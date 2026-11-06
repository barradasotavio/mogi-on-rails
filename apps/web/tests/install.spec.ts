import { expect, type Page, test } from "@playwright/test";

import { openSettings } from "./settings-navigation";

const desktopChrome =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const desktop = { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };
const rows = ["Your Lounge Names", "Appearance", "Watched Folders", "Storage"];

function settingsRows(page: Page) {
  return page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("listitem").getByRole("button");
}

function installSteps(page: Page) {
  return page.getByRole("main").getByRole("list", { name: "How to install", exact: true }).getByRole("listitem");
}

test("Instructions shows this system's install steps first, the others under Other devices, and Settings has no install row", async ({
  page,
}) => {
  await page.goto("/");
  await expect(installSteps(page).getByRole("heading")).toHaveText(["iPhone and iPad"]);
  await expect(installSteps(page)).toContainText("tap Share, then Add to Home Screen and Add");
  const others = page.getByRole("main").getByRole("list", { name: "Other devices", exact: true });
  await expect(others).toHaveCount(0);
  await page.getByRole("main").getByRole("button", { name: "Other devices", exact: true }).click();
  await expect(others.getByRole("heading")).toHaveText(["Android", "Mac with Safari", "Chrome or Edge on a computer"]);
  await expect(page.getByRole("button", { name: "Install App", exact: true })).toHaveCount(0);
  // With About gone, Instructions is the way to the licenses.
  await expect(page.getByRole("main").getByRole("link", { name: "Open-source licenses", exact: true })).toHaveAttribute(
    "href",
    "/licenses/third-party-notices.txt",
  );
  await openSettings(page);
  await expect(settingsRows(page)).toHaveText(rows);
});

test.describe("Chrome on a computer", () => {
  test.use({ ...desktop, userAgent: desktopChrome });
  test("with beforeinstallprompt, Instructions' Install App opens the native prompt once, then only the steps remain", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(installSteps(page).first()).toBeVisible();
    await page.evaluate(() => {
      const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {
          (window as unknown as { promptCalls: number }).promptCalls =
            ((window as unknown as { promptCalls?: number }).promptCalls ?? 0) + 1;
        },
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      });
      dispatchEvent(event);
      (window as unknown as { prevented: boolean }).prevented = event.defaultPrevented;
    });
    expect(await page.evaluate(() => (window as unknown as { prevented: boolean }).prevented)).toBe(true);
    const install = page.getByRole("main").getByRole("button", { name: "Install App", exact: true });
    await install.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { promptCalls?: number }).promptCalls)).toBe(1);
    await expect(install).toHaveCount(0);
    await expect(installSteps(page).getByRole("heading")).toHaveText(["Chrome or Edge on a computer"]);
    await openSettings(page);
    await expect(settingsRows(page)).toHaveText(rows);
  });
});
