import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { answerMogiQuestion, mogiQuestions, normalizeReconstructions } from "@mkw/engine";

import type { Capture, Mogi } from "../../../apps/web/lib/mogi/types.ts";
import { questionsWithOverviewInvariant } from "./support/question-invariant.ts";
import { ingestReadings } from "./support/real-captures.ts";

// Real FFA of 2026-11-15 as the app read its 11 screenshots, c01 race 1 and c02–c11 races 3–12 in photo order:
// the race-2 screenshot was cut off by the Switch, so race 2 has none. c01 reads its zero totals partly blank.
// c02's totals are those after race 2. `typedRace2` is what the user entered by hand: Nabbit xy (9th) left out.
const data = JSON.parse(readFileSync(new URL("./fixtures/ffa-2026-11-15.json", import.meta.url), "utf8")) as {
  roster: { id: string; loungeName: string; ign: string }[];
  captures: Capture[];
  typedRace2: { placements: string[]; absentParticipantIds: string[] };
};
const race2 = [
  "Spike",
  "Capt Toad",
  "Wing5Koopa",
  "Mr482kart",
  "ShyGuyGamer",
  "Morton",
  "Birdo1t0",
  "Tavo",
  "Nabbit xy",
  "DryBowser",
  "Rosa",
  "SH0YY",
];
const ingest = () =>
  ingestReadings(
    {
      id: "ffa-2026-11-15",
      name: "FFA",
      format: "FFA",
      createdAt: "2026-11-15",
      races: [],
      participants: data.roster.map((person) => ({ ...person, ignOrigin: "learned" })),
    },
    structuredClone(data.captures),
  );
const normalize = async (mogi: Mogi) => (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
const names = (mogi: Mogi, ids: string[] = []) =>
  ids.map((id) => mogi.participants.find((person) => person.id === id)!.loungeName);
const raceTwo = (mogi: Mogi) => mogi.races.find((race) => race.number === 2);
const asked = (mogi: Mogi) => questionsWithOverviewInvariant(mogi).map((question) => [question.kind, question.number]);

test("a race with no screenshot is read from the race-1 screen and the totals after it (raceTwoFromNeighbours)", async () => {
  const mogi = await ingest();
  const race = raceTwo(mogi);
  assert.equal(race?.origin, "reconstructed");
  assert.deepEqual(names(mogi, race.placements), race2);
  assert.deepEqual(race.absentParticipantIds ?? [], []);
  // Questions about other screenshots stay as they were; race 2 asks nothing.
  assert.ok(asked(mogi).every(([, number]) => number !== 2));
});

test("a race entered by hand that its neighbours' totals contradict asks once, and changes only with the answer (result.typed-contradicted)", async () => {
  const read = await ingest();
  const typed = await normalize({
    ...read,
    races: read.races.map((race) =>
      race.number === 2 ? { id: race.id, number: 2, origin: "manual", status: "confirmed", ...data.typedRace2 } : race,
    ),
  });
  const questions = mogiQuestions(typed).filter((question) => question.number === 2);
  assert.equal(questions.length, 1);
  const question = questions[0];
  assert.ok(question.kind === "sequence");
  assert.equal(question.suggestion, "totals");
  assert.equal(question.options[0].description, race2.map((name, index) => `${index + 1}\u00a0${name}`).join(", "));
  // Until the answer, the entered result counts as entered.
  assert.equal(raceTwo(typed)?.origin, "manual");
  assert.deepEqual(raceTwo(typed)?.placements, data.typedRace2.placements);

  const fixed = await normalize(await answerMogiQuestion(typed, question.id, { kind: "sequence", value: "totals" }));
  assert.deepEqual(names(fixed, raceTwo(fixed)?.placements), race2);
  assert.deepEqual(raceTwo(fixed)?.absentParticipantIds, []);
  assert.ok(asked(fixed).every(([, number]) => number !== 2));

  const kept = await normalize(await answerMogiQuestion(typed, question.id, { kind: "sequence", value: "typed" }));
  assert.deepEqual(raceTwo(kept)?.placements, data.typedRace2.placements);
  assert.ok(asked(kept).every(([, number]) => number !== 2));
});
