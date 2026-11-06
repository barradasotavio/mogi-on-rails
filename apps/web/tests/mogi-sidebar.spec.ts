import { expect, test } from "@playwright/test";

import { createMogi } from "./mogi-creation";
import { ffaRoster as roster, mogiState, restoreState } from "./mogi-state";
import { observedRace } from "./race-fixture";
const emptyMessage = "Choose a mogi, or paste a bot list in New Mogi.";

test("the regular bar traps and restores focus, closes on outside click and switches without stacking", async ({
  page,
}) => {
  const state = mogiState({ roster: roster("A") }, { roster: roster("B") });
  await restoreState(page, { ...state, activeMogiId: state.mogis[1].id });
  await page.setViewportSize({ width: 1024, height: 812 });
  const trigger = page.getByRole("button", { name: "Show Mogis", exact: true });
  await trigger.click();
  const sidebar = page.getByRole("dialog", { name: "Mogis", exact: true });
  await expect(sidebar).toBeVisible();
  expect(await sidebar.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).toBe("24px");
  const first = sidebar.getByRole("button", { name: "App Settings", exact: true });
  await expect(first).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(sidebar.getByRole("button", { name: /^Mogi Tier A · FFA/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sidebar).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(sidebar).toBeVisible();
  await page.locator("body").click({ position: { x: 800, y: 400 } });
  await expect(sidebar).toBeHidden();
  await expect(trigger).toBeFocused();
  // One toggle on screen, the toolbar's, in place: it reads Hide Mogis while the sidebar floats and closes it.
  // The modal hides the rest of the page from assistive technology, so it is found by its attribute.
  await trigger.click();
  const hide = page.locator("[data-show-mogis]:visible");
  await expect(hide).toHaveCount(1);
  await expect(hide).toHaveAttribute("aria-label", "Hide Mogis");
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await hide.click();
  await expect(sidebar).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const length = await page.evaluate(() => history.length);
  await sidebar.getByRole("button", { name: /^Mogi Tier A · FFA/ }).click();
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Mogi Tier A", exact: true })).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(emptyMessage, { exact: true })).toBeVisible();
  await trigger.click();
  await expect(sidebar).toBeVisible();
});

test("the sheet draft and mogi survive resizing between floating and docked sidebar", async ({ page }) => {
  await page.goto("/");
  await createMogi(page, roster("A"));
  await page.setViewportSize({ width: 1024, height: 812 });
  const url = page.url();
  await page.getByRole("button", { name: "Show Mogis", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Mogis", exact: true })
    .getByRole("button", { name: "New Mogi", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "New Mogi", exact: true });
  await expect(sheet.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  const draft = sheet.getByLabel("Lounge bot list", { exact: true });
  await draft.fill("Tier B\n1. An unfinished roster");
  await page.setViewportSize({ width: 1280, height: 812 });
  await expect(draft).toHaveValue("Tier B\n1. An unfinished roster");
  await draft.press("End");
  await draft.pressSequentially(" stays here");
  await page.setViewportSize({ width: 1024, height: 812 });
  await expect(draft).toHaveValue("Tier B\n1. An unfinished roster stays here");
  await expect(page).toHaveURL(url);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show Mogis", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { level: 1, name: "Mogi Tier A", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mogi Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Mogi Settings", exact: true });
  await settings.getByRole("button", { name: "Screenshots (0)", exact: true }).click();
  const images = page.getByRole("dialog", { name: "Screenshots", exact: true });
  await page.setViewportSize({ width: 1280, height: 812 });
  await expect(images).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 812 });
  await expect(images).toBeVisible();
  await images.getByRole("button", { name: "Back", exact: true }).click();
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Show Mogis", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 812 });
  await expect(page.getByRole("dialog", { name: "Mogis", exact: true })).toBeHidden();
  await page
    .getByRole("complementary", { name: "Mogis", exact: true })
    .getByRole("button", { name: "New Mogi", exact: true })
    .click();
  await expect(sheet).toBeVisible();
});

test("the docked sidebar can close and remembers the choice after reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Mogis", exact: true });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "New Mogi", exact: true })).toHaveClass(/glass-tint/);
  await expect(sidebar.getByRole("button", { name: "App Settings", exact: true })).toHaveClass(/glass/);
  await page.getByRole("button", { name: "Hide Mogis", exact: true }).click();
  await expect(sidebar).toBeHidden();
  // With no mogis, the start is Instructions, whose toolbar takes New Mogi as the list's does.
  await expect(
    page
      .getByRole("navigation", { name: "Instructions actions", exact: true })
      .getByRole("button", { name: "New Mogi", exact: true }),
  ).toHaveText("New Mogi");
  await page.reload();
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Show Mogis", exact: true }).click();
  await expect(sidebar).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Show Mogis", exact: true }).click();
  const overlay = page.getByRole("dialog", { name: "Mogis", exact: true });
  await expect(overlay).toBeVisible();
  await expect(page.locator('[data-slot="sidebar-veil"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
});

