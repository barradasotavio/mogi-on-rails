import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  answerMogiQuestion,
  countedRaces,
  mogiQuestions,
  normalizeReconstructions,
  reconcileSequence,
} from "@mkw/engine";

import { ingestReadings } from "../../../../packages/engine/tests/support/real-captures.ts";
import type { Capture, Mogi } from "../mogi/types.ts";
import { validateTracker } from "./validation.ts";

// The FFA of 2026-11-14 (see packages/engine/tests/chained-totals.test.ts), c01–c12 the result screens of races 1–12.
const data = JSON.parse(
  readFileSync(new URL("../../../../packages/engine/tests/fixtures/ffa-2026-11-14.json", import.meta.url), "utf8"),
) as { roster: { id: string; loungeName: string; ign: string }[]; captures: Capture[] };
const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `c${String(from + index).padStart(2, "0")}`);
const numbered = (mogi: Mogi) => countedRaces(mogi).map((race) => [race.number, race.captureIds?.[0]]);

/** A race awaiting review never stays confirmed, and one that waits for review keeps a question. */
function settledOrAsking(mogi: Mogi) {
  const questions = mogiQuestions(mogi);
  for (const race of mogi.races)
    if (race.status === "confirmed") assert.equal(race.participationReview, undefined, `Race ${race.number}`);
  if (mogi.races.some((race) => race.status === "pending" && race.participationReview))
    assert.ok(questions.length > 0, "A race awaiting review asks");
  return questions;
}

test("a saved mogi with races confirmed under review loads exportable, and asks the contradicted numbers again (number.contradicted)", async () => {
  // As the app saved it on 2026-11-14: the race-9 screen answered as 8 and the race-8 screen as 10, from bad
  // suggestions. The conflict kept races 8 and 9 confirmed with the review, which the backup rejects.
  const fresh = await ingestReadings(
    {
      id: "ffa-2026-11-14",
      name: "FFA",
      format: "FFA",
      createdAt: "2026-11-14",
      races: [],
      participants: data.roster.map((person) => ({ ...person, ignOrigin: "learned" })),
    },
    structuredClone(data.captures),
  );
  const facts = (
    [
      ["c01", 1],
      ["c02", 2],
      ["c09", 8],
      ["c08", 10],
    ] as const
  ).map(([captureId, number]) => ({
    captureId,
    number,
    phase: "after" as const,
  }));
  const conflicted = reconcileSequence({ ...fresh, sequence: { ...fresh.sequence!, numbers: facts } });
  assert.ok(conflicted.sequence?.conflict);
  const saved: Mogi = {
    ...conflicted,
    captures: conflicted.captures!.map((capture) => ({ ...capture, original: null })),
    races: conflicted.races.map((race) =>
      race.number === 8 || race.number === 9
        ? {
            ...fresh.races.find((entry) => entry.number === race.number)!,
            participationReview: race.participationReview,
          }
        : race,
    ),
  };
  const state = { version: 1 as const, mogis: [saved], activeMogiId: saved.id };
  assert.throws(() => validateTracker(state), /A result awaiting review was marked as confirmed/);

  let mogi = (await normalizeReconstructions(state, { revalidateBoundaryProofs: true })).mogis[0];
  validateTracker({ ...state, mogis: [mogi] }); // The check createBackup runs first.
  const asked = settledOrAsking(mogi).filter((question) => question.kind === "race");
  assert.deepEqual(
    asked.map((question) => [question.captureId, question.suggestion]),
    [
      ["c08", 8],
      ["c09", 9],
    ],
  );
  for (const question of asked)
    mogi = (
      await normalizeReconstructions({
        mogis: [await answerMogiQuestion(mogi, question.id, { kind: "race", value: question.suggestion! })],
      })
    ).mogis[0];
  assert.deepEqual(settledOrAsking(mogi), []);
  assert.deepEqual(
    numbered(mogi),
    ids(1, 12).map((id, index) => [index + 1, id]),
  );
});
