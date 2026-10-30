import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { voidPlugin } from "void";

export default defineConfig({
  base: "./",
  plugins: [react(), ...(process.env.VITEST ? [] : [voidPlugin()])],
  preview: {
    allowedHosts: ["slateserver.lan", "airq.slt.b65.dev"],
  },
  build: { outDir: "dist/client", cssTarget: ["chrome123", "firefox120", "safari17.5"] },
  environments: {
    client: {
      build: {
        outDir: "dist/client",
        rollupOptions: {
          input: { app: "index.html", sw: "worker/service-worker.ts" },
          output: {
            entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
          },
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
