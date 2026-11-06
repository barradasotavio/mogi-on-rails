import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { downloadBackup } from "./backup-navigation";
import { type Loose, mogiState, restoreState } from "./mogi-state";
import { openParticipants, returnToStandings } from "./participants-navigation";
import { nameQuestions, otherQuestion, roomQuestions, teamNameQuestions } from "./question-fixture";

const roster = `Tier D\n${Array.from({ length: 12 }, (_, index) => `${index + 1}. Piloto ${index + 1}`).join("\n")}`;
const base = () => mogiState({ roster });
async function restoreQuestions(page: Page, unresolved: number, races: number[], decreases = false) {
  await restoreState(page, nameQuestions(base(), races, unresolved, decreases));
  await page.getByRole("button", { name: /^\d+ Questions?$/ }).click();
  return page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
}

test("the sheet root stays unscrolled after three confirmations at 375 × 812", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const question = await restoreQuestions(page, 12, []);
  for (let index = 1; index <= 3; index++) {
    await expect(question.getByText(`Who is “Reading ${index}”?`, { exact: true })).toBeVisible();
    await question.getByRole("radio", { name: new RegExp(`^Piloto ${13 - index}( Suggested)?$`) }).check();
    await question.getByRole("button", { name: "Confirm", exact: true }).press("Enter");
    await expect(question.getByText(`Who is “Reading ${index + 1}”?`, { exact: true })).toBeVisible();
    await expect.poll(() => question.evaluate((element) => element.scrollTop)).toBe(0);
  }
});

test("the counter grows when new continuity questions enter the queue during the session", async ({ page }) => {
  const question = await restoreQuestions(page, 3, [3, 4], true);
  await expect(question).toHaveAccessibleName("Question 1 of 3");
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await question.getByRole("radio", { name: "Piloto 1", exact: true }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).press("Enter");
  await expect(question).toHaveAccessibleName("Question 2 of 3");
  await question.getByRole("radio", { name: "Piloto 2", exact: true }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).press("Enter");
  // The last name is eliminated; both intervals can now be asked about.
  await expect(
    question.getByText("Did everyone keep their points between these screenshots?", { exact: true }),
  ).toBeVisible();
  await expect(question).toHaveAccessibleName("Question 3 of 4");
  await question.getByRole("radio", { name: "Yes, points carried over", exact: true }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).press("Enter");
  await expect(question).toHaveAccessibleName("Question 4 of 4");
  await question.getByRole("radio", { name: "No, the room reopened", exact: true }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).press("Enter");
  await expect(question).toBeHidden();
});

