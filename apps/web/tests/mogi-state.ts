import { type Page } from "@playwright/test";

import { createBackup } from "@/lib/backup/archive";
import { newMogi, readLoungeRoster } from "@/lib/mogi/roster";
import type { Capture, Mogi, Race, TrackerState } from "@/lib/mogi/types";

import { expectRestored } from "./backup-navigation";
import { openBackup, openCurrentMogi } from "./settings-navigation";

/** For fixtures that edit restored state the way a backup manifest is edited: loosely typed on purpose. */
export type Loose = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- fixtures mirror the backup JSON shape.

/** Twelve FFA players, `Player 1` to `Player 12`, at the given tier. */
export function ffaRoster(tier = "D") {
  return `Tier ${tier}\n${Array.from({ length: 12 }, (_, index) => `${index + 1}. Player ${index + 1}`).join("\n")}`;
}

export interface MogiSpec {
  /** The Lounge bot list, read as New Mogi reads it. */
  roster: string;
  /** Races, or a builder that receives the mogi so it can place its participant ids (`p1` to `p12`). */
  races?: Race[] | ((mogi: Mogi) => Race[]);
  captures?: Capture[] | ((mogi: Mogi) => Capture[]);
  /** Any other mogi field: id, name, createdAt, raceDraft… */
  with?: Partial<Mogi>;
}

/**
 * Tracker state with one mogi per spec, the first one active. Ids are deterministic: the mogi is `mogi-1`, `mogi-2`…,
 * its participants `p1` to `p12`, in roster order. Specs that need other top-level fields set them on the result.
 */
export function mogiState(...specs: MogiSpec[]): TrackerState {
  const mogis = specs.map(({ roster, races = [], captures, with: fields }, index) => {
    const mogi = newMogi(roster, readLoungeRoster(roster), {
      id: `mogi-${index + 1}`,
      participantId: (n) => `p${n + 1}`,
      createdAt: new Date(Date.UTC(2026, 9, 1, 12, index)),
    });
    Object.assign(mogi, fields);
    mogi.races = typeof races === "function" ? races(mogi) : races;
    if (captures) mogi.captures = typeof captures === "function" ? captures(mogi) : captures;
    return mogi;
  });
  return { version: 1, mogis, activeMogiId: mogis[0]?.id ?? null };
}

/** The state as a backup ZIP, zipped by the app's own `createBackup`. */
export async function stateBackup(state: TrackerState, name = "state.zip") {
  const blob = await createBackup(state);
  return { name, mimeType: "application/zip", buffer: Buffer.from(await blob.arrayBuffer()) };
}

/**
 * Replaces the page's data with `state` through Settings › Storage › Restore from File, then opens the active mogi,
 * if any. Opens the app first when the page is blank.
 */
export async function restoreState(page: Page, state: TrackerState) {
  const file = await stateBackup(state);
  if (page.url() === "about:blank") await page.goto("/");
  await openBackup(page);
  await page.getByLabel("Restore from file").setInputFiles(file);
  await page.getByRole("button", { name: "Replace All Data", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Replace All Data?", exact: true })
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await expectRestored(page);
  if (state.activeMogiId) await openCurrentMogi(page);
}
