import { defineHandler } from "void/handler";
import { handleBadge } from "../../../worker/badge";

const badge = defineHandler((c) => handleBadge(c.req.raw, c.env, c.executionCtx));

export const GET = badge;
export const POST = badge;
export const DELETE = badge;
