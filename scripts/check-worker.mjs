import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createTestHarness } from "wrangler";

const server = createTestHarness({
  workers: [
    {
      config: {
        name: "airq-badge-test",
        main: "worker/index.ts",
        compatibility_date: "2026-10-05",
        assets: {
          directory: "./dist",
          binding: "ASSETS",
          run_worker_first: ["/api/*", "/sw.js", "/manifest.webmanifest"],
        },
        d1_databases: [
          { binding: "BADGE_DB", database_name: "badge-test", database_id: "badge-test" },
        ],
        vars: {
          VAPID_PUBLIC_KEY: "test-public",
          VAPID_PRIVATE_KEY: "test-private",
          VAPID_SUBJECT: "mailto:test@example.com",
        },
      },
    },
  ],
});

try {
  await server.listen();
  const worker = server.getWorker();
  const { BADGE_DB: db } = await worker.getEnv();
  const sql = await readFile("migrations/0001_badge_gate.sql", "utf8");
  await db.batch(
    sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => db.prepare(statement)),
  );
  const origin = "https://airq.test";
  const subscription = {
    endpoint: "https://web.push.apple.com/test",
    expirationTime: null,
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  };
  const token = "A".repeat(43);
  const register = (body, requestOrigin = origin) =>
    worker.fetch(`${origin}/api/badge/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: requestOrigin },
      body: JSON.stringify(body),
    });
  assert.equal((await register({ subscription, token }, "https://evil.test")).status, 403);
  assert.equal(
    (
      await register({
        subscription: { ...subscription, endpoint: "https://127.0.0.1/internal" },
        token,
      })
    ).status,
    400,
  );
  const first = await register({ subscription, token });
  assert.equal(first.status, 201);
  const { id } = await first.json();
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal((await register({ subscription, token })).status, 201);
  assert.equal((await register({ subscription, token: "B".repeat(43) })).status, 409);
  const url = `${origin}/api/badge/subscriptions/${id}`;
  assert.equal(
    (await worker.fetch(url, { method: "DELETE", headers: { Origin: origin } })).status,
    401,
  );
  const headers = { Origin: origin, Authorization: `Bearer ${token}` };
  assert.deepEqual(await (await worker.fetch(`${url}/test`, { headers })).json(), {
    status: "none",
  });
  const row = await db
    .prepare("SELECT token_hash, subscription FROM subscriptions WHERE id = ?")
    .bind(id)
    .first();
  assert.notEqual(row.token_hash, token);
  assert.deepEqual(JSON.parse(row.subscription), subscription);
  await db
    .prepare("UPDATE subscriptions SET last_test_at = ? WHERE id = ?")
    .bind(Date.now(), id)
    .run();
  assert.equal((await worker.fetch(`${url}/test`, { method: "POST", headers })).status, 429);
  await db.prepare("UPDATE subscriptions SET expires_at = 0 WHERE id = ?").bind(id).run();
  assert.equal((await worker.fetch(`${url}/test`, { method: "POST", headers })).status, 410);
  assert.equal((await worker.fetch(url, { method: "DELETE", headers })).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM subscriptions").first()).count, 0);
  assert.equal((await worker.fetch(url, { method: "DELETE", headers })).status, 401);
  const config = await worker.fetch(`${origin}/api/badge/config`);
  assert.deepEqual(await config.json(), {
    enabled: true,
    publicKey: "test-public",
    testOnly: true,
  });
  assert.equal(config.headers.get("Cache-Control"), "no-store");
  assert.equal((await worker.fetch(`${origin}/sw.js`)).headers.get("Cache-Control"), "no-cache");
  process.stdout.write(
    "[worker] Registration, idempotency, authorization, endpoint restrictions, expiry, rate limit, deletion, and cache headers passed.\n",
  );
} finally {
  await server.close();
}
