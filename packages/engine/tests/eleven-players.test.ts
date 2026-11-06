import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  answerMogiQuestion,
  captureBoundaryValues,
  countedRaces,
  mogiOverview,
  type MogiQuestion,
  type MogiQuestionAnswer,
  mogiQuestions,
  nativePlacementPoints,
  normalizeReconstructions,
  resultCoverage,
} from "@mkw/engine";

import type { Capture, Mogi } from "../../../apps/web/lib/mogi/types.ts";
// Saved OCR readings need the pure interpretation seam; recognizeImage requires a browser canvas.
import { interpretRightList } from "../src/recognition/finish-order.ts";
import { ingestReadings } from "./support/real-captures.ts";

// Real 2v2 mogi of 2026-10-30: Emole77 left after race 3 and the other races had 11 rows.
// In captures 10 and 11, karts in the background smudge some additions; the totals stay readable.
const data = JSON.parse(readFileSync(new URL("./fixtures/eleven-players.json", import.meta.url), "utf8"));
// The interpretation is redone as today's recognizer would; the raw readings stay intact.
const captures = data.readings.map((capture: Capture, index: number) => ({
  ...capture,
  interpretation: interpretRightList(
    capture.numericRows!,
    capture.interpretation!.positions,
    capture.interpretation!.movementRows,
    capture.rows,
  ),
  photoMoment: { at: Date.parse("2026-10-30T15:08:39-03:00") + index * 230_000, source: "exif" },
}));
const lounge: Record<string, string> = {
  "u.u": "Larry_.l",
  Kotone: "PiranhaPlant",
  "Y Wigglena": "Wigglenator",
  "Y wigglena": "Wigglenator",
  CRosalilou: "Rosalilou",
  "u Tbiddy": "Tbiddy",
  "★FishyN1": "FishyNo1",
  "É Tavo": "Tavo", // english-check: data (OCR'd in-game name)
  "★Reznor": "Reznor",
  "★ Reznor": "Reznor",
  Émole77: "Emole77", // english-check: data (OCR'd in-game name)
};
const loungeName = (reading: string) => lounge[reading] ?? (reading.startsWith("K") ? "Kongzi" : reading);

function emptyMogi(): Mogi {
  return {
    id: "eleven",
    name: "Mogi Tier EF",
    format: "2v2",
    createdAt: "2026-10-30",
    races: [],
    teams: data.room.teams,
    participants: data.room.participants.map((person: { loungeName: string }) => ({
      ...person,
      ign: person.loungeName,
      ignOrigin: "fallback",
    })),
  };
}
function answer(mogi: Mogi, question: MogiQuestion): MogiQuestionAnswer {
  if (question.kind === "name")
    return {
      kind: "name",
      answer: {
        participantId: mogi.participants.find((person) => person.loungeName === loungeName(question.reading))!.id,
      },
    };
  if (question.kind === "race")
    return {
      kind: "race",
      value: captures.findIndex((capture: { id: string }) => capture.id === question.captureId) + 1,
    };
  if (question.kind === "sequence" && question.options.some((option) => option.value === "continuous-12"))
    return { kind: "sequence", value: "continuous-12" };
  throw new Error(`Unexpected question: ${JSON.stringify(question)}`);
}
// The room size question has the factual answer: 11 represented.
function roomAnswer(mogi: Mogi, question: MogiQuestion): MogiQuestionAnswer {
  if (question.kind === "sequence" && question.options.some((option) => option.value === "11"))
    return { kind: "sequence", value: "11" };
  return answer(mogi, question);
}
/** Answer only capture questions; reconstruction positions remain in the queue for assertions. */
async function resolveCaptureQuestions(mogi: Mogi, asked: MogiQuestion[] = []) {
  for (let step = 0; step < 40; step++) {
    const question = mogiQuestions(mogi).find((question) => question.kind !== "position");
    if (!question) return mogi;
    asked.push(question);
    mogi = (
      await normalizeReconstructions({
        version: 1,
        mogis: [await answerMogiQuestion(mogi, question.id, answer(mogi, question))],
      })
    ).mogis[0];
  }
  assert.fail("The queue didn't finish");
}

test("an 11-player finish order with unreadable additions is still a finish order (showsFinishOrder)", () => {
  for (const index of [9, 10]) {
    assert.equal(captures[index].interpretation.screen, "finishOrderAdding", `Capture ${index + 1}`);
  }
});

