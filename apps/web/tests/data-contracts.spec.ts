import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { mogiOriginalList } from "@mkw/engine";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { downloadBackup, expectRestored } from "./backup-navigation";
import { useFixedRecognition } from "./fixed-recognition";
import { createMogi } from "./mogi-creation";
import { choosePlace, consultRace, openMogiActions, openMogiSection, openMogiSettings } from "./mogi-navigation";
import { type Loose, mogiState, restoreState, stateBackup } from "./mogi-state";
import { openParticipants } from "./participants-navigation";
import { questionEvidence } from "./question-evidence";
import { nameQuestions, otherQuestion } from "./question-fixture";
import { observedRace } from "./race-fixture";
import { addScreenshots } from "./screenshot-navigation";
import { openBackup, openCurrentMogi, openSettings } from "./settings-navigation";

const roster = `Tier D\n${Array.from({ length: 12 }, (_, index) => `${index + 1}. Piloto ${index + 1}`).join("\n")}`;
const originalPath = fileURLToPath(new URL("./fixtures/spec29/finish-order-totals.jpeg", import.meta.url));

async function failTrackerRead(page: Page) {
  await page.addInitScript(() => {
    const transact = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      const transaction = transact.call(this, stores, mode, options);
      if (this.name === "mkw-on-rails" && mode === "readonly") {
        IDBDatabase.prototype.transaction = transact;
        queueMicrotask(() => transaction.abort());
      }
      return transaction;
    };
  });
}

