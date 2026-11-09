import { copyFileSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

import { countedRaces, individualStandings, pointsFor, raceNumber, teamStandings } from "@mkw/engine";
import { expect, type Page, test } from "@playwright/test";

import { type MogiQuestion, mogiQuestions } from "../lib/mogi/questions";
import type { Mogi } from "../lib/mogi/types";
import { createMogi } from "../tests/mogi-creation";

// Small × Tiny experiment: three real capture scenarios, answered using ground truth.
// Requires BATCH_CAPTURES_DIR (13 originals) and OCR_TRUTH_DIR (mogi-truth.json, cumulative.json
// and capture-truth.json with row order and visible numbers for each capture).
const capturesDirectory = process.env.BATCH_CAPTURES_DIR ?? "";
const truthDirectory = process.env.OCR_TRUTH_DIR ?? "";
const outputDirectory = process.env.VALIDATION_OUTPUT;
const format = process.env.MOGI_FORMAT?.toLowerCase() === "ffa" ? "FFA" : "2v2";
const ffaBot = `Room 1 MMR: 5210 - Tier EF
1. VSPeach (5600 MMR)
2. Kameks Eye (5520 MMR)
3. funk2006 (5440 MMR)
4. toad67 (5360 MMR)
5. Tavo (5280 MMR)
6. KingBoo (5200 MMR)
7. pom (5120 MMR)
8. DonkeyKong (5040 MMR)
9. PiranhaPlant (4960 MMR)
10. BloopMaster (4880 MMR)
11. ActuFunk (4800 MMR)
12. iggy (4720 MMR)`;
interface CaptureTruth {
  file: string;
  rows: string[];
  right: number[];
  race: number;
  totalsAfter: number;
  phase: string;
}
interface MogiTruth {
  bot: string;
  races: { race: number; placements: string[] }[];
  totals: Record<string, number>;
  teams: [string, string, number][];
}
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(truthDirectory, file), "utf8")) as T;

test.use({ viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
test.skip(!capturesDirectory || !truthDirectory, "Set BATCH_CAPTURES_DIR and OCR_TRUTH_DIR.");

/** Match the QuestionSheet title to check that the calculated question is displayed. */
function heading(question: MogiQuestion) {
  if (question.kind === "image") return "Is this image from this mogi?";
  if (question.kind === "name") return `Who is “${question.reading}”?`;
  if (question.kind === "race" || question.kind === "sequence") return question.reading;
  if (question.kind === "credit") return `Who gets credit for ${question.reading}?`;
  if (question.kind === "points") return `What's the total for “${question.reading}” on this screenshot?`;
  if (question.kind === "team") return `Which team is “${question.reading}” on?`;
  return `Where did “${question.reading}” finish?`;
}

async function readMogi(page: Page): Promise<Mogi> {
  // Blobs become {} in JSON; question and points projections do not read pixels.
  const json = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("mkw-on-rails");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction("tracker", "readonly").objectStore("tracker").get("state");
          get.onsuccess = () => {
            db.close();
            resolve(JSON.stringify(get.result ?? { mogis: [] }));
          };
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
        };
      }),
  );
  const state = JSON.parse(json) as { mogis: Mogi[] };
  const id = new URL(page.url()).searchParams.get("mogi");
  return state.mogis.find((mogi) => mogi.id === id) ?? state.mogis.at(-1)!;
}

