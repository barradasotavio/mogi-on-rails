import path from "node:path";

import { devices, expect, type Locator, type Page, test } from "@playwright/test";

import { openMogiSettings } from "./mogi-navigation";
import { type Loose, mogiState, restoreState } from "./mogi-state";
import { otherQuestion } from "./question-fixture";

const roster = `Tier D\n${Array.from({ length: 12 }, (_, index) => `${index + 1}. Piloto ${index + 1}`).join("\n")}`;
const prints = process.env.CAPTURE_VIEWER_PRINTS;

async function continuityQuestion(page: Page) {
  // The previous capture belongs to race 1: the shared total decrease asks about continuity.
  const state = await otherQuestion(mogiState({ roster }), "sequence");
  const mogi: Loose = state.mogis[0];
  mogi.races = mogi.races.map((race: { captureIds?: string[] }) => ({
    ...race,
    captureIds: race.captureIds?.filter((id) => id !== "earlier-capture"),
  }));
  mogi.races.unshift({
    id: "earlier-race",
    origin: "observed",
    number: 1,
    status: "pending",
    placements: [],
    captureIds: ["earlier-capture"],
  });
  mogi.captures.find((capture: { id: string }) => capture.id === "earlier-capture").context.raceId = "earlier-race";
  await restoreState(page, state);
  await page.getByRole("button", { name: /^\d+ Questions?$/ }).click();
  const sheet = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  await expect(
    sheet.getByText("Did everyone keep their points between these screenshots?", { exact: true }),
  ).toBeVisible();
  // Both compared screenshots, each with the moment from the Images list.
  await expect(sheet.getByRole("img", { name: "Screenshot", exact: true })).toHaveCount(2);
  const labels = await sheet.locator("figcaption").allTextContents();
  expect(labels).toHaveLength(2);
  for (const label of labels) expect(label).toMatch(/^Race \d+ · after the race$/);
  return { sheet, labels };
}

function transform(image: Locator) {
  return image.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  });
}
async function expectScale(image: Locator, check: (scale: number) => boolean) {
  await expect.poll(async () => check((await transform(image)).scale)).toBe(true);
}
async function expectStillPage(page: Page) {
  expect(
    await page.evaluate(() => ({ wide: document.documentElement.scrollWidth > innerWidth, x: scrollX, y: scrollY })),
  ).toEqual({ wide: false, x: 0, y: 0 });
}
async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function save(page: Page, info: { outputPath: (name: string) => string }, name: string) {
  // Review prints only: outside the gate unless the prints folder is set.
  if (prints) await page.screenshot({ path: path.join(prints, `${name}.png`), animations: "disabled" });
}

test.describe("compact", () => {
  for (const scheme of ["light"] as const)
    test(`viewer with two captures: pinch, drag, double tap, swipe and close (375, ${scheme})`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: scheme });
      const { sheet, labels } = await continuityQuestion(page);
      await save(page, info, `question-375-${scheme}`);
      const trigger = sheet.getByRole("button", { name: `Enlarge ${labels[0]}`, exact: true });
      await trigger.tap();
      const viewer = page.getByRole("dialog", { name: "Screenshot viewer", exact: true });
      await expect(viewer).toBeVisible();
      await expect(viewer.getByRole("button", { name: "Close", exact: true })).toBeFocused();
      await expect(viewer.getByText("1 of 2", { exact: true })).toBeVisible();
      await expect(viewer.getByText(labels[0], { exact: true })).toBeVisible();
      const image = viewer.getByRole("img");
      await expect
        .poll(() =>
          image.evaluate(
            (element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0,
          ),
        )
        .toBe(true);
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number }[]) =>
        cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((point, id) => ({ ...point, id })) });
      const { x, y } = await center(image);

      // Pinching from 60 to 180 px zooms around the midpoint.
      await touch("touchStart", [
        { x: x - 30, y },
        { x: x + 30, y },
      ]);
      for (let step = 1; step <= 6; step++)
        await touch("touchMove", [
          { x: x - 30 - step * 10, y },
          { x: x + 30 + step * 10, y },
        ]);
      await touch("touchEnd", []);
      await expectScale(image, (scale) => scale > 2.5);
      await expectStillPage(page);
      // Dragging moves the zoomed image.
      const before = await transform(image);
      await touch("touchStart", [{ x, y }]);
      for (let step = 1; step <= 5; step++) await touch("touchMove", [{ x: x - step * 16, y }]);
      await touch("touchEnd", []);
      expect((await transform(image)).x).toBeLessThan(before.x - 40);
      await expectStillPage(page);
      await save(page, info, `viewer-zoomed-375-${scheme}`);
      // Double tap returns to 1× and, again, zooms to 2.5× at the tapped point.
      for (let tap = 0; tap < 2; tap++) {
        await touch("touchStart", [{ x, y }]);
        await touch("touchEnd", []);
      }
      await expectScale(image, (scale) => scale === 1);
      await page.waitForTimeout(350);
      for (let tap = 0; tap < 2; tap++) {
        await touch("touchStart", [{ x: x + 40, y }]);
        await touch("touchEnd", []);
      }
      await expectScale(image, (scale) => Math.abs(scale - 2.5) < 0.01);
      await page.waitForTimeout(350);
      for (let tap = 0; tap < 2; tap++) {
        await touch("touchStart", [{ x, y }]);
        await touch("touchEnd", []);
      }
      await expectScale(image, (scale) => scale === 1);
      // At 1×, horizontal swiping changes the capture.
      await touch("touchStart", [{ x: x + 100, y }]);
      for (let step = 1; step <= 6; step++) await touch("touchMove", [{ x: x + 100 - step * 30, y }]);
      await touch("touchEnd", []);
      await expect(viewer.getByText("2 of 2", { exact: true })).toBeVisible();
      await expect(viewer.getByText(labels[1], { exact: true })).toBeVisible();
      await viewer.getByRole("button", { name: "Previous Screenshot", exact: true }).tap();
      await expect(viewer.getByText("1 of 2", { exact: true })).toBeVisible();
      // Swiping down at 1× closes and restores focus to the tapped crop.
      const { x: sx, y: sy } = await center(viewer.getByRole("img"));
      await touch("touchStart", [{ x: sx, y: sy }]);
      for (let step = 1; step <= 6; step++) await touch("touchMove", [{ x: sx, y: sy + step * 30 }]);
      await touch("touchEnd", []);
      await expect(viewer).toBeHidden();
      await expect(sheet).toBeVisible();
      await expect(trigger).toBeFocused();
    });
});

