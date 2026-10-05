import { spawn, spawnSync } from "node:child_process";

const subject = process.argv[2];
if (!subject || !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) {
  throw new Error("Usage: node scripts/setup-push-secrets.mjs mailto:you@example.com");
}
const names = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
const existing = spawnSync("npx", ["wrangler", "secret", "list", "--format", "json"], {
  encoding: "utf8",
});
if (existing.status !== 0)
  throw new Error("Cannot read secret inventory. Run npx wrangler login first.");
const secrets = JSON.parse(existing.stdout);
if (!Array.isArray(secrets) || secrets.some((secret) => names.includes(secret.name))) {
  throw new Error(
    "VAPID secrets already exist. Refusing to rotate keys or invalidate installed subscriptions.",
  );
}
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
if (!privateKey.d) throw new Error("VAPID key export failed");
const publicKey = Buffer.from(raw).toString("base64url");
const upload = spawn("npx", ["wrangler", "secret", "bulk"], {
  stdio: ["pipe", "inherit", "inherit"],
});
upload.stdin.end(
  JSON.stringify({
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey.d,
    VAPID_SUBJECT: subject,
  }),
);
await new Promise((resolve, reject) => {
  upload.once("error", reject);
  upload.once("exit", (code) =>
    code === 0
      ? resolve()
      : reject(new Error("Secret upload failed. Check secret inventory before retrying.")),
  );
});
process.stdout.write("VAPID secrets created. No private key was written to disk or printed.\n");
