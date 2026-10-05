import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const server = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
});

let serverError = "";
server.stderr.on("data", (chunk) => {
  serverError += chunk.toString();
});

try {
  await waitForServer(server);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.getByText("Central region PM2.5").waitFor();
    await page.getByText("Central region PSI").waitFor();

    const unavailable = await page.getByText("Reading unavailable").count();
    if (unavailable > 0) throw new Error("The live data source returned an unavailable reading.");

    const values = await page.locator(".reading-value strong").allTextContents();
    if (values.length !== 2 || values.some((value) => !/^\d+$/.test(value.trim()))) {
      throw new Error(`Unexpected live values: ${JSON.stringify(values)}`);
    }
    process.stdout.write(`[live] Central PM2.5 ${values[0]}, PSI ${values[1]}.\n`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

async function waitForServer(process) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Preview server timed out. ${serverError}`)),
      10_000,
    );
    const onData = (chunk) => {
      if (!chunk.toString().includes("http://127.0.0.1:4173")) return;
      clearTimeout(timeout);
      process.stdout.off("data", onData);
      resolve();
    };
    process.stdout.on("data", onData);
    process.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Preview server exited with ${code}. ${serverError}`));
    });
  });
}
