import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { participantsForRace } from "@mkw/engine";
import { expect, type Page, test } from "@playwright/test";

import type { Capture, Mogi, Race } from "@/lib/mogi/types";

import { useFixedRecognition } from "./fixed-recognition";
import { openMogiSettings } from "./mogi-navigation";
import { ffaRoster, mogiState, restoreState } from "./mogi-state";
import { returnToStandings } from "./participants-navigation";
import { addScreenshots } from "./screenshot-navigation";

/** Race 1 counted from one accepted finish-order image; with `finished`, eleven manual races complete the mogi. */
function countedImage(mogi: Mogi, finished: boolean): { races: Race[]; captures: Capture[] } {
  const original = readFileSync(new URL("./fixtures/spec29/finish-order-totals.jpeg", import.meta.url));
  const placements = participantsForRace(mogi, 1).map((person) => person.id);
  const reading = (value: number) => ({
    text: String(value),
    value,
    confidence: 99,
    uncertain: false,
    location: { x: 1115, y: 48, width: 65, height: 58 },
  });
  return {
    races: [
      {
        id: "counted-race",
        number: 1,
        origin: "observed",
        status: "confirmed",
        placements,
        captureIds: ["counted-capture"],
      },
      ...(finished
        ? Array.from({ length: 11 }, (_, i) => ({
            id: `r${i + 2}`,
            number: i + 2,
            origin: "manual" as const,
            status: "confirmed" as const,
            placements,
          }))
        : []),
    ],
    captures: [
      {
        id: "counted-capture",
        fileName: "race-1.jpeg",
        width: 1920,
        height: 1080,
        stage: "finish-order-confirmed",
        reviewedAt: "2026-10-28",
        reviewedPlacements: placements,
        interpretation: {
          version: 1,
          screen: "finishOrderAdded",
          origin: "visual",
          positions: Array.from({ length: 12 }, (_, i) => reading(i + 1)),
          movementRows: [],
          reasons: [],
        },
        rows: placements.map((id, i) => ({
          text: mogi.participants.find((person) => person.id === id)!.ign,
          confidence: 99,
          uncertain: false,
          suggestedParticipantId: id,
          location: { x: 1270, y: 50 + i * 77, width: 385, height: 56 },
        })),
        nameAssociations: placements.map((id) => ({ participantId: id })),
        original: new Blob([original], { type: "image/jpeg" }),
      },
    ],
  };
}