test("provesRoomSize counts the twelve finish orders and continues the 11-player room without questions", async () => {
  let mogi = emptyMogi();
  for (const [index, capture] of captures.entries()) {
    const asked: MogiQuestion[] = [];
    mogi = await resolveCaptureQuestions(await ingestReadings(mogi, [structuredClone(capture)]), asked);
    assert.deepEqual(
      countedRaces(mogi).map((race) => race.number),
      Array.from({ length: index + 1 }, (_, n) => n + 1),
    );
    assert.deepEqual(
      asked.filter((question) => question.kind === "sequence"),
      [],
    );
    if (index > 0)
      assert.deepEqual(
        asked.filter((question) => question.kind === "race"),
        [],
      );
    assert.deepEqual(mogiQuestions(mogi), []);
  }
  for (const race of countedRaces(mogi)) {
    const capture = captures[race.number! - 1];
    const names = race.placements.map((id) => mogi.participants.find((person) => person.id === id)!.loungeName);
    const seen = capture.rows
      .filter((row: { text: string }) => row.text)
      .map((row: { text: string }) => loungeName(row.text));
    assert.deepEqual(names.slice(0, seen.length), seen, `Race ${race.number}`);
    if (race.number! > 3) assert.equal(names[11], "Emole77", `Race ${race.number}`);
  }
});

test("a room whose totals drop asks its race number instead of continuity", async () => {
  let mogi = emptyMogi();
  for (const capture of captures.slice(0, 5))
    mogi = await resolveCaptureQuestions(await ingestReadings(mogi, [structuredClone(capture)]));
  // The room reopened after race 5: the totals go back to one race's points.
  const reopened = structuredClone(captures[5]);
  reopened.id = "reopened";
  reopened.fileName = "reopened.jpg";
  for (const row of reopened.numericRows)
    if (row.right.value !== null)
      row.right = { ...row.right, value: row.addition.value ?? 1, text: String(row.addition.value ?? 1) };
  mogi = await ingestReadings(mogi, [reopened]);
  const questions = mogiQuestions(mogi);
  assert.ok(!questions.some((question) => question.kind === "sequence"));
  const question = questions.find((question) => question.kind === "race");
  assert.ok(question?.kind === "race", "Race question");
  assert.equal(question.reading, "Which race is this?");
  assert.ok(question.options.every((option) => typeof option.value === "number"));
  assert.ok(question.captureIds?.includes("reopened"));
});

test("a finish order whose room size is unknown asks instead of leaving the race stuck", async () => {
  let mogi = emptyMogi();
  for (const capture of captures.slice(0, 9))
    mogi = await resolveCaptureQuestions(await ingestReadings(mogi, [structuredClone(capture)]));
  const doubtful = structuredClone(captures[9]);
  // Without the rank of the last occupied row, the room size stays uncertain.
  doubtful.interpretation.positions[10] = {
    ...doubtful.interpretation.positions[10],
    text: "",
    value: null,
    confidence: 0,
    uncertain: true,
  };
  doubtful.interpretation = interpretRightList(
    doubtful.numericRows,
    doubtful.interpretation.positions,
    doubtful.interpretation.movementRows,
    doubtful.rows,
  );
  mogi = await ingestReadings(mogi, [doubtful]);
  for (let step = 0; step < 20 && !countedRaces(mogi).some((race) => race.number === 10); step++) {
    const question = mogiQuestions(mogi)[0];
    assert.ok(question, "Pending race 10 has a question");
    mogi = (
      await normalizeReconstructions({
        version: 1,
        mogis: [await answerMogiQuestion(mogi, question.id, roomAnswer(mogi, question))],
      })
    ).mogis[0];
  }
  assert.ok(countedRaces(mogi).some((race) => race.number === 10));
});

