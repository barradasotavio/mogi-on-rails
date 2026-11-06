import { readFileSync, writeFileSync } from "node:fs";

import { test } from "@playwright/test";

// Rewrites the saved readings that `useFixedRecognition` serves, from real OCR, for the fixtures already listed.
const file = new URL("./fixtures/recognitions.json", import.meta.url);
test.skip(!process.env.UPDATE_RECOGNITIONS, "Set UPDATE_RECOGNITIONS=1 to rewrite tests/fixtures/recognitions.json.");

test("saved readings match real recognition of their fixtures", async ({ page }) => {
  test.setTimeout(180000);
  const names = Object.keys(JSON.parse(readFileSync(file, "utf8")));
  const engine = new URL("../../../packages/engine/src/browser.ts", import.meta.url).pathname;
  const fixtures = new URL("./fixtures/", import.meta.url).pathname;
  await page.route("**/__recognitions", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html lang="en"><body><script type="module">
    import "/@vite/client";
    const { recognizeImage } = await import("/@fs${engine}");
    const readings = {};
    for (const name of ${JSON.stringify(names)})
      readings[name] = await recognizeImage(await (await fetch("/@fs${fixtures}" + name)).blob(), () => {}).result;
    window.recognitions = readings;
  </script></body></html>`,
    }),
  );
  await page.goto("/__recognitions");
  const readings = await (
    await page.waitForFunction(() => (window as { recognitions?: unknown }).recognitions, null, { timeout: 170000 })
  ).jsonValue();
  writeFileSync(file, JSON.stringify(readings, null, 1) + "\n");
});
