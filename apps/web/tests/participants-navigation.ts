import { expect, type Page } from "@playwright/test";

import { closeExportPanel } from "./export-navigation";

/** Close a known detail before returning to the mogi. */
export async function returnToStandings(page: Page) {
  // Replace is asynchronous; wait for its confirmation to release the underlying sheet.
  await expect(
    page.getByRole("alertdialog", { name: "Replace All Data?", exact: true, includeHidden: true }),
  ).toHaveCount(0);
  // A successful restore closes Settings; let its exit animation finish before reading the sheets.
  await expect(page.locator('[role="dialog"][data-state="closed"]')).toHaveCount(0);
  await closeExportPanel(page);
  const settingsNames = /^(Settings|Appearance|Storage|Backups|Restore|[A-Z][a-z]{2} \d+, \d{2}:\d{2}|About|New Mogi)$/;
  const sheet = page.getByRole("dialog", { name: settingsNames });
  if (await sheet.isVisible()) {
    const back = sheet.getByRole("button", { name: "Back", exact: true });
    while (await back.isVisible()) await back.click();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog", { name: settingsNames, includeHidden: true })).toHaveCount(0);
  }
  const mogiSheet = page.getByRole("dialog", {
    name: /^(Mogi Settings|Screenshots|Screenshot \d+|Numbers Read|Race|Question \d+ of \d+|Table(?: After Race \d+)?|Final Table)$/,
  });
  if (await mogiSheet.isVisible()) {
    // Returning from confirmation restores focus to the button that opened it.
    await expect.poll(() => mogiSheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(mogiSheet).toBeHidden();
  }
  if (await page.getByLabel("Sub's Lounge name", { exact: true }).isVisible())
    await page
      .getByRole("dialog", { name: "Sub", exact: true })
      .getByRole("button", { name: "Back", exact: true })
      .click();
  if (await page.getByLabel("In-game name", { exact: true }).isVisible())
    await page.getByRole("dialog").getByRole("button", { name: "Back", exact: true }).click();
  const players = page.getByRole("dialog", { name: "Players", exact: true });
  if (await players.isVisible()) {
    await players.getByRole("button", { name: "Close", exact: true }).click();
    await expect(players).toBeHidden();
  }
  if (await page.getByRole("dialog", { name: "Menu", exact: true }).isVisible()) await page.keyboard.press("Escape");
  const image = page
    .getByRole("dialog", { name: /^Screenshot \d+$/ })
    .filter({ has: page.getByRole("button", { name: "Review Screenshot", exact: true }) });
  if (await image.isVisible()) {
    await image.getByRole("button", { name: "Close", exact: true }).click();
    await image.waitFor({ state: "hidden" });
  }
  const editor = page.getByRole("dialog", { name: "Edit Result", exact: true });
  if (await editor.isVisible()) {
    const back = editor.getByRole("button", { name: "Back", exact: true });
    await editor.getByRole("button", { name: (await back.isVisible()) ? "Back" : "Close", exact: true }).click();
  }
  const race = page.getByRole("dialog", { name: /^(Race \d+|Discarded race)$/ });
  if (await race.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(race).toBeHidden();
  }
  if (await page.getByRole("dialog", { name: "Review Screenshot", exact: true }).isVisible())
    await page.getByRole("button", { name: "Back", exact: true }).click();
}
export async function openParticipants(page: Page) {
  await returnToStandings(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (await page.getByRole("button", { name: "Menu", exact: true }).isVisible())
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Players", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Players", exact: true })).toBeVisible();
}
export async function openSubstitution(page: Page, name: string) {
  await openParticipants(page);
  await page.getByRole("dialog", { name: "Players", exact: true }).getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "Record Sub", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sub", exact: true })).toBeVisible();
}
