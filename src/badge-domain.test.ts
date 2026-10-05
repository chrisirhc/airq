import { describe, expect, it } from "vitest";
import {
  applyBadgeCommand,
  type BadgeState,
  type BadgeTarget,
  badgeTargetSchema,
  currentDecision,
  decideBadge,
  expireSavedTarget,
  newestSnapshot,
  notificationPresentation,
  type RegionalSnapshot,
} from "./badge-domain";
import { coordinateSchema, pm25Schema, REGIONS } from "./domain";
import { estimatePm25 } from "./location-estimator";
import { pushSubscriptionSchema } from "./push-protocol";

const snapshot: RegionalSnapshot = {
  revision: 2,
  readingAt: 1_000,
  updatedAt: 1_000,
  validUntil: 100_000,
  referenceFingerprint: "five points",
  estimatorVersion: 1,
  values: { north: 10, south: 20, east: 30, west: 40, central: 50 },
};
const target: BadgeTarget = {
  kind: "estimate",
  weights: { north: 0.1, south: 0.2, east: 0.3, west: 0.2, central: 0.2 },
  referenceFingerprint: "five points",
  estimatorVersion: 1,
  capturedAt: 0,
  expiresAt: 200_000,
};
const background: BadgeState = { mode: "background", target, snapshot };

describe("badge calculation and lifetime", () => {
  it("rounds the weighted estimate rather than a regional or notification count", () => {
    expect(
      decideBadge(
        snapshot,
        { ...target, weights: { ...target.weights, north: 0.123, south: 0.177 } },
        2_000,
      ),
    ).toEqual({
      kind: "reading",
      value: 31.77,
      rounded: 32,
      readingAt: 1_000,
      validUntil: 100_000,
    });
  });
  it("uses a selected official region directly", () => {
    expect(decideBadge(snapshot, { kind: "region", region: "west" }, 2_000)).toMatchObject({
      value: 40,
      rounded: 40,
    });
  });
  it("preserves actual zero", () => {
    expect(
      decideBadge(
        { ...snapshot, values: { ...snapshot.values, east: 0 } },
        { kind: "region", region: "east" },
        2_000,
      ),
    ).toMatchObject({ value: 0, rounded: 0 });
  });
  it("clears stale, expired, changed-reference and changed-algorithm targets", () => {
    expect(decideBadge(snapshot, target, 100_000)).toEqual({ kind: "clear", reason: "stale" });
    expect(decideBadge(snapshot, { ...target, expiresAt: 2_000 }, 2_000)).toEqual({
      kind: "clear",
      reason: "expired",
    });
    expect(decideBadge({ ...snapshot, referenceFingerprint: "moved" }, target, 2_000)).toEqual({
      kind: "clear",
      reason: "target-mismatch",
    });
    expect(decideBadge({ ...snapshot, estimatorVersion: 2 }, target, 2_000)).toEqual({
      kind: "clear",
      reason: "target-mismatch",
    });
    expect(decideBadge({ ...snapshot, updatedAt: 70_000 }, target, 2_000)).toEqual({
      kind: "clear",
      reason: "stale",
    });
  });
  it("rejects malformed weights and excessive target retention at the boundary", () => {
    expect(
      badgeTargetSchema.safeParse({ ...target, weights: { ...target.weights, east: 10 } }).success,
    ).toBe(false);
    expect(badgeTargetSchema.safeParse({ ...target, expiresAt: 100_000_000 }).success).toBe(false);
  });
  it("removes expired sensitive weights on the next execution", () => {
    const expired = expireSavedTarget(background, 200_000);
    expect(expired).toMatchObject({ mode: "background", target: null });
    expect(currentDecision(expired, 200_000)).toEqual({ kind: "clear", reason: "expired" });
  });
  it("agrees with the existing estimator at an exact reference", () => {
    const points = REGIONS.map((name, index) => ({
      name,
      coordinate: coordinateSchema.parse({ latitude: 1.3 + index * 0.01, longitude: 103.8 }),
    }));
    const regionalValues = {
      north: pm25Schema.parse(10),
      south: pm25Schema.parse(20),
      east: pm25Schema.parse(30),
      west: pm25Schema.parse(40),
      central: pm25Schema.parse(50),
    };
    const result = estimatePm25({
      coordinate: coordinateSchema.parse({ latitude: 1.32, longitude: 103.8 }),
      references: points,
      values: regionalValues,
    });
    expect(result.kind).toBe("estimated");
    if (result.kind !== "estimated") throw new Error("Expected estimate");
    const exactWeights = { north: 0, south: 0, east: 0, west: 0, central: 0 };
    for (const contribution of result.estimate.contributions)
      exactWeights[contribution.region] = contribution.weight;
    expect(decideBadge(snapshot, { ...target, weights: exactWeights }, 2_000)).toMatchObject({
      value: 30,
      rounded: 30,
    });
  });
});

