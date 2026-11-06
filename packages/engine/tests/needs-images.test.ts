import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  answerMogiQuestion,
  applyReviewedRace,
  countedRaces,
  individualStandings,
  type MogiNeedsImagesReason,
  mogiOverview,
  mogiQuestions,
  normalizeReconstructions,
  placementPoints,
  pointsFor,
  resultCoverage,
} from "@mkw/engine";

import { ingestReadings, reinterpretReading } from "./support/real-captures.ts";
type Mogi = Parameters<typeof ingestReadings>[0];
type Capture = Parameters<typeof ingestReadings>[1][number];

const data = JSON.parse(readFileSync(new URL("./fixtures/eleven-players.json", import.meta.url), "utf8")) as {
  room: Mogi;
  readings: Capture[];
};
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
function emptyMogi(): Mogi {
  return {
    id: "needs-images",
    name: "Mogi Tier EF",
    format: "2v2",
    createdAt: "2026-10-30",
    races: [],
    teams: data.room.teams,
    participants: data.room.participants.map((person) => ({
      ...person,
      ign: person.loungeName,
      ignOrigin: "fallback",
    })),
  };
}
function finalReading(): Capture {
  return reinterpretReading({
    ...structuredClone(data.readings[11]),
    photoMoment: { at: Date.parse("2026-10-30T15:08:39-03:00") + 11 * 230_000, source: "exif" },
  });
}
function twelvePlayerFinal(): Capture {
  const capture = finalReading();
  const participants = emptyMogi().participants;
  capture.id = "twelve-12";
  capture.unreadableRowNumbers = [];
  const numeric = (value: number, text = String(value)) => ({
    value,
    text,
    confidence: 100,
    uncertain: false,
    alternatives: [{ value, text, confidence: 100 }],
  });
  capture.rows = capture.rows.map((row, index) => ({
    ...row,
    text: participants[index].loungeName,
    confidence: 100,
    uncertain: false,
    alternatives: [{ text: participants[index].loungeName, confidence: 100 }],
  }));
  // Eleven complete cycles plus this finish order: each native total is 12 times its addition.
  capture.numericRows = capture.numericRows!.map((row, index) => ({
    ...row,
    right: { ...row.right, ...numeric(placementPoints[index] * 12) },
    addition: { ...row.addition, ...numeric(placementPoints[index], `+${placementPoints[index]}`) },
  }));
  capture.interpretation!.positions = capture.interpretation!.positions.map((reading, index) => ({
    ...reading,
    ...numeric(index + 1),
  }));
  const reinterpreted = reinterpretReading(capture);
  // A settled finish order, with visible additions retained as evidence of the native scale.
  reinterpreted.interpretation = { ...reinterpreted.interpretation!, screen: "finishOrderAdded" };
  return reinterpreted;
}
function checkQuestionPrecedence(mogi: Mogi) {
  for (const position of mogiOverview(mogi).positions)
    if (position.questionCount > 0) {
      assert.equal(position.state, "questions");
      assert.equal(position.needsImages, undefined);
    }
}

test("a lone race-12 final whose native totals sum to 984 proves a native room of twelve from race one, without questions (provenIntervals)", async () => {
  const capture = twelvePlayerFinal();
  assert.equal(
    capture.numericRows!.reduce((sum, row) => sum + row.right.value!, 0),
    984,
  );
  const mogi = await ingestReadings(emptyMogi(), [capture]);
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.equal(resultCoverage(mogi).complete, true);
  assert.equal(resultCoverage(mogi).final, true);
  const overview = mogiOverview(mogi);
  assert.equal(overview.finished, true);
  assert.equal(overview.action.kind, "copy-submit");
  assert.deepEqual(
    overview.positions.map((position) => position.state),
    [...Array(11).fill("unseen"), "counted"],
  );
  assert.ok(overview.positions.every((position) => position.needsImages === undefined));
  assert.deepEqual(
    Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])),
    Object.fromEntries(capture.rows.map((row, index) => [row.text, capture.numericRows![index].right.value])),
  );
});

