import { defineConfig } from "@playwright/test";

import development from "./playwright.config";
const port = process.env.PORT ?? "5214";

export default defineConfig({
  ...development,
  // PRODUCTION_SPECS_ONLY lets test:focused send just the production-only specs here.
  ...(process.env.PRODUCTION_SPECS_ONLY === "1" ? { testMatch: "**/*.production.spec.ts" } : {}),
  testIgnore: [],
  // The build needs no warming.
  globalSetup: undefined,
  timeout: 90000,
  expect: { timeout: 3000 },
  use: { ...development.use, contextOptions: {}, baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
