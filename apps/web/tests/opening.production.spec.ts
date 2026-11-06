import type { Response, TestInfo } from "@playwright/test";
import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";

import { expectOfflineReady } from "./settings-navigation";

interface OpeningMetrics {
  fadeStart: number;
  fadeEnd: number;
  removedAt: number;
  longTasks: { start: number; duration: number }[];
}
declare global {
  interface Window {
    openingMetrics: OpeningMetrics;
    openingFrames: number[][];
  }
}

async function measureOpening(page: Page) {
  await page.addInitScript(() => {
    const metrics: OpeningMetrics = { fadeStart: 0, fadeEnd: 0, removedAt: 0, longTasks: [] };
    window.openingMetrics = metrics;
    const selector = '[role="status"][aria-label="Opening Mogi on Rails"]';
    document.addEventListener("transitionstart", (event) => {
      if ((event.target as Element).matches(selector)) metrics.fadeStart = performance.now();
    });
    document.addEventListener("transitionend", (event) => {
      if ((event.target as Element).matches(selector)) metrics.fadeEnd = performance.now();
    });
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.removedNodes)
          if (node instanceof Element && (node.matches(selector) || node.querySelector(selector)))
            metrics.removedAt = performance.now();
    }).observe(document, { childList: true, subtree: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        metrics.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  });
}

async function holdStorage(page: Page) {
  await page.goto("/manifest.webmanifest");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("mkw-on-rails", 4);
        request.onupgradeneeded = () => request.result.createObjectStore("tracker");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("tracker", "readwrite");
          const store = transaction.objectStore("tracker");
          let holding = true;
          window.addEventListener(
            "release-storage",
            () => {
              holding = false;
            },
            { once: true },
          );
          transaction.oncomplete = () => db.close();
          function keepAlive() {
            const read = store.get("state");
            read.onsuccess = () => {
              resolve();
              if (holding) keepAlive();
            };
          }
          keepAlive();
        };
      }),
  );
}

async function expectInitialTheme(page: Page, info: TestInfo, theme: "light" | "dark") {
  const rgb = theme === "dark" ? [10, 10, 10] : [255, 255, 255];
  await page.addInitScript(() => {
    const frames: number[][] = (window.openingFrames = []);
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    function sample() {
      const opening = document.querySelector('[role="status"][aria-label="Opening Mogi on Rails"]');
      if (opening) {
        context.fillStyle = getComputedStyle(opening).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        frames.push([...context.getImageData(0, 0, 1, 1).data]);
      }
      if (opening || !frames.length) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
  });
  let resume!: () => void;
  const hydration = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await hydration;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.getByRole("status", { name: "Opening Mogi on Rails", exact: true })).toBeVisible();
    const screenshot = await page.screenshot({ path: info.outputPath(`opening-${theme}.png`) });
    const pixel = await sharp(screenshot)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...pixel]).toEqual(rgb);
    await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
    expect(
      await page
        .locator('meta[name="theme-color"]')
        .evaluateAll((metas) =>
          metas
            .find((meta) => !meta.getAttribute("media") || matchMedia(meta.getAttribute("media")!).matches)
            ?.getAttribute("content"),
        ),
    ).toBe(theme === "dark" ? "#0a0a0a" : "#ffffff");
  } finally {
    resume();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Mogi on Rails", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Opening Mogi on Rails", exact: true })).toHaveCount(0);
  await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
  const frames = await page.evaluate(() => window.openingFrames);
  expect(frames.length).toBeGreaterThan(0);
  expect([...new Set(frames.map((frame) => frame.join(",")))]).toEqual([[...rgb, 255].join(",")]);
  // The theme cases block the worker on purpose; Playwright, not the app, reports that.
  expect(errors.filter((error) => error !== "Service Worker registration blocked by Playwright")).toEqual([]);
}

test.describe("Theme before hydration", () => {
  // One context for every case: no worker may answer the held scripts, and each page starts from its own storage.
  test.use({ serviceWorkers: "block" });

  test("the opening paints the saved preference, or the system when there is none or storage is denied", async ({
    context,
  }, info) => {
    const cases = [
      { system: "light", saved: "dark", theme: "dark" },
      { system: "dark", saved: "light", theme: "light" },
      { system: "dark", saved: "denied", theme: "dark" },
      { system: "light", saved: "denied", theme: "light" },
      { system: "dark", saved: null, theme: "dark" },
      { system: "dark", saved: "system", theme: "dark" },
      { system: "dark", saved: "invalid", theme: "dark" },
    ] as const;
    for (const { system, saved, theme } of cases)
      await test.step(`saved ${saved ?? "absent"}, system ${system}`, async () => {
        const page = await context.newPage();
        await page.emulateMedia({ colorScheme: system });
        await page.addInitScript((value) => {
          if (value === "denied")
            Object.defineProperty(window, "localStorage", {
              get() {
                throw new DOMException("Storage denied", "SecurityError");
              },
            });
          else if (value === null) localStorage.removeItem("mkw-appearance");
          else localStorage.setItem("mkw-appearance", value);
        }, saved);
        await expectInitialTheme(page, info, theme);
        await page.close();
      });
  });
});

