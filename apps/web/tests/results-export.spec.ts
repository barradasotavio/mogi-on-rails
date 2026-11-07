import { readFileSync } from "node:fs";

import { participantsForRace, registerSubstitution } from "@mkw/engine";
import type { BrowserContext } from "@playwright/test";
import { expect, type Page, test } from "@playwright/test";

import { createMogi } from "./mogi-creation";
import { openMogiActions } from "./mogi-navigation";
import { ffaRoster, mogiState, restoreState } from "./mogi-state";
import { openParticipants, returnToStandings } from "./participants-navigation";
import { questionEvidence } from "./question-evidence";

const roster = ffaRoster();
const finalCommand =
  "!submit 1 D\nPlayer 1 180\nPlayer 2 144\nPlayer 3 120\nPlayer 4 108\nPlayer 5 96\nPlayer 6 84\nPlayer 7 72\nPlayer 8 60\nPlayer 9 48\nPlayer 10 36\nPlayer 11 24\nPlayer 12 12";

/** All 12 races counted in roster order; with `checkEmpty`, Player 1 is replaced from race 9 and the credit question is answered first. */
async function openFinalExport(page: Page, context: BrowserContext, checkEmpty = false) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  if (checkEmpty) {
    // A new mogi exports while it waits on every race.
    await page.goto("/");
    await createMogi(page, roster);
    await openMogiActions(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const emptyExport = page.getByRole("dialog", { name: "Export", exact: true });
    await expect(emptyExport.getByRole("button", { name: "Copy Share Text", exact: true })).toBeEnabled();
    await expect(emptyExport.getByRole("textbox", { name: "!submit", exact: true })).toHaveCount(0);
    await expect(emptyExport.getByRole("list", { name: "!submit", exact: true })).toHaveText(
      "!submitWaiting on 12 races",
    );
    await expect(emptyExport.getByRole("button", { name: "Copy Table", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(emptyExport).toBeHidden();
  }
  const state = mogiState({ roster });
  let mogi = state.mogis[0];
  if (checkEmpty)
    mogi = registerSubstitution(mogi, {
      slotId: mogi.participants[0].id,
      loungeName: "Replacement",
      ign: "New",
      fromRace: 9,
    });
  state.mogis[0] = {
    ...mogi,
    races: Array.from({ length: 12 }, (_, index) => ({
      id: `race-${index + 1}`,
      origin: "manual",
      number: index + 1,
      placements: participantsForRace(mogi, index + 1).map((person) => person.id),
    })),
  };
  await restoreState(page, state);
  if (checkEmpty) {
    await page.getByRole("button", { name: "1 Question", exact: true }).click();
    const question = page.getByRole("dialog", { name: "Question 1 of 1", exact: true });
    await expect(question.getByText("Who gets credit for Player 1?", { exact: true })).toBeVisible();
    await expect(question.getByRole("radio", { name: /Replacement.*Suggested/ })).toBeChecked();
    await expect(question.getByText("Played 4 races in a winning position", { exact: true })).toBeVisible();
    await expect(question.getByRole("img")).toHaveCount(0);
    await questionEvidence(page, "credit");
    await question.getByRole("button", { name: "Not Sure", exact: true }).click();
    await expect(question).toBeHidden();
    await expect(page.getByRole("button", { name: "Race 12 · counted", exact: true })).toHaveText("12");
    await expect(page.getByText("Question left for later", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "1 Question", exact: true }).click();
    await question.getByRole("radio", { name: "Player 1", exact: true }).check();
    await question.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(question).toBeHidden();
    const header = page.locator("header").filter({ has: page.locator("h1") });
    await header.getByRole("button", { name: "Copy !submit", exact: true }).click();
    await expect(header.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    await expect(header.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(1);
    await expect(page.locator("[data-toast]")).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(finalCommand);
    await expect(header.getByRole("button", { name: "Copy !submit", exact: true })).toBeVisible();
    await page.reload();
    await openParticipants(page);
    await page
      .getByRole("dialog", { name: "Players", exact: true })
      .getByRole("button", { name: "Player 1", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Player 1", exact: true })
      .getByRole("button", { name: "Credit Player 1", exact: true })
      .click();
    await expect(question.getByText("Who gets credit for Player 1?", { exact: true })).toBeVisible();
    await expect(question.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await expect(question.getByRole("radio", { name: /Replacement.*Suggested/ })).toBeChecked();
    await question.getByRole("radio", { name: "Player 1", exact: true }).check();
    await question.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(question).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: "1 Question", exact: true })).toHaveCount(0);
  }
  await openMogiActions(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Export", exact: true });
  return panel;
}

test("Save Text downloads !submit when clipboard access is denied", async ({ page, context }, info) => {
  const panel = await openFinalExport(page, context, true);
  await expect(panel.getByLabel("Tier", { exact: true })).toHaveValue("D");
  await expect(panel.getByLabel("!submit", { exact: true })).toHaveValue(finalCommand);
  await expect(panel.getByLabel("!submit", { exact: true })).toHaveAttribute("readonly", "");

  await page.clock.install({ time: new Date("2026-10-28T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T12:00:10Z"));
  const copy = panel.getByRole("button", { name: /^(Copy !submit|Copied)$/ });
  await copy.click();
  await expect(panel.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  const announced = panel.getByRole("status").filter({ hasText: "Copied" });
  await expect(announced).toHaveCount(1);
  expect(await announced.evaluate((element) => element.closest('[aria-hidden="true"]'))).toBeNull();
  await expect(page.locator("[data-toast]")).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(finalCommand);

  await panel.getByLabel("Tier", { exact: true }).fill("E");
  await panel.getByLabel("Tier", { exact: true }).press("Tab");
  await expect(panel.getByLabel("!submit", { exact: true })).toHaveValue(
    finalCommand.replace("!submit 1 D", "!submit 1 E"),
  );
  await expect(copy).toBeEnabled();

  // Denial is injected only at the native API, keeping export and download real.
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
    });
  });
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  // The virtual clock also completes Radix's asynchronous focus restoration.
  await page.clock.fastForward(1);
  await returnToStandings(page);
  const header = page.locator("header").filter({ has: page.locator("h1") });
  await header.getByRole("button", { name: "Copy !submit", exact: true }).click();
  await expect(panel).toBeVisible();
  const save = panel.getByRole("button", { name: "Save Text", exact: true });
  await expect(save).toBeFocused();
  // The failure is said inline in Export, beside its alternative, never in a toast.
  await expect(panel.getByText("Couldn't copy !submit. Use Save Text.", { exact: true })).toBeVisible();
  await expect(page.locator("[data-toast]")).toHaveCount(0);
  await page.clock.fastForward(1700);
  await expect(save).toBeVisible();
  await page.clock.resume();
  const downloading = page.waitForEvent("download");
  await save.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("mkw-submit.txt");
  const path = info.outputPath("mkw-submit.txt");
  await download.saveAs(path);
  expect(readFileSync(path, "utf8")).toBe(finalCommand.replace("!submit 1 D", "!submit 1 E"));
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(header.getByRole("button", { name: "Copy !submit", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mogi Tier E", exact: true })).toBeVisible();
});

test("an empty tier explains why the final header cannot submit", async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const panel = await openFinalExport(page, context);
  await panel.getByLabel("Tier", { exact: true }).fill("");
  await panel.getByLabel("Tier", { exact: true }).blur();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await returnToStandings(page);
  const missingTier = page
    .locator("header")
    .filter({ has: page.locator("h1") })
    .getByRole("button", { name: "Add the Tier to Submit", exact: true });
  await expect(missingTier).toBeVisible();
  await expect(missingTier).toBeDisabled();
  await openMogiActions(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "!submit", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("list", { name: "!submit", exact: true })).toHaveCount(0);
  await expect(panel.getByLabel("Tier", { exact: true })).toHaveAccessibleDescription("Needed for !submit");
  await panel.getByLabel("Tier", { exact: true }).fill("D");
  await panel.getByLabel("Tier", { exact: true }).blur();
  await expect(panel.getByLabel("!submit", { exact: true })).toHaveValue(finalCommand);
});

test("export refuses data changed in another tab", async ({ page, context }) => {
  const panel = await openFinalExport(page, context);
  const other = await context.newPage();
  await other.goto(page.url());
  await openMogiActions(other);
  await other.getByRole("button", { name: "Export", exact: true }).click();
  const otherExport = other.getByRole("dialog", { name: "Export", exact: true });
  await otherExport.getByLabel("Tier", { exact: true }).fill("E");
  await otherExport.getByLabel("Tier", { exact: true }).blur();
  await expect(otherExport.getByLabel("!submit", { exact: true })).toHaveValue(/^!submit 1 E/);
  await other.keyboard.press("Escape");
  await other.reload();
  await expect(other.getByRole("heading", { name: "Mogi Tier E", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Copy !submit", exact: true }).click();
  await expect(panel.getByText("The data changed. Reload before exporting.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("img", { name: "Table preview", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Save Text", exact: true })).toBeDisabled();
  // From the mogi header, the same refusal is the concurrent-write alert, not a toast.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await returnToStandings(page);
  await page
    .locator("header")
    .filter({ has: page.locator("h1") })
    .getByRole("button", { name: "Copy !submit", exact: true })
    .click();
  const changed = page.getByRole("alertdialog", { name: "Your Data Changed in Another Window", exact: true });
  await expect(changed).toHaveAccessibleDescription(
    "Reload before continuing. Confirmed results and pending screenshots are kept.",
  );
  await expect(changed.getByRole("button")).toHaveText(["Reload"]);
  await expect(page.getByText("The data changed. Reload before exporting.", { exact: true })).toHaveCount(0);
});

// Only the native APIs fail; the export, the clipboard text and the downloads stay real.
async function failImageCopy(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "write", {
      configurable: true,
      value: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
    });
  });
}

test("copy and share failures appear inline in Export with a fallback and clear on the next attempt", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: () => Promise.resolve() });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  const panel = await openFinalExport(page, context);
  await failImageCopy(page);
  await panel.getByRole("button", { name: "Copy Image", exact: true }).click();
  await expect(panel.getByText("Couldn't copy the image. Use Save Image.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Copy Image", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Share", exact: true }).click();
  await expect(panel.getByText("Couldn't share. Use Save Image.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Couldn't copy the image. Use Save Image.", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Copy Share Text", exact: true }).click();
  await expect(panel.getByText("Couldn't share. Use Save Image.", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  await expect(panel.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(1);
  await expect(page.locator("[data-toast]")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Copy Share Text", exact: true })).toBeVisible();
});
