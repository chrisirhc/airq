import type { BadgeEnv } from "./badge";
import type { OneMapEnv } from "./onemap";

declare module "void/handler" {
  interface CloudBindings extends BadgeEnv, OneMapEnv {}
}
