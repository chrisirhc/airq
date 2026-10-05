import { spawnSync } from "node:child_process";

const checks = [
  ["Lint", "npm", ["run", "lint"]],
  ["Types", "npm", ["run", "typecheck"]],
  ["Unit tests", "npm", ["test"]],
  ["Production build", "npm", ["run", "build"]],
  ["Worker integration", "npm", ["run", "test:worker"]],
  ["Browser test", "npm", ["run", "test:browser"]],
];

for (const [label, command, args] of checks) {
  process.stdout.write(`\n[verify] ${label}\n`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("\n[verify] All checks passed.\n");
