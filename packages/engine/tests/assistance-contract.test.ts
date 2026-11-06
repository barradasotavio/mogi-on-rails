import assert from "node:assert/strict";
import test from "node:test";

import {
  assistanceTargets,
  changePositionFact,
  confirmAssistance,
  individualStandings,
  resultCoverage,
  setAssistanceAnalysis,
  solveAssistance,
} from "@mkw/engine";

import { inferenceFixture, people, reviewOrder } from "./support/mogi.ts";

test("mixed native eleven and ten races preserve unordered absences and adjusted totals separately", async () => {
  let state = inferenceFixture(12, 4, [53, 43, 37, 33, 29, 25, 21, 17, 13, 9, 5, 2]);
  for (const [raceId, participantId] of [
    ["gap2", "p12"],
    ["gap3", "p12"],
    ["gap3", "p11"],
  ]) {
    state = changePositionFact(state, { raceId, participantId, position: "absent" });
  }
  const analysis = await solveAssistance(state, assistanceTargets(state), state.assistance!.facts);
  assert.equal(analysis.status, "unique");
  assert.equal(analysis.complete, true);
  const confirmed = setAssistanceAnalysis(state, analysis);
  assert.equal(confirmed.races[1].placements.length, 11);
  assert.deepEqual(confirmed.races[1].absentParticipantIds, ["p12"]);
  assert.equal(confirmed.races[2].placements.length, 10);
  assert.deepEqual([...(confirmed.races[2].absentParticipantIds ?? [])].sort(), ["p11", "p12"]);
  assert.equal(individualStandings(confirmed).find((person) => person.id === "p1")?.points, 60);
});

test("a discarded native race contributes known fifteen points to an ambiguous two-gap equation", async () => {
  let state = inferenceFixture(12, 5, [72, 63, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5]);
  state.races = state.races.map((race) => ({ ...race, physicalNumber: race.number }));
  state.races[2] = { ...state.races[2], status: "discarded", placements: people.map((person) => person.id) };
  state.races[3].number = 3;
  state.races[4].number = 4;
  state = reviewOrder(state);
  const ambiguous = await solveAssistance(state, assistanceTargets(state), []);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.complete, true);
  assert.equal(ambiguous.equations[0].gain, 27);
  assert.equal(ambiguous.equations[0].known, 15);
  assert.ok(ambiguous.knownRaces.some((race) => race.raceId === "gap3" && race.discarded));
  state = changePositionFact(state, { raceId: "gap2", participantId: "p1", position: 1 });
  const determined = await solveAssistance(state, assistanceTargets(state), state.assistance!.facts);
  assert.equal(determined.status, "unique");
  assert.deepEqual(resultCoverage(setAssistanceAnalysis(state, determined)).included, [1, 2, 3, 4]);
});

test("three numbered missing races can all be uniquely determined by a complete search", async () => {
  const state = inferenceFixture(12, 5, [75, 60, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5]);
  const analysis = await solveAssistance(state, assistanceTargets(state), []);
  assert.equal(analysis.status, "unique");
  assert.equal(analysis.complete, true);
  assert.equal(analysis.hypotheses.length, 1);
  const result = setAssistanceAnalysis(state, analysis);
  assert.equal(result.assistance?.confirmed?.kind, "unique");
  assert.deepEqual(resultCoverage(result).included, [1, 2, 3, 4, 5]);
});

test("an incomplete analysis cannot confirm even when the caller supplies a unique candidate", async () => {
  const state = inferenceFixture(12, 5, [75, 60, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5]);
  const complete = await solveAssistance(state, assistanceTargets(state), []);
  assert.equal(complete.status, "unique");
  const incomplete = { ...complete, complete: false };
  const pending = setAssistanceAnalysis(state, incomplete);
  assert.equal(pending.assistance?.confirmed, undefined);
  assert.deepEqual(resultCoverage(pending).pending, [2, 3, 4]);
  assert.equal(confirmAssistance(pending, complete.hypotheses[0], "unique"), pending);
});
