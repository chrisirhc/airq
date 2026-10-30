import { defineHandler } from "void/handler";
import { handleLocation } from "../../worker/onemap";

export const POST = defineHandler((c) => handleLocation(c.req.raw, c.env));
