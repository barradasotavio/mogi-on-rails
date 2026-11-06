import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { raw } from "../../../packages/engine/tests/support/real-captures";
import { downloadBackup, expectRestored } from "../tests/backup-navigation";
import { createMogi } from "../tests/mogi-creation";
import { openMogiSettings } from "../tests/mogi-navigation";
import { openCurrentMogi } from "../tests/settings-navigation";

test.use({
  viewport: { width: 1024, height: 900 },
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
  timezoneId: "America/Sao_Paulo",
});

const roster = `Tier D\n${Array.from(
  { length: 6 },
  (_, i) =>
    `${i + 1}. ${raw.roster
      .filter((person) => person.teamId === `team-${i + 1}`)
      .map((person) => person.loungeName)
      .join(", ")}`,
).join("\n")}`;

function captures(indices: number[]) {
  const directory = process.env.BATCH_CAPTURES_DIR ?? path.resolve(".fixtures/real-captures");
  const names = readdirSync(directory)
    .filter((name) => /\.jpe?g$/i.test(name))
    .sort();
  expect(names).toHaveLength(13);
  return indices.map((index) => ({ bytes: [...readFileSync(path.join(directory, names[index]))], type: "image/jpeg" }));
}

async function paste(page: Page, files = captures([0]), text = "", itemsOnly = false) {
  return page.evaluate(
    ({ files, text, itemsOnly }) => {
      const clipboardData = new DataTransfer();
      for (const file of files)
        clipboardData.items.add(
          new File([new Uint8Array(file.bytes)], "image.jpeg", { type: file.type, lastModified: 0 }),
        );
      if (text) clipboardData.setData("text/plain", text);
      if (itemsOnly) Object.defineProperty(clipboardData, "files", { value: new DataTransfer().files });
      const event = new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
      (document.activeElement ?? document.body).dispatchEvent(event);
      return event.defaultPrevented;
    },
    { files, text, itemsOnly },
  );
}

async function resolveIggy(page: Page) {
  await page.getByRole("button", { name: "1 question", exact: true }).click();
  const question = page.getByRole("dialog", { name: "Question 1 of 1", exact: true });
  await expect(question.getByText("Who is “F☆ peepa”?", { exact: true })).toBeVisible();
  await question.getByRole("radio", { name: /^iggy(?: Suggested)?$/ }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question).toBeHidden();
}

test("pasting a real capture reads and counts the race with correct totals", async ({ page }) => {
  await page.goto("/");
  await createMogi(page, roster);
  const prevented = await paste(page);
  const reading = page.getByRole("status").filter({ hasText: /^Reading 1 of 1$/ });
  await expect(reading).toBeVisible();
  expect(prevented).toBe(true);
  await expect(reading).toHaveCount(0, { timeout: 30000 });
  await resolveIggy(page);
  await expect(page.getByRole("button", { name: "Race 1 · counted", exact: true })).toBeVisible();
  const players = page.getByRole("list", { name: "Player standings", exact: true });
  const totals = {
    VSPeach: 15,
    iggy: 12,
    "Kameks Eye": 10,
    pom: 9,
    funk2006: 8,
    KingBoo: 7,
    Tavo: 6,
    BloopMaster: 5,
    toad67: 4,
    ActuFunk: 3,
    PiranhaPlant: 2,
    DonkeyKong: 1,
  };
  for (const [name, points] of Object.entries(totals)) {
    await expect(
      players
        .getByRole("listitem")
        .filter({ has: page.getByText(name, { exact: true }) })
        .getByText(String(points), { exact: true })
        .last(),
    ).toBeVisible();
  }
  expect(await paste(page)).toBe(true);
  await expect(page.locator("[aria-live=polite]").filter({ hasText: "Image already in this mogi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Race 2 · future", exact: true })).toBeVisible();
});

