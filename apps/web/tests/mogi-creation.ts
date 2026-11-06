import { expect, type Page } from "@playwright/test";

/** Opens New Mogi from wherever the page is: a visible New Mogi, or the list behind Instructions or a mogi. */
export async function openCreation(page: Page) {
  // Enabled only: before the app is ready, the list behind its route shows a disabled New Mogi that then leaves.
  const enabled = page.locator(":enabled");
  const trigger = page
    .getByRole("button", { name: "New Mogi", exact: true })
    .filter({ visible: true })
    .and(enabled)
    .first();
  const way = page
    .getByRole("button", { name: /^(Back|Show Mogis)$/ })
    .filter({ visible: true })
    .and(enabled)
    .first();
  await expect(trigger.or(way).first()).toBeVisible();
  if (!(await trigger.isVisible())) await way.click();
  await trigger.click();
}

/** The scenario provides the full list and checks participant parsing. */
export async function createMogi(page: Page, roster: string) {
  await openCreation(page);
  const sheet = page.getByRole("dialog", { name: "New Mogi", exact: true });
  await expect(sheet.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await expect(sheet.getByLabel("Lounge bot list", { exact: true })).toHaveValue("");
  await sheet.getByLabel("Lounge bot list", { exact: true }).fill(roster);
  await sheet.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New Mogi", exact: true, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Races", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Mogi Tier ${/Tier (\S+)/.exec(roster)?.[1]}`);
}