test("the toolbar carries the actions, the title stays in the content, content starts below it and the window controls stay clear", async ({
  page,
}) => {
  await restoreState(page, observedRace(mogiState({ roster: roster("A") })));
  // Playwright can't install the app, so Window Controls Overlay is emulated through the --titlebar-*
  // properties that stand for env(titlebar-area-*) and the root attribute the head script sets: macOS
  // geometry, window controls on the left, app menu on the right.
  // A stylesheet, not inline style: closing dialogs restore the root element's style attribute. Chrome
  // applies the change to properties derived on :root a few frames late, so the checks poll.
  const overlay = (on: boolean) =>
    page.evaluate((on) => {
      document.getElementById("titlebar-emulation")?.remove();
      document.documentElement.toggleAttribute("data-titlebar", on);
      if (!on) return;
      document.documentElement.setAttribute("data-titlebar", "overlay");
      document.head.insertAdjacentHTML(
        "beforeend",
        '<style id="titlebar-emulation">:root { --titlebar-x: 78px; --titlebar-width: calc(100vw - 174px); --titlebar-height: 33px; }</style>',
      );
    }, on);
  const nav = page.getByRole("navigation", { name: "Mogi actions", exact: true });
  const geometry = () =>
    nav.evaluate((element) => {
      const bounds = (node: Element | null) => node!.getBoundingClientRect();
      const shown = (nodes: Iterable<Element>) => Array.from(nodes).filter((node) => node.getClientRects().length);
      // The leading group's toggle, if shown (docked open, the sidebar's header carries it), and the trailing group's last action.
      return {
        top: bounds(element).top,
        bottom: bounds(element).bottom,
        first: shown(element.firstElementChild!.firstElementChild!.children)[0]?.getBoundingClientRect().left ?? null,
        last: bounds(shown(element.querySelectorAll("button")).at(-1)!).right,
        // Vertical centre of every visible control, to line them up with the window controls.
        centres: shown(element.querySelectorAll("button")).map(
          (button) => (bounds(button).top + bounds(button).bottom) / 2,
        ),
        background: getComputedStyle(element).backgroundColor,
        content: getComputedStyle(document.body).backgroundColor,
        title: element.contains(document.querySelector("[data-mogi-title]:not(:where(main *))")),
        grid: bounds(document.querySelector('[aria-label="Races"]')).top,
        sidebarControl:
          document.querySelector("aside:not([inert]) .sidebar-header button")?.getBoundingClientRect().left ?? null,
      };
    });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("heading", { level: 1, name: "Mogi Tier A", exact: true })).toBeVisible();
  let toolbar = await geometry();
  // The docked sidebar is 320px wide; the toolbar's 16px margins follow it.
  expect(toolbar).toMatchObject({ top: 0, bottom: 52, first: null, last: 1424, title: false });
  expect(toolbar.grid - toolbar.bottom).toBeGreaterThanOrEqual(12);
  await overlay(true);
  // Docked open, the window controls sit over the sidebar's header.
  await expect.poll(async () => (await geometry()).sidebarControl).toBeGreaterThanOrEqual(78);
  // The toolbar becomes the 33px band; its controls centre on the window controls' line, and it keeps the
  // content's background, the theme-color the browser paints the window controls with, even scrolled.
  await expect.poll(async () => (await geometry()).bottom).toBe(33);
  await page.getByRole("main").evaluate((main) => {
    main.scrollTop = 300;
  });
  toolbar = await geometry();
  expect(toolbar.first).toBeNull();
  expect(toolbar.last).toBeLessThanOrEqual(1440 - 96);
  for (const centre of toolbar.centres) expect(Math.abs(centre - 16.5)).toBeLessThanOrEqual(0.5);
  // One height for every control in the band, sidebar header and toolbar alike.
  expect(
    new Set(
      await page
        .locator('aside:not([inert]) .sidebar-header button:visible, nav[aria-label="Mogi actions"] button:visible')
        .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height)),
    ),
  ).toEqual(new Set([29]));
  expect(toolbar.background).toBe(toolbar.content);
  // The docked sidebar's hairline runs through the band, as in Notes.
  expect(await page.evaluate(() => document.elementFromPoint(319, 16)?.tagName)).toBe("ASIDE");
  // The title bar never dims: with a sheet open, its scrim starts below the band, which stays above it.
  await page.getByRole("button", { name: "Players", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Players", exact: true })).toBeVisible();
  // Hit testing can't tell (the band takes no pointer events while a modal is open), so compare stacking.
  expect(
    await page.evaluate(() => {
      const z = (element: Element) => Number(getComputedStyle(element).zIndex) || 0;
      const band = z(document.querySelector('nav[aria-label="Mogi actions"]')!);
      return Array.from(document.querySelectorAll(".scrim")).map((scrim) => ({
        below: z(scrim) < band,
        top: scrim.getBoundingClientRect().top,
      }));
    }),
  ).toEqual([{ below: true, top: 33 }]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Players", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Hide Mogis", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show Mogis", exact: true })).toBeFocused();
  await expect.poll(async () => (await geometry()).first).toBeGreaterThanOrEqual(78);
  await page.setViewportSize({ width: 600, height: 800 });
  await expect.poll(() => page.getByRole("main").evaluate((main) => main.getBoundingClientRect().top)).toBe(33);
  await overlay(false);
  await expect.poll(() => page.getByRole("main").evaluate((main) => main.getBoundingClientRect().top)).toBe(0);
});

test("the sidebar starts open when localStorage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem,
      write = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "mkw-sidebar-open") throw new DOMException("Blocked", "SecurityError");
      return read.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "mkw-sidebar-open") throw new DOMException("Blocked", "SecurityError");
      return write.call(this, key, value);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Mogis", exact: true });
  await expect(sidebar).toBeVisible();
  await page.getByRole("button", { name: "Hide Mogis", exact: true }).click();
  await expect(sidebar).toBeHidden();
  await page.reload();
  await expect(sidebar).toBeVisible();
});
