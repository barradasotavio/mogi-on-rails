import type { FileChooser } from "@playwright/test";
import { expect, type Page } from "@playwright/test";

import { openMogiSection } from "./mogi-navigation";
/** Selects originals only; scenario observes progress and answers each factual question. */
export async function addScreenshots(page: Page, files: Parameters<FileChooser["setFiles"]>[0]) {
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add Screenshots", exact: true }).click();
  await (await choosing).setFiles(files);
}
export async function openSource(page: Page, fileName: string) {
  await openMogiSection(page, "Tracks");
  const source = page
    .getByRole("group", { name: /^Screenshot \d+ sequence$/, includeHidden: true })
    .filter({ has: page.getByText(fileName, { exact: true }) });
  await source.waitFor({ state: "attached", timeout: 90000 });
  if (!(await source.isVisible())) {
    const history = page.getByRole("button", { name: /^View Saved Race Screenshots \(\d+\)$/ });
    if ((await history.getAttribute("aria-expanded")) !== "true") await history.click();
    await expect(history).toHaveAttribute("aria-expanded", "true");
  }
  await expect(source).toBeVisible();
  return source;
}
