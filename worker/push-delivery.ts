import { buildPushPayload } from "@block65/webcrypto-web-push";
import { z } from "zod";
import {
  providerReasonSchema,
  type pushSubscriptionSchema,
  safeErrorNameSchema,
  type testErrorSchema,
} from "../src/push-protocol";

type Failure = {
  status: "failed";
  error: z.infer<typeof testErrorSchema>;
  errorName: z.infer<typeof safeErrorNameSchema> | null;
  httpStatus: number | null;
  providerReason?: z.infer<typeof providerReasonSchema> | null;
};
export type PushResult =
  | Failure
  | (({ status: "accepted" } | { status: "expired" }) & {
      error: null;
      errorName: null;
      httpStatus: number;
    });

export async function deliverPush(
  subscription: z.infer<typeof pushSubscriptionSchema>,
  vapid: { publicKey: string; privateKey: string; subject: string },
  data: string,
  send: typeof fetch = fetch,
): Promise<PushResult> {
  let stage: "payload-error" | "push-network-error" = "payload-error";
  try {
    const payload = await buildPushPayload(
      { data, options: { ttl: 60, topic: "airq-reading" } },
      subscription,
      vapid,
    );
    stage = "push-network-error";
    const response = await send(subscription.endpoint, {
      ...payload,
      redirect: "error",
      signal: AbortSignal.timeout(6_000),
    });
    if (response.status === 404 || response.status === 410)
      return { status: "expired", error: null, errorName: null, httpStatus: response.status };
    if (response.ok)
      return { status: "accepted", error: null, errorName: null, httpStatus: response.status };
    const reason = z
      .object({ reason: providerReasonSchema })
      .safeParse(await response.json().catch(() => null));
    return {
      status: "failed",
      error: "push-rejected",
      errorName: null,
      httpStatus: response.status,
      providerReason: reason.success ? reason.data.reason : null,
    };
  } catch (error: unknown) {
    const name = safeErrorNameSchema.safeParse(error instanceof Error ? error.name : "Error");
    return {
      status: "failed",
      error: stage,
      errorName: name.success ? name.data : "Error",
      httpStatus: null,
    };
  }
}