test.describe("Initial HTML", () => {
  test.use({ javaScriptEnabled: false });

  test("the theme script precedes theme CSS in the head", async ({ page, request }) => {
    await page.goto("/");
    const children = await page.locator("head").evaluate((head) =>
      [...head.children].map((element) => ({
        tag: element.tagName,
        text: element.textContent ?? "",
        href: element.getAttribute("rel") === "stylesheet" ? element.getAttribute("href") : null,
      })),
    );
    const script = children.findIndex((element) => element.tag === "SCRIPT" && element.text.includes("mkw-appearance"));
    expect(script).toBeGreaterThanOrEqual(0);
    let themedStyles = 0;
    for (const [index, element] of children.entries()) {
      const css = element.href
        ? await (await request.get(element.href)).text()
        : element.tag === "STYLE"
          ? element.text
          : "";
      if (!/--background\s*:/.test(css)) continue;
      themedStyles++;
      expect(index).toBeGreaterThan(script);
    }
    expect(themedStyles).toBeGreaterThan(0);
  });

  test("the opening appears even with JavaScript disabled", async ({ page }, info) => {
    await page.goto("/");
    const opening = page.getByRole("status", { name: "Opening Mogi on Rails", exact: true });
    await expect(opening).toBeVisible();
    expect(await opening.boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
    await expect(opening).toHaveText("");
    const icon = opening.locator("img");
    await expect(icon).toHaveAttribute("src", "/icons/icon-512.png");
    await expect(icon).toHaveAttribute("width", "96");
    await expect(icon).toHaveAttribute("height", "96");
    await expect(icon).toHaveAttribute("fetchpriority", "high");
    await expect(page.getByText("Opening your mogis…", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("opening-light.png") });
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await opening.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
    await page.screenshot({ path: info.outputPath("opening-desktop.png") });
  });

  test("HTML provides portrait iPhone startup images", async ({ page, request }) => {
    await page.goto("/");
    // The apple-prefixed meta puts the installed app in legacy mode, adding the status bar to the screen base.
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveCount(0);
    // A login page without viewport-fit=cover followed by ours with it in HTML shortens the installed app's web view.
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      "width=device-width, initial-scale=1",
    );
    for (const [width, height, scale] of [
      [390, 844, 3],
      [420, 912, 3],
      [440, 956, 3],
    ]) {
      const href = `/icons/startup/${width * scale}x${height * scale}.png`;
      const image = page.locator(`link[rel="apple-touch-startup-image"][href="${href}"]`);
      await expect(image).toHaveCount(1);
      await expect(image).toHaveAttribute(
        "media",
        `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: portrait)`,
      );
      const response = await request.get(href);
      expect(response.ok()).toBe(true);
      const png = sharp(await response.body());
      const metadata = await png.metadata();
      expect([metadata.width, metadata.height]).toEqual([width * scale, height * scale]);
      expect(metadata.hasAlpha).toBe(false);
      const pixel = await png.extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      expect([...pixel]).toEqual([255, 255, 255]);
      const center = await sharp(await response.body())
        .extract({ left: Math.floor((width * scale) / 2), top: Math.floor((height * scale) / 2), width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
      expect([...center]).toEqual([0, 122, 85]);
    }
  });
});

test("after load the last viewport meta covers the screen", async ({ page }) => {
  await page.goto("/");
  // The meta added by the appearance script overrides the copy without cover inserted by hydration.
  await expect(page.locator('meta[name="viewport"]').last()).toHaveAttribute(
    "content",
    "width=device-width, initial-scale=1, viewport-fit=cover",
  );
});

test("cover the page until reading finishes, fade and release clicks and focus", async ({ page, context }) => {
  const storage = await context.newPage();
  await holdStorage(storage);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  const opening = page.getByRole("status", { name: "Opening Mogi on Rails", exact: true });
  await expect(opening).toBeVisible();
  expect(await opening.boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
  await expect(page.getByRole("heading", { level: 1, name: "Mogi on Rails", exact: true })).toHaveCount(0);
  await expect(opening).toHaveCSS("transition-duration", "0.2s");
  await expect(opening).toHaveCSS("transition-property", "opacity");
  expect(await opening.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  const fade = opening.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        element.addEventListener("transitionend", (event) => resolve((event as TransitionEvent).elapsedTime), {
          once: true,
        });
      }),
  );
  await storage.evaluate(() => window.dispatchEvent(new Event("release-storage")));
  expect(await fade).toBe(0.2);
  await expect(opening).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Mogi on Rails", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mogis", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("reduced motion removes the opening without a transition", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const storage = await context.newPage();
  await holdStorage(storage);
  await page.goto("/");
  const opening = page.getByRole("status", { name: "Opening Mogi on Rails", exact: true });
  await expect(opening).toBeVisible();
  await expect(opening).toHaveCSS("transition-property", "none");
  await expect(opening).toHaveCSS("transition-duration", "0s");
  await storage.evaluate(() => window.dispatchEvent(new Event("release-storage")));
  await expect(opening).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mogis", exact: true })).toBeVisible();
});

test("a newer native version removes the opening and directs updating without deleting data", async ({
  page,
  context,
}) => {
  const storage = await context.newPage();
  await storage.goto("/manifest.webmanifest");
  // A real newer native database makes this writer fail before reading records.
  await storage.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("mkw-on-rails", 5);
        request.onupgradeneeded = () => request.result.createObjectStore("tracker");
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Opening Mogi on Rails", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Couldn't Open Your Mogis", exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "This data was saved by a newer version of the app. Connect to the internet and reload to update. Your data is still on this device.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore from Backup", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Mogi", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const fallback of [false, true]) {
  test(`cached OCR warms the idle runtime after the fade, without network (${fallback ? "fallback" : "requestIdleCallback"})`, async ({
    page,
    context,
  }, info) => {
    await page.goto("/");
    await expectOfflineReady(page);
    await context.setOffline(true);
    const storage = await context.newPage();
    await holdStorage(storage);
    const cold = await context.newPage();
    if (fallback)
      await cold.addInitScript(() => {
        Reflect.deleteProperty(window, "requestIdleCallback");
        Reflect.deleteProperty(window, "cancelIdleCallback");
      });
    await measureOpening(cold);
    const resources: Response[] = [];
    cold.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/ocr/")) resources.push(response);
    });
    await page.close();
    await cold.goto("/");
    await expect(cold.getByRole("status", { name: "Opening Mogi on Rails", exact: true })).toBeVisible();
    const prepared = cold.waitForResponse((response) => new URL(response.url()).pathname.endsWith(".wasm"), {
      timeout: 10000,
    });
    await storage.evaluate(() => window.dispatchEvent(new Event("release-storage")));
    await expect(cold.getByRole("status", { name: "Opening Mogi on Rails", exact: true })).toHaveCount(0);
    await prepared;
    const measurements = await cold.evaluate(() => ({
      ...window.openingMetrics,
      ocr: performance
        .getEntriesByType("resource")
        .filter((entry) => new URL(entry.name).pathname.startsWith("/ocr/"))
        .map((entry) => ({ url: new URL(entry.name).pathname, start: entry.startTime })),
    }));
    await info.attach("opening-measurements", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
    expect(measurements.fadeStart).toBeGreaterThan(0);
    expect(measurements.fadeEnd - measurements.fadeStart).toBeGreaterThanOrEqual(150);
    expect(measurements.removedAt).toBeGreaterThanOrEqual(measurements.fadeEnd);
    expect(measurements.ocr.length).toBeGreaterThan(0);
    expect(Math.min(...measurements.ocr.map((entry) => entry.start))).toBeGreaterThanOrEqual(measurements.removedAt);
    expect(
      measurements.longTasks.filter(
        (task) => task.start < measurements.removedAt && task.start + task.duration > measurements.fadeStart,
      ),
    ).toEqual([]);
    expect(resources.length).toBeGreaterThan(0);
    for (const response of resources) {
      expect(response.status(), response.url()).toBe(200);
      expect(response.fromServiceWorker(), response.url()).toBe(true);
    }
    if (!fallback) {
      // A surviving completion marker must not authorize downloads after eviction.
      expect(
        await cold.evaluate(async () => {
          for (const name of await caches.keys())
            if (name.startsWith("mkw-offline-")) {
              const cache = await caches.open(name);
              if (await cache.delete("/ocr/models.json")) return true;
            }
          return false;
        }),
      ).toBe(true);
      await context.setOffline(false);
      const incomplete = await context.newPage();
      await incomplete.goto("/");
      await expectOfflineReady(incomplete);
      await expect(incomplete.getByRole("alert")).toHaveCount(0);
    }
  });
}
