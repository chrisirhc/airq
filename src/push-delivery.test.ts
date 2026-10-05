// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deliverPush } from "../worker/push-delivery";
import { testStatusMessage } from "./push-protocol";

async function fixture() {
  const vapidPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const devicePair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const encode = (bytes: ArrayBuffer | Uint8Array) =>
    Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
  const privateKey = await crypto.subtle.exportKey("jwk", vapidPair.privateKey);
  if (!privateKey.d) throw new Error("Missing fixture key");
  return {
    subscription: {
      endpoint: "https://web.push.apple.com/secret-endpoint",
      expirationTime: null,
      keys: {
        p256dh: encode(await crypto.subtle.exportKey("raw", devicePair.publicKey)),
        auth: encode(crypto.getRandomValues(new Uint8Array(16))),
      },
    },
    vapid: {
      publicKey: encode(await crypto.subtle.exportKey("raw", vapidPair.publicKey)),
      privateKey: privateKey.d,
      subject: "mailto:test@example.com",
    },
  };
}

describe("test push diagnostics", () => {
  it("encrypts a real payload and reports a push-service rejection without exposing its body", async () => {
    const { subscription, vapid } = await fixture();
    let encryptedBytes = 0;
    const result = await deliverPush(
      subscription,
      vapid,
      '{"reading":30}',
      async (_input, init) => {
        encryptedBytes = (await new Response(init?.body).arrayBuffer()).byteLength;
        return new Response("secret response containing credentials", { status: 403 });
      },
    );
    expect(encryptedBytes).toBe(4096);
    expect(result).toEqual({
      status: "failed",
      error: "push-rejected",
      errorName: null,
      httpStatus: 403,
      providerReason: null,
    });
    if (result.status !== "failed") throw new Error("Expected rejected delivery");
    expect(testStatusMessage(result)).toBe("Push service rejected the test (HTTP 403).");
  });
  it("distinguishes crypto preparation errors from network errors", async () => {
    const { subscription, vapid } = await fixture();
    expect(
      await deliverPush(subscription, { ...vapid, privateKey: "invalid" }, "test"),
    ).toMatchObject({ status: "failed", error: "payload-error", httpStatus: null });
    expect(
      await deliverPush(subscription, vapid, "test", async () => {
        throw new TypeError(subscription.endpoint);
      }),
    ).toEqual({
      status: "failed",
      error: "push-network-error",
      errorName: "TypeError",
      httpStatus: null,
    });
  });
  it("retains only documented provider reasons", async () => {
    const { subscription, vapid } = await fixture();
    const result = await deliverPush(subscription, vapid, "test", async () =>
      Response.json({ reason: "BadJwtToken", endpoint: subscription.endpoint }, { status: 403 }),
    );
    expect(result).toEqual({
      status: "failed",
      error: "push-rejected",
      errorName: null,
      httpStatus: 403,
      providerReason: "BadJwtToken",
    });
  });
  it("reports acceptance without claiming device receipt", async () => {
    const { subscription, vapid } = await fixture();
    const result = await deliverPush(
      subscription,
      vapid,
      "test",
      async () => new Response(null, { status: 201 }),
    );
    expect(result).toEqual({ status: "accepted", error: null, errorName: null, httpStatus: 201 });
    if (result.status !== "accepted") throw new Error("Expected accepted delivery");
    expect(testStatusMessage(result)).toContain("does not confirm device delivery");
  });
});
