import { expect, test } from "@playwright/test";

test("the whole screen shares questions and overview by mogi identity", async ({ page }) => {
  // Instrument real functions without replacing their projections or components.
  for (const [file, name, counter] of [
    ["questions/mogi-questions", "mogiQuestions", "questions"],
    ["mogi/mogi-overview", "mogiOverview", "overview"],
  ]) {
    await page.route(`**/packages/engine/src/domain/${file}.ts*`, async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const pattern = new RegExp(`function ${name}\\([^]*?\\) \\{`);
      expect(source).toMatch(pattern);
      await route.fulfill({
        response,
        body: source.replace(
          pattern,
          (match) => `${match}\nif (window.projectionCalls) window.projectionCalls.${counter}++;`,
        ),
      });
    });
  }
  const fixture = new URL("./mogi-render-fixture.tsx", import.meta.url).pathname;
  await page.route("**/__mogi-render", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
    import "/@vite/client";
    import RefreshRuntime from "/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { mountMogiRender } = await import("/@fs${fixture}");
    mountMogiRender();
  </script></body></html>`,
    }),
  );
  await page.goto("/__mogi-render");
  await expect(page.getByRole("region", { name: "Races", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.projectionCalls)).toEqual({ questions: 1, overview: 1 });
  await page.evaluate(() => window.renderProbe("busy"));
  await page.evaluate(() => window.renderProbe("reading"));
  await expect(page.getByRole("status").filter({ hasText: "Reading 1 of 13" })).toBeVisible();
  await page.evaluate(() => window.renderProbe("reading"));
  await expect(page.getByRole("status").filter({ hasText: "Reading 2 of 13" })).toBeVisible();
  expect(await page.evaluate(() => window.projectionCalls)).toEqual({ questions: 1, overview: 1 });
  await page.evaluate(() => window.renderProbe("revision"));
  await expect.poll(() => page.evaluate(() => window.projectionCalls)).toEqual({ questions: 2, overview: 2 });
});