async function removeImage(page: Page) {
  await openMogiSettings(page);
  const settings = page.getByRole("dialog", { name: "Mogi Settings", exact: true });
  await settings.getByRole("button", { name: "Screenshots 1", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Screenshots", exact: true })
    .getByRole("button", { name: /race-1\.jpeg/ })
    .click();
  await page
    .getByRole("dialog", { name: /^Screenshot \d+$/ })
    .getByRole("button", { name: "Remove Screenshot", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Screenshots", exact: true }).getByRole("listitem")).toHaveCount(0);
  await returnToStandings(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Race 1 · counted", exact: true })).toHaveCount(0);
}

async function setUp(
  page: Page,
  width: number,
  colorScheme: "light" | "dark" = "light",
  tiers = ["A"],
  finished = false,
) {
  await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
  await page.emulateMedia({ colorScheme });
  const state = mogiState(
    ...tiers.map((tier) => ({
      roster: ffaRoster(tier),
      ...(tier === "A"
        ? {
            races: (mogi: Mogi) => countedImage(mogi, finished).races,
            captures: (mogi: Mogi) => countedImage(mogi, finished).captures,
          }
        : {}),
    })),
  );
  state.activeMogiId = state.mogis[tiers.indexOf("A")].id;
  await restoreState(page, state);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mogi Tier A");
  await expect(page.getByRole("button", { name: "Race 1 · counted", exact: true })).toBeVisible();
}

async function expectRestored(page: Page) {
  await expect(page.getByRole("button", { name: "Race 1 · counted", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
  await openMogiSettings(page);
  await expect(
    page
      .getByRole("dialog", { name: "Mogi Settings", exact: true })
      .getByRole("button", { name: "Screenshots 1", exact: true }),
  ).toBeVisible();
  await returnToStandings(page);
}

async function print(page: Page, name: string) {
  // Review prints only: outside the gate unless UNDO_PRINTS names a folder.
  const prints = process.env.UNDO_PRINTS;
  if (!prints) return;
  const file = path.join(prints, `${name}.png`);
  mkdirSync(prints, { recursive: true });
  await page.screenshot({ path: file, scale: "css", animations: "disabled" });
  await test.info().attach(name, { path: file, contentType: "image/png" });
}

test("at 375px, Undo appears in the floating bar beside Back and Menu, without a Notice, ignores Ctrl+Z under a sheet and restores the image", async ({
  page,
}) => {
  await setUp(page, 375);
  await removeImage(page);
  const bar = page.getByRole("toolbar", { name: "Mogi actions", exact: true });
  const group = bar.getByRole("group");
  expect(
    await group
      .getByRole("button")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
  ).toEqual(["Back", "Menu", "Undo"]);
  const undo = group.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await expect(page.getByText("Screenshot removed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Screenshot removed. Undo available." })).toHaveCount(1);
  await print(page, "undo-375-light");
  // With a sheet open the shortcut belongs to the sheet: Undo stays available.
  await openMogiSettings(page);
  await page.keyboard.press("Control+z");
  await returnToStandings(page);
  await expect(undo).toBeVisible();
  await undo.click();
  await expectRestored(page);
});

test("at 1440px, Undo is a toolbar button before Players, without a Notice, and ⌘Z restores the image", async ({
  page,
}) => {
  await setUp(page, 1440);
  await removeImage(page);
  const toolbar = page.getByRole("navigation", { name: "Mogi actions", exact: true });
  const names = await toolbar
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => button.getClientRects().length)
        .map((button) => button.getAttribute("aria-label") ?? button.textContent!.trim()),
    );
  expect(names.slice(names.indexOf("Undo"), names.indexOf("Undo") + 3)).toEqual(["Undo", "Players", "Mogi Settings"]);
  await expect(toolbar.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await expect(page.getByText("Screenshot removed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Screenshot removed. Undo available." })).toHaveCount(1);
  await print(page, "undo-1440-light");
  await page.keyboard.press("Meta+z");
  await expectRestored(page);
});

test("going to another mogi or the list removes Undo", async ({ page }) => {
  await setUp(page, 1440, "light", ["B", "A"]);
  const sidebar = page.getByRole("complementary", { name: "Mogis", exact: true });
  await removeImage(page);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await sidebar.getByRole("button", { name: /^Mogi Tier B\W*FFA/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mogi Tier B");
  await expect(undo).toHaveCount(0);
  await sidebar.getByRole("button", { name: /^Mogi Tier A\W*FFA/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mogi Tier A");
  await expect(undo).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(page.getByRole("button", { name: "Race 1 · counted", exact: true })).toHaveCount(0);
});

test("returning to the list in compact removes Undo", async ({ page }) => {
  await setUp(page, 375);
  await removeImage(page);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: /^Mogi Tier A\W*FFA/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mogi Tier A");
  await expect(undo).toHaveCount(0);
});

test("a finished mogi reads an added image, and that image removed and added again is read afresh", async ({
  page,
}) => {
  await useFixedRecognition(page);
  await setUp(page, 1440, "light", ["A"], true);
  const file = fileURLToPath(new URL("./fixtures/spec29/pre-race-individual-656.jpeg", import.meta.url));
  await addScreenshots(page, file);
  const reading = page.getByRole("status").filter({ hasText: /^Reading 1 of 1$/ });
  await expect(reading).toBeVisible();
  await expect(reading).toHaveCount(0, { timeout: 60000 });
  // Removing it leaves no repeat fingerprint behind.
  await openMogiSettings(page);
  await page
    .getByRole("dialog", { name: "Mogi Settings", exact: true })
    .getByRole("button", { name: "Screenshots 2", exact: true })
    .click();
  const images = page.getByRole("dialog", { name: "Screenshots", exact: true });
  await images.getByRole("button", { name: /pre-race-individual-656\.jpeg/ }).click();
  await page
    .getByRole("dialog", { name: /^Screenshot \d+$/ })
    .getByRole("button", { name: "Remove Screenshot", exact: true })
    .click();
  await expect(images.getByRole("listitem")).toHaveCount(1);
  await returnToStandings(page);
  await addScreenshots(page, file);
  await expect(reading).toBeVisible();
  await expect(page.getByText("Screenshot already in this mogi", { exact: true })).toHaveCount(0);
});