test("pasting a batch in compact preserves order, names, times and totals for both races", async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.setFixedTime(new Date("2026-10-29T17:05:06.000Z"));
  await page.goto("/");
  await createMogi(page, roster);
  const files = captures([0, 1]);
  expect(await paste(page, files)).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: /^Reading 1 of 2$/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Reading 2 of 2$/ })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("status").filter({ hasText: /^Reading \d+ of 2$/ })).toHaveCount(0, { timeout: 30000 });
  await resolveIggy(page);
  await expect(page.getByRole("button", { name: "Race 1 · counted", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Race 2 · counted", exact: true })).toBeVisible();
  const players = page.getByRole("list", { name: "Player standings", exact: true });
  const totals = {
    VSPeach: 22,
    iggy: 13,
    "Kameks Eye": 12,
    pom: 13,
    funk2006: 16,
    KingBoo: 22,
    Tavo: 18,
    BloopMaster: 14,
    toad67: 7,
    ActuFunk: 9,
    PiranhaPlant: 7,
    DonkeyKong: 11,
  };
  for (const [name, points] of Object.entries(totals)) {
    await expect(
      players
        .getByRole("listitem")
        .filter({ has: page.getByText(name, { exact: true }) })
        .getByText(String(points), { exact: true })
        .last(),
    ).toBeVisible();
  }
  const backup = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("pasted.zip"))));
  const saved = JSON.parse(strFromU8(backup["manifest.json"])).state.mogis[0].captures;
  expect(saved.map((capture: { fileName: string }) => capture.fileName)).toEqual([
    "Pasted image 14-05-06.jpeg",
    "Pasted image 14-05-06 2.jpeg",
  ]);
  expect(saved.map((capture: { lastModified: number }) => capture.lastModified)).toEqual([
    1793293506000, 1793293506001,
  ]);
  expect(saved.map((capture: { pastedAt: number }) => capture.pastedAt)).toEqual([1793293506000, 1793293506001]);
  expect(saved.map((capture: { photoMoment: unknown }) => capture.photoMoment)).toEqual([
    { at: 1793108275000, source: "exif" },
    { at: 1793108275000, source: "exif" },
  ]);
  expect(saved.map((capture: { original: { sha256: string } }) => capture.original.sha256)).toEqual(
    files.map((file) => createHash("sha256").update(new Uint8Array(file.bytes)).digest("hex")),
  );
});

test("editable fields preserve text pasting even with an image in the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await createMogi(page, roster);
  const files = captures([0]);
  for (const kind of ["input", "textarea", "contenteditable"]) {
    // Isolate focus from the sheet rule using real DOM fields in the open mogi.
    await page.evaluate((kind) => {
      const field = document.createElement(kind === "contenteditable" ? "div" : kind);
      field.id = "paste-field";
      if (kind === "contenteditable") field.setAttribute("contenteditable", "true");
      document.body.appendChild(field);
      field.focus();
    }, kind);
    expect(await paste(page, files, "kept as text")).toBe(false);
    await expect(page.getByRole("status").filter({ hasText: /^Reading / })).toHaveCount(0);
    // A synthetic ClipboardEvent does not perform native insertion: check it with the real shortcut.
    await page.evaluate(() => navigator.clipboard.writeText("kept as text"));
    await page.keyboard.press("ControlOrMeta+V");
    const field = page.locator("#paste-field");
    if (kind === "contenteditable") await expect(field).toHaveText("kept as text");
    else await expect(field).toHaveValue("kept as text");
    await field.evaluate((element) => element.remove());
  }
  await expect(page.getByRole("button", { name: "Race 1 · future", exact: true })).toBeVisible();
});