test.describe("regular", () => {
  const desktop = devices["Desktop Chrome"];
  test.use({
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
    userAgent: desktop.userAgent,
  });
  for (const scheme of ["dark"] as const)
    test(`viewer: click, drag, ctrl + wheel, arrows and Escape (1440, ${scheme})`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      const { sheet, labels } = await continuityQuestion(page);
      await save(page, info, `question-1440-${scheme}`);
      const trigger = sheet.getByRole("button", { name: `Enlarge ${labels[1]}`, exact: true });
      await trigger.click();
      const viewer = page.getByRole("dialog", { name: "Screenshot viewer", exact: true });
      await expect(viewer.getByRole("button", { name: "Close", exact: true })).toBeFocused();
      await expect(viewer.getByText("2 of 2", { exact: true })).toBeVisible();
      const image = viewer.getByRole("img");
      await expect
        .poll(() =>
          image.evaluate(
            (element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0,
          ),
        )
        .toBe(true);
      // The image fits the viewport.
      const fitted = (await image.boundingBox())!;
      expect(fitted.width <= 1440 && fitted.height <= 900).toBe(true);
      const { x, y } = await center(image);
      await page.mouse.click(x + 200, y + 100);
      await expectScale(image, (scale) => Math.abs(scale - 2.5) < 0.01);
      await expectStillPage(page);
      await save(page, info, `viewer-zoomed-1440-${scheme}`);
      const before = await transform(image);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 120, y + 60, { steps: 6 });
      await page.mouse.up();
      const panned = await transform(image);
      expect(panned.x).toBeGreaterThan(before.x + 60);
      expect(panned.scale).toBeCloseTo(2.5);
      // Dragging does not toggle zoom; the next click returns to 1×.
      await page.mouse.click(x, y);
      await expectScale(image, (scale) => scale === 1);
      // Ctrl + wheel (also how Chrome delivers trackpad pinch) zooms in.
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -80);
      await page.keyboard.up("Control");
      await expectScale(image, (scale) => scale > 1);
      await expectStillPage(page);
      await page.keyboard.press("ArrowLeft");
      await expect(viewer.getByText("1 of 2", { exact: true })).toBeVisible();
      await expectScale(viewer.getByRole("img"), (scale) => scale === 1);
      await viewer.getByRole("button", { name: "Next Screenshot", exact: true }).click();
      await expect(viewer.getByText("2 of 2", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(viewer).toBeHidden();
      await expect(sheet).toBeVisible();
      await expect(trigger).toBeFocused();
      await sheet.getByRole("button", { name: "Close", exact: true }).click();

      // Images: image detail opens the same viewer.
      await openMogiSettings(page);
      await page.getByRole("button", { name: "Screenshots (2)", exact: true }).click();
      await page
        .getByRole("button", { name: /^Race \d+ · after the race/ })
        .first()
        .click();
      const open = page.getByRole("button", { name: "Enlarge screenshot", exact: true });
      await open.click();
      await expect(viewer).toBeVisible();
      await expect(viewer.getByText(/^Race \d+ · after the race$/)).toBeVisible();
      // Escape closes only the viewer; image detail stays open.
      await page.keyboard.press("Escape");
      await expect(viewer).toBeHidden();
      await expect(page.getByRole("dialog", { name: "Screenshot 1", exact: true })).toBeVisible();
      await expect(open).toBeFocused();
    });
});
