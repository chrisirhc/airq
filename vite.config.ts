import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  preview: {
    allowedHosts: ["slateserver.lan", "airq.slt.b65.dev"],
  },
  build: {
    rollupOptions: {
      input: { app: "index.html", sw: "worker/service-worker.ts" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
