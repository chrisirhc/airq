import { z } from "zod";
import {
  ESTIMATOR_VERSION,
  READING_LIFETIME_MS,
  referenceFingerprint,
  regionalSnapshotSchema,
} from "../src/badge-domain";
import { parsePm25 } from "../src/public-readings";
import { enrollmentSchema, pushSubscriptionSchema, testStatusSchema } from "../src/push-protocol";
import { deliverPush } from "./push-delivery";

interface Env {
  ASSETS: Fetcher;
  BADGE_DB?: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
const storedEnrollmentSchema = z.object({
  subscription: z.string(),
  token_hash: z.string(),
  expires_at: z.number(),
  test_status: z.string(),
  test_error: z.string().nullable(),
  test_error_name: z.string().nullable(),
  test_http_status: z.number().nullable(),
  test_provider_reason: z.string().nullable(),
});
const storedSnapshotSchema = z.object({ revision: z.number().int(), payload: z.string() });
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

export async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function collectSnapshot(db: D1Database) {
  const response = await fetch("https://api-open.data.gov.sg/v2/real-time/api/pm25", {
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error("Official readings unavailable");
  const reading = parsePm25(await response.json(), new Date(), READING_LIFETIME_MS);
  const now = Date.now();
  if (
    reading.stale ||
    reading.updatedAt.getTime() > now + 60_000 ||
    reading.timestamp.getTime() > now + 60_000
  )
    throw new Error("No fresh official reading");
  const payload = JSON.stringify({
    readingAt: reading.timestamp.getTime(),
    updatedAt: reading.updatedAt.getTime(),
    validUntil: reading.updatedAt.getTime() + READING_LIFETIME_MS,
    values: reading.values,
    referenceFingerprint: referenceFingerprint(reading.references),
    estimatorVersion: ESTIMATOR_VERSION,
  });
  const contentHash = await hash(payload);
  await db
    .prepare("INSERT OR IGNORE INTO snapshots (content_hash, payload) VALUES (?, ?)")
    .bind(contentHash, payload)
    .run();
  const row = storedSnapshotSchema.parse(
    await db
      .prepare("SELECT revision, payload FROM snapshots WHERE content_hash = ?")
      .bind(contentHash)
      .first(),
  );
  return regionalSnapshotSchema.parse({ ...JSON.parse(row.payload), revision: row.revision });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/badge/")) {
      const response = await env.ASSETS.fetch(request);
      if (url.pathname.endsWith("/sw.js") || url.pathname.endsWith("/manifest.webmanifest")) {
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-cache");
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    }
    if (request.method === "GET" && url.pathname === "/api/badge/config")
      return json({
        enabled: Boolean(
          env.BADGE_DB && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT,
        ),
        publicKey: env.VAPID_PUBLIC_KEY ?? "",
        testOnly: true,
      });
    const db = env.BADGE_DB;
    const publicKey = env.VAPID_PUBLIC_KEY;
    const privateKey = env.VAPID_PRIVATE_KEY;
    const subject = env.VAPID_SUBJECT;
    if (!db || !publicKey || !privateKey || !subject)
      return json({ error: "Background test is not configured" }, 503);
    if (request.method !== "GET" && request.headers.get("Origin") !== url.origin)
      return json({ error: "Same-origin request required" }, 403);
    try {
      if (request.method === "POST" && url.pathname === "/api/badge/subscriptions") {
        if (request.headers.get("Content-Type") !== "application/json")
          return json({ error: "JSON required" }, 415);
        const body = await request.text();
        if (body.length > 4096) return json({ error: "Request too large" }, 413);
        const enrollment = enrollmentSchema.parse(JSON.parse(body));
        const id = await hash(enrollment.subscription.endpoint);
        const tokenHash = await hash(enrollment.token);
        await db.prepare("DELETE FROM subscriptions WHERE expires_at < ?").bind(Date.now()).run();
        const result = await db
          .prepare(`INSERT INTO subscriptions (id, subscription, token_hash, expires_at)
          SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM subscriptions) < 1000
          OR EXISTS (SELECT 1 FROM subscriptions WHERE id = ?)
          ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,
          expires_at=excluded.expires_at WHERE subscriptions.token_hash=excluded.token_hash`)
          .bind(
            id,
            JSON.stringify(enrollment.subscription),
            tokenHash,
            Date.now() + 30 * 24 * 60 * 60 * 1000,
            id,
          )
          .run();
        if (result.meta.changes === 0)
          return json(
            { error: "Enrollment limit reached or subscription belongs to another enrollment" },
            409,
          );
        return json({ id }, 201);
      }
      const match = /^\/api\/badge\/subscriptions\/([a-f0-9]{64})(\/test)?$/.exec(url.pathname);
      const id = match?.[1];
      if (!id) return json({ error: "Not found" }, 404);
      const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return json({ error: "Unauthorized" }, 401);
      const row = storedEnrollmentSchema.safeParse(
        await db.prepare("SELECT * FROM subscriptions WHERE id = ?").bind(id).first(),
      );
      if (!row.success || row.data.token_hash !== (await hash(token)))
        return json({ error: "Unauthorized" }, 401);
      if (request.method === "DELETE" && !match?.[2]) {
        await db.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
        return json({ deleted: true });
      }
      if (request.method === "GET" && match?.[2])
        return json(
          testStatusSchema.parse({
            status: row.data.test_status,
            error: row.data.test_error,
            errorName: row.data.test_error_name,
            httpStatus: row.data.test_http_status,
            providerReason: row.data.test_provider_reason,
          }),
        );
      if (request.method !== "POST" || !match?.[2])
        return json({ error: "Method not allowed" }, 405);
      if (row.data.expires_at <= Date.now())
        return json({ error: "Enrollment expired. Disable and enable again." }, 410);
      const reserved = await db
        .prepare(
          "UPDATE subscriptions SET last_test_at = ?, test_status = 'pending', test_error = NULL, test_error_name = NULL, test_http_status = NULL, test_provider_reason = NULL WHERE id = ? AND last_test_at < ?",
        )
        .bind(Date.now(), id, Date.now() - 60_000)
        .run();
      if (reserved.meta.changes === 0) return json({ error: "Wait one minute between tests" }, 429);
      const snapshot = await collectSnapshot(db).catch(async (error: unknown) => {
        await db
          .prepare(
            "UPDATE subscriptions SET test_status = 'failed', test_error = 'reading-unavailable' WHERE id = ?",
          )
          .bind(id)
          .run();
        throw error;
      });
      const subscription = pushSubscriptionSchema.parse(JSON.parse(row.data.subscription));
      ctx.waitUntil(
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          try {
            const active = await db
              .prepare("SELECT id FROM subscriptions WHERE id = ? AND expires_at > ?")
              .bind(id, Date.now())
              .first();
            if (!active) return;
            const result = await deliverPush(
              subscription,
              { publicKey, privateKey, subject },
              JSON.stringify(snapshot),
            );
            if (result.status === "expired")
              await db.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
            else
              await db
                .prepare(
                  "UPDATE subscriptions SET test_status = ?, test_error = ?, test_error_name = ?, test_http_status = ?, test_provider_reason = ? WHERE id = ?",
                )
                .bind(
                  result.status,
                  result.error,
                  result.errorName,
                  result.httpStatus,
                  result.status === "failed" ? (result.providerReason ?? null) : null,
                  id,
                )
                .run();
          } catch {
            await db
              .prepare("UPDATE subscriptions SET test_status = 'failed' WHERE id = ?")
              .bind(id)
              .run();
          }
        })(),
      );
      return json({ status: "pending", delaySeconds: 10 }, 202);
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return json({ error: "Invalid request or stored data" }, 400);
      return json({ error: "Background test unavailable. Try again later." }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
