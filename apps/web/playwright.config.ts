import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";
const port = process.env.PORT ?? "5173";
export default defineConfig({
  testDir: "./tests",
  // *.production.spec.ts needs the built service worker and offline inventory; it runs only on the production config.
  testIgnore: "**/*.production.spec.ts",
  // Every test gets its own context, so its own IndexedDB, storage and service worker.
  fullyParallel: true,
  // A quarter of the cores (3 on a 12-core Mac) leaves the machine usable while the gate runs.
  workers: Math.max(1, Math.floor(availableParallelism() / 4)),
  // Absolute, so every config that spreads this one resolves the same file.
  globalSetup: fileURLToPath(new URL("./tests/warm-dev-server.ts", import.meta.url)),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["iPhone 13"],
    browserName: "chromium",
    channel: "chrome",
    // Sheets and alerts settle at once; motion itself is observed only by the production-only specs.
    contextOptions: { reducedMotion: "reduce" },
    // Fixture pages served by page.route (question-session, mogi-render) have no address, so Chrome's local network
    // access checks block their Vite WebSocket and the page spins on the failure.
    permissions: ["local-network-access"],
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
