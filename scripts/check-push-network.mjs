import assert from "node:assert/strict";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const bundle = await build({
  entryPoints: ["scripts/fixtures/push-worker.mjs"],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});
const script = bundle.outputFiles[0]?.text;
if (!script) throw new Error("Missing test Worker bundle");
let requests = 0;
let bytes = 0;
let status = 201;
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    compatibilityDate: "2026-10-05",
    script,
    outboundService: async (request) => {
      requests++;
      bytes = (await request.arrayBuffer()).byteLength;
      return new Response(null, {
        status,
        headers: status === 307 ? { Location: "https://untrusted.example/push" } : {},
      });
    },
  }),
);
try {
  const send = async () => (await runtime.dispatchFetch("https://test.local/network")).json();
  assert.deepEqual(await send(), {
    result: { status: "accepted", error: null, errorName: null, httpStatus: 201 },
  });
  assert.equal(bytes, 4096);
  assert.equal(requests, 1);
  status = 307;
  assert.deepEqual(await send(), {
    result: {
      status: "failed",
      error: "push-rejected",
      errorName: null,
      httpStatus: 307,
      providerReason: null,
    },
  });
  assert.equal(requests, 2);
  process.stdout.write(
    "[push] Real Worker fetch sends the encrypted request and does not follow redirects.\n",
  );
} finally {
  await runtime.dispose();
}
