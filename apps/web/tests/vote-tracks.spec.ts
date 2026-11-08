import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import type { Mogi, Race } from "@/lib/mogi/types";

import { downloadBackup } from "./backup-navigation";
import { ffaRoster, mogiState, restoreState } from "./mogi-state";
import { openCurrentMogi } from "./settings-navigation";

test("the saved track order orders Tracks and Vote, strikes tracks raced in the mogi, and it and hiding Vote travel with the backup", async ({
  page,
}, info) => {
  const raced =
    (tracks: NonNullable<Race["track"]>[], extra: Partial<Race> = {}) =>
    (mogi: Mogi) =>
      tracks.map((track, index): Race => ({
        id: `r${index + 1}`,
        origin: "manual",
        number: index + 1,
        track,
        placements: mogi.participants.map(({ id }) => id),
        ...(index === 1 ? extra : {}),
      }));
  // Races per track: Whistlestop Summit 4, DK Spaceport 3, Crown City 2, Mario Bros. Circuit 1 (this mogi's first);
  // this mogi's second race, on Crown City, doesn't count but was still played.
  const state = mogiState(
    { roster: ffaRoster("D"), races: raced(["MBC", "CC"], { status: "discarded" }) },
    {
      roster: ffaRoster("C"),
      races: raced(["WS", "WS", "WS", "WS", "DKS", "DKS", "DKS", "CC", "CC"]),
      with: { id: "previous", createdAt: "2026-09-30T12:00:00Z" },
    },
  );
  await restoreState(page, { ...state, loungeNames: ["Player 1"], trackOrder: { by: "races", count: "both" } });
  const byRaces = ["Whistlestop Summit", "DK Spaceport", "Crown City", "Mario Bros. Circuit"];
  await expect(page.getByRole("list", { name: "Vote", exact: true }).getByRole("listitem")).toHaveText([
    byRaces[0],
    byRaces[1],
    `${byRaces[2]}, raced`,
    `${byRaces[3]}, raced`,
  ]);

  await page.goto("/?view=tracks");
  const tracks = page.getByRole("list", { name: "Tracks", exact: true }).getByRole("button");
  for (const [index, name] of byRaces.entries()) await expect(tracks.nth(index)).toContainText(name);
  await page.getByRole("button", { name: "Sort", exact: true }).filter({ visible: true }).click();
  const sort = page.getByRole("dialog", { name: "Sort", exact: true });
  await expect(sort.getByRole("button", { name: "Make Default", exact: true })).toBeDisabled();
  await sort.getByRole("button", { name: "Total", exact: true }).click();
  await sort.getByRole("button", { name: "Make Default", exact: true }).click();
  await expect(sort.getByRole("button", { name: "Make Default", exact: true })).toBeDisabled();
  const shown = sort.getByRole("switch", { name: "Show Vote on Mogis", exact: true });
  await expect(shown).toBeChecked();
  await shown.click();
  await expect(shown).not.toBeChecked();
  await page.keyboard.press("Escape");
  const manifest = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("backup.zip"))))["manifest.json"];
  const saved = JSON.parse(strFromU8(manifest)).state;
  expect(saved.trackOrder).toEqual({ by: "total", count: "both" });
  expect(saved.voteShown).toBe(false);
  await openCurrentMogi(page);
  await expect(page.getByRole("list", { name: "Vote", exact: true })).toHaveCount(0);
});
