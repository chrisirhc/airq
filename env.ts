import { defineEnv, string } from "void/env";

export default defineEnv({
  ONEMAP_EMAIL: string().optional(),
  ONEMAP_PASSWORD: string().optional(),
  VAPID_PUBLIC_KEY: string().optional(),
  VAPID_PRIVATE_KEY: string().optional(),
  VAPID_SUBJECT: string().optional(),
});