interface Answer {
  value?: string;
  another?: string;
  points?: number;
  note?: string;
}
function answerFor(question: MogiQuestion, mogi: Mogi, captures: CaptureTruth[], truth: MogiTruth): Answer {
  const capture = mogi.captures?.find((entry) => entry.id === question.captureId);
  const file = capture && capture?.fileName;
  const source = captures.find((entry) => entry.file === file);
  const teamOf = (name: string) => truth.teams.findIndex((team) => team.includes(name)) + 1;
  switch (question.kind) {
    case "image":
      return { value: "yes" };
    case "name": {
      const want = source?.rows[question.row - 1];
      const option = question.options.find((entry) => entry.loungeName === want);
      if (!option) throw new Error(`No option for ${want}: ${JSON.stringify(question)}`);
      return { value: option.id };
    }
    case "points": {
      const want = source?.right[question.row - 1];
      return want === undefined
        ? { points: question.suggestion ?? 0, note: "row without ground truth" }
        : { points: want };
    }
    case "race": {
      const candidates = source ? [source.race, source.totalsAfter] : [];
      if (typeof question.suggestion === "number" && candidates.includes(question.suggestion))
        return { value: String(question.suggestion) };
      for (const candidate of candidates) {
        if (question.options.some((option) => option.value === candidate)) return { value: String(candidate) };
        if (question.otherRaces?.some((option) => option.value === candidate))
          return { value: "another", another: String(candidate) };
      }
      return {
        value: String(question.suggestion ?? question.options[0]?.value),
        note: `race ${candidates.join("/")} unavailable`,
      };
    }
    case "sequence": {
      const values = question.options.map((option) => option.value);
      if (values.includes("continuous-12")) return { value: "continuous-12" };
      if (values.includes("counted")) return { value: "counted" };
      if (question.id.startsWith("room-order:")) {
        const first = [...question.options].sort((a, b) => a.label.localeCompare(b.label))[0];
        return { value: first.value };
      }
      return { value: "unknown", note: "individual continuity without a 'no' option" };
    }
    case "team":
      return { value: `team-${teamOf(question.reading)}` };
    case "position": {
      const placements = truth.races.find((race) => race.race === question.number)?.placements ?? [];
      const place = placements.indexOf(question.reading) + 1;
      return place
        ? { value: String(place) }
        : { value: String(question.suggestion), note: "no placement in ground truth" };
    }
    case "credit": {
      const option = question.options.find((entry) => entry.label === question.reading);
      return {
        value: option?.value ?? question.suggestion,
        note: option ? undefined : "credit without the person themselves",
      };
    }
  }
}

interface QuestionLog {
  kind: string;
  id: string;
  heading: string;
  suggestion: unknown;
  answer: Answer;
  suggestionRight: boolean;
}
/** Open the queue through the header and answer until empty; return the log and initial header count. */
async function answerQueue(page: Page, captures: CaptureTruth[], truth: MogiTruth) {
  const log: QuestionLog[] = [];
  const headers: string[] = [];
  const initial = new Map<string, MogiQuestion>();
  let repeated = 0,
    lastId = "";
  for (let guard = 0; guard < 200; guard++) {
    const dialog = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
    if (!(await dialog.isVisible())) {
      await page.waitForTimeout(400);
      const header = page.getByRole("button", { name: /^\d+ questions?$/ }).first();
      if (!(await header.isVisible())) break;
      headers.push((await header.textContent())!.trim());
      const pending = mogiQuestions(await readMogi(page));
      expect(Number.parseInt(headers.at(-1)!), "The header counts every pending question without hiding rows").toBe(
        pending.length,
      );
      for (const question of pending) initial.set(question.id, question);
      await header.click();
      await expect(dialog).toBeVisible();
    }
    let mogi = await readMogi(page);
    let question = mogiQuestions(mogi)[0];
    // The sheet may be one write behind/ahead of IndexedDB; wait for the same title.
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!question) break;
      const visible = await dialog
        .getByText(heading(question), { exact: true })
        .isVisible()
        .catch(() => false);
      if (visible) break;
      await page.waitForTimeout(250);
      mogi = await readMogi(page);
      question = mogiQuestions(mogi)[0];
    }
    if (!question) {
      await expect(dialog).toBeHidden({ timeout: 5000 });
      break;
    }
    await expect(dialog.getByText(heading(question), { exact: true })).toBeVisible();
    repeated = question.id === lastId ? repeated + 1 : 0;
    lastId = question.id;
    if (repeated >= 3) throw new Error(`Repeated question without progress: ${question.id}`);
    const answer = answerFor(question, mogi, captures, truth);
    const suggestion = "suggestion" in question ? question.suggestion : undefined;
    log.push({
      kind: question.kind,
      id: question.id,
      heading: heading(question),
      suggestion,
      answer,
      suggestionRight:
        answer.points !== undefined
          ? suggestion === answer.points
          : answer.another
            ? false
            : String(suggestion) === answer.value,
    });
    if (answer.points !== undefined) await dialog.getByLabel("Points", { exact: true }).fill(String(answer.points));
    else {
      await dialog.locator(`[role="radio"][value="${answer.value}"]`).click();
      if (answer.another) await dialog.locator(`[role="radio"][value="${answer.another}"]`).click();
    }
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    // Advance when the engine's calculated queue changes or the sheet closes.
    await expect
      .poll(
        async () => {
          const next = mogiQuestions(await readMogi(page))[0];
          return !next || next.id !== question.id || !(await dialog.isVisible());
        },
        { timeout: 15000 },
      )
      .toBe(true);
  }
  const final = await readMogi(page);
  const deduced = [...initial.values()].filter((question) => !log.some((answer) => answer.id === question.id));
  for (const question of deduced) {
    expect(question.kind, "Only names may be resolved by elimination without a human answer").toBe("name");
    if (question.kind !== "name") continue;
    for (const occurrence of [question, ...question.occurrences]) {
      const association = final.captures?.find((capture) => capture.id === occurrence.captureId)?.nameAssociations?.[
        occurrence.row - 1
      ];
      expect(association?.participantId, "An unanswered row needs an established identity").toBeTruthy();
      expect(association?.origin, "An unanswered association stays deduced and reviewable").toBe("deduced");
    }
  }
  expect(mogiQuestions(final), "No pending question is hidden when answers finish").toEqual([]);
  return { log, headers, deduced: deduced.map((question) => ({ id: question.id, reading: heading(question) })) };
}

