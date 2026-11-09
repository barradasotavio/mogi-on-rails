import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import type { Mogi, Race } from "@/lib/mogi/types";

import { downloadBackup } from "./backup-navigation";
import { ffaRoster, mogiState, restoreState } from "./mogi-state";
import { openCurrentMogi } from "./settings-navigation";

test("Vote follows the saved sort, lit by natural breaks, and strikes raced ones; Tracks opens in its saved order; both settings travel with the backup", async ({
  page,
}, info) => {
  // Player 1 (p1) finishes in `places[i]` on `tracks[i]`.
  const raced =
    (tracks: NonNullable<Race["track"]>[], places: number[], extra: Partial<Race> = {}) =>
    (mogi: Mogi) =>
      tracks.map((track, index): Race => {
        const others = mogi.participants.map(({ id }) => id).filter((id) => id !== "p1");
        others.splice(places[index] - 1, 0, "p1");
        return {
          id: `r${index + 1}`,
          origin: "manual",
          number: index + 1,
          track,
          placements: others,
          ...(index === 1 ? extra : {}),
        };
      });
  // The saved sort is Races: Crown City 5 (this mogi's second race doesn't count but was still played), Whistlestop
  // Summit and DK Spaceport 3, Mario Bros. Circuit 1, this mogi's first race. Three values, three groups.
  const state = mogiState(
    { roster: ffaRoster("D"), races: raced(["MBC", "CC"], [1, 1], { status: "discarded" }) },
    {
      roster: ffaRoster("C"),
      races: raced(
        ["WS", "WS", "WS", "DKS", "DKS", "DKS", "CC", "CC", "CC", "CC"],
        [1, 1, 1, 12, 12, 12, 1, 12, 1, 12],
      ),
      with: { id: "previous", createdAt: "2026-09-30T12:00:00Z" },
    },
  );
  await restoreState(page, { ...state, loungeNames: ["Player 1"], trackOrder: { by: "races", count: "both" } });
  await expect(page.getByRole("list", { name: "Vote", exact: true }).getByRole("listitem")).toHaveText([
    "Crown City, Good, raced",
    "Whistlestop Summit, Mixed",
    "DK Spaceport, Mixed",
    "Mario Bros. Circuit, Bad, raced",
  ]);

  await page.goto("/?view=tracks");
  const tracks = page.getByRole("list", { name: "Tracks", exact: true }).getByRole("button");
  const byRaces = ["Crown City", "Whistlestop Summit", "DK Spaceport", "Mario Bros. Circuit"];
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