test("the cumulative anchor numbers the capture without opening a race question", async ({ page }) => {
  const state = await otherQuestion(base(), "race");
  const capture: Loose = state.mogis[0].captures![0];
  const points = [30, 24, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2];
  const reading = (value: number) => ({
    text: String(value),
    value,
    confidence: 100,
    uncertain: false,
    location: { x: 1728, y: 50, width: 112, height: 56 },
  });
  capture.numericRows = points.map((value, index) => ({
    row: index + 1,
    right: reading(value),
    addition: { ...reading(0), value: null, uncertain: true },
  }));
  await restoreState(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("button", { name: /^\d+ Questions?$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Race 2 · counted", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /^Question/ })).toHaveCount(0);
});

test("room sessions persist through the queue and public ZIP: session, order and deduced", async ({ page }, info) => {
  for (const kind of ["session", "order", "deduced"] as const) {
    await restoreState(page, roomQuestions(base(), kind));
    if (kind !== "deduced") {
      await page.getByRole("button", { name: "1 Question", exact: true }).click();
      const question = page.getByRole("dialog", { name: "Question 1 of 1", exact: true });
      await expect(
        question.getByText(kind === "session" ? "Which race is this?" : "Which came first?", { exact: true }),
      ).toBeVisible();
      await question
        .getByRole("radio", { name: kind === "session" ? "Race 7 Suggested" : "room-a-1.jpeg Suggested", exact: true })
        .check();
      await question.getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(question).toBeHidden();
    }
    await expect(page.getByRole("button", { name: /^\d+ Questions?$/ })).toHaveCount(0);
    await page.reload();
    const saved = unzipSync(readFileSync(await downloadBackup(page, info.outputPath(`${kind}-answered.zip`))));
    const mogi = JSON.parse(strFromU8(saved["manifest.json"])).state.mogis[0];
    if (kind === "session") {
      expect(mogi.sequence.roomAnalysis.sessions[0].start).toBe(5);
      expect(mogi.races.find((r: { captureIds?: string[] }) => r.captureIds?.includes("room-a-1")).number).toBe(7);
    } else if (kind === "order") {
      expect(mogi.sequence.numbers.map((n: { number: number }) => n.number).sort()).toEqual([1, 2, 3, 4]);
      expect(mogi.sequence.roomAnalysis.sessions).toHaveLength(2);
    } else {
      expect(mogi.captures[0].numericRows[0].right.value).toBeNull();
      expect(mogi.captures[0].numericDeductions).toEqual([{ row: 1, field: "right", value: 15, origin: "deduced" }]);
      expect(mogi.captures[0].numericAnswers).toBeUndefined();
    }
  }
});

test("a stale draft offers the action that discards it and opens the current race", async ({ page }) => {
  const state = nameQuestions(base(), [], 3);
  const mogi = state.mogis[0];
  mogi.raceDraft = {
    version: 1,
    purpose: "manual",
    raceId: "question-race",
    number: 2,
    baseSignature: "0".repeat(64),
    updatedAt: "2026-10-29T00:00:00Z",
    fields: {
      placements: mogi.participants.map((person) => person.id),
      absentParticipantIds: [],
      rawOverrides: {},
      reviewed: false,
    },
  };
  await restoreState(page, state);
  // The draft is a pencil on its race's tile; Resume and Discard live in that race's sheet, with no banner.
  const tile = page.getByRole("button", { name: /^Race 2 · .* · Edit in progress$/ });
  await expect(tile.locator('[data-race-badge="editing"]')).toBeVisible();
  await tile.click();
  const draftSheet = page.getByRole("dialog", { name: "Race 2", exact: true });
  await expect(draftSheet).toHaveAccessibleDescription("Edit in progress");
  await draftSheet.getByRole("button", { name: "Resume Edit", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard Draft", exact: true }).click();
  const race = page.getByRole("dialog", { name: "Race 2", exact: true });
  await expect(race).toBeVisible();
  await expect(race).not.toHaveAccessibleDescription("Edit in progress");
  await expect(race.getByRole("button", { name: "Edit Result", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume Edit", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mogi Tier D", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume Edit", exact: true })).toHaveCount(0);
});

test("3v3 restricts options to the trio and keeps deductions correctable after reload", async ({ page }, info) => {
  await restoreState(page, teamNameQuestions(base()));
  await page.getByRole("button", { name: "1 Question", exact: true }).click();
  const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  await expect(question.getByRole("radio")).toHaveCount(4);
  await expect(question.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await question.getByRole("radio", { name: /^Northstar(?: Suggested)?$/ }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question.getByRole("radio")).toHaveCount(3);
  await expect(question.getByRole("radio", { name: /^Northstar/ })).toHaveCount(0);
  await question.getByRole("radio", { name: /^Waterfall(?: Suggested)?$/ }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: /^\d+ Questions?$/ })).toHaveCount(0);
  await openParticipants(page);
  await page
    .getByRole("dialog", { name: "Players", exact: true })
    .getByRole("button", { name: "Sunflower", exact: true })
    .click();
  const person = page.getByRole("dialog", { name: "Sunflower", exact: true });
  await expect(person.getByText("Suggested", { exact: true })).toBeVisible();
  await person.getByRole("button", { name: "Unlink A *", exact: true }).click();
  await returnToStandings(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "1 Question", exact: true })).toBeVisible();
  const saved = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("unlinked-team-question.zip"))));
  const mogi = JSON.parse(strFromU8(saved["manifest.json"])).state.mogis[0];
  expect(mogi.captures[0].nameAssociations[2]).toEqual({ participantId: null, unlinked: true });
});
