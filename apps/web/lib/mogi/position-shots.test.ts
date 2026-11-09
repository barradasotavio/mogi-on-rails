import assert from "node:assert/strict";
import test from "node:test";

import type { PositionQuestion } from "@mkw/engine";

import { positionShots } from "./position-shots.ts";
import type { Mogi } from "./types.ts";

const people = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
const capture = (id: string, raceId: string, phase: "before" | "after", order: (string | null)[]) => ({
  id,
  context: { phase, raceId },
  rows: [],
  nameAssociations: order.map((participantId) => ({ participantId })),
});
const mogi = (captures: ReturnType<typeof capture>[]) =>
  ({
    races: [1, 2, 3, 4].map((number) => ({
      id: `race-${number}`,
      number,
      origin: "observed",
      status: "pending",
      placements: [],
      captureIds: captures.filter((c) => c.context.raceId === `race-${number}`).map((c) => c.id),
    })),
    captures,
  }) as unknown as Mogi;
const question = { kind: "position", raceId: "race-2", number: 2, participantId: "p3" } as PositionQuestion;
const shots = (state: Mogi) =>
  positionShots(state, question).map((shot) => [shot.capture.id, shot.label, shot.row] as const);

test("a position question shows the totals before and after its race, in order, with the person's row", () => {
  const unlinked = [null, ...people.slice(1)].map((id) => (id === "p3" ? null : id));
  const state = mogi([
    capture("results-1", "race-1", "after", people),
    capture("lobby-3", "race-3", "before", [...people].reverse()),
    capture("lobby-2", "race-2", "before", unlinked),
    capture("lobby-4", "race-4", "before", people),
  ]);
  assert.deepEqual(shots(state), [
    ["lobby-2", "Race 2 · before the race", undefined],
    ["lobby-3", "Race 3 · before the race", 10],
  ]);
});

test("a position question whose race has a results screen shows that screen", () => {
  const state = mogi([
    capture("lobby-2", "race-2", "before", people),
    capture("results-2", "race-2", "after", people),
    capture("lobby-3", "race-3", "before", people),
  ]);
  assert.deepEqual(shots(state), [["results-2", "Race 2 · after the race", 3]]);
});