/** Cumulatives per race from counted placements, and final totals from standings. */
function totalsReport(mogi: Mogi, cumulative: Record<string, number>[], truth: MogiTruth, through = 12) {
  const races = countedRaces(mogi);
  const running: Record<string, number> = Object.fromEntries(mogi.participants.map((person) => [person.loungeName, 0]));
  const perRace: { race: number; ok: boolean | null; diff: string[] }[] = [];
  for (let number = 1; number <= 12; number++) {
    const race = races.find((entry) => raceNumber(mogi, entry) === number);
    if (!race || !race.placements.length) {
      perRace.push({ race: number, ok: null, diff: ["no placements"] });
      continue;
    }
    for (const person of mogi.participants) running[person.loungeName] += pointsFor(race, person.id);
    const diff = Object.keys(cumulative[number - 1])
      .filter((key) => running[key] !== cumulative[number - 1][key])
      .map((key) => `${key}: ${running[key]} ≠ ${cumulative[number - 1][key]}`);
    perRace.push({ race: number, ok: diff.length === 0, diff });
  }
  const individuals = individualStandings(mogi).map((entry) => ({ name: entry.loungeName, points: entry.points }));
  const teams = teamStandings(mogi).map((team) => ({
    members: team.participants.map((person) => person.loungeName),
    points: team.points,
  }));
  const expected = through === 12 ? truth.totals : cumulative[through - 1];
  const finalOk =
    individuals.every((entry) => entry.points === expected[entry.name]) &&
    (mogi.format === "FFA" ||
      truth.teams.every(([a, b, points]) =>
        teams.some(
          (team) =>
            team.members.includes(a) &&
            team.members.includes(b) &&
            team.points === (through === 12 ? points : expected[a] + expected[b]),
        ),
      ));
  return { through, perRace, individuals, teams, finalOk };
}

