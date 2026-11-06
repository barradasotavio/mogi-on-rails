import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { downloadBackup, expectRestored } from "./backup-navigation";
import { createMogi } from "./mogi-creation";
import { ffaRoster, mogiState, restoreState, stateBackup } from "./mogi-state";
import { nameQuestions } from "./question-fixture";
import { expectOfflineReady, openBackup, openSettings } from "./settings-navigation";
import { serveUpdateGenerations } from "./update-server";

const roster = ffaRoster();
test.use({ actionTimeout: 10000 });
async function controlled(page: Page) {
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
async function nextGeneration(page: Page, server: Awaited<ReturnType<typeof serveUpdateGenerations>>) {
  server.advance();
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect
    .poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting))
    .toBe(true);
}
async function hidden(page: Page) {
  // The test emits the visibility boundary; activation, reload and persistence are native.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
async function visible(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
async function waitForBuild(page: Page, build: string) {
  // Activation first saves the automatic backup; under load that outlasts the 3 s default.
  await expect
    .poll(
      () =>
        page
          .evaluate(async () => {
            const worker = navigator.serviceWorker.controller;
            if (!worker) return "";
            return new Promise<string>((resolve) => {
              const channel = new MessageChannel();
              channel.port1.onmessage = (event) => {
                channel.port1.close();
                resolve(event.data.build);
              };
              worker.postMessage({ type: "status" }, [channel.port2]);
            });
          })
          .catch((cause: Error) => {
            if (/Execution context was destroyed|Cannot find context/.test(cause.message)) return "";
            throw cause;
          }),
      { timeout: 15000 },
    )
    .toBe(build);
}

test("replacement failure opens the save alert, keeps data and Try Again completes restore", async ({ page }, info) => {
  await restoreState(page, mogiState({ roster: ffaRoster("Current") }));
  await openBackup(page);
  await page
    .getByLabel("Restore from file", { exact: true })
    .setInputFiles(await stateBackup(mogiState({ roster }), "original.zip"));
  const restore = page.getByRole("dialog", { name: "Restore", exact: true });
  await restore.getByRole("button", { name: "Replace All Data", exact: true }).click();
  await page.evaluate(() => {
    const transact = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      const transaction = transact.call(this, stores, mode, options);
      if (mode === "readwrite") {
        IDBDatabase.prototype.transaction = transact;
        queueMicrotask(() => transaction.abort());
      }
      return transaction;
    };
  });
  await page
    .getByRole("alertdialog", { name: "Replace All Data on This Device?", exact: true })
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  // The aborted write is a storage failure: the blocking alert, with Restore kept behind it.
  const failure = page.getByRole("alertdialog", { name: "Couldn't Save on This Device", exact: true });
  await expect(failure).toBeVisible();
  await expect(failure.getByRole("button")).toHaveText(["Manage Storage", "Try Again"]);
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await expect(
    page
      .getByRole("dialog", { name: "Restore", exact: true, includeHidden: true })
      .getByRole("alert", { includeHidden: true }),
  ).toContainText("Couldn't restore the backup.");
  // Nothing was replaced: both mogis are still on this device.
  const kept = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("mkw-on-rails");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const names = Array.from(db.objectStoreNames);
          const read = db.transaction(names, "readonly");
          let count = 0;
          for (const name of names) {
            const all = read.objectStore(name).getAll();
            all.onsuccess = () => {
              for (const value of all.result) count += JSON.stringify(value).split("Tier Current").length - 1;
            };
          }
          read.oncomplete = () => {
            db.close();
            resolve(count);
          };
        };
      }),
  );
  expect(kept).toBeGreaterThan(0);
  // Try Again repeats the same replacement, which now goes through.
  await failure.getByRole("button", { name: "Try Again", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Mogi Tier D", exact: true })).toBeVisible();
  const restored = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("restored.zip"))));
  expect(JSON.parse(strFromU8(restored["manifest.json"])).state.mogis).toHaveLength(1);
});

