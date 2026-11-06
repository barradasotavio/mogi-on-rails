import { expect, type Page } from "@playwright/test";

import { returnToStandings } from "./participants-navigation";
const backupDateTitle = /^[A-Z][a-z]{2} \d+, \d{2}:\d{2}$/;

async function backToStorage(page: Page) {
  for (const name of ["Restore", backupDateTitle]) {
    const detail = page.getByRole("dialog", { name, exact: true });
    if (await detail.isVisible()) await detail.getByRole("button", { name: "Back", exact: true }).click();
  }
}
export async function openSettings(page: Page) {
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  if (await settings.isVisible()) return;
  await backToStorage(page);
  const section = page.getByRole("dialog", { name: /^(Your Lounge Names|Appearance|Watched Folders|Storage)$/ });
  if (await section.isVisible()) {
    await section.getByRole("button", { name: "Back", exact: true }).click();
    await expect(settings).toBeVisible();
    return;
  }
  await returnToStandings(page);
  await expect(
    page
      .getByRole("heading", { level: 1 })
      .or(page.getByRole("button", { name: "App Settings", exact: true }))
      .or(page.getByRole("button", { name: "Show Mogis", exact: true }))
      .first(),
  ).toBeVisible();
  const direct = page.getByRole("button", { name: "Settings", exact: true });
  const back = page.getByRole("button", { name: "Back", exact: true });
  if (await back.isVisible()) await back.click();
  if (await direct.isVisible()) await direct.click();
  else {
    const appSettings = page.getByRole("button", { name: "App Settings", exact: true });
    if (!(await appSettings.isVisible())) await page.getByRole("button", { name: "Show Mogis", exact: true }).click();
    await appSettings.click();
  }
  await expect(settings.getByRole("button", { name: "Close", exact: true })).toBeFocused();
}
/** Settings › Storage, which holds Save Backup, Restore from File and the automatic backups. */
export async function openBackup(page: Page) {
  await backToStorage(page);
  if (await page.getByRole("dialog", { name: "Storage", exact: true }).isVisible()) return;
  await openSettings(page);
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Storage", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Storage", exact: true }).getByRole("button", { name: "Back", exact: true }),
  ).toBeFocused();
}
export async function openCurrentMogi(page: Page) {
  await returnToStandings(page);
  const progress = page.getByRole("region", { name: "Races", exact: true });
  if (!(await progress.isVisible())) {
    const active = page.locator('button[data-mogi-id][aria-current="true"]:visible');
    if (await active.count()) await active.click();
    else {
      const rows = page.locator("button[data-mogi-id]:visible");
      if (!(await rows.count())) await page.getByRole("button", { name: "Show Mogis", exact: true }).click();
      await page.locator("button[data-mogi-id]:visible").first().click();
    }
  }
  await expect(progress).toBeVisible();
}
// Synchronize with the real worker's readiness protocol; never starts preparation.
export async function expectOfflineReady(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const worker = navigator.serviceWorker.controller;
          if (!worker) return false;
          return new Promise<boolean>((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
              channel.port1.close();
              resolve(event.data.ready === true);
            };
            worker.postMessage({ type: "status" }, [channel.port2]);
          });
        }),
      { timeout: 60000 },
    )
    .toBe(true);
}
