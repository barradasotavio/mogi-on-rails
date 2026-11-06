import { expect, type Page } from "@playwright/test";

import { openBackup } from "./settings-navigation";
/** Download through the public action; ZIP assertions belong to the scenario. */
export async function downloadBackup(page: Page, outputPath: string) {
  await openBackup(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save Backup", exact: true }).click();
  await (await downloading).saveAs(outputPath);
  return outputPath;
}
/** A restore ends when Settings closes on the restored data; no toast confirms it. */
export async function expectRestored(page: Page) {
  await expect(page.getByRole("alertdialog", { name: "Replace All Data on This Device?", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Backup restored", { exact: true })).toHaveCount(0);
}