test("only eleven-12 needs earlier images, preserves adjusted known points and never asks for placements", async () => {
  let mogi = await ingestReadings(emptyMogi(), [finalReading()]);
  assert.ok(mogiQuestions(mogi).some((question) => question.kind === "race"));
  checkQuestionPrecedence(mogi);
  for (let step = 0; step < 40; step++) {
    const queue = mogiQuestions(mogi);
    assert.ok(
      queue.every((question) => question.kind === "race" || question.kind === "name"),
      JSON.stringify(queue),
    );
    checkQuestionPrecedence(mogi);
    const question = queue[0];
    if (!question) break;
    const response =
      question.kind === "race"
        ? { kind: "race" as const, value: 12 }
        : {
            kind: "name" as const,
            answer: {
              participantId: mogi.participants.find(
                (person) =>
                  person.loungeName ===
                  (lounge[question.reading] ?? (question.reading.startsWith("K") ? "Kongzi" : question.reading)),
              )!.id,
            },
          };
    mogi = (await normalizeReconstructions({ mogis: [await answerMogiQuestion(mogi, question.id, response)] }))
      .mogis[0];
  }
  assert.deepEqual(mogiQuestions(mogi), []);
  const reason: MogiNeedsImagesReason = "fewer-players";
  const overview = mogiOverview(mogi);
  for (const position of overview.positions.slice(0, 11)) {
    assert.equal(position.state, "needs-images");
    assert.deepEqual(position.needsImages, { reason });
    assert.equal(position.questionCount, 0);
  }
  assert.equal(overview.positions[11].state, "counted");
  assert.equal(overview.positions[11].needsImages, undefined);
  assert.equal(resultCoverage(mogi).complete, false);
  assert.deepEqual(resultCoverage(mogi).included, [12]);
  const race = countedRaces(mogi)[0];
  assert.equal(race.number, 12);
  const emole = mogi.participants.find((person) => person.loungeName === "Emole77")!;
  assert.equal(pointsFor(race, emole.id), 1);
  assert.deepEqual(
    race.placements.map((id) => pointsFor(race, id)),
    [...placementPoints.slice(0, 11), 1],
  );
  for (const person of individualStandings(mogi)) {
    assert.equal(person.points, null);
    assert.deepEqual(person.coverage, []);
  }
  // Unknown earlier results never acquire zero-valued contributions.
  assert.ok(
    mogi.races.filter((race) => race.number! < 12).every((race) => !race.nativePoints && !race.placements.length),
  );
  const noKnownResults = {
    ...mogi,
    races: mogi.races.filter((race) => race.number !== 12),
    captures: [],
    sequence: undefined,
    coverage: undefined,
  };
  assert.ok(individualStandings(noKnownResults).every((person) => person.points === null));
  const reading = mogiOverview(mogi, { reading: { current: 1, total: 1, numbers: [1] } });
  assert.equal(reading.positions[0].state, "reading");
  assert.equal(reading.positions[0].needsImages, undefined);
});

test("an empty mogi only has future positions", () => {
  assert.ok(
    mogiOverview(emptyMogi()).positions.every(
      (position) => position.state === "future" && position.questionCount === 0 && position.needsImages === undefined,
    ),
  );
});

test("a question on another race keeps missing results unseen until answered", async () => {
  const mogi = emptyMogi();
  const participantId = mogi.participants[0].id;
  mogi.races = [
    {
      id: "r2",
      number: 2,
      origin: "manual",
      status: "confirmed",
      placements: mogi.participants.map((person) => person.id),
      captureIds: ["c2"],
    },
  ];
  mogi.captures = [
    {
      id: "c2",
      fileName: "race-2.jpeg",
      original: new Blob(),
      width: 1920,
      height: 1080,
      stage: "finish-order-confirmed",
      context: { phase: "after", raceId: "r2" },
      reviewedAt: "",
      reviewedPlacements: [],
      rows: [{ text: "Unclear", confidence: 30, uncertain: true, suggestedParticipantId: participantId }],
      nameAssociations: [{ participantId: null }],
    },
  ];
  const queue = mogiQuestions(mogi);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, "name");
  assert.equal(queue[0].number, 2);
  const before = mogiOverview(mogi);
  assert.equal(before.positions[1].state, "questions");
  assert.equal(before.positions[0].questionCount, 0);
  assert.equal(before.positions[0].state, "unseen");
  assert.equal(before.positions[0].needsImages, undefined);

  const answered = await answerMogiQuestion(mogi, queue[0].id, { kind: "name", answer: { participantId } });
  assert.deepEqual(mogiQuestions(answered), []);
  const after = mogiOverview(answered);
  assert.equal(after.positions[0].state, "needs-images");
  assert.deepEqual(after.positions[0].needsImages, { reason: "no-later-totals" });
});

