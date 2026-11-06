import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  answerMogiQuestion,
  countedRaces,
  type MogiQuestion,
  type MogiQuestionAnswer,
  mogiQuestions,
  normalizeReconstructions,
  resultCoverage,
} from "@mkw/engine";

import type { Capture, Mogi } from "../../../apps/web/lib/mogi/types.ts";
import { ingestReadings } from "./support/real-captures.ts";

// Real 3v3 mogi of 2026-11-01, as the app read its 16 screenshots: three pre-race screens (one with
// 11 names), a game communication error, and twelve result screens. The room reopened before race 10, whose totals
// (all zeros) read as blank.
const data = JSON.parse(readFileSync(new URL("./fixtures/reopened-3v3.json", import.meta.url), "utf8"));
const readings: Capture[] = data.readings;
const results = readings.filter((reading) => reading.interpretation?.screen === "finishOrderAdding");
// Race of each screen; a pre-race screen belongs to the race that follows it.
const raceByTime = ["150507", "150741", "150850", "151144", "151251", "151543", "151941", "152307", "152705"]
  .concat(["153026", "153313", "153709", "154616", "155005", "155428"])
  .map((stamp) => readings.find((reading) => reading.fileName.slice(8, 14) === stamp)!.id);
const races = [1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const raceOf = (id: string) => races[raceByTime.indexOf(id)];
const lounge: Record<string, string> = {
  "Triple T": "pom",
  "TchomEl.i.": "ChainChomp",
  Saucisse: "lumayy",
  "Sloth <3": "boo loves",
};

function emptyMogi(): Mogi {
  return {
    id: "reopened",
    name: "Mogi Tier F",
    format: "3v3",
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

/** Answers every question as the maintainer would; returns the races each continuity question compared. */
async function answerAll(mogi: Mogi, asked: MogiQuestion[]): Promise<Mogi> {
  for (let step = 0; step < 30; step++) {
    const question = mogiQuestions(mogi)[0];
    if (!question) return mogi;
    asked.push(question);
    let answer: MogiQuestionAnswer;
    if (question.kind === "name")
      answer = {
        kind: "name",
        answer: {
          participantId: mogi.participants.find((person) => person.loungeName === lounge[question.reading])!.id,
        },
      };
    else if (question.kind === "race") {
      assert.equal(question.suggestion, raceOf(question.captureId), "Suggested race");
      answer = { kind: "race", value: raceOf(question.captureId) };
    } else if (question.kind === "sequence" && question.captureIds) {
      const [from, to] = question.captureIds.map(raceOf).sort((a, b) => a - b);
      answer = { kind: "sequence", value: from < 10 && to >= 10 ? "reset" : "continuous-12" };
    } else assert.fail(`Unexpected question: ${JSON.stringify(question).slice(0, 200)}`);
    mogi = (
      await normalizeReconstructions({ version: 1, mogis: [await answerMogiQuestion(mogi, question.id, answer)] })
    ).mogis[0];
  }
  assert.fail("The queue didn't finish");
}
const compared = (asked: MogiQuestion[]) =>
  asked.flatMap((question) =>
    question.kind === "sequence" && question.captureIds ? [question.captureIds.map(raceOf).sort((a, b) => a - b)] : [],
  );
const allRaces = Array.from({ length: 12 }, (_, n) => n + 1);

test("a reopened room asks about adjacent screenshots and counts every race after it", async () => {
  let mogi = emptyMogi();
  const asked: MogiQuestion[] = [];
  for (const reading of results) mogi = await answerAll(await ingestReadings(mogi, [structuredClone(reading)]), asked);
  // Each continuity question shows the last settled screenshot beside the new one.
  assert.deepEqual(compared(asked), [
    [9, 10],
    [10, 11],
  ]);
  assert.deepEqual(
    countedRaces(mogi).map((race) => race.number),
    allRaces,
  );
  assert.ok(resultCoverage(mogi).final, "The result is final, so !submit is available");
});

test("all screenshots of a reopened room at once leave the error screen out and count every race", async () => {
  const asked: MogiQuestion[] = [];
  // Readings arrive in the order they finish, not in photo order.
  const arrival = [3, 2, 9, 7, 13, 0, 15, 11, 14, 5, 1, 12, 6, 10, 8, 4].map((index) => readings[index]);
  const mogi = await answerAll(await ingestReadings(emptyMogi(), structuredClone(arrival)), asked);
  assert.deepEqual(compared(asked), [
    [9, 10],
    [10, 11],
  ]);
  const error = readings.find((reading) => reading.interpretation?.screen === "unknown")!;
  assert.ok(!asked.some((question) => "captureId" in question && question.captureId === error.id));
  assert.deepEqual(
    countedRaces(mogi).map((race) => race.number),
    allRaces,
  );
  assert.ok(resultCoverage(mogi).final, "The result is final, so !submit is available");
});
