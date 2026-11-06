import { expect, test } from "@playwright/test";

import { ordinal } from "../lib/format";
import { downloadBackup, expectRestored } from "./backup-navigation";
import { choosePlace } from "./mogi-navigation";
import { ffaRoster, mogiState, restoreState } from "./mogi-state";
import { roomQuestions } from "./question-fixture";
import { openCurrentMogi } from "./settings-navigation";

for (const [width, colorScheme] of [[375, "light"]] as const) {
  test(`unseen races can be inspected through the list at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    await restoreState(page, roomQuestions(mogiState({ roster: ffaRoster() }), "unseen"));
    await expect(page.getByText("FFA · Race 10 of 12", { exact: true })).toBeVisible();
    const tile = page.getByRole("button", { name: "Race 3 · Not seen", exact: true });
    await expect(tile).toHaveAttribute("aria-disabled", "true");
    await expect(tile).toHaveText("3");
    const row = page
      .getByRole("list", { name: "Tracks", exact: true })
      .getByRole("button", { name: "3 Not seen", exact: true });
    await expect(row).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    await row.click();
    const detail = page.getByRole("dialog", { name: "Race 3", exact: true });
    await expect(detail.getByText("No screenshot", { exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "Edit Result", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save Result", exact: true })).toBeDisabled();
    await choosePlace(page, "1st", "Player 1");
    if (width === 375) {
      await page
        .getByRole("dialog", { name: "Edit Result", exact: true })
        .getByRole("button", { name: "Back", exact: true })
        .click();
      // The draft persists silently; the sheet's subtitle is its only mark.
      await expect(detail).toHaveAccessibleDescription("Edit in progress");
      await detail.getByRole("button", { name: "Close", exact: true }).click();
      const saved = await downloadBackup(page, info.outputPath("partial-edit.zip"));
      await page.getByLabel("Restore from file").setInputFiles(saved);
      await page.getByRole("button", { name: "Replace All Data", exact: true }).click();
      await page
        .getByRole("alertdialog", { name: "Replace All Data on This Device?", exact: true })
        .getByRole("button", { name: "Replace", exact: true })
        .click();
      await expectRestored(page);
      await openCurrentMogi(page);
      // A not-seen race with an edit in progress opens its sheet from the tile, where Resume lives.
      await page.getByRole("button", { name: "Race 3 · Not seen · Edit in progress", exact: true }).click();
      await expect(detail).toHaveAccessibleDescription("Edit in progress");
      await detail.getByRole("button", { name: "Resume Edit", exact: true }).click();
      await expect(page.getByRole("button", { name: "1, Player 1", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save Result", exact: true })).toBeDisabled();
    }
    for (let i = 2; i <= 12; i++) await choosePlace(page, ordinal(i), `Player ${i}`);
    await page.getByRole("button", { name: "Save Result", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edit Result", exact: true })).toBeHidden();
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Race 3 · counted", exact: true })).toBeVisible();
    await expect(page.getByText("FFA · Race 10 of 12", { exact: true })).toBeVisible();
  });
}