test("a later result without cumulative evidence needs images, but existing questions and readings win", () => {
  const mogi = emptyMogi();
  mogi.races = [
    {
      id: "r12",
      number: 12,
      status: "confirmed",
      origin: "manual",
      placements: mogi.participants.map((person) => person.id),
    },
  ];
  assert.deepEqual(mogiQuestions(mogi), []);
  const overview = mogiOverview(mogi);
  assert.ok(
    overview.positions
      .slice(0, 11)
      .every((position) => position.state === "needs-images" && position.needsImages?.reason === "no-later-totals"),
  );
  assert.equal(overview.positions[11].state, "counted");
  const activity = mogiOverview(mogi, {
    imageQuestions: [{ number: 3 }],
    reading: { current: 1, total: 1, numbers: [3, 4] },
  });
  assert.equal(activity.positions[2].state, "reading");
  assert.equal(activity.positions[2].questionCount, 1);
  assert.equal(activity.positions[2].needsImages, undefined);
  assert.equal(activity.positions[3].state, "reading");
  const questions = mogiOverview(mogi, { imageQuestions: [{ number: 3 }] });
  assert.equal(questions.positions[2].state, "questions");
  assert.equal(questions.positions[2].needsImages, undefined);
});

test("a result entered by hand for a race that needs images counts it, and the mogi can finish", () => {
  const mogi = emptyMogi();
  const ids = mogi.participants.map((person) => person.id);
  mogi.races = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12].map((number) => ({
    id: `r${number}`,
    number,
    status: "confirmed",
    origin: "manual",
    placements: [...ids.slice(number % 12), ...ids.slice(0, number % 12)],
  }));
  assert.equal(mogiOverview(mogi).positions[8].state, "needs-images");

  const entered = applyReviewedRace(mogi, { id: "r9", number: 9, origin: "manual", placements: [...ids].reverse() });
  const overview = mogiOverview(entered);
  assert.equal(overview.positions[8].state, "counted");
  assert.equal(overview.finished, true);
  assert.deepEqual(overview.action, { kind: "copy-submit" });
  assert.equal(
    individualStandings(entered).reduce((sum, row) => sum + (row.points ?? 0), 0),
    984,
  );
});

test("an unrecognized screen with names needs images after its race number is answered and accepts a manual result", async () => {
  const capture = twelvePlayerFinal();
  capture.interpretation!.screen = "unknown";
  let mogi = await ingestReadings(emptyMogi(), [capture]);
  const question = mogiQuestions(mogi).find((q) => q.kind === "race")!;
  assert.equal(question.reading, "Which race is this?");
  mogi = await answerMogiQuestion(mogi, question.id, { kind: "race", value: 1 });
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.equal(mogiOverview(mogi).positions[0].state, "needs-images");
  assert.deepEqual(mogiOverview(mogi).positions[0].needsImages, { reason: "no-later-totals" });
  const race = mogi.races.find((race) => race.captureIds?.includes(capture.id))!;
  const entered = applyReviewedRace(mogi, {
    ...race,
    origin: "manual",
    placements: mogi.participants.map((p) => p.id),
  });
  assert.equal(mogiOverview(entered).positions[0].state, "counted");
  assert.deepEqual(entered.races.find((r) => r.id === race.id)!.captureIds, [capture.id]);
});
