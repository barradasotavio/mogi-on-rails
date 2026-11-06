import { defineConfig } from "@playwright/test";

import production from "./playwright.chrome-production.config";
import development from "./playwright.config";

// BATCH_PRODUCTION=1 measures the production build already compiled by npm run build.
export default defineConfig({ ...(process.env.BATCH_PRODUCTION ? production : development), testDir: "./benchmarks" });
