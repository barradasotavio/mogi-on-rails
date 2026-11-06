import { expect, type Page } from "@playwright/test";

import { returnToStandings } from "./participants-navigation";

export async function openMogiSection(page: Page, name: "Standings" | "Tracks") {
  await returnToStandings(page);
  if (name === "Standings") {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Table", exact: true }).click();
  } else await openMogiActions(page);
}
export async function openMogiSettings(page: Page) {
  await returnToStandings(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Mogi Settings", exact: true }).click();
  // Callers press keys next; under load the sheet can mount after the click returns.
  await expect(page.getByRole("dialog", { name: "Mogi Settings", exact: true })).toBeVisible();
}
export async function openMogiActions(page: Page) {
  await openMogiSettings(page);
}
export async function consultRace(page: Page, number: number) {
  await returnToStandings(page);
  const tile = page.getByRole("button", { name: new RegExp(`^Race ${number} · (counted|questions)$`) });
  await tile.click();
  const dialog = page.getByRole("dialog", { name: `Race ${number}`, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
export async function editRace(page: Page, number: number) {
  const dialog = await consultRace(page, number);
  // Keyboard entry must also push the editor page.
  await dialog.getByRole("button", { name: "Edit Result", exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Save Result", exact: true })).toBeVisible();
}
/** Edit Result: a place opens its page of players, and choosing one swaps the two places. */
export async function choosePlace(page: Page, place: string, player: string) {
  const editor = page.getByRole("dialog", { name: "Edit Result", exact: true });
  await editor
    .getByRole("list", { name: "Finish order", exact: true })
    .getByRole("button", { name: new RegExp(`^${Number.parseInt(place)}, `) })
    .click();
  await page
    .getByRole("dialog", { name: `${place} Place`, exact: true })
    .getByRole("button", { name: new RegExp(`^${player}( Selected| \\d+(st|nd|rd|th))?$`) })
    .click();
  await expect(editor).toBeVisible();
}
