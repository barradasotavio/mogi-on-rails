import path from "node:path";

import type { Response } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { consultRace } from "./mogi-navigation";
import { mogiState, restoreState } from "./mogi-state";
import { openParticipants, returnToStandings } from "./participants-navigation";
import { observedRace } from "./race-fixture";
import { expectOfflineReady } from "./settings-navigation";

test("OCR and Inter work on a cold offline page with manual association", async ({ page, context }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await expectOfflineReady(page);
  const names = [
    "Lounge A",
    "Lounge B",
    "anypianta",
    "Sigmabirdo",
    "Goomba",
    "Swoopy",
    "Rosalinas",
    "Tavo",
    "BOWSERJR",
    "Fuzzxx",
    "B nabbit◇",
    "Jmole",
  ];
  await restoreState(
    page,
    observedRace(mogiState({ roster: `Tier D\n${names.map((name, index) => `${index + 1}. ${name}`).join("\n")}` })),
  );
  await expect(page).toHaveURL(/\/\?mogi=.+/);
  const mogiUrl = page.url();
  await context.setOffline(true);
  const cold = await context.newPage();
  const fontResponses: Response[] = [];
  // Serverless after load: once ready, nothing reaches the network but the browser's /sw.js update check.
  const network: string[] = [];
  context.on("request", (request) => {
    if (request.serviceWorker()) network.push(request.url());
  });
  cold.on("response", (response) => {
    if (!response.fromServiceWorker() && response.url().startsWith("http")) network.push(response.url());
    if (new URL(response.url()).pathname.endsWith(".woff2")) fontResponses.push(response);
  });
  cold.on("requestfailed", (request) => {
    if (request.url().startsWith("http")) network.push(request.url());
  });
  await page.close();
  await cold.goto(mogiUrl);
  await returnToStandings(cold);
  await expect(cold).toHaveURL(mogiUrl);
  expect(
    await cold.getByRole("heading", { level: 1 }).evaluate(async (element) => {
      await document.fonts.ready;
      return {
        family: getComputedStyle(element).fontFamily.split(",")[0],
        available: document.fonts.check('16px "Inter Variable"'),
        loaded: [...document.fonts].some(
          (face) => face.family.replaceAll(/["']/g, "") === "Inter Variable" && face.status === "loaded",
        ),
      };
    }),
  ).toEqual({ family: '"Inter Variable"', available: true, loaded: true });
  expect(fontResponses.length).toBeGreaterThan(0);
  for (const response of fontResponses) {
    expect(response.status(), response.url()).toBe(200);
    expect(response.fromServiceWorker(), response.url()).toBe(true);
  }
  const race = await consultRace(cold, 1);
  await race.getByRole("button", { name: "Track Choose", exact: true }).click();
  await cold.getByRole("searchbox", { name: "Search track or code", exact: true }).fill("CC");
  await cold
    .getByRole("dialog", { name: "Track", exact: true })
    .getByRole("button", { name: "CC Crown City CC", exact: true })
    .click();
  await race.getByRole("button", { name: "Close", exact: true }).click();
  await cold.reload();
  const trackRow = cold.getByRole("list", { name: "Tracks", exact: true }).getByRole("listitem").first();
  await expect(trackRow).toContainText("Crown City");
  const icon = trackRow.getByRole("img", { name: "CC", exact: true });
  await icon.scrollIntoViewIfNeeded();
  await expect(icon).toBeVisible();
  await expect.poll(() => icon.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const firstTile = cold.getByRole("button", { name: /^Race 1 · / });
  await firstTile.scrollIntoViewIfNeeded();
  const before = await firstTile.boundingBox();
  const picker = cold.waitForEvent("filechooser");
  await cold.getByRole("button", { name: "Add Screenshots", exact: true }).click();
  await (await picker).setFiles(path.resolve(import.meta.dirname, "fixtures/spec29/finish-order-totals.jpeg"));
  await expect(cold.getByRole("status").filter({ hasText: /^Reading 1 of 1$/ })).toBeVisible();
  expect(await firstTile.boundingBox()).toEqual(before);
  const questions = cold.getByRole("button", { name: /^\d+ Questions?$/ });
  await expect(questions).toBeVisible({ timeout: 30000 });
  await questions.click();
  const question = cold.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  const reading = await question.getByText(/^Who is /).innerText();
  await question.getByRole("radio", { name: /^Lounge A(?: Suggested)?$/ }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question.getByText(reading, { exact: true })).toHaveCount(0);
  await cold.reload();
  // The last free identity is deduced; the human association remains saved after reload.
  await expect(questions).toHaveCount(0);
  await openParticipants(cold);
  await cold
    .getByRole("dialog", { name: "Players", exact: true })
    .getByRole("button", { name: /^Lounge A/ })
    .click();
  await expect(
    cold.getByRole("dialog", { name: "Lounge A", exact: true }).getByLabel("In-game name", { exact: true }),
  ).toHaveValue(/“(.+)”/.exec(reading)![1]);
  expect(network.filter((url) => new URL(url).pathname !== "/sw.js")).toEqual([]);
});
