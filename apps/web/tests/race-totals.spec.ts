import { expect, test } from "@playwright/test";

import { ffaRoster, type Loose, mogiState, restoreState } from "./mogi-state";
import { nameQuestions } from "./question-fixture";

test("the table stops at the gap and list counts open the same questions as the header", async ({ page }) => {
  const state = nameQuestions(mogiState({ roster: ffaRoster() }), []);
  const mogi: Loose = state.mogis[0],
    capture = mogi.captures[0];
  const ids = mogi.participants.map((person: { id: string }) => person.id);
  mogi.races = [
    { id: "r1", number: 1, origin: "manual", status: "confirmed", placements: ids },
    mogi.races.find((race: { id: string }) => race.id === "question-race"),
    { id: "r3", number: 3, origin: "manual", status: "confirmed", placements: [...ids].reverse() },
    { id: "r4", number: 4, origin: "manual", status: "pending", placements: [] },
  ];
  capture.interpretation = { ...capture.interpretation, screen: "overallStandings" };

  const reading = (value: number) => ({
    text: String(value),
    value,
    confidence: 99,
    uncertain: false,
    location: { x: 1115, y: 48, width: 65, height: 58 },
  });
  capture.numericRows = [30, 24, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2].map((value, index) => ({
    row: index + 1,
    right: reading(value),
    addition: { ...reading(0), value: null, uncertain: true },
  }));
  mogi.sequence = {
    version: 1,
    numbers: [{ captureId: capture.id, number: 2, phase: "after" }],
    links: [],
    relations: [],
    occurrences: [],
    gaps: [],
    inputSignature: "pending",
  };
  await restoreState(page, state);
  await expect(page.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Player standings", exact: true }).getByRole("listitem").first(),
  ).toHaveText("1Player 115");
  const rows = page.getByRole("list", { name: "Tracks", exact: true }).getByRole("listitem");
  await expect(page.getByRole("button", { name: "2 Questions", exact: true })).toBeVisible();
  await expect(rows.nth(1)).toContainText("2 questions");
  await expect(rows.nth(3)).not.toContainText("question");
  await expect(page.getByRole("button", { name: "Race 4 · pending", exact: true })).toHaveText("4");
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.getByRole("button", { name: "Open race 4 · pending", exact: true })).toHaveText("4");
  const questionColumn = page.getByRole("button", { name: "Open race 2 · questions", exact: true });
  await expect(questionColumn).toHaveText("2");
  await expect(questionColumn).not.toHaveClass(/bg-primary/);
  await questionColumn.scrollIntoViewIfNeeded();
  // A column with questions opens them, like its progress tile.
  await questionColumn.click();
  await expect(page.getByRole("dialog", { name: "Question 1 of 2", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await rows.nth(1).getByRole("button").click();
  const question = page.getByRole("dialog", { name: "Question 1 of 2", exact: true });
  await expect(question.getByText("Who is “Reading 1”?", { exact: true })).toBeVisible();
  await expect(question.getByRole("radio", { name: /Suggested$/ })).toHaveCount(0);
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await question.getByRole("radio", { name: "Player 1", exact: true }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question).toBeHidden();
  await expect(page.getByText("FFA · Race 3 of 12", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Table", exact: true })).toBeVisible();
  await page.reload();
});
