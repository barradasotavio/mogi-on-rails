import { defineConfig } from "@playwright/test";

import production from "./playwright.chrome-production.config";
import development from "./playwright.config";
export default defineConfig({
  ...(process.env.QUICK_PRODUCTION === "1" ? production : development),
  use: { ...(process.env.QUICK_PRODUCTION === "1" ? production.use : development.use), trace: "retain-on-failure" },
  globalSetup: undefined,
  testMatch: "quick-journey.spec.ts",
  grep: /.*/,
});
