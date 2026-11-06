import { mkdir } from "node:fs/promises";

import { expect, type Page } from "@playwright/test";

/** The matrix is optional visual evidence, outside the quick selection and budget. */
export async function questionEvidence(page: Page, kind: string) {
  const directory = process.env.QUESTION_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  for (const width of [375, 1280])
    for (const colorScheme of ["light", "dark"] as const) {
      await question.getByRole("button", { name: "Close", exact: true }).click();
      await expect(question).toBeHidden();
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.getByRole("button", { name: /^\d+ Questions?$/ }).click();
      await expect(question.getByRole("button", { name: "Close", exact: true })).toBeFocused();
      await question.getByRole("button", { name: "Close", exact: true }).scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      if (kind === "points") {
        const input = await question.getByLabel("Points", { exact: true }).boundingBox();
        const confirm = await question.getByRole("button", { name: "Confirm", exact: true }).boundingBox();
        expect(input!.y + input!.height).toBeLessThanOrEqual(confirm!.y);
      }
      await page.screenshot({
        path: `${directory}/${kind}-${width}-${colorScheme}.png`,
        animations: "disabled",
        scale: "css",
      });
    }
  await question.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.getByRole("button", { name: /^\d+ Questions?$/ }).click();
}