/** Measure a page reading: from upload until "Reading k of n" ends, with long tasks in that window. */
async function readFiles(page: Page, files: string[]) {
  await page.evaluate(() => {
    const target = window as unknown as {
      ocrMeasure?: { tasks: { start: number; duration: number }[]; observer?: PerformanceObserver };
    };
    if (!target.ocrMeasure) {
      const tasks: { start: number; duration: number }[] = [];
      const observer = new PerformanceObserver((list) =>
        tasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration }))),
      );
      observer.observe({ type: "longtask", buffered: true });
      target.ocrMeasure = { tasks, observer };
    }
    const window_ = {
      start: performance.now(),
      end: 0,
      seen: false,
      progress: [] as { current: number; ms: number }[],
    };
    const mutation = new MutationObserver(() => {
      const status = [...document.querySelectorAll('[role="status"]')]
        .map((node) => node.textContent ?? "")
        .find((text) => /^Reading \d+ of \d+$/.test(text));
      if (status) {
        window_.seen = true;
        const current = Number(/Reading (\d+)/.exec(status)![1]);
        if (window_.progress.at(-1)?.current !== current)
          window_.progress.push({ current, ms: performance.now() - window_.start });
      } else if (window_.seen && !window_.end) {
        window_.end = performance.now();
        mutation.disconnect();
      }
    });
    mutation.observe(document.body, { childList: true, subtree: true, characterData: true });
    Object.assign(window, { ocrWindow: window_ });
  });
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add images", exact: true }).first().click();
  await (await picker).setFiles(files);
  await page.waitForFunction(() => (window as unknown as { ocrWindow: { end: number } }).ocrWindow.end > 0, null, {
    timeout: 300000,
  });
  return page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const { ocrWindow, ocrMeasure } = window as unknown as {
      ocrWindow: { start: number; end: number; progress: { current: number; ms: number }[] };
      ocrMeasure: { tasks: { start: number; duration: number }[]; observer: PerformanceObserver };
    };
    ocrMeasure.tasks.push(
      ...ocrMeasure.observer.takeRecords().map((entry) => ({ start: entry.startTime, duration: entry.duration })),
    );
    const inside = ocrMeasure.tasks.filter((task) => task.start >= ocrWindow.start && task.start <= ocrWindow.end);
    return {
      readMs: ocrWindow.end - ocrWindow.start,
      longTasksMs: inside.reduce((sum, task) => sum + task.duration, 0),
      longTaskCount: inside.length,
      progress: ocrWindow.progress,
    };
  });
}

