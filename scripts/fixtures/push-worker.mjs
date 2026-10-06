import { deliverPush } from "../../worker/push-delivery";

export default {
  async fetch(request) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const device = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]);
    const encode = (bytes) =>
      btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const key = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const subscription = {
      endpoint: "https://web.push.apple.com/test",
      expirationTime: null,
      keys: {
        p256dh: encode(await crypto.subtle.exportKey("raw", device.publicKey)),
        auth: encode(crypto.getRandomValues(new Uint8Array(16))),
      },
    };
    const vapid = {
      publicKey: encode(await crypto.subtle.exportKey("raw", pair.publicKey)),
      privateKey: key.d,
      subject: "mailto:test@example.com",
    };
    let bytes = 0;
    if (new URL(request.url).pathname === "/network")
      return Response.json({ result: await deliverPush(subscription, vapid, "test") });
    const result = await deliverPush(subscription, vapid, "test", async (_input, init) => {
      bytes = (await new Response(init.body).arrayBuffer()).byteLength;
      return new Response(null, { status: 403 });
    });
    return Response.json({ result, bytes });
  },
};
