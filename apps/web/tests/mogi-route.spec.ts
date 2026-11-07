import { expect, type Page, test } from "@playwright/test";

import { createMogi } from "./mogi-creation";
import { openMogiActions, openMogiSettings } from "./mogi-navigation";
import { ffaRoster, mogiState, restoreState } from "./mogi-state";

const roster = ffaRoster();

test("regular reopens the last in-progress mogi without leaving an empty screen in history", async ({ page }) => {
  await page.goto("/");
  await createMogi(page, roster.replace("Tier D", "Tier A"));
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await createMogi(page, roster.replace("Tier D", "Tier B"));
  const latestUrl = page.url();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/tracks/item-box.webp");
  const beforeHome = page.url();
  const historyLength = await page.evaluate(() => history.length);
  await page.goto("/");
  await expect(page).toHaveURL(latestUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Mogi Tier B", exact: true })).toBeFocused();
  expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
  await page.goBack();
  await expect(page).toHaveURL(beforeHome);
  await page.goForward();
  await expect(page).toHaveURL(latestUrl);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page).toHaveURL(latestUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Mogi Tier B", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mogis", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("main").getByRole("button", { name: /^Mogi Tier B\W*FFA/ })).toBeFocused();
});

/** Sixteen mogis, R0 the oldest and so last in the list, restored in one public ZIP. */
async function restoreSixteen(page: Page) {
  const state = mogiState(
    ...Array.from({ length: 16 }, (_, index) => ({
      roster: ffaRoster(`R${index}`),
      with: { name: `Mogi Tier R${index}`, createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString() },
    })),
  );
  await restoreState(page, { ...state, activeMogiId: null });
  await expect(page.getByRole("button", { name: /^Mogi Tier R\d+\W*FFA/ }).filter({ visible: true })).toHaveCount(16);
}

test("the URL preserves the mogi on reload and history restores scroll, focus and overview", async ({ page }) => {
  // This flow observes scroll restoration; the dev config otherwise reduces motion.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await restoreSixteen(page);
  const row = page.getByRole("button", { name: /^Mogi Tier R0\W*FFA/ });
  await row.scrollIntoViewIfNeeded();
  const main = page.getByRole("main");
  const scroll = await main.evaluate((element) => element.scrollTop);
  expect(scroll).toBeGreaterThan(100);
  await row.click();
  await expect(page).toHaveURL(/\/\?mogi=.+/);
  const url = page.url();
  const heading = page.getByRole("heading", { level: 1, name: "Mogi Tier R0", exact: true });
  await expect(heading).toBeFocused();
  expect(await heading.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(heading).toBeFocused();
  await openMogiActions(page);
  await page.getByRole("button", { name: "Screenshots 0", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Screenshots", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(row).toBeFocused();
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(scroll);
  expect(await row.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  await page.goForward();
  await expect(heading).toBeFocused();
  await expect(page.getByRole("region", { name: "Races", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(url);
  await expect(heading).toBeFocused();
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.goto("/?mogi=missing");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Mogi not found", { exact: true })).toBeVisible();

  await createMogi(page, roster);
  await openMogiSettings(page);
  const mogiSettings = page.getByRole("dialog", { name: "Mogi Settings", exact: true });
  await expect(mogiSettings.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await expect(mogiSettings.getByRole("listitem")).toHaveText(["Bot List", "Screenshots0", "Export", "Delete Mogi"]);
  await mogiSettings.getByRole("button", { name: "Bot List", exact: true }).click();
  const original = page.getByRole("dialog", { name: "Bot List", exact: true });
  await expect(original.locator("pre")).toHaveText(roster);
  await original.getByRole("button", { name: "Back", exact: true }).click();
  await expect(mogiSettings.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
  const beforeReplacement = page.url();
  const creationHistory = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "New Mogi", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "New Mogi", exact: true });
  await expect(creation).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(creationHistory);
  await page.goForward();
  await expect(creation).toBeHidden();
  await expect(page).toHaveURL(beforeReplacement);
  await createMogi(page, roster);
  const replacement = page.url();
  expect(replacement).not.toBe(beforeReplacement);
  expect(await page.evaluate(() => history.length)).toBe(creationHistory);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(replacement);
  await openMogiSettings(page);
  await page.getByRole("button", { name: "Delete Mogi", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: /^Delete .+\?$/ });
  await expect(confirmation).toHaveAccessibleDescription("This can't be undone.");
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete Mogi", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Delete Mogi", exact: true }).click();
  await confirmation.getByRole("button", { name: "Delete Mogi", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Mogi deleted", { exact: true })).toBeVisible();
  await expect(page.getByText("Mogi not found", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Mogi Settings", exact: true })).toBeHidden();
  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Mogi not found", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Mogi Tier D\W*FFA/ })).toHaveCount(1);
});