test("preparation failure is silent, retries on next opening and does not repeat the complete version", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90000);
  const server = await serveUpdateGenerations(baseURL!);
  try {
    server.failResource();
    await page.goto(server.origin);
    await controlled(page);
    await expect.poll(server.releaseRequests, { timeout: 30000 }).toBe(1);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("[data-toast]")).toHaveCount(0);
    await openSettings(page);
    await expect(page.getByRole("button", { name: "Offline use", exact: true })).toHaveCount(0);
    server.recoverResource();
    // An idle transition does not retry a failed attempt during the same open.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await createMogi(page, roster);
    await page.waitForLoadState("networkidle");
    expect(server.releaseRequests()).toBe(1);
    await page.reload();
    await expectOfflineReady(page);
    expect(server.releaseRequests()).toBe(2);
    await page.reload();
    await expectOfflineReady(page);
    await page.waitForLoadState("networkidle");
    expect(server.releaseRequests()).toBe(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("[data-toast]")).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test("a hidden page updates at the same URL; a fourth backup retains the latest three and Restore requires preview and confirmation", async ({
  page,
  baseURL,
}, info) => {
  test.setTimeout(180000);
  const server = await serveUpdateGenerations(baseURL!);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.origin);
    await controlled(page);
    for (let i = 1; i <= 4; i++) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await createMogi(page, roster.replace("Tier D", `Tier D${i}`));
      if (i === 1) {
        await page.setViewportSize({ width: 800, height: 900 });
        // At this width the toolbar keeps Table in More.
        await page.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("button", { name: "Table", exact: true }).click();
        await expect(page.getByRole("dialog", { name: /^Table/ })).toBeVisible();
      }
      const url = page.url();
      await nextGeneration(page, server);
      await expect(page.getByText("Update ready", { exact: true })).toHaveCount(0);
      await expect(page.getByText(/Atualização disponível|Reabrir com atualização/)).toHaveCount(0); // english-check: data (Portuguese copy that must stay absent)
      const reload = page.waitForEvent("framenavigated", {
        timeout: 10000,
        predicate: (frame) => frame === page.mainFrame(),
      });
      await hidden(page);
      await reload;
      await waitForBuild(page, server.build());
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1, name: `Mogi Tier D${i}`, exact: true })).toBeVisible();
    }
    // Open the list through its public URL, independent of document history before reload.
    await page.goto(`${server.origin}/?mogi=`);
    await expect(page.getByRole("button", { name: "New Mogi", exact: true }).first()).toBeEnabled();
    await page.setViewportSize({ width: 375, height: 812 });
    await openBackup(page);
    const rows = page.getByRole("list", { name: "Before updates", exact: true }).getByRole("button");
    await expect(rows).toHaveCount(3);
    await expect(rows).toHaveText([
      /[A-Z][a-z]{2} \d+, \d{2}:\d{2}4 mogis · \d+(\.\d+)? (KB|MB)/,
      /3 mogis · \d+(\.\d+)? (KB|MB)/,
      /2 mogis · \d+(\.\d+)? (KB|MB)/,
    ]);
    await page.screenshot({ path: info.outputPath("backups-375.png"), animations: "disabled" });
    await rows.first().click();
    await expect(page.getByRole("button", { name: "Download ZIP", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("backup-375.png"), animations: "disabled" });
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
    const zipPath = info.outputPath("automatic.zip");
    await (await downloading).saveAs(zipPath);
    const manifest = JSON.parse(strFromU8(unzipSync(readFileSync(zipPath))["manifest.json"]));
    expect(Object.keys(manifest).sort()).toEqual(["backupVersion", "exportedAt", "format", "state"]);
    expect(manifest.backupVersion).toBe(3);
    expect(manifest.state.mogis).toHaveLength(4);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBackup(page);
    await page.screenshot({ path: info.outputPath("backups-1440.png"), animations: "disabled" });
    await rows.last().click();
    await expect(page.getByRole("button", { name: "Restore…", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("backup-1440.png"), animations: "disabled" });
    await page.getByRole("button", { name: "Restore…", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Restore", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Restore", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Replace All Data", exact: true }).click();
    await page
      .getByRole("alertdialog", { name: "Replace All Data on This Device?", exact: true })
      .getByRole("button", { name: "Replace", exact: true })
      .click();
    await expectRestored(page);
    const restored = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("restored.zip"))));
    expect(JSON.parse(strFromU8(restored["manifest.json"])).state.mogis).toHaveLength(2);
    await page.reload();
    await openBackup(page);
    await expect(rows).toHaveCount(3);
  } finally {
    await server.close();
  }
});

