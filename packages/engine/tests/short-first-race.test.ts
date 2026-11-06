import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  answerMogiQuestion,
  applySequenceAnswer,
  countedRaces,
  type MogiQuestion,
  type MogiQuestionAnswer,
  mogiQuestions,
  normalizeReconstructions,
  resultCoverage,
  sequenceInputSignature,
} from "@mkw/engine";

import type { Capture, Mogi } from "../../../apps/web/lib/mogi/types.ts";
import { ingestReadings } from "./support/real-captures.ts";

// Real 2v2 mogi of 2026-11-01, as the app read its result screens of races 1–8 and 10–12. The game gave race 1 only
// 81 points (MBJ21™'s +1 never reached its total), so from race 2 on every room sum is one short of 82 per race;
// before race 8, MBJ21™ alone restarted at 0. The room reopened before race 10; race 9 has no image.
const data = JSON.parse(readFileSync(new URL("./fixtures/short-first-race.json", import.meta.url), "utf8"));
const readings: Capture[] = data.readings;
const races = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12];
const raceOf = (id: string) => races[readings.findIndex((reading) => reading.id === id)];

function emptyMogi(): Mogi {
  return {
    id: "short",
    name: "Mogi Tier F",
    format: "2v2",
    createdAt: "2026-11-01",
    races: [],
    teams: data.room.teams,
    participants: data.room.participants.map((person: { loungeName: string }) => ({
      ...person,
      ign: person.loungeName,
      ignOrigin: "fallback",
    })),
  };
}

/** Uploads one screenshot at a time and answers as the maintainer would: the true race, the totals as read. */
async function uploadOneByOne(from: number): Promise<{ mogi: Mogi; asked: MogiQuestion[] }> {
  let mogi = emptyMogi();
  const asked: MogiQuestion[] = [];
  for (const reading of readings.slice(from - 1)) {
    mogi = await ingestReadings(mogi, [structuredClone(reading)]);
    mogi = await answerAll(mogi, asked);
  }
  return { mogi, asked };
}

async function answerAll(mogi: Mogi, asked: MogiQuestion[]): Promise<Mogi> {
  for (let step = 0; ; step++) {
    assert.ok(step < 20, "The queue didn't finish");
    const question = mogiQuestions(mogi)[0];
    if (!question) return mogi;
    asked.push(question);
    let answer: MogiQuestionAnswer;
    if (question.kind === "race") answer = { kind: "race", value: raceOf(question.captureId) };
    else if (question.kind === "points") answer = { kind: "points", value: question.suggestion! };
    else assert.fail(`Unexpected question: ${JSON.stringify(question).slice(0, 200)}`);
    mogi = (
      await normalizeReconstructions({ version: 1, mogis: [await answerMogiQuestion(mogi, question.id, answer)] })
    ).mogis[0];
  }
}

test("a short room starts at race 1 and asks only the reopened room’s race number", async () => {
  const { mogi, asked } = await uploadOneByOne(1);
  assert.deepEqual(
    asked.map((question) => question.kind),
    ["race"],
  );
  assert.equal(asked[0].captureId, readings[8].id);
  assert.equal(asked[0].reading, "Which race is this?");
  assert.equal(mogi.races.find((race) => race.number === 9)?.status, "pending");
  assert.equal(resultCoverage(mogi).final, false);
  assert.deepEqual(
    countedRaces(mogi).map((race) => race.number),
    races,
  );
});

test("confirmed totals that fit no sum are asked once, then the race number places the rest", async () => {
  const { mogi, asked } = await uploadOneByOne(3);
  const points = asked.filter((question) => question.kind === "points").map((question) => question.id);
  assert.equal(new Set(points).size, points.length, "No total is asked twice");
  assert.deepEqual(
    asked.filter((question) => question.kind === "race").map((question) => question.captureId),
    [readings[2].id, readings[8].id],
  );
  assert.deepEqual(
    countedRaces(mogi).map((race) => race.number),
    races.slice(2),
  );
});

test("all captures of a short room suggest the reopening that ends at race 12", async () => {
  const asked: MogiQuestion[] = [];
  const mogi = await answerAll(await ingestReadings(emptyMogi(), structuredClone(readings)), asked);
  assert.deepEqual(
    asked.map((question) => question.kind),
    ["race"],
  );
  const question = asked[0];
  assert.equal(question.captureId, readings[8].id);
  assert.equal(question.reading, "Which race is this?");
  assert.equal(question.kind === "race" && question.suggestion, 10);
  assert.deepEqual(question.kind === "race" && question.options.map((option) => option.value), [10, 9]);
  assert.deepEqual(
    countedRaces(mogi).map((race) => race.number),
    races,
  );
});

test("a lower answered number places a totals drop before the previous room without reopening", async () => {
  const asked: MogiQuestion[] = [];
  let mogi = await answerAll(await ingestReadings(emptyMogi(), [structuredClone(readings[2])]), asked);
  const earlier = structuredClone(readings[8]);
  earlier.photoMoment!.at = readings[2].photoMoment!.at + 1;
  const offset = asked.length;
  mogi = await ingestReadings(mogi, [earlier]);
  const question = mogiQuestions(mogi)[0];
  assert.equal(question.kind, "race");
  asked.push(question);
  mogi = (
    await normalizeReconstructions({
      version: 1,
      mogis: [await answerMogiQuestion(mogi, question.id, { kind: "race", value: 1 })],
    })
  ).mogis[0];
  assert.deepEqual(
    asked.slice(offset).map((question) => question.kind),
    ["race"],
  );
  assert.equal(asked[offset].reading, "Which race is this?");
  assert.deepEqual(
    countedRaces(mogi).map((race) => race.number),
    [1, 3],
  );
  assert.ok(mogi.sequence?.roomAnalysis?.sessions.every((session) => !session.reopening));
  assert.equal(mogi.sequence?.conflict, undefined);
});

/** The batch with photo times that order nothing: one shared value, or none at all. */
function timeless(shared: boolean): Capture[] {
  return structuredClone(readings).map((reading) => {
    if (shared) reading.photoMoment = { at: readings[0].photoMoment!.at, source: "file-date" };
    else delete reading.photoMoment;
    return reading;
  });
}

test("equal photo times behave like unknown ones: totals order the batch and only the reopening is asked", async () => {
  for (const shared of [true, false]) {
    const asked: MogiQuestion[] = [];
    const mogi = await answerAll(await ingestReadings(emptyMogi(), timeless(shared)), asked);
    assert.deepEqual(
      asked.map((question) => [question.kind, question.captureId]),
      [["race", readings[8].id]],
    );
    assert.equal(asked[0].kind === "race" && asked[0].suggestion, 10);
    assert.deepEqual(
      countedRaces(mogi).map((race) => race.number),
      races,
    );
  }
});

test("an answered race number never withdraws races that their totals prove", async () => {
  for (const shared of [true, false]) {
    let mogi = await ingestReadings(emptyMogi(), timeless(shared));
    mogi = applySequenceAnswer(
      mogi,
      { kind: "number", captureId: readings[8].id, value: 10 },
      sequenceInputSignature(mogi),
    );
    mogi = (await normalizeReconstructions({ version: 1, mogis: [mogi] })).mogis[0];
    assert.deepEqual(mogiQuestions(mogi), []);
    assert.deepEqual(
      countedRaces(mogi).map((race) => race.number),
      races,
    );
  }
});
