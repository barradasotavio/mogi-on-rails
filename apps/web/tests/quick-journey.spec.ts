import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { downloadBackup } from "./backup-navigation";
import { createMogi } from "./mogi-creation";
import { choosePlace, editRace } from "./mogi-navigation";
import { mogiState, restoreState } from "./mogi-state";
import { openParticipants } from "./participants-navigation";
import { nameQuestions } from "./question-fixture";
import { observedRace } from "./race-fixture";

const roster = `Tier D\n${Array.from({ length: 12 }, (_, index) => `${index + 1}. Piloto ${index + 1}`).join("\n")}`;

test("overview inspects, discards and reinstates races, answers names and preserves results", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add Screenshots", exact: true })).toHaveCount(0);
  await createMogi(page, roster);
  const players = page.getByRole("list", { name: "Player standings", exact: true });
  await expect(players.getByRole("listitem")).toHaveCount(12);
  await expect(players.getByRole("listitem").filter({ has: page.getByText("0", { exact: true }) })).toHaveCount(12);
  await restoreState(page, observedRace(mogiState({ roster })));
  // Editing exercises the keyboard; navigation and discarding still use clicks.
  await expect(page.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
  await editRace(page, 1);
  await choosePlace(page, "1st", "Piloto 2");
  await page.getByRole("button", { name: "Save Result", exact: true }).press("Enter");
  await expect(page.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
  const raceSheet = page.getByRole("dialog", { name: "Race 1", exact: true });
  await expect(raceSheet.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await expect(raceSheet.getByRole("img")).toHaveCount(0);
  await expect(raceSheet.getByRole("list", { name: "Results", exact: true }).getByRole("listitem")).toHaveCount(12);
  await expect(raceSheet.getByRole("list", { name: "Results", exact: true }).getByRole("listitem").first()).toHaveText(
    "1Piloto 2+15",
  );
  await raceSheet.getByRole("button", { name: "Track Choose", exact: true }).click();
  const trackPage = page.getByRole("dialog", { name: "Track", exact: true });
  await expect(trackPage.getByRole("button", { name: "Back", exact: true })).toBeFocused();
  await expect(
    trackPage.getByRole("list", { name: "Tracks", exact: true }).getByRole("listitem").first(),
  ).toContainText("Acorn Heights");
  await trackPage.getByRole("searchbox", { name: "Search track or code", exact: true }).fill("no such track");
  await expect(trackPage.getByText("No track matches", { exact: true })).toBeVisible();
  await trackPage.getByRole("searchbox", { name: "Search track or code", exact: true }).fill("rmmm");
  await trackPage.getByRole("button", { name: "rMMM Moo Moo Meadows rMMM", exact: true }).click();
  await expect(raceSheet.getByRole("button", { name: "Track rMMM Moo Moo Meadows", exact: true })).toBeVisible();
  await raceSheet.getByRole("button", { name: "Track rMMM Moo Moo Meadows", exact: true }).click();
  await trackPage.getByRole("searchbox", { name: "Search track or code", exact: true }).fill("meadows");
  await expect(
    trackPage.getByRole("button", { name: "rMMM Moo Moo Meadows rMMM Selected", exact: true }),
  ).toBeVisible();
  await trackPage.getByRole("button", { name: "Back", exact: true }).click();
  await raceSheet.getByRole("button", { name: "Discard Race", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Discard Race 1?", exact: true });
  await expect(confirmation).toContainText("Later races move up one number.");
  await confirmation.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(raceSheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Race 1 · future", exact: true })).toBeFocused();
  await expect(
    page.getByRole("main").getByRole("paragraph").getByText("FFA · No races yet", { exact: true }),
  ).toBeVisible();
  await expect(players.getByRole("listitem").first()).toContainText("0");
  const discardedRow = page.getByRole("list", { name: "Discarded", exact: true }).getByRole("button");
  await discardedRow.click();
  const discardedSheet = page.getByRole("dialog", { name: "Discarded Race", exact: true });
  await expect(
    discardedSheet.getByText("Left out of the totals. The results are kept in case the race counts again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    discardedSheet.getByRole("list", { name: "Results", exact: true }).getByRole("listitem").first(),
  ).toHaveText("1Piloto 215");
  await discardedSheet.getByRole("button", { name: "Count Again", exact: true }).click();
  await expect(discardedSheet).toBeHidden();
  await expect(page.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
  await expect(players.getByRole("listitem").first()).toHaveText("1Piloto 215");
  const saved = JSON.parse(
    strFromU8(
      unzipSync(readFileSync(await downloadBackup(page, info.outputPath("before-questions.zip"))))["manifest.json"],
    ),
  ).state;
  const exported = saved.mogis[0];
  expect(exported.races[0].placements[0]).toBe(exported.participants[1].id);
  expect(exported.races[0].track).toBe("rMMM");
  // The questions build on the saved data, so the result and track above must survive into them.
  await restoreState(page, nameQuestions(saved, [2], 3));
  const trackRow = page.getByRole("list", { name: "Tracks", exact: true }).getByRole("listitem").first();
  await expect(trackRow.getByRole("img", { name: "rMMM", exact: true })).toBeVisible();
  await expect(trackRow).toContainText("Moo Moo Meadows");
  await expect(trackRow).not.toContainText("2nd");
  await expect(page.getByRole("list", { name: "Tracks", exact: true }).getByRole("listitem").nth(1)).toContainText(
    "3 questions",
  );
  // A race with questions shows "?" in place of its number, with no badge.
  const questionTile = page
    .getByRole("region", { name: "Races", exact: true })
    .getByRole("button", { name: "Race 2 · questions", exact: true });
  await expect(questionTile).toHaveText("?");
  await expect(questionTile).toHaveAttribute("data-race-state", "questions");
  await expect(questionTile.locator("svg")).toHaveCount(0);
  await page.getByRole("button", { name: "3 Questions", exact: true }).click();
  let question = page.getByRole("dialog", { name: "Question 1 of 3", exact: true });
  await expect(question.getByText("Who is “Reading 1”?", { exact: true })).toBeVisible();
  await expect(question.getByText("Also in 1 other screenshot", { exact: true })).toBeVisible();
  await expect(question.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  // The spelling appears in two screenshots: the sheet shows the row in each.
  await expect(question.getByRole("img", { name: "Screenshot row 1", exact: true })).toHaveCount(2);
  await question.getByRole("button", { name: "Not Sure", exact: true }).press("Enter");
  // Deferring the representative advances to the next spelling without repeating the other occurrence.
  await expect(question.getByText("Who is “Reading 2”?", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Race 2 · questions", exact: true }).click();
  question = page.getByRole("dialog", { name: "Question 1 of 3", exact: true });
  await expect(question.getByText("Who is “Reading 1”?", { exact: true })).toBeVisible();
  await question.getByRole("radio", { name: "Piloto 1", exact: true }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).press("Enter");
  // The answer resolves both occurrences and advances to the second spelling.
  question = page.getByRole("dialog", { name: "Question 2 of 3", exact: true });
  await expect(question.getByText("Who is “Reading 2”?", { exact: true })).toBeVisible();
  await expect(question.getByRole("img", { name: "Screenshot row 2", exact: true })).toHaveCount(2);
  await question.getByRole("button", { name: "Not Sure", exact: true }).press("Enter");
  await expect(question.getByText("Who is “Reading 3”?", { exact: true })).toBeVisible();
  await question.getByRole("button", { name: "Not Sure", exact: true }).press("Enter");
  await expect(question).toBeHidden();
  await expect(page.getByText("Question left for later", { exact: true })).toBeVisible();
  await page.reload();
  // Two spellings remain; answering the substitution eliminates the last free person.
  await page.getByRole("button", { name: "2 Questions", exact: true }).click();
  question = page.getByRole("dialog", { name: "Question 1 of 2", exact: true });
  await expect(question.getByText("Who is “Reading 2”?", { exact: true })).toBeVisible();
  await question.getByRole("radio", { name: "Someone who subbed in", exact: true }).check();
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await question.getByLabel("Sub's Lounge name", { exact: true }).fill("Replacement");
  await question
    .getByRole("radiogroup", { name: "Subbed in for", exact: true })
    .getByRole("radio", { name: "Piloto 2", exact: true })
    .check();
  await question.getByRole("button", { name: "Confirm", exact: true }).press("Enter");
  await expect(question).toBeHidden();
  await expect(page.getByText("FFA · Race 2 of 12", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("FFA · Race 2 of 12", { exact: true })).toBeVisible();
  await openParticipants(page);
  await page
    .getByRole("dialog", { name: "Players", exact: true })
    .getByRole("button", { name: "Replacement", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Replacement", exact: true }).getByText("Subbing for Piloto 2", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("From race 2", { exact: true })).toBeVisible();
  await page
    .getByRole("dialog", { name: "Replacement", exact: true })
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Players", exact: true })
    .getByRole("button", { name: "Piloto 1", exact: true })
    .click();
  const reader = page.getByRole("dialog", { name: "Piloto 1", exact: true });
  await expect(reader.getByRole("listitem").filter({ hasText: "Read as" })).toHaveText([
    "Read as Reading 1Confirmed by youUnlink",
  ]);
  await reader.getByRole("button", { name: "Unlink Reading 1", exact: true }).click();
  await expect(page.getByText("“Reading 1” will be asked again", { exact: true })).toBeVisible();
  // Even with one free person left, the removed spelling waits for an answer instead of returning by elimination.
  await expect(reader.getByText(/^Read as /)).toHaveCount(0);
});