test("shrinking-room gaps reconstruct uniquely or ask about one-sided and two-sided missing cumulatives", async () => {
  const finishOrder = captures[2].rows
    .filter((row: { text: string }) => row.text)
    .map((row: { text: string }) => loungeName(row.text));
  for (const ambiguous of [false, true]) {
    let mogi = emptyMogi();
    for (const [index, original] of captures.entries()) {
      if (index === 2 || (!ambiguous && index === 8)) continue;
      const capture = structuredClone(original);
      if (ambiguous && index > 2) {
        // Leave race 3 compatible with Emole77 first in twelve or absent in eleven.
        for (const reading of capture.numericRows) {
          const name = loungeName(capture.rows[reading.row - 1].text);
          const rank = finishOrder.indexOf(name);
          if (rank < 0 || reading.right.value === null) continue;
          reading.right.value += nativePlacementPoints(11)[rank] - nativePlacementPoints(12)[rank];
          reading.right.text = String(reading.right.value);
        }
      }
      const asked: MogiQuestion[] = [];
      mogi = await resolveCaptureQuestions(await ingestReadings(mogi, [capture]), asked);
      if (index > 0)
        assert.deepEqual(
          asked.filter((question) => question.kind === "race" || question.kind === "sequence"),
          [],
          `Capture ${index + 1}`,
        );
    }
    const absent = mogi.participants.find((person) => person.loungeName === "Emole77")!.id;
    assertCheckedAddingColumn(mogi);
    if (!ambiguous) {
      const race = mogi.races.find((race) => race.number === 3)!;
      assert.equal(race.origin, "reconstructed");
      assert.equal(race.reconstruction?.status, "unique");
      assert.equal(race.reconstruction?.represented, 12);
      assert.equal(race.placements[11], absent);
      assert.deepEqual(
        race.placements.map((id) => mogi.participants.find((person) => person.id === id)!.loungeName),
        finishOrder,
      );
      assertAmbiguousNativePoints(mogi, 9, absent);
      assert.deepEqual(mogi.assistance?.facts, []);
      const question = mogiQuestions(mogi)[0];
      assert.ok(question?.kind === "position");
      assert.equal(question.number, 9);
      assert.equal(question.participantId, absent);
      assert.equal(mogiOverview(mogi).positions.find((position) => position.number === 9)?.state, "questions");
      mogi = (
        await normalizeReconstructions({
          mogis: [await answerMogiQuestion(mogi, question.id, { kind: "position", value: "absent" })],
        })
      ).mogis[0];
      const reconstructed = mogi.races.find((race) => race.number === 9)!;
      assert.equal(reconstructed.origin, "reconstructed");
      assert.equal(reconstructed.reconstruction?.status, "unique");
      assert.deepEqual(
        reconstructed.placements.map((id) => mogi.participants.find((person) => person.id === id)!.loungeName),
        captures[8].rows
          .filter((row: { text: string }) => row.text)
          .map((row: { text: string }) => loungeName(row.text)),
      );
      assert.deepEqual(
        countedRaces(mogi).map((race) => race.number),
        Array.from({ length: 12 }, (_, index) => index + 1),
      );
      assert.equal(resultCoverage(mogi).through, 12);
      assert.equal(resultCoverage(mogi).complete, true);
      assert.deepEqual(mogiQuestions(mogi), []);
      continue;
    }
    assertAmbiguousNativePoints(mogi, 3, absent);
    const question = mogiQuestions(mogi)[0];
    assert.ok(question?.kind === "position");
    assert.equal(question.number, 3);
    assert.equal(question.participantId, absent);
    assert.equal(mogiOverview(mogi).positions.find((position) => position.number === 3)?.state, "questions");
    for (const value of ["absent", 1] as const) {
      const answered: Mogi = (
        await normalizeReconstructions({
          mogis: [await answerMogiQuestion(mogi, question.id, { kind: "position", value })],
        })
      ).mogis[0];
      const race = answered.races.find((race) => race.number === 3)!;
      assert.equal(race.origin, "reconstructed");
      assert.equal(race.reconstruction?.status, "unique");
      assert.equal(race.reconstruction?.represented, value === "absent" ? 11 : 12);
      const sharedOrder = finishOrder.filter((name: string) => name !== "Emole77");
      assert.deepEqual(
        race.placements.map((id) => answered.participants.find((person) => person.id === id)!.loungeName),
        value === "absent" ? sharedOrder : ["Emole77", ...sharedOrder],
      );
      assert.deepEqual(mogiQuestions(answered), []);
    }
  }
});

function assertAmbiguousNativePoints(mogi: Mogi, number: number, absent: string) {
  const race = mogi.races.find((race) => race.number === number)!;
  assert.equal(race.status, "pending");
  assert.equal(race.reconstruction?.status, "ambiguous");
  const analysis = race.reconstruction!.boundaryAnalysis!;
  assert.equal(
    analysis.equations.some((equation) => equation.participantId === absent),
    false,
  );
  const hypotheses = analysis.hypotheses.map((hypothesis) => hypothesis.results[0]);
  assert.deepEqual(hypotheses.map((result) => result.represented).sort(), [11, 12]);
  assert.equal(hypotheses.find((result) => result.represented === 12)!.placements[0], absent);
  for (const person of mogi.participants.filter((person) => person.id !== absent)) {
    const equation = analysis.equations.find((equation) => equation.participantId === person.id)!;
    const rank = captures[number - 1].rows.findIndex(
      (row: { text: string }) => loungeName(row.text) === person.loungeName,
    );
    const expected = nativePlacementPoints(11)[rank];
    assert.equal(equation.newer.value - equation.older.value - equation.known, expected);
    assert.ok(
      hypotheses.every(
        (result) => nativePlacementPoints(result.represented)[result.placements.indexOf(person.id)] === expected,
      ),
    );
  }
}

function assertCheckedAddingColumn(mogi: Mogi) {
  const source = mogi.captures!.find((capture) => capture.fileName === "eleven-10.jpg")!;
  assert.equal(captureBoundaryValues(source).size, 0);
  assert.equal(captureBoundaryValues(source, mogi).size, 11);
  for (const change of ["contradiction", "unreadable", "identity"] as const) {
    const changed = structuredClone(mogi);
    const capture = changed.captures!.find((capture) => capture.id === source.id)!;
    if (change === "contradiction") capture.numericRows![0].right.value!++;
    if (change === "unreadable") {
      capture.numericRows![0].right = { ...capture.numericRows![0].right, uncertain: true, value: null };
      capture.numericDeductions = [];
    }
    if (change === "identity") capture.nameAssociations![0] = { participantId: null };
    assert.equal(captureBoundaryValues(capture, changed).size, 0, change);
  }
}
