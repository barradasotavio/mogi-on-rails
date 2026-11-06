import { expect, test } from "@playwright/test";

import { consultRace } from "./mogi-navigation";
import { restoreState } from "./mogi-state";
import { trackSaveState } from "./track-save-fixture";

test("choosing a track with three capture mogis saves without long tasks", async ({ page }, info) => {
  await page.addInitScript(() => {
    type Fiber = {
      actualDuration?: number;
      selfBaseDuration?: number;
      memoizedProps?: { mogi?: { id: string } };
      type?: { name?: string };
      flags: number;
      child: Fiber | null;
      sibling: Fiber | null;
    };
    const profile = {
      active: false,
      development: false,
      renders: {} as Record<string, number>,
      selfMs: {} as Record<string, number>,
      ruleCalls: {} as Record<string, number>,
      actualSelfMs: {} as Record<string, number>,
    };
    let previous = new Set<Fiber>();
    const renderers = new Map<number, { bundleType?: number }>();
    Object.defineProperty(window, "trackSaveProfile", { value: profile });
    Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      value: {
        supportsFiber: true,
        renderers,
        inject: (renderer: { bundleType?: number }) => {
          renderers.set(1, renderer);
          profile.development = renderer.bundleType === 1;
          return 1;
        },
        onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
          const current = new Set<Fiber>();
          const indices: Record<string, number> = {};
          function visit(fiber: Fiber | null) {
            if (!fiber) return;
            current.add(fiber);
            const name = fiber.type?.name ?? "";
            if (
              [
                "Tracker",
                "MogiList",
                "MogiListSections",
                "MogiListRow",
                "MogiOverview",
                "MogiStandings",
                "MogiTableSection",
                "MogiTable",
                "MogiTableView",
                "ScoreMatrix",
                "ResultsExport",
                "ResultsExportSession",
              ].includes(name)
            ) {
              const index = indices[name] ?? 0;
              indices[name] = index + 1;
              // PerformedWork on a new fiber excludes branches reused from the previous commit.
              if (profile.active && !previous.has(fiber) && fiber.flags & 1) {
                const key = `${name}:${fiber.memoizedProps?.mogi?.id ?? index}:${index}`;
                profile.renders[key] = (profile.renders[key] ?? 0) + 1;
                profile.selfMs[key] = (profile.selfMs[key] ?? 0) + (fiber.selfBaseDuration ?? 0);
                let childrenMs = 0;
                for (let child = fiber.child; child; child = child.sibling) childrenMs += child.actualDuration ?? 0;
                profile.actualSelfMs[key] =
                  (profile.actualSelfMs[key] ?? 0) + Math.max(0, (fiber.actualDuration ?? 0) - childrenMs);
              }
            }
            visit(fiber.child);
            visit(fiber.sibling);
          }
          visit(root.current);
          previous = current;
        },
      },
    });
  });
  await page.route("**/packages/engine/src/domain/mogi/mogi-summary.ts*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const pattern = /function mogiSummary\([^]*?\) \{/;
    expect(source).toMatch(pattern);
    await route.fulfill({
      response,
      body: source.replace(
        pattern,
        (match) => `${match}
      if (window.trackSaveProfile?.active) {
        const calls = window.trackSaveProfile.ruleCalls;
        calls[mogi.id] = (calls[mogi.id] ?? 0) + 1;
      }`,
      ),
    });
  });
  await page.route("**/packages/engine/src/domain/mogi/mogi-overview.ts*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const pattern = /function mogiPlayerChanges\([^]*?\) \{/;
    expect(source).toMatch(pattern);
    await route.fulfill({
      response,
      body: source.replace(
        pattern,
        (match) => `${match}
      if (window.trackSaveProfile?.active) {
        const calls = window.trackSaveProfile.ruleCalls;
        calls["changes"] = (calls["changes"] ?? 0) + 1;
      }`,
      ),
    });
  });
  await page.route("**/packages/engine/src/domain/scoring/submission.ts*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const pattern = /function loungeSubmission\([^]*?\) \{/;
    expect(source).toMatch(pattern);
    await route.fulfill({
      response,
      body: source.replace(
        pattern,
        (match) => `${match}
      if (window.trackSaveProfile?.active) {
        const calls = window.trackSaveProfile.ruleCalls;
        calls["submission"] = (calls["submission"] ?? 0) + 1;
      }`,
      ),
    });
  });
  await page.route("**/packages/engine/src/domain/scoring/scoring.ts*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const pattern = /function individualStandings\([^]*?\) \{/;
    expect(source).toMatch(pattern);
    await route.fulfill({
      response,
      body: source.replace(
        pattern,
        (match) => `${match}
      if (window.trackSaveProfile?.active) {
        const calls = window.trackSaveProfile.ruleCalls;
        calls["standings"] = (calls["standings"] ?? 0) + 1;
      }`,
      ),
    });
  });
  const fixture = await trackSaveState();
  expect(fixture.shape).toEqual({
    mogis: 3,
    capturesPerMogi: 13,
    racesPerMogi: 12,
    reconstructionsPerMogi: 1,
    questionsPerMogi: 2,
  });
  await restoreState(page, fixture.state);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto(`/?mogi=${fixture.activeId}`);
  await expect(page.getByRole("button", { name: "2 Questions", exact: true })).toBeVisible();
  const standings = page.getByRole("list", { name: "Team standings", exact: true, includeHidden: true });
  const beforeStandings = await standings.innerText();
  const race = await consultRace(page, 1);
  await race.getByRole("button", { name: "Track Choose", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search track or code", exact: true }).fill("CC");
  const track = page
    .locator('[role="dialog"] ul[aria-label="Tracks"]')
    .getByRole("button", { name: "CC Crown City CC", exact: true });
  await expect(track).toBeVisible();
  // The picker carries the race's screenshot.
  await expect(
    page
      .getByRole("dialog", { name: "Track", exact: true })
      .getByRole("img", { name: "Screenshot of race 1", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const cpuRate = Number(process.env.TRACK_SAVE_CPU_RATE ?? 1);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  const measure = await track.evaluate((element) => {
    const profile = Object.getOwnPropertyDescriptor(window, "trackSaveProfile")!.value as {
      active: boolean;
      development: boolean;
      renders: Record<string, number>;
      selfMs: Record<string, number>;
      ruleCalls: Record<string, number>;
      actualSelfMs: Record<string, number>;
    };
    profile.active = true;
    profile.renders = {};
    profile.selfMs = {};
    profile.ruleCalls = {};
    profile.actualSelfMs = {};
    let controlsDisabled = false;
    const controls = new MutationObserver(() => {
      if (!element.matches(":disabled")) return;
      const rows = Array.from(document.querySelectorAll("[data-mogi-id]"));
      controlsDisabled ||= rows.length > 0 && rows.every((row) => row.matches(":disabled"));
    });
    controls.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
    const tasks: { startTime: number; duration: number }[] = [];
    const observer = new PerformanceObserver((list) =>
      tasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration }))),
    );
    observer.observe({ type: "longtask" });
    const start = performance.now();
    (element as HTMLButtonElement).click();
    return new Promise<{
      tasks: typeof tasks;
      elapsedMs: number;
      controlsDisabled: boolean;
      development: boolean;
      renders: Record<string, number>;
      selfMs: Record<string, number>;
      ruleCalls: Record<string, number>;
      actualSelfMs: Record<string, number>;
    }>((resolve) => {
      const interval = setInterval(() => {
        if (!document.querySelector('[role="dialog"] ul[aria-label="Tracks"]')) {
          clearInterval(interval);
          // Let the observer deliver the task that committed the saved track.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              tasks.push(...observer.takeRecords().map(({ startTime, duration }) => ({ startTime, duration })));
              observer.disconnect();
              controls.disconnect();
              profile.active = false;
              resolve({
                tasks,
                elapsedMs: performance.now() - start,
                controlsDisabled,
                development: profile.development,
                renders: profile.renders,
                selfMs: profile.selfMs,
                ruleCalls: profile.ruleCalls,
                actualSelfMs: profile.actualSelfMs,
              });
            }),
          );
        }
      }, 10);
    });
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  expect(await standings.innerText()).toBe(beforeStandings);
  await expect(race.getByRole("button", { name: "Track CC Crown City", exact: true })).toBeVisible();
  await info.attach("track-save-performance", {
    body: JSON.stringify({ fixture: fixture.shape, cpuRate, ...measure }, null, 2),
    contentType: "application/json",
  });
  console.log("track-save-performance", JSON.stringify({ fixture: fixture.shape, cpuRate, ...measure }));
  await page.reload();
  const restored = await consultRace(page, 1);
  await expect(restored.getByRole("button", { name: "Track CC Crown City", exact: true })).toBeVisible();
  if (measure.development) {
    expect(measure.ruleCalls["other-1"] ?? 0).toBe(0);
    expect(measure.ruleCalls["other-2"] ?? 0).toBe(0);
    expect(measure.ruleCalls["changes"] ?? 0).toBe(0);
    expect(measure.ruleCalls["submission"] ?? 0).toBe(0);
    expect(measure.ruleCalls["standings"] ?? 0).toBe(0);
  }
  expect(measure.tasks.filter((task) => task.duration > 50)).toEqual([]);
  expect(measure.controlsDisabled).toBe(true);
  if (measure.development)
    expect(Object.keys(measure.renders).filter((key) => key.startsWith("MogiOverview:"))).toHaveLength(1);
  for (const [component, count] of Object.entries(measure.renders)) {
    if (component.startsWith("Mogi")) expect(count, component).toBeLessThanOrEqual(1);
  }
});