test("sheets, confirmation and New Mogi do not receive captures; the bot list receives text", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await createMogi(page, roster);
  const files = captures([0]);
  await openMogiSettings(page);
  expect(await paste(page, files)).toBe(false);
  await page.getByRole("button", { name: "Delete mogi", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  expect(await paste(page, files)).toBe(false);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Mogi settings", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Show mogis", exact: true }).click();
  expect(await paste(page, files)).toBe(false);
  await page.getByRole("button", { name: "New mogi", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "New mogi", exact: true });
  expect(await paste(page, files)).toBe(false);
  const bot = creation.getByLabel("Lounge bot list", { exact: true });
  await bot.focus();
  expect(await paste(page, files, roster)).toBe(false);
  await page.evaluate((text) => navigator.clipboard.writeText(text), roster);
  await page.keyboard.press("ControlOrMeta+V");
  await expect(bot).toHaveValue(roster);
  await creation.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Reading / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Race 1 · future", exact: true })).toBeVisible();
});

test("a finished mogi does not receive pasted captures", async ({ page }, info) => {
  await page.goto("/");
  await createMogi(page, roster);
  const backup = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("initial.zip"))));
  const manifest = JSON.parse(strFromU8(backup["manifest.json"]));
  const mogi = manifest.state.mogis[0];
  mogi.races = Array.from({ length: 12 }, (_, index) => ({
    id: `race-${index + 1}`,
    origin: "manual",
    number: index + 1,
    placements: mogi.participants.map((person: { id: string }) => person.id),
  }));
  await page.getByLabel("Restore from file").setInputFiles({
    name: "finished.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync({ ...backup, "manifest.json": strToU8(JSON.stringify(manifest)) })),
  });
  await page.getByRole("button", { name: "Replace all data", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Replace all data on this device?", exact: true })
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await expectRestored(page);
  await openCurrentMogi(page);
  await expect(page.getByRole("button", { name: "Copy !submit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add images", exact: true })).toHaveCount(0);
  expect(await paste(page)).toBe(false);
  await expect(page.getByRole("status").filter({ hasText: /^Reading / })).toHaveCount(0);
});

test("a clipboard with only items accepts PNG and WebP in order and ignores other file types", async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date("2026-10-29T17:05:06.000Z"));
  await page.goto("/");
  await createMogi(page, roster);
  const files = await page.evaluate(
    async (originals) => {
      return Promise.all(
        originals.map(async (file, index) => {
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(file.bytes)], { type: file.type }));
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
          bitmap.close();
          const type = index === 0 ? "image/png" : "image/webp";
          const encoded = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), type, 1));
          return { bytes: [...new Uint8Array(await encoded.arrayBuffer())], type };
        }),
      );
    },
    captures([0, 1]),
  );
  expect(await paste(page, [{ bytes: [1, 2, 3], type: "application/pdf" }, ...files], "text item", true)).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: /^Reading 1 of 2$/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Reading \d+ of 2$/ })).toHaveCount(0, { timeout: 30000 });
  await resolveIggy(page);
  await expect(page.getByRole("button", { name: "Race 2 · counted", exact: true })).toBeVisible();
  const backup = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("items.zip"))));
  const saved = JSON.parse(strFromU8(backup["manifest.json"])).state.mogis[0].captures;
  expect(saved.map((capture: { fileName: string }) => capture.fileName)).toEqual([
    "Pasted image 14-05-06.png",
    "Pasted image 14-05-06 2.webp",
  ]);
  expect(saved.map((capture: { photoMoment: unknown }) => capture.photoMoment)).toEqual([
    { at: 1793293506000, source: "pasted" },
    { at: 1793293506001, source: "pasted" },
  ]);
  const pastedBackup = await downloadBackup(page, info.outputPath("pasted-no-exif.zip"));
  await page.getByLabel("Restore from file").setInputFiles(pastedBackup);
  await page.getByRole("button", { name: "Replace all data", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Replace all data on this device?", exact: true })
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await expectRestored(page);
  await page.clock.setFixedTime(new Date("2026-10-29T18:05:06.000Z"));
  await page.reload();
  const reloaded = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("reloaded-paste.zip"))));
  expect(
    JSON.parse(strFromU8(reloaded["manifest.json"])).state.mogis[0].captures.map(
      (capture: { photoMoment: unknown }) => capture.photoMoment,
    ),
  ).toEqual(saved.map((capture: { photoMoment: unknown }) => capture.photoMoment));
});

