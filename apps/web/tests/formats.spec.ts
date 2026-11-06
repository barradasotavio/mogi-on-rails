import { readFileSync } from "node:fs";

import { registerSubstitution } from "@mkw/engine";
import { expect, test } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { downloadBackup, expectRestored } from "./backup-navigation";
import { createMogi, openCreation } from "./mogi-creation";
import { type Loose, mogiState, restoreState } from "./mogi-state";
import { openParticipants, openSubstitution } from "./participants-navigation";
import { nameQuestions } from "./question-fixture";
import { observedRace } from "./race-fixture";

function roster(teamSize: number) {
  return `Tier D\n${Array.from(
    { length: 12 / teamSize },
    (_, group) =>
      `${group + 1}. ${Array.from({ length: teamSize }, (_, member) => `Player ${group * teamSize + member + 1}`).join(", ")}`,
  ).join("\n")}`;
}

test("removed lists are refused and Players records a substitution from the first race", async ({ page }) => {
  await page.goto("/");
  for (const size of [4, 6]) {
    await openCreation(page);
    await page.getByLabel("Lounge bot list", { exact: true }).fill(roster(size));
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.getByText("This app supports FFA, 2v2 and 3v3. 4v4 and 6v6 lists can't be used.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Mogi on Rails", exact: true })).toBeVisible();
  }
  await createMogi(page, roster(2));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openParticipants(page);
  const list = page.getByRole("dialog", { name: "Players", exact: true });
  const players = list.getByRole("list", { name: "Player list", exact: true });
  await expect(players.getByRole("listitem")).toHaveCount(12);
  await expect(players.getByRole("listitem").first().getByLabel("Team 1", { exact: true })).toBeVisible();
  // "Player N" in every team suggests the same tag: all stay untagged without blocking anything.
  const untagged = list.getByRole("list", { name: "Teams without a tag", exact: true });
  await expect(untagged.getByRole("listitem")).toHaveCount(6);
  // Under the untagged teams, the roster opens its own section.
  await expect(players.locator("xpath=..").getByRole("heading", { name: "Players", exact: true })).toBeVisible();
  await expect(untagged.getByRole("listitem").first()).toContainText("Another team also seems to use Play");
  await untagged.getByRole("button", { name: /Player 1, Player 2/ }).click();
  const team = page.getByRole("dialog", { name: "Team 1", exact: true });
  await expect(
    team.getByText("Another team also seems to use Play. Pick a tag for this one, or leave it empty.", { exact: true }),
  ).toBeVisible();
  await team.getByLabel("Tag", { exact: true }).fill("XO");
  await team.getByLabel("Tag", { exact: true }).blur();
  const tagged = page.getByRole("dialog", { name: "XO", exact: true });
  await expect(tagged.getByText("The in-game names suggest Play.", { exact: true })).toBeVisible();
  await expect(tagged.getByRole("button", { name: "Use Play", exact: true })).toBeVisible();
  await tagged.getByRole("button", { name: "Player 2", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Player 2", exact: true })
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await tagged.getByRole("button", { name: "Back", exact: true }).click();
  await expect(untagged.getByRole("listitem")).toHaveCount(5);
  await expect(players.getByRole("listitem").first().getByLabel("Team 1 · XO", { exact: true })).toHaveText("XO");
  await list.getByRole("button", { name: "Player 1", exact: true }).click();
  const person = page.getByRole("dialog", { name: "Player 1", exact: true });
  // On a person, the team opens its page and Back returns to the person.
  await person.getByRole("button", { name: /^Team/ }).click();
  await expect(tagged.getByLabel("Tag", { exact: true })).toHaveValue("XO");
  await tagged.getByRole("button", { name: "Back", exact: true }).click();
  await expect(person.getByText("In this mogi", { exact: true })).toHaveCount(0);
  await person.getByRole("button", { name: "Record Sub", exact: true }).click();
  const sub = page.getByRole("dialog", { name: "Sub", exact: true });
  await expect(sub.getByRole("radio", { name: "1", exact: true })).toBeChecked();
  await expect(sub.getByRole("radio", { name: "2", exact: true })).toBeDisabled();
  await sub.getByRole("radio", { name: "1", exact: true }).click();
  await expect(sub.getByRole("radio", { name: "1", exact: true })).toBeChecked();
  await expect(sub.getByText("Player 1 never raced: every race goes to the sub.", { exact: true })).toBeVisible();
  await sub.getByRole("button", { name: "Back", exact: true }).click();
  await expect(person.getByRole("button", { name: "Back", exact: true })).toBeFocused();
  await person.getByRole("button", { name: "Record Sub", exact: true }).click();
  await sub.getByLabel("Sub's Lounge name", { exact: true }).fill("Early sub");
  // The inspector keeps its presentation and draft even when crossing the breakpoint.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(sub.getByLabel("Sub's Lounge name", { exact: true })).toHaveValue("Early sub");
  await sub.getByRole("button", { name: "Record Sub", exact: true }).click();
  await expect(list.getByText("No races", { exact: true })).toBeVisible();
  await expect(list.getByText("Races 1–12", { exact: true })).toBeVisible();
  await list.getByRole("button", { name: "Player 1", exact: true }).click();
  await expect(person.getByText("Subbed out for Early sub", { exact: true })).toBeVisible();
  await expect(person.getByRole("button", { name: "Record Sub", exact: true })).toHaveCount(0);
  await person.getByRole("button", { name: "Back", exact: true }).click();
  await list.getByRole("button", { name: "Close", exact: true }).click();
  await expect(list).toBeHidden();
  // A new opening uses the compact class and starts on the list.
  await openParticipants(page);
  await expect(list.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await list.getByRole("button", { name: "Close", exact: true }).click();
  await expect(list).toBeHidden();
  // Data as the steps above left it (tag XO, Early sub from race 1), with race 1 observed.
  const built = mogiState({ roster: roster(2) });
  built.mogis[0].teams![0].tag = "XO";
  built.mogis[0] = registerSubstitution(built.mogis[0], {
    slotId: "p1",
    loungeName: "Early sub",
    ign: "",
    fromRace: 1,
  });
  await restoreState(page, observedRace(built));
  await openSubstitution(page, "Player 2");
  await expect(sub.getByRole("radio", { name: "2", exact: true })).toBeChecked();
  await expect(sub.getByRole("radio", { name: "3", exact: true })).toBeDisabled();
  await expect(sub.getByText("Races before 2 stay with Player 2.", { exact: true })).toBeVisible();
  await expect(sub.getByRole("button", { name: "Record Sub", exact: true })).toBeDisabled();
  await sub.getByLabel("Sub's Lounge name", { exact: true }).fill("Fresh sub");
  await sub.getByRole("button", { name: "Record Sub", exact: true }).click();
  await expect(page.getByText("Fresh sub subs in from race 2", { exact: true })).toBeVisible();
  await expect(list.getByText("Races 1–1", { exact: true })).toBeVisible();
  await page.reload();
  await openParticipants(page);
  await expect(list.getByText("Races 2–12", { exact: true })).toBeVisible();
  await expect(players.getByRole("listitem").first().getByLabel("Team 1 · XO", { exact: true })).toBeVisible();
  await expect(list.getByText("Races 1–12", { exact: true })).toBeVisible();
});

test("backup refuses unsupported formats and restores normal queue formats with tags", async ({ page }, info) => {
  await page.goto("/");
  for (const index of [0, 1, 2]) {
    if (index) await page.getByRole("button", { name: "Back", exact: true }).click();
    await createMogi(page, roster(index + 1));
  }
  const files = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("supported.zip"))));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  expect(manifest.state.mogis.map((mogi: { format: string }) => mogi.format)).toEqual(["FFA", "2v2", "3v3"]);
  for (const mogi of manifest.state.mogis) {
    expect(mogi.name).toMatch(/^Mogi [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
    expect(mogi.teams.map((team: { name: string }) => team.name)).toEqual(
      Array.from({ length: mogi.teams.length }, (_, index) => `Team ${index + 1}`),
    );
  }
  const unsupported = structuredClone(manifest);
  unsupported.state.mogis[0].format = "4v4";
  await page.getByLabel("Restore from file").setInputFiles({
    name: "unsupported.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(unsupported)) })),
  });
  await expect(page.getByRole("alert")).toContainText("Unsupported format.");
  // The chosen tag is additive in the backup and returns on restore.
  manifest.state.mogis[1].teams[0].tag = "XO";
  manifest.state.activeMogiId = null;
  await page.getByLabel("Restore from file").setInputFiles({
    name: "supported.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(manifest)) })),
  });
  await page.getByRole("button", { name: "Replace All Data", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Replace All Data on This Device?", exact: true })
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await expectRestored(page);
  await page.reload();
  // Without an active mogi, loading opens the list.
  const back = page.getByRole("button", { name: "Back", exact: true });
  await expect(page.getByRole("heading", { name: "Mogis", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Mogi Tier D · FFA/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Mogi Tier D · 2v2/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Mogi Tier D · 3v3/ })).toBeVisible();
  await page.getByRole("button", { name: /^Mogi Tier D · 2v2/ }).click();
  await openParticipants(page);
  await expect(
    page.getByRole("dialog", { name: "Players", exact: true }).getByLabel("Team 1 · XO", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Players", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await back.click();
  await page.getByRole("button", { name: /^Mogi Tier D · FFA/ }).click();
  const restored = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("restored.zip"))));
  const state = JSON.parse(strFromU8(restored["manifest.json"])).state;
  expect(state.mogis.map((mogi: { format: string }) => mogi.format)).toEqual(["FFA", "2v2", "3v3"]);
  expect(state.mogis[1].teams[0].tag).toBe("XO");
});

test("Players keeps one row per person with IGNs and the substitution range at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const state = nameQuestions(mogiState({ roster: roster(1) }), [], 0);
  let mogi: Loose = state.mogis[0];
  mogi.participants[0].ign = "First very long in-game name";
  mogi.races = Array.from({ length: 5 }, (_, i) => ({
    id: `r${i + 1}`,
    origin: "manual",
    number: i + 1,
    placements: mogi.participants.map((person: { id: string }) => person.id),
  }));
  mogi = registerSubstitution(mogi, {
    slotId: mogi.participants[0].id,
    loungeName: "Replacement with a long name",
    ign: "Another very long IGN",
    fromRace: 6,
  });
  mogi.captures[0].context.raceId = "r2";
  mogi.captures[0].rows[0].uncertain = true;
  mogi.captures[0].nameAssociations[0].ign = "Second very long in-game name";
  state.mogis[0] = mogi;
  await restoreState(page, state);
  await openParticipants(page);
  const list = page.getByRole("list", { name: "Player list", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(13);
  await expect(list.getByRole("button", { name: "Player 1", exact: true })).toContainText(
    "First very long in-game name · Second very long in-game name",
  );
  await expect(list.getByRole("button", { name: "Player 1", exact: true })).toContainText("Races 1–5");
  await expect(list.getByRole("button", { name: "Replacement with a long name", exact: true })).toContainText(
    "Races 6–12",
  );
  const heights = await list
    .getByRole("button")
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
  for (const height of heights) expect(height).toBeCloseTo(44, 2);
});
