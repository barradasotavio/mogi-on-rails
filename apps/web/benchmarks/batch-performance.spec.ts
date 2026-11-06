import { copyFileSync, mkdirSync, readdirSync, utimesSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { raw } from "../../../packages/engine/tests/support/real-captures";
import { createMogi } from "../tests/mogi-creation";

test.use({ viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

test("a real batch keeps the thread available and counts one answer per pair", async ({ page }, info) => {
  test.setTimeout(180000);
  // Private originals: prepare .fixtures/real-captures or supply the directory for measurement.
  const directory = process.env.BATCH_CAPTURES_DIR ?? path.resolve(".fixtures/real-captures");
  const copies = info.outputPath("originals");
  mkdirSync(copies, { recursive: true });
  const files = readdirSync(directory)
    .filter((name) => /\.jpe?g$/i.test(name))
    .sort()
    .map((name) => {
      const copy = path.join(copies, name);
      copyFileSync(path.join(directory, name), copy);
      // The local copy time is not the capture time; no temporal order, like the Node fixture.
      utimesSync(copy, 1700000000, 1700000000);
      return copy;
    });
  expect(files).toHaveLength(13);
  await page.goto("/");
  const teams = Array.from(
    { length: 6 },
    (_, i) =>
      `${i + 1}. ${raw.roster
        .filter((person) => person.teamId === `team-${i + 1}`)
        .map((person) => person.loungeName)
        .join(", ")}`,
  );
  await createMogi(page, `Tier D\n${teams.join("\n")}`);
  await page.evaluate(() => {
    const start = performance.now();
    const tasks: number[] = [],
      progress: { current: number; ms: number }[] = [];
    const longTasks = new PerformanceObserver((list) =>
      tasks.push(...list.getEntries().map((entry) => entry.duration)),
    );
    longTasks.observe({ type: "longtask" });
    const observer = new MutationObserver(() => {
      const status = [...document.querySelectorAll('[role="status"]')]
        .map((node) => node.textContent)
        .find((text) => /^Reading \d+ of 13$/.test(text ?? ""));
      if (!status) return;
      const current = Number(/Reading (\d+)/.exec(status)![1]);
      if (progress.at(-1)?.current !== current) progress.push({ current, ms: performance.now() - start });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    Object.assign(window, { batchMeasurement: { start, tasks, progress, longTasks, observer } });
  });
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add images", exact: true }).click();
  await (await picker).setFiles(files);
  await expect(page.getByRole("status").filter({ hasText: /^Reading 1 of 13$/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Reading \d+ of 13$/ })).toHaveCount(0, { timeout: 150000 });
  const metrics = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const measurement = (
      window as unknown as {
        batchMeasurement: {
          start: number;
          tasks: number[];
          progress: { current: number; ms: number }[];
          longTasks: PerformanceObserver;
          observer: MutationObserver;
        };
      }
    ).batchMeasurement;
    measurement.tasks.push(...measurement.longTasks.takeRecords().map((entry) => entry.duration));
    measurement.longTasks.disconnect();
    measurement.observer.disconnect();
    return {
      totalMs: performance.now() - measurement.start,
      longTasksMs: measurement.tasks.reduce((sum, ms) => sum + ms, 0),
      taskCount: measurement.tasks.length,
      maxTaskMs: Math.max(0, ...measurement.tasks),
      progress: measurement.progress,
      intervalsMs: measurement.progress.slice(1).map((entry, index) => entry.ms - measurement.progress[index].ms),
    };
  });
  console.log(JSON.stringify(metrics));
  await info.attach("batch-performance", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
  await page.screenshot({ path: info.outputPath("batch-complete.png"), animations: "disabled" });
  expect(metrics.progress.map((entry) => entry.current)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
  expect(metrics.longTasksMs).toBeLessThanOrEqual(10000);
  // The first interval includes OCR initialization; the others compare steady state.
  const steady = metrics.intervalsMs.slice(1);
  expect(Math.max(...steady) / Math.min(...steady)).toBeLessThanOrEqual(2);
  const header = page.getByRole("button", { name: "1 question", exact: true });
  await expect(header).toBeVisible();
  await header.click();
  const question = page.getByRole("dialog", { name: "Question 1 of 1", exact: true });
  await expect(question.getByText("Who is “F☆ peepa”?", { exact: true })).toBeVisible();
  await question.getByRole("radio", { name: /^iggy(?: Suggested)?$/ }).check();
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question).toBeHidden();
  await expect(page.getByRole("button", { name: /^\d+ questions?$/ })).toHaveCount(0);
});