test("text, unsupported types and the mogi list let pasting continue without a notice", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New mogi", exact: true })).toBeVisible();
  const files = captures([0]);
  expect(await paste(page, files)).toBe(false);
  await createMogi(page, roster);
  expect(await paste(page, [], "plain text")).toBe(false);
  expect(
    await paste(
      page,
      files.map((file) => ({ ...file, type: "image/gif" })),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => !document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true })),
    ),
  ).toBe(false);
  await expect(page.getByRole("status").filter({ hasText: /^Reading / })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("[aria-live=polite]").filter({ hasText: /\S/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  expect(await paste(page, files)).toBe(false);
  await openCurrentMogi(page);
  await expect(page.getByRole("button", { name: "Race 1 · future", exact: true })).toBeVisible();
});

test("pasting and picking reject non-16:9 and small images with the same error", async ({ page }) => {
  await page.goto("/");
  await createMogi(page, roster);
  const message = "Choose the full 16:9 screenshot (at least 640 × 360), without cropping the results screen.";
  let failures = 0;
  for (const [width, height] of [
    [800, 800],
    [320, 180],
  ]) {
    for (const method of ["select", "paste"]) {
      const file = await page.evaluate(
        async ({ width, height, method }) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d")!;
          context.fillStyle = method === "select" ? "white" : "black";
          context.fillRect(0, 0, width, height);
          const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
          return { bytes: [...new Uint8Array(await blob.arrayBuffer())], type: "image/png" };
        },
        { width, height, method },
      );
      if (method === "select") {
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Add images", exact: true }).click();
        await (await chooser).setFiles({ name: "invalid.png", mimeType: file.type, buffer: Buffer.from(file.bytes) });
      } else expect(await paste(page, [file])).toBe(true);
      failures++;
      await expect(page.getByRole("alert")).toHaveText([Array(failures).fill(message).join("")]);
      await expect(page.getByRole("button", { name: "Add images", exact: true })).toBeEnabled();
    }
  }
  await expect(page.getByRole("button", { name: "Race 1 · counted", exact: true })).toHaveCount(0);
});

test("dragging stays restricted to regular and the picker recognizes the same capture as repeated", async ({
  page,
}) => {
  await page.goto("/");
  await createMogi(page, roster);
  const files = captures([0]);
  async function drop() {
    return page.evaluate((files) => {
      const dataTransfer = new DataTransfer();
      for (const file of files)
        dataTransfer.items.add(new File([new Uint8Array(file.bytes)], "drag.jpeg", { type: file.type }));
      const main = document.querySelector("main")!;
      const over = new DragEvent("dragover", { dataTransfer, bubbles: true, cancelable: true });
      const drop = new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true });
      main.dispatchEvent(over);
      main.dispatchEvent(drop);
      return [over.defaultPrevented, drop.defaultPrevented];
    }, files);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await drop()).toEqual([false, false]);
  await expect(page.getByRole("status").filter({ hasText: /^Reading / })).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 900 });
  expect(await drop()).toEqual([true, true]);
  await expect(page.getByRole("status").filter({ hasText: /^Reading 1 of 1$/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Reading / })).toHaveCount(0, { timeout: 30000 });
  await resolveIggy(page);
  await expect(page.getByRole("button", { name: "Race 1 · counted", exact: true })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add images", exact: true }).click();
  await (await chooser).setFiles({ name: "same.jpeg", mimeType: "image/jpeg", buffer: Buffer.from(files[0].bytes) });
  await expect(page.locator("[aria-live=polite]").filter({ hasText: "Image already in this mogi" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Race 1 · counted", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Race 2 · future", exact: true })).toBeVisible();
});