describe("badge ordering and opt-out", () => {
  it("ignores old deliveries and accepts same-timestamp corrections", () => {
    expect(
      newestSnapshot(snapshot, {
        ...snapshot,
        revision: 1,
        values: { ...snapshot.values, east: 99 },
      }),
    ).toEqual(snapshot);
    expect(
      newestSnapshot(snapshot, {
        ...snapshot,
        revision: 3,
        values: { ...snapshot.values, east: 35 },
      }).values.east,
    ).toBe(35);
    expect(newestSnapshot(snapshot, { ...snapshot, revision: 9, readingAt: 0 })).toEqual(snapshot);
  });
  it("recalculates the newest snapshot for the replacement target", () => {
    const updated = applyBadgeCommand(background, {
      kind: "target",
      target: { kind: "region", region: "west" },
      snapshot: { ...snapshot, revision: 0 },
    });
    expect(currentDecision(updated, 2_000)).toMatchObject({ rounded: 40 });
  });
  it("refreshes background readings without extending saved-location expiry", () => {
    const updated = applyBadgeCommand(background, {
      kind: "snapshot",
      snapshot: { ...snapshot, revision: 3, values: { ...snapshot.values, east: 40 } },
    });
    expect(currentDecision(updated, 2_000)).toMatchObject({ value: 35, rounded: 35 });
    expect(updated).toMatchObject({ target: { expiresAt: 200_000 } });
    expect(
      currentDecision(applyBadgeCommand(updated, { kind: "snapshot", snapshot: null }), 2_000),
    ).toEqual({ kind: "clear", reason: "stale" });
  });
  it("clears before opt-out cleanup and gives disabled/expired pushes visible nonnumeric status", () => {
    const disabled = applyBadgeCommand(background, { kind: "disable" });
    expect(currentDecision(disabled, 2_000)).toEqual({ kind: "clear", reason: "disabled" });
    expect(notificationPresentation(disabled, 2_000).body).toContain(
      "No current background estimate",
    );
    expect(notificationPresentation(background, 200_000).body).toContain("Saved location expired");
  });
  it("labels units and saved location in each valid notification", () => {
    expect(notificationPresentation(background, 2_000)).toMatchObject({ title: "PM2.5 32 µg/m³" });
    expect(notificationPresentation(background, 2_000).body).toContain("saved location");
  });
});

it("blocks arbitrary fetch destinations and accepts known HTTPS push services", () => {
  const input = {
    endpoint: "https://web.push.apple.com/test",
    expirationTime: null,
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  };
  expect(pushSubscriptionSchema.safeParse(input).success).toBe(true);
  for (const endpoint of [
    "http://web.push.apple.com/test",
    "https://127.0.0.1/test",
    "https://web.push.apple.com.evil.test/test",
    "https://fcm.googleapis.com:123/test",
  ])
    expect(pushSubscriptionSchema.safeParse({ ...input, endpoint }).success).toBe(false);
});
