import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { createMogi } from "./mogi-creation";
import { ffaRoster, mogiState, restoreState } from "./mogi-state";
import { nameQuestions } from "./question-fixture";
import { openSettings } from "./settings-navigation";

const roster = ffaRoster();
const prints = process.env.STORAGE_PRINTS;

/** Two mogis: Tier D with two 443 KB captures, created last in state, and Tier C with none. */
async function restoreMogis(page: Page) {
  const captured = nameQuestions(mogiState({ roster })).mogis[0];
  const empty = mogiState({ roster: ffaRoster("C"), with: { id: "empty-mogi", createdAt: "2026-10-27T12:00:00Z" } })
    .mogis[0];
  await restoreState(page, { version: 1, mogis: [empty, captured], activeMogiId: null, sharedReceipts: [] });
}
async function openStorage(page: Page) {
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Storage", exact: true }).click();
  const storage = page.getByRole("dialog", { name: "Storage", exact: true });
  await expect(storage.getByRole("button", { name: "Back", exact: true })).toBeFocused();
  return storage;
}
async function stubPersistence(page: Page, initially: boolean) {
  await page.addInitScript((granted) => {
    const calls = { persist: 0 };
    let persisted = granted;
    (window as Window & { persistCalls?: typeof calls }).persistCalls = calls;
    StorageManager.prototype.persisted = async () => persisted;
    StorageManager.prototype.persist = async () => {
      calls.persist++;
      persisted = true;
      return true;
    };
  }, initially);
}
const persistCalls = (page: Page) =>
  page.evaluate(() => (window as Window & { persistCalls?: { persist: number } }).persistCalls!.persist);

async function print(page: Page, name: string) {
  // Review prints only: outside the gate unless the prints folder is set.
  if (!prints) return;
  const file = path.join(prints, `${name}.png`);
  mkdirSync(prints, { recursive: true });
  await page.screenshot({ path: file, scale: "css", animations: "disabled" });
  await test.info().attach(name, { path: file, contentType: "image/png" });
}

for (const [width, height] of [[375, 812]]) {
  test(`Storage shows usage, backups, mogis by size and persistent storage at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height });
    await stubPersistence(page, false);
    await restoreMogis(page);
    const storage = await openStorage(page);

    await expect(storage.getByRole("heading", { level: 2 })).toHaveText([
      "Storage",
      "Usage",
      "Backup",
      "Mogis",
    ]);
    const usage = storage.getByRole("meter", { name: "Storage used", exact: true });
    await expect(usage).toBeVisible();
    await expect(storage.getByText(/^\d+(\.\d)? (KB|MB|GB) of \d+(\.\d)? (KB|MB|GB) used$/)).toBeVisible();

    // Tier D carries two captures of 453,526 bytes each; Tier C only its record.
    const mogis = storage.getByRole("list", { name: "Mogis", exact: true }).getByRole("listitem");
    await expect(mogis).toHaveCount(2);
    await expect(mogis.nth(0)).toContainText("Mogi Tier D");
    // The two images alone are 885.8 KB; the record adds a few KB more.
    const captured = Number(/(\d+\.\d) KB$/.exec(await mogis.nth(0).innerText())?.[1]);
    expect(captured).toBeGreaterThan(885.8);
    expect(captured).toBeLessThan(950);
    // Title, then the creation moment, then the size.
    await expect(mogis.nth(1)).toHaveText(/^Mogi Tier C[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}\d{1,2}\.\d KB$/);
    await expect(mogis.getByRole("button")).toHaveCount(0);

    // One way to save the ZIP: Save Backup hands it to the browser, with no second Save or Share.
    await expect(storage.getByRole("list", { name: "Backup", exact: true }).getByRole("button")).toHaveText([
      "Save Backup",
      "Restore from File…",
    ]);
    // With no automatic backup yet, the group is hidden.
    await expect(storage.getByRole("list", { name: "Before updates", exact: true })).toHaveCount(0);
    // persist() was requested on open; the page shows the granted state.
    expect(await persistCalls(page)).toBe(1);
    await expect(storage.getByRole("list", { name: "Persistent storage", exact: true })).toHaveText(
      "Persistent storageOn",
    );
    await expect(storage).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    for (const colorScheme of width < 768 ? (["light", "dark"] as const) : (["light"] as const)) {
      await page.emulateMedia({ colorScheme });
      await print(page, `storage-${width}-${colorScheme}`);
      if (width < 768) {
        await storage.getByText("Persistent storage", { exact: true }).scrollIntoViewIfNeeded();
        await print(page, `storage-${width}-${colorScheme}-end`);
        await storage.locator(".edge-mask").evaluate((element) => {
          element.scrollTop = 0;
        });
      }
    }
  });
}

test("Save Backup generates the same ZIP while writes fail", async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>) {
      const name = (window as Window & { storageFailure?: string }).storageFailure;
      if (name && args[1] === "readwrite") throw new DOMException("Injected storage failure", name);
      return transaction.apply(this, args);
    } as IDBDatabase["transaction"];
  });
  await restoreMogis(page);
  await page.evaluate(() => {
    (window as Window & { storageFailure?: string }).storageFailure = "QuotaExceededError";
  });
  // Opening a mogi remembers it: that write fails, so saving is now broken while reads still work.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^Mogi Tier C · FFA/ }).click();
  // The alert leads to the same Storage page as Settings › Storage.
  await page
    .getByRole("alertdialog", { name: "This Device Is Out of Space", exact: true })
    .getByRole("button", { name: "Manage Storage", exact: true })
    .click();
  const storage = page.getByRole("dialog", { name: "Storage", exact: true });
  await expect(storage.getByRole("button", { name: "Back", exact: true })).toBeFocused();
  const downloading = page.waitForEvent("download");
  await storage.getByRole("button", { name: "Save Backup", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^mogi-on-rails-.+\.zip$/);
  const files = unzipSync(readFileSync(await download.path()));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  expect(manifest.state.mogis.map((mogi: { submissionTier: string }) => mogi.submissionTier).sort()).toEqual([
    "C",
    "D",
  ]);
  expect(Object.keys(files).filter((name) => name.startsWith("images/"))).toHaveLength(2);
});

test("without an estimate, Storage says usage is unavailable and still lists mogis; persistent storage is not requested again", async ({
  page,
}) => {
  await stubPersistence(page, true);
  await page.addInitScript(() => {
    Object.defineProperty(StorageManager.prototype, "estimate", { configurable: true, value: undefined });
  });
  await page.goto("/");
  await createMogi(page, roster);
  const storage = await openStorage(page);
  await expect(storage.getByText("Usage isn't available in this browser.", { exact: true })).toBeVisible();
  await expect(storage.getByRole("meter")).toHaveCount(0);
  await expect(storage.getByRole("list", { name: "Mogis", exact: true }).getByRole("listitem")).toContainText([
    "Mogi Tier D",
  ]);
  await expect(storage.getByRole("list", { name: "Persistent storage", exact: true })).toContainText("On");
  expect(await persistCalls(page)).toBe(0);
});
