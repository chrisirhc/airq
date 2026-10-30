import { defineConfig } from "void/config";

export default defineConfig({
  worker: {
    compatibility_date: "2026-10-05",
    compatibility_flags: ["nodejs_compat"],
  },
  cloudflare: {
    name: "airq",
    workers_dev: false,
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      traces: {
        enabled: false,
      },
    },
    d1_databases: [
      {
        binding: "BADGE_DB",
        database_name: "airq-badge",
        database_id: "f5084845-bcf1-4e27-80c1-4db84effb37d",
        migrations_dir: "migrations",
      },
    ],
    routes: [
      {
        pattern: "airq.b65.dev",
        custom_domain: true,
      },
    ],
  },
});
