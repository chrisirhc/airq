import { defineHandler } from "void/handler";

export const GET = defineHandler(async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache");
  return new Response(response.body, { status: response.status, headers });
});
