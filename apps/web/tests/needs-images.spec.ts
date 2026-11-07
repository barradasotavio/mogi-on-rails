import { expect, test } from "@playwright/test";

import { ffaRoster, type Loose, mogiState, restoreState } from "./mogi-state";
import { nameQuestions, shrunkRoom } from "./question-fixture";

test(`"!" explains races that need images and Enter Result opens an empty order`, async ({ page }) => {
  await restoreState(page, shrunkRoom(mogiState({ roster: ffaRoster() })));

  const grid = page.getByRole("region", { name: "Races", exact: true });
  // ImageOff replaces the number, outside the accessibility tree.
  for (let number = 1; number <= 11; number++) {
    const block = grid.getByRole("button", { name: `Race ${number} · Needs screenshots`, exact: true });
    await expect(block).toHaveText("");
    await expect(block.locator('svg.lucide-ghost[data-race-badge="needs-images"][aria-hidden="true"]')).toHaveCount(1);
  }
  await expect(grid.getByRole("button", { name: "Race 12 · counted", exact: true })).toHaveText("12");
  await expect(grid.locator("svg[data-race-badge]")).toHaveCount(11);
  await expect(grid.getByText("?", { exact: true })).toHaveCount(0);
  const tile = grid.getByRole("button", { name: "Race 7 · Needs screenshots", exact: true });
  await expect(
    page
      .getByRole("list", { name: "Tracks", exact: true })
      .getByRole("button", { name: "7 Needs screenshots", exact: true }),
  ).toBeVisible();

  await tile.click();
  const sheet = page.getByRole("dialog", { name: "Race 7", exact: true });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByText("It had fewer than 12 players, so later totals can't count it.", { exact: true }),
  ).toBeVisible();
  await expect(sheet.getByRole("radio")).toHaveCount(0);
  await expect(sheet.getByRole("combobox")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(tile).toBeFocused();

  await tile.click();
  const picker = page.waitForEvent("filechooser");
  await sheet.getByRole("button", { name: "Add Screenshots", exact: true }).click();
  const chooser = await picker;
  expect(chooser.isMultiple()).toBe(true);
  await expect(sheet).toBeHidden();

  // No image can prove it: the result is typed by hand.
  await tile.click();
  await sheet.getByRole("button", { name: "Enter Result", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Result", exact: true });
  await expect(
    editor
      .getByRole("list", { name: "Finish order", exact: true })
      .getByRole("button", { name: /^\d+, Choose player$/ }),
  ).toHaveCount(12);
  // Finish order, then More options, always shown: no photo to attach and nothing to expand.
  await expect(editor.locator("h2[data-section-title], [data-section-title] > h2")).toHaveText([
    "Finish order",
    "More options",
  ]);
  await expect(editor.getByRole("list", { name: "More options", exact: true }).getByRole("button")).toHaveText([
    "Absent Players",
  ]);
});

test("a numbered screenshot that wasn't recognized needs images and is the reference in Enter Result", async ({
  page,
}) => {
  const state = nameQuestions(mogiState({ roster: ffaRoster() }), [], 0);
  const mogi: Loose = state.mogis[0];
  mogi.races = mogi.races.filter((race: { id: string }) => race.id !== "question-race");
  Object.assign(mogi.captures[0], {
    context: { phase: "after" },
    interpretation: { ...mogi.captures[0].interpretation, screen: "unknown" },
  });
  await restoreState(page, state);
  await page.getByRole("button", { name: "1 Question", exact: true }).click();
  const question = page.getByRole("dialog", { name: "Question 1 of 1", exact: true });
  await expect(question.getByText("Which race is this?", { exact: true })).toBeVisible();
  await question.getByRole("radio", { name: "Race 2" }).click();
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question).toBeHidden();
  const tile = page
    .getByRole("region", { name: "Races", exact: true })
    .getByRole("button", { name: "Race 2 · Needs screenshots", exact: true });
  await tile.click();
  await page
    .getByRole("dialog", { name: "Race 2", exact: true })
    .getByRole("button", { name: "Enter Result", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit Result", exact: true });
  await expect(editor.getByRole("img", { name: "Screenshot of race 2", exact: true })).toBeVisible();
});
