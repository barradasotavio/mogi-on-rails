import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  answerMogiQuestion,
  countedRaces,
  individualStandings,
  mogiQuestions,
  normalizeReconstructions,
} from "@mkw/engine";

import type { Capture, Mogi } from "../../../apps/web/lib/mogi/types.ts";
import { questionsWithOverviewInvariant } from "./support/question-invariant.ts";
import { ingestReadings } from "./support/real-captures.ts";

// Real FFA of 2026-11-14 as the app read its 13 screenshots, c01–c12 the result screens of races 1–12 in photo order,
// c13 a final ranking read as blank. Cheepcheep finished 3rd in race 1, missed race 2 (11 players) and rejoined race 3
// at 0; goombie left after race 7 (11 players from race 8). So no screen's totals sum to 82 per race. The race-1
// screen reads its zero totals mostly as blank; on c11 PeteyP reads 377 for 37 and kamek-obli L75, on c10 Wiggy77 .27.
const data = JSON.parse(readFileSync(new URL("./fixtures/ffa-2026-11-14.json", import.meta.url), "utf8")) as {
  roster: { id: string; loungeName: string; ign: string }[];
  captures: Capture[];
};
const emptyMogi = (): Mogi => ({
  id: "ffa-2026-11-14",
  name: "FFA",
  format: "FFA",
  createdAt: "2026-11-14",
  races: [],
  participants: data.roster.map((person) => ({ ...person, ignOrigin: "learned" })),
});
const ingest = (ids: string[]) =>
  ingestReadings(emptyMogi(), structuredClone(data.captures.filter((capture) => ids.includes(capture.id))));
const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `c${String(from + index).padStart(2, "0")}`);
const numbered = (mogi: Mogi) =>
  countedRaces(mogi).map((race) => [race.number, race.captureIds?.[0]] as [number | undefined, string | undefined]);

test("screens chained by totals number every race with no question (points.race1-permutation)", async () => {
  // The race-1 screen's points equal the race-2 screen's totals, so its blank totals were 0: it is race 1.
  const mogi = await ingest(ids(1, 13));
  assert.deepEqual(settledOrAsking(mogi), []);
  assert.deepEqual(
    numbered(mogi),
    ids(1, 12).map((id, index) => [index + 1, id]),
  );
  assert.deepEqual(Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])), {
    kamek_oblivio: 110,
    Megabomb: 108,
    Buzz: 104,
    Tavo: 99,
    Cheepcheep: 95,
    lakitu71212: 82,
    DinoRexy: 81,
    KmBB91: 79,
    Sharkbomb: 70,
    PeteyP: 56,
    goombie: 50,
    Wiggy77: 50,
  });
});

test("a chained room numbers itself when its totals and the 12-race ceiling leave one start (raceNumberByCeiling)", async () => {
  // Races 5–12: the race-5 totals need at least five races, and race 12 is the last one.
  const mogi = await ingest(ids(5, 12));
  assert.deepEqual(settledOrAsking(mogi), []);
  assert.deepEqual(
    numbered(mogi),
    ids(5, 12).map((id, index) => [index + 5, id]),
  );
});

test("one answered race numbers every screen chained to it, before it too (gaplessRoom)", async () => {
  // Races 5–10 leave more than one start; answering the last screen places the five before it.
  let mogi = await ingest(ids(5, 10));
  const question = mogiQuestions(mogi).find((entry) => entry.kind === "race" && entry.captureId === "c10");
  assert.ok(question, "The race-10 screen asks which race it is");
  mogi = (
    await normalizeReconstructions({
      mogis: [await answerMogiQuestion(mogi, question.id, { kind: "race", value: 10 })],
    })
  ).mogis[0];
  assert.deepEqual(settledOrAsking(mogi), []);
  assert.deepEqual(
    numbered(mogi),
    ids(5, 10).map((id, index) => [index + 5, id]),
  );
});

/** Every race the engine outputs is either counted or still asks something: a race awaiting review never stays
 * confirmed, and one that waits for review keeps a question. Unseen races stay pending with none. */
function settledOrAsking(mogi: Mogi) {
  const questions = questionsWithOverviewInvariant(mogi);
  for (const race of mogi.races) {
    if (race.status === "confirmed") assert.equal(race.participationReview, undefined, `Race ${race.number}`);
  }
  if (mogi.races.some((race) => race.status === "pending" && race.participationReview))
    assert.ok(questions.length > 0, "A race awaiting review asks");
  return questions;
}