test("a read failure replaces the list and sidebar with recovery, which also offers Manage Storage", async ({
  page,
}) => {
  await failTrackerRead(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Couldn't Open Your Mogis", exact: true })).toBeVisible();
  await expect(
    page.getByText("Your data is still on this device. Reload to try again, or restore a backup.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("button")).toHaveText([
    "Reload",
    "Restore from Backup",
    "Manage Storage",
  ]);
  await expect(page.getByRole("button", { name: "New Mogi", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mogis", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Opening Mogi on Rails", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // At regular width the sidebar and app navigation stay out too.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("heading", { name: "Couldn't Open Your Mogis", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Mogis", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "App navigation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "App navigation", exact: true })).toHaveCount(0);
  await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: "Reload", exact: true }).click()]);
  await expect(page.getByRole("heading", { name: "Couldn't Open Your Mogis", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage Storage", exact: true }).click();
  const storage = page.getByRole("dialog", { name: "Storage", exact: true });
  await expect(storage.getByRole("button", { name: "Back", exact: true })).toBeFocused();
  await expect(storage.getByRole("button", { name: "Save Backup", exact: true })).toBeVisible();
});

test("recovery restores a backup without loading existing data", async ({ page, context }) => {
  const backup = await stateBackup(observedRace(mogiState({ roster })), "recovery.zip");
  await restoreState(page, mogiState({ roster: roster.replace("Tier D", "Tier Current") }));

  const recovery = await context.newPage();
  await failTrackerRead(recovery);
  await recovery.goto("/");
  await recovery.getByRole("button", { name: "Restore from Backup", exact: true }).click();
  await expect(recovery.getByRole("dialog", { name: "Storage", exact: true })).toBeVisible();
  await recovery.keyboard.press("Escape");
  await expect(recovery.getByRole("button", { name: "Restore from Backup", exact: true })).toBeFocused();
  await recovery.getByRole("button", { name: "Restore from Backup", exact: true }).click();
  await recovery.getByLabel("Restore from file", { exact: true }).setInputFiles(backup);
  await recovery.getByRole("button", { name: "Replace All Data", exact: true }).click();
  await recovery
    .getByRole("alertdialog", { name: "Replace All Data on This Device?", exact: true })
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await expectRestored(recovery);
  await openCurrentMogi(recovery);
  await expect(recovery.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
  await expect(recovery.getByRole("heading", { name: "Couldn't Open Your Mogis", exact: true })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mogi Tier Current", exact: true })).toHaveCount(0);
});

async function expectFailedImage(page: Page) {
  await openMogiActions(page);
  await page.getByRole("button", { name: /^Screenshots \d+$/ }).click();
  const images = page.getByRole("dialog", { name: "Screenshots", exact: true });
  await expect(images.getByText("finish-order-totals.jpeg", { exact: true })).toBeVisible();
  await images.getByRole("button", { name: /finish-order-totals.jpeg/ }).click();
  await expect(page.getByText("Reading failed", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(images).toBeHidden();
}

test("a restored track survives result editing, and discarding makes the final result partial and discarding makes the final result partial", async ({
  page,
}, info) => {
  const state = mogiState({
    roster,
    races: ({ participants }) => [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `race-${index + 1}`,
        origin: "manual" as const,
        number: index === 0 ? undefined : index + 1,
        placements: (index === 1 ? [...participants].reverse() : participants).map((person) => person.id),
      })),
      {
        id: "spare",
        origin: "manual",
        number: 13,
        status: "discarded",
        placements: participants.map((person) => person.id),
      },
    ],
  });
  const mogi = state.mogis[0];
  delete mogi.originalList;
  mogi.races[0].track = "CC";
  await restoreState(page, state);
  await expect(page.getByText("FFA · Finished", { exact: true })).toBeVisible();
  const restored = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("finished.zip"))));
  const restoredMogi = JSON.parse(strFromU8(restored["manifest.json"])).state.mogis[0];
  expect(mogiOriginalList(restoredMogi)).toBe(roster.replace("Tier D", "Tier D\nFFA"));
  await openCurrentMogi(page);
  const discardedRow = page.getByRole("list", { name: "Discarded", exact: true }).getByRole("button");
  await discardedRow.click();
  const discarded = page.getByRole("dialog", { name: "Discarded Race", exact: true });
  await expect(discarded.getByRole("button", { name: "Count Again", exact: true })).toBeDisabled();
  await expect(
    discarded.getByText("12 races already count. Discard another one first.", { exact: true }),
  ).toBeVisible();
  await discarded.getByRole("button", { name: "Close", exact: true }).click();
  await expect(discardedRow).toBeFocused();
  const tile = page.getByRole("button", { name: "Race 1 · counted", exact: true });
  await tile.click();
  const race = page.getByRole("dialog", { name: "Race 1", exact: true });
  await expect(race.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await race.getByRole("button", { name: "Close", exact: true }).click();
  await expect(tile).toBeFocused();
  await tile.click();
  await expect(race.getByRole("button", { name: "Edit Result", exact: true })).toBeEnabled();
  await race.getByRole("button", { name: "Edit Result", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Result", exact: true });
  await expect(editor.getByRole("button", { name: "Back", exact: true })).toBeFocused();
  await editor.getByRole("button", { name: "Back", exact: true }).click();
  await expect(race.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await race.getByRole("button", { name: "Edit Result", exact: true }).click();
  await choosePlace(page, "1st", "Piloto 2");
  await editor.getByRole("button", { name: "Save Result", exact: true }).click();
  await expect(race.getByRole("list", { name: "Results", exact: true }).getByRole("listitem").first()).toHaveText(
    "1Piloto 2+15",
  );
  await race.getByRole("button", { name: "Close", exact: true }).click();
  await expect(tile).toBeFocused();
  await tile.click();
  await race.getByRole("button", { name: "Discard Race", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Discard Race 1?", exact: true });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(race.getByRole("button", { name: "Discard Race", exact: true })).toBeFocused();
  await race.getByRole("button", { name: "Discard Race", exact: true }).click();
  await confirmation.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(race).toBeHidden();
  await expect(tile).toBeFocused();
  const following = await consultRace(page, 1);
  await expect(following.getByRole("list", { name: "Results", exact: true }).getByRole("listitem").first()).toHaveText(
    "1Piloto 12+15",
  );
  await following.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("FFA · Race 11 of 12", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("FFA · Race 11 of 12", { exact: true })).toBeVisible();
  const saved = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("partial.zip"))));
  const savedMogi = JSON.parse(strFromU8(saved["manifest.json"])).state.mogis[0];
  expect(savedMogi.races.find((race: { id: string }) => race.id === "race-1").track).toBe("CC");
  expect(savedMogi.races.find((race: { id: string }) => race.id === "race-1").placements[0]).toBe(
    mogi.participants[1].id,
  );
});

// The boundaries are real UI, native IndexedDB and the public ZIP. Recognition
// belongs to the single offline OCR flow, without repeating it in every persistence test.
test("ZIP restores data and original bytes; altered files and cancellation preserve the mogi", async ({
  page,
}, info) => {
  // Exporting 24 captures is a separate visual review; the normal journey keeps its 90 s.
  test.setTimeout(process.env.QUESTION_SCREENSHOTS ? 180000 : 90000);
  await page.context().route("**/ocr/paddle-worker.js", (route) => route.abort());
  const base = observedRace(mogiState({ roster }));
  await restoreState(page, base);
  await expect(page.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
  await openParticipants(page);
  const list = page.getByRole("dialog", { name: "Players", exact: true });
  await expect(list.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await expect(list.getByRole("listitem")).toHaveCount(12);
  await expect(list.getByRole("listitem").first()).toHaveText("1Piloto 1");
  await list.getByRole("button", { name: "Piloto 1", exact: true }).click();
  const person = page.getByRole("dialog", { name: "Piloto 1", exact: true });
  await expect(person.getByRole("button", { name: "Back", exact: true })).toBeFocused();
  await expect(person.getByText("1st · 15 pts", { exact: true })).toBeVisible();
  await expect(person.getByText("Team", { exact: true })).toHaveCount(0);
  await person.getByLabel("In-game name", { exact: true }).fill("Kart name");
  await person.getByRole("button", { name: "Back", exact: true }).focus();
  await expect(person.getByLabel("In-game name", { exact: true })).toHaveValue("Kart name");
  await person.getByLabel("In-game name", { exact: true }).fill("");
  await person.getByRole("button", { name: "Back", exact: true }).focus();
  await expect(person.getByLabel("In-game name", { exact: true })).toHaveValue("Kart name");
  await person.getByRole("button", { name: "Back", exact: true }).click();
  await expect(list.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await expect(list.getByRole("listitem").first()).toContainText("Kart name");
  await list.getByRole("button", { name: "Close", exact: true }).click();
  await expect(list).toBeHidden();
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
  await addScreenshots(page, originalPath);
  // Without OCR there is no factual question; the pending original remains viewable and exportable.
  await expectFailedImage(page);
  await page.reload();
  await expectFailedImage(page);
  await expect(page.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();

  // The table includes the state of all 12 positions, so read it after adding the captures.
  await openMogiSection(page, "Standings");
  const standings = await page.getByRole("table", { name: "Mogi table", exact: true }).innerText();
  await page.keyboard.press("Escape");
  // Your Lounge names live in the state, so they travel with the backup.
  await openSettings(page);
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: /^Your Lounge Names/ })
    .click();
  const names = page.getByRole("dialog", { name: "Your Lounge Names", exact: true });
  const add = names.getByLabel("Add a Lounge name", { exact: true });
  for (const name of ["Piloto 1", "Old name"]) {
    await add.fill(name);
    await add.press("Enter");
  }
  await expect(names.getByRole("list", { name: "Your Lounge names", exact: true }).getByRole("listitem")).toHaveText([
    "Piloto 1",
    "Old name",
  ]);
  await names.getByRole("button", { name: "Remove Old name", exact: true }).click();
  await names.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("button", { name: /^Your Lounge Names/ }),
  ).toContainText("Piloto 1");
  const path = await downloadBackup(page, info.outputPath("original.zip"));
  const files = unzipSync(readFileSync(path));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  expect(manifest.state.mogis[0].originalList).toBe(roster);
  expect(manifest.state.loungeNames).toEqual(["Piloto 1"]);
  const savedFile = manifest.state.sharedReceipts.flatMap(
    (receipt: { files: { name: string; original: { path: string; sha256: string } }[] }) => receipt.files,
  )[0];
  expect(savedFile.name).toBe("finish-order-totals.jpeg");
  expect(Buffer.from(files[savedFile.original.path])).toEqual(readFileSync(originalPath));
  expect(savedFile.original.sha256).toBe(createHash("sha256").update(readFileSync(originalPath)).digest("hex"));

  await openCurrentMogi(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await createMogi(page, roster.replace("Tier D", "Tier Current"));
  await openBackup(page);
  const altered: Record<string, Uint8Array> = {
    ...files,
    [savedFile.original.path]: files[savedFile.original.path].slice(),
  };
  altered[savedFile.original.path][0] ^= 1;
  await page
    .getByLabel("Restore from file")
    .setInputFiles({ name: "alterado.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync(altered)) });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Restore", exact: true })).toHaveCount(0);

  await page.getByLabel("Restore from file").setInputFiles(path);
  await expect(page.getByRole("dialog", { name: "Restore", exact: true })).toBeVisible();
  await page
    .getByRole("dialog", { name: "Restore", exact: true })
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mogi Tier Current", exact: true })).toBeVisible();
  await openBackup(page);
  await page.getByLabel("Restore from file").setInputFiles(path);
  // Restore previews the file in the Settings stack; Cancel keeps it open and Save Backup First stays inside it.
  const restore = page.getByRole("dialog", { name: "Restore", exact: true });
  await expect(restore.getByRole("button", { name: "Back", exact: true })).toBeFocused();
  await expect(restore.getByRole("list", { name: "Summary", exact: true }).getByRole("listitem")).toHaveText([
    "Mogis1",
    "Races1",
    /^Screenshots\d+$/,
  ]);
  await expect(restore.getByRole("checkbox")).toHaveCount(0);
  await restore.getByRole("button", { name: "Replace All Data", exact: true }).click();
  const replacing = page.getByRole("alertdialog", { name: "Replace All Data on This Device?", exact: true });
  await expect(replacing).toContainText("Your current mogis will be replaced by the 1 in this backup.");
  await replacing.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(restore.getByRole("button", { name: "Replace All Data", exact: true })).toBeFocused();
  const downloading = page.waitForEvent("download");
  await restore.getByRole("button", { name: "Save Backup First", exact: true }).click();
  await (await downloading).saveAs(info.outputPath("before-replace.zip"));
  await expect(restore).toBeVisible();
  await restore.getByRole("button", { name: "Replace All Data", exact: true }).click();
  await replacing.getByRole("button", { name: "Replace", exact: true }).click();
  // Settings closes on the restored data instead of confirming with a toast.
  await expectRestored(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mogi Tier D", exact: true })).toBeVisible();
  await expect(page.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
  await openMogiSection(page, "Standings");
  await expect(page.getByRole("table", { name: "Mogi table", exact: true })).toHaveText(standings, {
    useInnerText: true,
  });
  await page.keyboard.press("Escape");
  await openCurrentMogi(page);
  await expectFailedImage(page);
  const restored = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("restored.zip"))));
  const restoredState = JSON.parse(strFromU8(restored["manifest.json"])).state;
  expect(restoredState.mogis).toHaveLength(1);
  expect(restoredState.loungeNames).toEqual(["Piloto 1"]);
  expect(restoredState.mogis[0].submissionTier).toBe("D");
  expect(restoredState.mogis[0].originalList).toBe(roster);
  expect(restoredState.mogis[0].participants[0].ign).toBe("Kart name");
  expect(restoredState.mogis[0].races).toHaveLength(1);
  const restoredFile = restoredState.sharedReceipts.flatMap(
    (receipt: { files: { original: { path: string } }[] }) => receipt.files,
  )[0];
  expect(Buffer.from(restored[restoredFile.original.path])).toEqual(readFileSync(originalPath));

  // New types extend this persistence flow without adding another journey to the matrix.
  // Name, race and sequence answers persist in quick-journey and question-flow.
  for (const kind of ["points", "team", "position"] as const) {
    const state = await otherQuestion(base, kind);
    {
      const mogi: Loose = state.mogis[0];
      if (kind === "points") {
        // Two team standings readings remain uncertain.
        // Finish order and overall standings with enough data are already resolved by deduction.
        mogi.captures[0].interpretation = {
          ...mogi.captures[0].interpretation,
          screen: "teamStandings",
          positions: [],
        };
        for (const [index, row] of mogi.captures[0].numericRows.entries()) {
          const value = index === 2 ? 18 : index === 3 ? 20 : row.right.value;
          row.right =
            index < 2
              ? { ...row.right, text: "?", value: null, uncertain: true }
              : { ...row.right, text: String(value), value, uncertain: false };
        }
      } else if (kind === "team") {
        // A single free slot is deduced; two incomplete teams preserve the question.
        delete mogi.participants[2].teamId;
      }
    }
    const backup = await stateBackup(state, `${kind}-question.zip`);
    if (kind === "team") {
      const invalid = unzipSync(backup.buffer);
      const manifest = JSON.parse(strFromU8(invalid["manifest.json"]));
      manifest.state.mogis[0].participants[0].teamId = "team-2";
      await page.getByLabel("Restore from file").setInputFiles({
        ...backup,
        buffer: Buffer.from(zipSync({ ...invalid, "manifest.json": strToU8(JSON.stringify(manifest)) })),
      });
      await expect(page.getByRole("alert")).toContainText("Inconsistent team distribution");
    }
    await page.getByLabel("Restore from file").setInputFiles(backup);
    await expect(page.getByRole("heading", { name: "Restore", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Replace All Data", exact: true }).click();
    await page
      .getByRole("alertdialog", { name: "Replace All Data on This Device?", exact: true })
      .getByRole("button", { name: "Replace", exact: true })
      .click();
    await openCurrentMogi(page);
    if (kind === "position") await expect(page.getByRole("button", { name: "1 Question", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^\d+ Questions?$/ }).click();
    const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
    const heading =
      kind === "points"
        ? "How many points for “Piloto 1”?"
        : kind === "team"
          ? "Which team is “Piloto 1” on?"
          : "Where did “Player 1” finish?";
    await expect(question.getByText(heading, { exact: true })).toBeVisible();
    await questionEvidence(page, kind);
    if (kind === "points") {
      await expect(question.getByLabel("Points", { exact: true })).toBeVisible();
      await question.getByLabel("Points", { exact: true }).fill("30");
    } else if (kind === "position") await question.getByRole("radio", { name: /^1st/ }).check();
    else await expect(question.getByRole("radio", { name: /Suggested$/ })).toBeChecked();
    await question.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(question.getByText(heading, { exact: true })).toBeHidden();
    await page.reload();
    const result = unzipSync(readFileSync(await downloadBackup(page, info.outputPath(`${kind}-answered.zip`))));
    const answered = JSON.parse(strFromU8(result["manifest.json"])).state.mogis[0];
    if (kind === "points") expect(answered.captures[0].numericAnswers).toEqual([{ row: 1, field: "right", value: 30 }]);
    if (kind === "team") expect(answered.participants[0].teamId).toBe("team-0");
    if (kind === "position") expect(answered.assistance.facts[0].position).toBe(1);
  }
});

test("a spelling question lists other races or the count of unnumbered images", async ({ page }) => {
  for (const [numbers, note] of [
    [[3, 5, 8], "Also in races 3, 5 and 8"],
    [[undefined, undefined, undefined, undefined, undefined, undefined], "Also in 6 other screenshots"],
  ] as const) {
    await restoreState(page, nameQuestions(mogiState({ roster }), [...numbers]));
    await page.getByRole("button", { name: /^\d+ Questions?$/ }).click();
    const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
    for (
      let i = 0;
      i < numbers.length && !(await question.getByText("Who is “Reading 1”?", { exact: true }).isVisible());
      i++
    ) {
      await expect(
        question.getByText("Did everyone keep their points between these screenshots?", { exact: true }),
      ).toBeVisible();
      await question.getByRole("button", { name: "Not Sure", exact: true }).click();
    }
    await expect(question.getByText("Who is “Reading 1”?", { exact: true })).toBeVisible();
    await expect(question.getByText(note, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("a stale tab refuses overwrites and reloads the mogi saved by the other tab", async ({ page, context }) => {
  await restoreState(page, observedRace(mogiState({ roster })));
  const other = await context.newPage();
  await other.goto("/");
  await (await consultRace(other, 1)).getByRole("button", { name: "Edit Result", exact: true }).click();
  await choosePlace(other, "1st", "Piloto 2");
  await other.getByRole("button", { name: "Save Result", exact: true }).click();
  await expect(other.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
  await openMogiSettings(page);
  await page.getByRole("button", { name: "Delete Mogi", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: /^Delete .+\?$/ });
  await confirmation.getByRole("button", { name: "Delete Mogi", exact: true }).click();
  // The refused write is the blocking alert, above the confirmation.
  const changed = page.getByRole("alertdialog", { name: "Your Data Changed in Another Window", exact: true });
  await expect(changed).toHaveAccessibleDescription(
    "Reload before continuing. Confirmed results and pending screenshots are kept.",
  );
  await expect(changed.getByRole("button")).toHaveText(["Reload"]);
  await changed.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
  await other.reload();
  await expect(other.getByText("FFA · Race 1 of 12", { exact: true })).toBeVisible();
});

test("an image whose file was moved after addition does not prevent later writes", async ({ page }, info) => {
  // Chromium rereads a disk File on every write that still references it.
  const first = info.outputPath("first.jpeg"),
    second = info.outputPath("second.jpeg");
  copyFileSync(originalPath, first);
  copyFileSync(fileURLToPath(new URL("./fixtures/spec29/finish-order-additions.jpeg", import.meta.url)), second);
  await useFixedRecognition(page);
  await restoreState(page, mogiState({ roster }));
  await addScreenshots(page, first);
  await expect(page.getByRole("status").filter({ hasText: /^Reading / })).toHaveCount(0, { timeout: 60000 });
  renameSync(first, info.outputPath("moved.jpeg"));
  await page.keyboard.press("Escape");
  await addScreenshots(page, second);
  await expect(page.getByRole("status").filter({ hasText: /^Reading / })).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByRole("alertdialog", { name: "Couldn't Save on This Device", exact: true })).toHaveCount(0);
});

test("finished mogi compresses older JPEG backups without changing results or original-file duplicates", async ({
  page,
}, info) => {
  await page.context().route("**/ocr/paddle-worker.js", (route) => route.abort());
  await page.goto("/");
  // These images have no game pixels: recognition is already stored in the older backup.
  const jpeg = Buffer.from(
    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(1920, 1080),
        context = canvas.getContext("2d")!;
      context.fillStyle = "#357ab2";
      context.fillRect(0, 0, 1920, 1080);
      context.fillStyle = "#ffffff";
      context.fillRect(200, 100, 600, 800);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
      return [...new Uint8Array(await blob.arrayBuffer())];
    }),
  );
  const sha256 = createHash("sha256").update(jpeg).digest("hex");
  const state = mogiState({
    roster,
    races: ({ participants }) =>
      Array.from({ length: 12 }, (_, i) => ({
        id: `compression-race-${i + 1}`,
        number: i + 1,
        origin: "observed",
        status: "confirmed",
        placements: participants.map((person) => person.id),
        ...(i < 2 ? { captureIds: [`compression-capture-${i}`] } : {}),
      })),
    captures: ({ participants }) =>
      [0, 1].map((i) => ({
        id: `compression-capture-${i}`,
        fileName: `synthetic-${i}.jpeg`,
        original: new Blob([jpeg], { type: "image/jpeg" }),
        width: 1920,
        height: 1080,
        stage: "finish-order-confirmed",
        reviewedAt: "2026-10-28",
        reviewedPlacements: participants.map((person) => person.id),
        ...(i ? { fingerprint: sha256 } : {}),
        photoMoment: { at: 1793200000000 + i * 1000, source: "exif" },
        rows: participants.map((person) => ({
          text: person.ign,
          confidence: 100,
          uncertain: false,
          suggestedParticipantId: person.id,
        })),
        nameAssociations: participants.map((person) => ({ participantId: person.id })),
      })),
  });
  // The older backup as the app writes it: the expected state below is its manifest.
  const files = unzipSync((await stateBackup(state, "older-jpegs.zip")).buffer);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  await restoreState(page, state);
  await expect(page.getByText("FFA · Finished", { exact: true })).toBeVisible();
  const questions = page.getByRole("button", { name: /^\d+ Questions?$/ });
  const questionCount = await questions.allTextContents();
  await openMogiSection(page, "Standings");
  const standings = await page.getByRole("table", { name: "Mogi table", exact: true }).innerText();
  await page.keyboard.press("Escape");
  let exported = files;
  await expect
    .poll(
      async () => {
        exported = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("compressed.zip"))));
        const state = JSON.parse(strFromU8(exported["manifest.json"])).state;
        return state.mogis[0].captures.every(
          (image: { original: { mimeType: string }; compressedFrom?: unknown }) =>
            image.original.mimeType === "image/webp" && image.compressedFrom,
        );
      },
      { timeout: 60000 },
    )
    .toBe(true);
  const saved = JSON.parse(strFromU8(exported["manifest.json"]));
  const expected = structuredClone(manifest.state);
  // The restore itself advances this ownership generation; it is unrelated to compression.
  expected.mogis[0].sourceRevision = saved.state.mogis[0].sourceRevision;
  for (const [i, stored] of saved.state.mogis[0].captures.entries()) {
    expect(stored.compressedFrom).toEqual({ sha256, size: jpeg.length });
    const bytes = exported[stored.original.path];
    expect(stored.original.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(stored.original.size).toBe(bytes.length);
    expect(Buffer.from(bytes).subarray(8, 12).toString()).toBe("WEBP");
    expect(bytes.length).toBeLessThan(jpeg.length);
    expected.mogis[0].captures[i].original = stored.original;
    expected.mogis[0].captures[i].compressedFrom = stored.compressedFrom;
    expected.mogis[0].captures[i].fingerprint ??= sha256;
  }
  expect(saved.state).toEqual(expected);
  // Read the new optional field and compressed bytes through the same public restore validator.
  await page
    .getByLabel("Restore from file")
    .setInputFiles({ name: "compressed.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync(exported)) });
  await page.getByRole("button", { name: "Replace All Data", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Replace All Data on This Device?", exact: true })
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await expectRestored(page);
  await openCurrentMogi(page);
  await expect(questions).toHaveText(questionCount);
  await openMogiSection(page, "Standings");
  await expect(page.getByRole("table", { name: "Mogi table", exact: true })).toHaveText(standings, {
    useInnerText: true,
  });
  await page.keyboard.press("Escape");
  const race = await consultRace(page, 1);
  await race.getByRole("button", { name: "Discard Race", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Discard Race 1?", exact: true })
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  await expect(page.getByText("FFA · Race 11 of 12", { exact: true })).toBeVisible();
  await addScreenshots(page, { name: "synthetic-original.jpeg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(page.locator("[aria-live=polite]").filter({ hasText: "Screenshot already in this mogi" })).toBeVisible();
  const reopened = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("reopened-compressed.zip"))));
  const reopenedMogi = JSON.parse(strFromU8(reopened["manifest.json"])).state.mogis[0];
  expect(reopenedMogi.captures).toEqual(saved.state.mogis[0].captures);
  for (const image of reopenedMogi.captures)
    expect(reopened[image.original.path]).toEqual(exported[image.original.path]);
});
