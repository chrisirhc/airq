import { z } from "zod";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      !url.username &&
      !url.password &&
      (url.hostname.endsWith(".push.apple.com") ||
        url.hostname === "fcm.googleapis.com" ||
        url.hostname === "updates.push.services.mozilla.com" ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  }, "Unsupported push service"),
  expirationTime: z.number().nullable().default(null),
  keys: z.object({ p256dh: base64url.length(87), auth: base64url.length(22) }),
});
export const enrollmentSchema = z.object({
  subscription: pushSubscriptionSchema,
  token: base64url.length(43),
});
export const enrollmentReceiptSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) });
export const pushConfigSchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string(),
  testOnly: z.literal(true),
});