/** Raw readings per capture, to compare models field by field. */
function rawReadings(mogi: Mogi) {
  return [...(mogi.captures ?? [])]
    .map((capture) => ({
      file: capture.fileName,
      names: capture.rows.map((row) => ({ text: row.text, confidence: row.confidence, bounds: row.bounds })),
      right: (capture.numericRows ?? []).map((row) => ({
        row: row.row,
        text: row.right?.text,
        value: row.right?.value,
        uncertain: row.right?.uncertain,
      })),
      addition: (capture.numericRows ?? []).map((row) => ({
        row: row.row,
        text: row.addition?.text,
        value: row.addition?.value,
        uncertain: row.addition?.uncertain,
      })),
      positions: capture.interpretation?.positions?.map((position) => position.value) ?? [],
      interpretation: capture.interpretation,
      numericDeductions: capture.numericDeductions,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function prepare(info: { outputPath: (name: string) => string }) {
  const copies = info.outputPath("originals");
  mkdirSync(copies, { recursive: true });
  const files = readdirSync(capturesDirectory)
    .filter((name) => /\.jpe?g$/i.test(name))
    .sort()
    .map((name) => {
      const copy = path.join(copies, name);
      copyFileSync(path.join(capturesDirectory, name), copy);
      utimesSync(copy, 1700000000, 1700000000);
      return copy;
    });
  expect(files).toHaveLength(13);
  return files;
}

for (const scenario of [
  { id: "A", label: "iterative", batches: Array.from({ length: 13 }, (_, i) => [i]) },
  { id: "B", label: "batch of 5", batches: [[0, 1, 2, 3, 4]] },
  { id: "C", label: "full batch", batches: [Array.from({ length: 13 }, (_, i) => i)] },
])
  test(`scenario ${scenario.id} (${scenario.label}) answers using ground truth`, async ({ page }, info) => {
    test.setTimeout(900000);
    const files = prepare(info);
    const truth = read<MogiTruth>("mogi-truth.json");
    const cumulative = read<Record<string, number>[]>("cumulative.json");
    const captures = read<CaptureTruth[]>("capture-truth.json");
    await page.goto("/");
    await createMogi(page, format === "FFA" ? ffaBot : truth.bot);
    const steps = [];
    for (const batch of scenario.batches) {
      const timing = await readFiles(
        page,
        batch.map((index) => files[index]),
      );
      const { log, headers, deduced } = await answerQueue(page, captures, truth);
      const mogi = await readMogi(page);
      const expectedThrough = Math.max(...batch.map((index) => captures[index].totalsAfter));
      const totals = totalsReport(mogi, cumulative, truth);
      const through = totals.perRace.filter((entry) => entry.race <= expectedThrough);
      steps.push({
        captures: batch.map((index) => index + 1),
        ...timing,
        perImageMs: timing.readMs / batch.length,
        headers,
        questions: log,
        deduced,
        expectedThrough,
        totalsOk: through.every((entry) => entry.ok === true),
        totals: totals.perRace,
      });
      console.log(
        JSON.stringify({
          scenario: scenario.id,
          captures: batch.map((index) => index + 1),
          readMs: Math.round(timing.readMs),
          headers,
          questions: log.map((entry) => entry.kind),
          totalsOk: through.every((entry) => entry.ok === true),
        }),
      );
    }
    const mogi = await readMogi(page);
    for (const capture of mogi.captures ?? [])
      for (const row of capture.rows) {
        expect(row.bounds, `Row bounds in ${capture.fileName}`).toBeDefined();
        expect(row.bounds!.x).toBeGreaterThanOrEqual(0);
        expect(row.bounds!.y).toBeGreaterThanOrEqual(0);
        expect(row.bounds!.x + row.bounds!.width).toBeLessThanOrEqual(1920);
        expect(row.bounds!.y + row.bounds!.height).toBeLessThanOrEqual(1080);
      }
    const final = totalsReport(mogi, cumulative, truth, steps.at(-1)!.expectedThrough);
    const counts: Record<string, number> = {};
    for (const entry of steps.flatMap((step) => step.questions)) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    const result = {
      scenario: scenario.id,
      label: scenario.label,
      format,
      model: process.env.OCR_MODEL ?? "tiny",
      counts,
      readMs: steps.reduce((sum, step) => sum + step.readMs, 0),
      longTasksMs: steps.reduce((sum, step) => sum + step.longTasksMs, 0),
      perImageMs: steps.reduce((sum, step) => sum + step.readMs, 0) / scenario.batches.flat().length,
      everyStepOk: steps.every((step) => step.totalsOk),
      final,
      steps,
      raw: rawReadings(mogi),
    };
    const body = JSON.stringify(result, null, 2);
    await info.attach(`scenario-${scenario.id}`, { body, contentType: "application/json" });
    if (outputDirectory) {
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(path.join(outputDirectory, `scenario-${scenario.id}.json`), body);
    }
    console.log(
      JSON.stringify({
        scenario: scenario.id,
        counts,
        readMs: Math.round(result.readMs),
        perImageMs: Math.round(result.perImageMs),
        longTasksMs: Math.round(result.longTasksMs),
        everyStepOk: result.everyStepOk,
        finalOk: final.finalOk,
      }),
    );
    expect(result.everyStepOk, "Correct totals after each batch/race").toBe(true);
    expect(final.finalOk, "Correct totals through the scenario's last race").toBe(true);
    const answers = steps.flatMap((step) => step.questions);
    expect(new Set(answers.map((answer) => answer.id)).size, "Each ID is answered once").toBe(answers.length);
    for (const step of steps) {
      expect(
        step.headers.map((header) => Number.parseInt(header)).reduce((a, b) => a + b, 0),
        "Every initial pending question has an answer or proven deduction",
      ).toBe(step.questions.length + step.deduced.length);
    }
    if (format === "FFA") {
      expect(
        answers.every((answer) => answer.kind === "name"),
        "FFA only asks names",
      ).toBe(true);
      if (scenario.id === "C")
        expect(answers.length, "A complete FFA asks at most four answers").toBeLessThanOrEqual(4);
    } else expect(answers.length, "2v2 keeps one question per scenario").toBe(1);
  });