test("an open question and two windows defer updates; the next trigger retries; opening applies and Restart Now preserves Settings", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180000);
  const server = await serveUpdateGenerations(baseURL!);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.origin);
    await controlled(page);
    await restoreState(page, nameQuestions(mogiState({ roster })));
    await page
      .getByRole("button", { name: /^\d+ Questions?$/ })
      .first()
      .click();
    const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
    await expect(question).toBeVisible();
    const before = server.build();
    await nextGeneration(page, server);
    await hidden(page);
    await page.waitForTimeout(300);
    await waitForBuild(page, before);
    await expect(question).toBeVisible();
    await visible(page);
    await page.keyboard.press("Escape");
    // Closing a question on a visible page does not trigger an update.
    await openBackup(page);
    await expect(page.getByText("None yet", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const other = await context.newPage();
    await other.goto(page.url());
    await controlled(other);
    await openSettings(page);
    await hidden(page);
    await expect(
      page.getByText("Close the other windows of this app to finish the update", { exact: true }),
    ).toBeVisible();
    await visible(page);
    await waitForBuild(page, before);
    await other.close();
    // Opening with a waiting worker applies it before another interaction.
    const url = page.url();
    await page.reload();
    // Status messages keep the old worker busy and can starve the activation; wait for it without messaging.
    await expect
      .poll(
        () => page.evaluate(async () => !(await navigator.serviceWorker.getRegistration())?.waiting).catch(() => false),
        { timeout: 15000 },
      )
      .toBe(true);
    await waitForBuild(page, server.build());
    await expect(page).toHaveURL(url);
    await openBackup(page);
    await expect(page.getByRole("list", { name: "Before updates", exact: true }).getByRole("button")).toHaveCount(1);
    await nextGeneration(page, server);
    await openSettings(page);
    const reload = page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame() });
    await page.getByRole("button", { name: "Restart Now", exact: true }).click();
    await reload;
    await waitForBuild(page, server.build());
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).not.toContainText(
      /Preparar|Pronto|Não|neste|Seus|Compartilhar|Cancelar/, // english-check: data (Portuguese copy that must stay absent)
    );
    await openBackup(page);
    await expect(page.getByRole("dialog", { name: "Storage", exact: true })).not.toContainText(
      /Exportar|Restaurar|Selecionar|Não|dados|dispositivo|Cancelar|prévia/, // english-check: data (Portuguese copy that must stay absent)
    );
  } finally {
    await server.close();
  }
});

test("a write error prevents activation and Settings explains how to retry", async ({ page, baseURL }, info) => {
  const server = await serveUpdateGenerations(baseURL!);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.origin);
    await controlled(page);
    await restoreState(page, nameQuestions(mogiState({ roster })));
    const before = server.build();
    await nextGeneration(page, server);
    await openSettings(page);
    // Inject a boundary failure; the aborted transaction, data and retry are native.
    await page.evaluate(() => {
      const transact = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, options) {
        const transaction = transact.call(this, stores, mode, options);
        if (mode === "readwrite") {
          IDBDatabase.prototype.transaction = transact;
          queueMicrotask(() => transaction.abort());
        }
        return transaction;
      };
    });
    await hidden(page);
    await expect(page.getByText("Couldn't save the backup.", { exact: false })).toBeVisible({ timeout: 15000 });
    await visible(page);
    await expect(page.getByText("Update ready", { exact: true })).toBeVisible();
    await waitForBuild(page, before);
    const reload = page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame() });
    await page.getByRole("button", { name: "Restart Now", exact: true }).click();
    await reload;
    await waitForBuild(page, server.build());
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
    await openBackup(page);
    await expect(page.getByRole("list", { name: "Before updates", exact: true }).getByRole("button")).toHaveCount(1);
    await page.getByRole("list", { name: "Before updates", exact: true }).getByRole("button").click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
    const path = info.outputPath("automatic-with-originals.zip");
    await (await downloading).saveAs(path);
    const entries = unzipSync(readFileSync(path));
    expect(Buffer.from(entries["images/0/0.bin"])).toEqual(
      readFileSync(new URL("./fixtures/spec29/finish-order-totals.jpeg", import.meta.url)),
    );
  } finally {
    await server.close();
  }
});
