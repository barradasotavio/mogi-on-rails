import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { downloadBackup, expectRestored } from "./backup-navigation";
import { ffaRoster, mogiState, restoreState } from "./mogi-state";
import { nameQuestions } from "./question-fixture";
import { openBackup, openSettings } from "./settings-navigation";

async function restore(page: Page, buffer: Buffer) {
  await openBackup(page);
  await page
    .getByLabel("Restore from file", { exact: true })
    .setInputFiles({ name: "free-space.zip", mimeType: "application/zip", buffer });
  await page.getByRole("button", { name: "Replace All Data", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Replace", exact: true }).click();
  await expectRestored(page);
}
async function storage(page: Page) {
  await openSettings(page);
  await page.getByRole("button", { name: "Storage", exact: true }).click();
  return page.getByRole("dialog", { name: "Storage", exact: true });
}
async function results(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page
      .locator("button[data-mogi-id]:visible")
      .or(page.getByRole("region", { name: "Races", exact: true }))
      .first(),
  ).toBeVisible();
  if (!(await page.getByRole("region", { name: "Races", exact: true }).isVisible()))
    await page.locator('button[data-mogi-id="finished"]:visible').click();
  const main = page.getByRole("main");
  await expect(main.getByText("Finished", { exact: false }).first()).toBeVisible();
  // The public standings and score table include every race and total.
  const standings = await main.innerText();
  const compact = (page.viewportSize()?.width ?? 0) < 768;
  if (compact) {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Table", exact: true }).click();
  }
  const table = await page.getByRole("table", { name: "Mogi table", exact: true }).innerText();
  if (compact) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  return { standings, table };
}

for (const width of [375])
  test(`free space preserves finished results and persists at ${width}px`, async ({ page }, info) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    // A finished mogi whose race 12 has an image, and one in progress (Tier C) with nothing to free.
    const state = nameQuestions(
      mogiState(
        { roster: ffaRoster(), with: { id: "finished" } },
        { roster: ffaRoster("C"), with: { id: "progress" } },
      ),
      [],
      0,
    );
    const finished = state.mogis[0];
    finished.races = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i + 1}`,
      number: i + 1,
      origin: "manual",
      status: "confirmed",
      placements: finished.participants.map((p) => p.id),
      ...(i === 11 ? { captureIds: [finished.captures![0].id] } : {}),
    }));
    finished.captures![0].context = { phase: "after", raceId: "r12" };
    await restoreState(page, { ...state, activeMogiId: null });
    const before = await results(page);
    let panel = await storage(page);
    const rows = panel.getByRole("list", { name: "Mogis", exact: true });
    await expect(rows.getByRole("button")).toHaveCount(1);
    await expect(rows.getByRole("listitem").filter({ hasText: "Mogi Tier C" }).getByRole("button")).toHaveCount(0);
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText([
      "Storage",
      "Usage",
      "Backup",
      "Mogis",
    ]);
    await rows.getByRole("button").click();
    let detail = page.getByRole("dialog", { name: "Mogi Tier D", exact: true });
    const oldSize = await detail.getByRole("list", { name: "Size", exact: true }).innerText();
    await detail.getByRole("button", { name: "Delete Screenshots", exact: true }).click();
    let alert = page.getByRole("alertdialog", { name: "Delete Screenshots of Mogi Tier D?", exact: true });
    await expect(alert).toContainText("Results and the table are kept.");
    await alert.getByRole("button", { name: "Cancel", exact: true }).click();
    await detail.getByRole("button", { name: "Delete Screenshots", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete Screenshots", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "Delete Screenshots", exact: true })).toHaveCount(0);
    const newSize = await detail.getByRole("list", { name: "Size", exact: true }).innerText();
    expect(parseFloat(newSize.replace("Size", ""))).toBeLessThan(parseFloat(oldSize.replace("Size", "")));
    expect(await results(page)).toEqual(before);
    await page.reload();
    expect(await results(page)).toEqual(before);

    // A capture without bytes survives the public ZIP export/restore path.
    const exported = readFileSync(await downloadBackup(page, info.outputPath("freed.zip")));
    const saved = unzipSync(exported);
    const snapshot = JSON.parse(strFromU8(saved["manifest.json"]));
    expect(snapshot.state.mogis.find((m: { id: string }) => m.id === "finished").captures[0].original).toBeNull();
    expect(Object.keys(saved).filter((path) => path.startsWith("images/"))).toHaveLength(0);
    await restore(page, exported);
    expect(await results(page)).toEqual(before);
    // Images keeps its title, and the image detail explains the missing bytes.
    if (width < 768) await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Mogi Settings", exact: true }).click();
    await page.getByRole("button", { name: "Screenshots 1", exact: true }).click();
    await page.getByRole("button", { name: /Race 12 · after the race/ }).click();
    await expect(page.getByText("Screenshot deleted to free space.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enlarge screenshot", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Enlarge screenshot", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Screenshot viewer", exact: true });
    await expect(viewer.getByText("Screenshot deleted to free space.", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await page.keyboard.press("Escape");

    panel = await storage(page);
    await panel.getByRole("list", { name: "Mogis", exact: true }).getByRole("button").click();
    detail = page.getByRole("dialog", { name: "Mogi Tier D", exact: true });
    await expect(detail.getByRole("button", { name: "Delete Screenshots", exact: true })).toHaveCount(0);
    await detail.getByRole("button", { name: "Delete Mogi", exact: true }).click();
    alert = page.getByRole("alertdialog", { name: "Delete Mogi Tier D?", exact: true });
    await expect(alert).toContainText("This can't be undone.");
    await alert.getByRole("button", { name: "Delete Mogi", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]mogi=finished(?:&|$)/);
    await expect(panel.getByRole("list", { name: "Mogis", exact: true }).getByRole("listitem")).toHaveCount(1);
    await expect(panel.getByRole("list", { name: "Mogis", exact: true }).getByRole("button")).toHaveCount(0);
    await page.reload();
    panel = await storage(page);
    await expect(panel.getByText(/Mogi Tier D/)).toHaveCount(0);
  });
