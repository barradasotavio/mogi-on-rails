import { expect, type Page, test } from "@playwright/test";

import { openSettings } from "./settings-navigation";

async function openAppearance(page: Page) {
  await openSettings(page);
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Appearance", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Appearance", exact: true });
}

async function expectThemeColor(page: Page, color: string) {
  await expect
    .poll(() =>
      page
        .locator('meta[name="theme-color"]')
        .evaluateAll((metas) =>
          metas
            .find((meta) => !meta.getAttribute("media") || matchMedia(meta.getAttribute("media")!).matches)
            ?.getAttribute("content"),
        ),
    )
    .toBe(color);
}

test("Appearance offers System, Light and Dark and preserves the choice on reopening", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const appearance = await openAppearance(page);
  const list = appearance.getByRole("list", { name: "Appearance", exact: true });
  await expect(list.getByRole("button")).toHaveText(["System", "Light", "Dark"]);
  const choice = (label: string) => list.getByRole("button", { name: new RegExp(`^${label}`) });
  const selected = () => list.getByRole("listitem").filter({ has: page.getByLabel("Selected", { exact: true }) });
  await expect(selected()).toHaveText("System");

  await choice("Dark").click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expectThemeColor(page, "#0a0a0a");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await openAppearance(page);
  await expect(selected()).toHaveText("Dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await choice("Light").click();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
  await expectThemeColor(page, "#ffffff");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
  await openAppearance(page);
  await expect(selected()).toHaveText("Light");

  await choice("System").click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expectThemeColor(page, "#0a0a0a");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
  await expectThemeColor(page, "#ffffff");
});
