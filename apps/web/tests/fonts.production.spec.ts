import type { Response } from "@playwright/test";
import { expect, test } from "@playwright/test";

test("the initial screen loads Inter Variable from local files", async ({ page, request }, info) => {
  const responses: Response[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(".woff2")) responses.push(response);
  });
  await page.goto("/");
  const text = page
    .getByRole("main")
    .getByRole("paragraph")
    .filter({ hasText: "Your mogis, tallied from your screenshots" });
  await expect(text).toBeVisible();
  const font = await text.evaluate(async (element) => {
    await document.fonts.ready;
    return {
      family: getComputedStyle(element).fontFamily.split(",")[0],
      available: document.fonts.check('16px "Inter Variable"'),
      loaded: [...document.fonts].some(
        (face) => face.family.replaceAll(/["']/g, "") === "Inter Variable" && face.status === "loaded",
      ),
    };
  });
  expect(font).toEqual({ family: '"Inter Variable"', available: true, loaded: true });
  expect(responses.length).toBeGreaterThan(0);
  for (const response of responses) {
    expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
    expect(response.status(), response.url()).toBe(200);
  }

  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  const inventory = JSON.parse(
    (await worker.text())
      .split("\n")[0]
      .replace(/^const INVENTORY=/, "")
      .replace(/;$/, ""),
  ) as {
    build: string;
    entries: { url: string; size: number; hash: string }[];
  };
  const fonts = inventory.entries.filter(({ url }) => url.endsWith(".woff2"));
  expect(fonts.length).toBeGreaterThan(0);
  for (const response of responses) expect(fonts.map(({ url }) => url)).toContain(new URL(response.url()).pathname);
  expect(inventory.entries.map(({ url }) => url)).toContain("/licenses/inter-OFL.txt");
  const version = await request.get("/offline-version.json");
  expect(await version.json()).toEqual({ build: inventory.build });
  const license = await request.get("/licenses/inter-OFL.txt");
  expect(license.status()).toBe(200);
  expect(await license.text()).toContain("SIL OPEN FONT LICENSE");
  await page.screenshot({ path: info.outputPath("home-inter.png"), scale: "css" });
});
