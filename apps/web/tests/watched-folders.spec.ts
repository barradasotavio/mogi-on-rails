import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { downloadBackup } from "./backup-navigation";
import { createMogi } from "./mogi-creation";
import { ffaRoster } from "./mogi-state";
import { openSettings } from "./settings-navigation";

const roster = ffaRoster();

/**
 * The folder picker returns a folder in the origin's private file system: a real directory handle that
 * IndexedDB can keep, so nothing on the computer is read. Reading a file is counted to prove when checks run.
 */
async function stubFolderPicker(page: Page) {
  await page.addInitScript(() => {
    const folders = window as unknown as {
      folderReads: number;
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    };
    folders.folderReads = 0;
    folders.showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle("Album", { create: true });
    const getFile = FileSystemFileHandle.prototype.getFile;
    FileSystemFileHandle.prototype.getFile = function () {
      folders.folderReads++;
      return getFile.call(this);
    };
  });
}

/** Writes a synthetic file into the watched folder: a flat PNG of `color`, or text. */
async function save(page: Page, name: string, color?: string) {
  await page.evaluate(
    async ([name, color]) => {
      let blob = new Blob(["not an image"], { type: "text/plain" });
      if (color) {
        const canvas = new OffscreenCanvas(64, 36);
        const context = canvas.getContext("2d")!;
        context.fillStyle = color;
        context.fillRect(0, 0, 64, 36);
        blob = await canvas.convertToBlob({ type: "image/png" });
      }
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("Album", { create: true });
      const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
      await writable.write(blob);
      await writable.close();
    },
    [name, color] as const,
  );
}

test("a watched folder offers its new images only during a mogi, and once", async ({ page }, info) => {
  await stubFolderPicker(page);
  // Intake is the subject, not recognition: the PNG skips OCR.
  await page.context().route("**/ocr/paddle-worker.js", (route) => route.abort());
  // The test drives the folder checks' interval (3 s in watched-folders.tsx) instead of sleeping.
  await page.clock.install();
  await page.goto("/");
  await save(page, "before-start.png", "#c00000");
  await save(page, "notes.txt");
  await openSettings(page);
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Watched Folders", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Watched Folders", exact: true });
  // A browser that refuses before showing a picker, as an embedding app can, says so instead of doing nothing.
  await page.evaluate(() => {
    const folders = window as unknown as { showDirectoryPicker: () => Promise<unknown>; picker?: unknown };
    folders.picker = folders.showDirectoryPicker;
    folders.showDirectoryPicker = () => Promise.reject(new DOMException("The user aborted a request.", "AbortError"));
  });
  await settings.getByRole("button", { name: "Add Folder", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("The user aborted a request.");
  await page.evaluate(() => {
    const folders = window as unknown as { showDirectoryPicker: unknown; picker: unknown };
    folders.showDirectoryPicker = folders.picker;
  });
  await settings.getByRole("button", { name: "Add Folder", exact: true }).click();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await expect(settings.getByRole("list", { name: "Watched folders", exact: true })).toHaveText("Album");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // With no mogi in progress, nothing in the folder is read, not even a file's date.
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => (window as unknown as { folderReads: number }).folderReads)).toBe(0);
  // Back to real time, so files written next are dated after the mogi starts.
  await page.clock.setSystemTime(Date.now());

  // During a mogi only the new image is offered: not the one dated before the start, not the text file.
  await createMogi(page, roster);
  await save(page, "first.png", "#0050c0");
  await page.clock.runFor(3000);
  const offer = page.getByRole("dialog", { name: "New Screenshot", exact: true });
  await expect(offer.getByRole("img", { name: "New screenshot", exact: true })).toBeVisible();
  await offer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(offer).toBeHidden();

  // Cancel stores nothing and the image is not offered again; the next one comes alone and Add to Mogi takes it.
  await save(page, "second.png", "#00a050");
  await page.clock.runFor(3000);
  await expect(offer.getByRole("img", { name: "New screenshot", exact: true })).toBeVisible();
  await offer.getByRole("button", { name: "Add to Mogi", exact: true }).click();
  await expect(offer).toBeHidden();
  await expect(page.getByRole("button", { name: /^Reading/ })).toHaveCount(0, { timeout: 30000 });
  const state = JSON.parse(
    strFromU8(unzipSync(readFileSync(await downloadBackup(page, info.outputPath("added.zip"))))["manifest.json"]),
  ).state;
  const images = [
    ...state.mogis.flatMap((mogi: { captures?: { name?: string }[] }) => mogi.captures ?? []),
    ...(state.sharedReceipts ?? []).flatMap((receipt: { files: unknown[] }) => receipt.files),
  ];
  expect(images).toHaveLength(1);

  // The folder stays watched after a reload.
  await page.reload();
  await openSettings(page);
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("button", { name: /^Watched Folders/ }),
  ).toContainText("Album");
});

test("without a folder picker, Settings has no Watched Folders", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
  await page.goto("/");
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByRole("button", { name: "Storage", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: /Watched Folders/ })).toHaveCount(0);
});
