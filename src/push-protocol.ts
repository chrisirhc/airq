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

export const testErrorSchema = z.enum([
  "reading-unavailable",
  "payload-error",
  "push-network-error",
  "push-rejected",
]);
export const safeErrorNameSchema = z.enum([
  "Error",
  "TypeError",
  "DataError",
  "OperationError",
  "NotSupportedError",
  "InvalidAccessError",
  "AbortError",
  "TimeoutError",
]);
export const providerReasonSchema = z.enum([
  "BadTtl",
  "BadUrgency",
  "BadWebPushRequest",
  "BadWebPushTopic",
  "VapidPkHashMismatch",
  "IdleTimeout",
  "BadAuthorizationHeader",
  "BadJwtToken",
  "BadVapidPublicKey",
  "BadPath",
  "MethodNotAllowed",
  "PayloadTooLarge",
  "TooManyRequests",
  "InternalServerError",
  "ServiceUnavailable",
  "Shutdown",
]);
export const testStatusSchema = z.object({
  status: z.enum(["none", "pending", "accepted", "failed"]),
  error: testErrorSchema.nullable().optional(),
  errorName: safeErrorNameSchema.nullable().optional(),
  httpStatus: z.number().int().min(100).max(599).nullable().optional(),
  providerReason: providerReasonSchema.nullable().optional(),
});

export function testStatusMessage(result: z.infer<typeof testStatusSchema>): string {
  switch (result.status) {
    case "none":
      return "No test has been requested.";
    case "pending":
      return "Test pending. Close AirQ now; delivery starts after 10 seconds. Reopen to check the result.";
    case "accepted":
      return "Push service accepted the test. This does not confirm device delivery. Check your notifications and Home Screen badge.";
    case "failed": {
      switch (result.error) {
        case "reading-unavailable":
          return "Test failed: fresh official readings were unavailable. Try again after a minute.";
        case "payload-error":
          return `Test failed while preparing the encrypted push${result.errorName ? ` (${result.errorName})` : ""}.`;
        case "push-network-error":
          return `Test failed contacting the push service${result.errorName ? ` (${result.errorName})` : ""}. Try again after a minute.`;
        case "push-rejected":
          return `Push service rejected the test${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ""}${result.providerReason ? `: ${result.providerReason}` : ""}.`;
        default:
          return "Test delivery failed. This older test has no recorded failure reason. Send a new test after a minute.";
      }
    }
  }
}
