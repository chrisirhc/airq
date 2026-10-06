import { z } from "zod";
import { REGIONS, type RegionReference, regionSchema } from "./domain";

export const TARGET_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const READING_LIFETIME_MS = 45 * 60 * 1000;
export const ESTIMATOR_VERSION = 1;
const time = z.number().int().nonnegative();
const values = z.object({
  north: z.number().finite().nonnegative(),
  south: z.number().finite().nonnegative(),
  east: z.number().finite().nonnegative(),
  west: z.number().finite().nonnegative(),
  central: z.number().finite().nonnegative(),
});
const weights = values.refine(
  (value) => Math.abs(REGIONS.reduce((sum, region) => sum + value[region], 0) - 1) < 1e-9,
  "Weights must sum to one",
);
export const badgeTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("region"), region: regionSchema }),
  z
    .object({
      kind: z.literal("estimate"),
      weights,
      referenceFingerprint: z.string(),
      estimatorVersion: z.number().int().positive(),
      capturedAt: time,
      expiresAt: time,
    })
    .refine(
      (target) =>
        target.expiresAt > target.capturedAt &&
        target.expiresAt - target.capturedAt <= TARGET_LIFETIME_MS,
      "Invalid target lifetime",
    ),
]);
export type BadgeTarget = z.infer<typeof badgeTargetSchema>;
export const regionalSnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    readingAt: time,
    updatedAt: time,
    validUntil: time,
    referenceFingerprint: z.string(),
    estimatorVersion: z.number().int().positive(),
    values,
  })
  .refine(
    (snapshot) => snapshot.validUntil <= snapshot.updatedAt + READING_LIFETIME_MS,
    "Invalid reading lifetime",
  );
export type RegionalSnapshot = z.infer<typeof regionalSnapshotSchema>;
export const badgeDecisionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("reading"),
      value: z.number().finite().nonnegative(),
      rounded: z.number().int().nonnegative(),
      readingAt: time,
      validUntil: time,
    })
    .refine(
      (decision) => decision.rounded === Math.round(decision.value),
      "Badge must round the reading",
    ),
  z.object({
    kind: z.literal("clear"),
    reason: z.enum(["disabled", "expired", "stale", "target-mismatch", "test"]),
  }),
]);
export type BadgeDecision = z.infer<typeof badgeDecisionSchema>;
export const badgeStateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("disabled") }),
  z.object({ mode: z.literal("foreground"), decision: badgeDecisionSchema }),
  z.object({
    mode: z.literal("background"),
    target: badgeTargetSchema.nullable(),
    snapshot: regionalSnapshotSchema.nullable(),
    badgeClearedForTest: z.literal(true).optional(),
  }),
]);
export type BadgeState = z.infer<typeof badgeStateSchema>;
export const badgeCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status") }),
  z.object({ kind: z.literal("disable") }),
  z.object({ kind: z.literal("clear-for-test") }),
  z.object({ kind: z.literal("snapshot"), snapshot: regionalSnapshotSchema.nullable() }),
  z.object({ kind: z.literal("foreground"), decision: badgeDecisionSchema }),
  z.object({
    kind: z.literal("target"),
    target: badgeTargetSchema,
    snapshot: regionalSnapshotSchema,
  }),
]);
export type BadgeCommand = z.infer<typeof badgeCommandSchema>;

export function referenceFingerprint(references: readonly RegionReference[]): string {
  return JSON.stringify(
    REGIONS.map((region) => {
      const point = references.find((reference) => reference.name === region);
      return [region, point?.coordinate.latitude, point?.coordinate.longitude];
    }),
  );
}

export function decideBadge(
  snapshot: RegionalSnapshot,
  target: BadgeTarget,
  now: number,
): BadgeDecision {
  if (target.kind === "estimate" && now >= target.expiresAt)
    return { kind: "clear", reason: "expired" };
  if (
    now >= snapshot.validUntil ||
    snapshot.updatedAt > now + 60_000 ||
    snapshot.readingAt > now + 60_000
  )
    return { kind: "clear", reason: "stale" };
  if (
    target.kind === "estimate" &&
    (target.referenceFingerprint !== snapshot.referenceFingerprint ||
      target.estimatorVersion !== snapshot.estimatorVersion)
  )
    return { kind: "clear", reason: "target-mismatch" };
  const value =
    target.kind === "region"
      ? snapshot.values[target.region]
      : REGIONS.reduce((sum, region) => sum + snapshot.values[region] * target.weights[region], 0);
  return {
    kind: "reading",
    value,
    rounded: Math.round(value),
    readingAt: snapshot.readingAt,
    validUntil: snapshot.validUntil,
  };
}

export function newestSnapshot(
  current: RegionalSnapshot | null,
  incoming: RegionalSnapshot,
): RegionalSnapshot {
  if (!current) return incoming;
  if (incoming.readingAt !== current.readingAt)
    return incoming.readingAt > current.readingAt ? incoming : current;
  if (incoming.updatedAt !== current.updatedAt)
    return incoming.updatedAt > current.updatedAt ? incoming : current;
  return incoming.revision > current.revision ? incoming : current;
}

export function currentDecision(state: BadgeState, now: number): BadgeDecision {
  if (state.mode === "disabled") return { kind: "clear", reason: "disabled" };
  if (state.mode === "foreground")
    return state.decision.kind === "reading" && now >= state.decision.validUntil
      ? { kind: "clear", reason: "stale" }
      : state.decision;
  if (!state.target) return { kind: "clear", reason: "expired" };
  if (state.badgeClearedForTest) return { kind: "clear", reason: "test" };
  return state.snapshot
    ? decideBadge(state.snapshot, state.target, now)
    : { kind: "clear", reason: "stale" };
}

export function applyBadgeCommand(state: BadgeState, command: BadgeCommand): BadgeState {
  switch (command.kind) {
    case "status":
      return state;
    case "disable":
      return { mode: "disabled" };
    case "clear-for-test":
      return state.mode === "background" ? { ...state, badgeClearedForTest: true } : state;
    case "foreground":
      return { mode: "foreground", decision: command.decision };
    case "snapshot":
      return state.mode === "background"
        ? {
            ...state,
            snapshot: command.snapshot ? newestSnapshot(state.snapshot, command.snapshot) : null,
          }
        : state;
    case "target":
      return {
        mode: "background",
        ...(state.mode === "background" && state.badgeClearedForTest
          ? { badgeClearedForTest: true }
          : {}),
        target: command.target,
        snapshot: newestSnapshot(
          state.mode === "background" ? state.snapshot : null,
          command.snapshot,
        ),
      };
  }
}

export function expireSavedTarget(state: BadgeState, now: number): BadgeState {
  return state.mode === "background" &&
    state.target?.kind === "estimate" &&
    now >= state.target.expiresAt
    ? { ...state, target: null }
    : state;
}

export function notificationPresentation(
  state: BadgeState,
  now: number,
): { title: string; body: string } {
  const decision = currentDecision(state, now);
  if (state.mode !== "background" || !state.target || decision.kind === "clear")
    return {
      title: "AirQ badge update",
      body:
        decision.kind === "clear" && decision.reason === "expired"
          ? "Saved location expired. Open AirQ to refresh your location."
          : "No current background estimate. Open AirQ to check your settings and readings.",
    };
  const target =
    state.target.kind === "estimate" ? "saved location" : `${state.target.region} region`;
  const reading = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "numeric",
    minute: "2-digit",
  }).format(decision.readingAt);
  return {
    title: `PM2.5 ${decision.rounded} µg/m³`,
    body: `${target}, reading at ${reading}. Last received reading, not live tracking.`,
  };
}
