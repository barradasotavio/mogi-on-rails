import assert from "node:assert/strict";
import test from "node:test";

import type { AssistanceAnalysis } from "@mkw/engine";
import {
  applyReconstruction,
  normalizeReconstructions,
  reconstructOne,
  registerSubstitution,
  resultCoverage,
} from "@mkw/engine";

import { reconstructionSourceSignature } from "../src/domain/reconstruction/reconstruction-input.ts";
import { inferenceFixture, reviewOrder, scale12, source } from "./support/mogi.ts";

test("normalizing an already normalized reconstruction preserves the state and its mogi, race and list identities", async () => {
  const input = inferenceFixture();
  const reconstructed = applyReconstruction(input, input.races[1], await reconstructOne(input, input.races[1]));
  const state = await normalizeReconstructions({ mogis: [reconstructed] });
  const normalized = await normalizeReconstructions(state);
  assert.equal(normalized, state);
  assert.equal(normalized.mogis, state.mogis);
  assert.equal(normalized.mogis[0], state.mogis[0]);
  assert.equal(normalized.mogis[0].races, state.mogis[0].races);
  assert.equal(normalized.mogis[0].races[1], state.mogis[0].races[1]);
  assert.equal(normalized.mogis[0].races[1].placements, state.mogis[0].races[1].placements);
});

test("a proof saved with raw signatures stays current and keeps only digests", async () => {
  const input = inferenceFixture();
  const reconstructed = applyReconstruction(input, input.races[1], await reconstructOne(input, input.races[1]));
  const proof = reconstructed.races[1].reconstruction!;
  // Older versions stored the raw sources; with real captures each history entry reached ~20 MB.
  const raw = reconstructionSourceSignature(reconstructed, reconstructed.races[1]);
  const legacy = { ...proof, inputSignature: raw };
  const superseded = {
    ...legacy,
    status: "stale" as const,
    boundaryAnalysis: { equations: [{ boundaryChecks: [{ sourceCaptureIds: [], signature: raw }] }] },
  } as unknown as typeof proof & { boundaryAnalysis: AssistanceAnalysis };
  const stored = {
    ...reconstructed,
    races: reconstructed.races.map((race, index) =>
      index === 1 ? { ...race, reconstruction: legacy, reconstructionHistory: [superseded] } : race,
    ),
  };
  const race = (await normalizeReconstructions({ mogis: [stored] }, { revalidateBoundaryProofs: true })).mogis[0]
    .races[1];
  assert.equal(race.status, "confirmed");
  assert.deepEqual(race.placements, reconstructed.races[1].placements);
  assert.equal(race.reconstruction?.inputSignature, proof.inputSignature);
  assert.equal(race.reconstructionHistory?.length, 1);
  const [entry] = race.reconstructionHistory!;
  assert.equal(entry.inputSignature, proof.inputSignature);
  assert.equal(entry.boundaryAnalysis?.equations[0].boundaryChecks?.[0].signature.length, 64);
});

test("changing only a track preserves the other normalized mogis, physical races and derived lists", async () => {
  const input = inferenceFixture();
  input.races = input.races.map((race) => ({ ...race, physicalNumber: race.number }));
  const state = await normalizeReconstructions({
    mogis: [input, { ...inferenceFixture(), id: "other" }, { ...inferenceFixture(), id: "third" }],
  });
  const original = state.mogis[0];
  const changed = {
    ...original,
    races: original.races.map((race, i) => (i === 0 ? { ...race, track: "CC" as const } : race)),
  };
  const requested = { ...state, mogis: [changed, ...state.mogis.slice(1)] };
  const normalized = await normalizeReconstructions(requested, { previousState: state });
  assert.equal(normalized, requested);
  assert.equal(normalized.mogis[0], changed);
  assert.equal(normalized.mogis[1], state.mogis[1]);
  assert.equal(normalized.mogis[2], state.mogis[2]);
  assert.equal(normalized.mogis[0].races[0], changed.races[0]);
  assert.equal(normalized.mogis[0].races[1], original.races[1]);
  assert.equal(normalized.mogis[0].races[2], original.races[2]);
  assert.equal(normalized.mogis[0].races[0].placements, original.races[0].placements);
  assert.equal(normalized.mogis[0].participants, original.participants);
  assert.equal(normalized.mogis[0].orderReview, original.orderReview);
  assert.equal(await normalizeReconstructions(normalized), normalized);
});

test("two partial anchors do not invent the missing placements and a room reset cannot bridge the interval", async () => {
  let state = inferenceFixture(2);
  const ambiguous = await reconstructOne(state, state.races[1]);
  assert.notEqual(ambiguous.status, "unique");
  assert.deepEqual(ambiguous.placements, []);
  state.races[2].gameEvidence!.session = "returned-room";
  state = reviewOrder(state);
  const reset = await reconstructOne(state, state.races[1]);
  assert.equal(reset.status, "insufficient");
  assert.deepEqual(reset.anchors, []);
});

for (const example of [
  { represented: 11, totals: [42, 34, 29, 26, 23, 20, 17, 14, 11, 8, 5, 2], absent: ["p12"] },
  { represented: 10, totals: [41, 33, 28, 25, 22, 19, 16, 13, 10, 7, 4, 2], absent: ["p11", "p12"] },
]) {
  test(`a missing native ${example.represented}-person race has distinct absent identities without invented places`, async () => {
    const state = inferenceFixture(12, 3, example.totals);
    const result = await reconstructOne(state, state.races[1]);
    assert.equal(result.status, "unique");
    assert.equal(result.represented, example.represented);
    assert.equal(result.placements.length, example.represented);
    assert.deepEqual([...result.absentParticipantIds].sort(), example.absent);
    assert.equal(new Set([...result.placements, ...result.absentParticipantIds]).size, 12);
    assert.equal(result.placements[0], "p1");
  });
}

test("a known discarded native result is subtracted and a contradictory native value invalidates that proof", async () => {
  let state = inferenceFixture(12, 4, [46, 38, 33, 31, 29, 27, 25, 23, 21, 19, 18, 18]);
  state.races[1].physicalNumber = 2;
  state.races[2] = {
    ...source("discarded", 3, scale12),
    gameEvidence: undefined,
    physicalNumber: 3,
    status: "discarded",
  };
  state.races[0].physicalNumber = 1;
  state.races[3].physicalNumber = 4;
  state.races[3].number = 3;
  state = reviewOrder(state);
  const proof = await reconstructOne(state, state.races[1]);
  assert.equal(proof.status, "unique");
  assert.equal(proof.anchors[0].known, 15);
  assert.equal(proof.anchors[0].gain, 1);
  assert.ok(proof.knownRaces.some((race) => race.raceId === "discarded" && race.discarded && race.represented === 12));
  state.races[2].nativePoints = { p1: 14 };
  state = reviewOrder(state);
  assert.equal((await reconstructOne(state, state.races[1])).status, "conflict");
});

test("a large gain across two numbered gaps does not materialize one combined race", async () => {
  const state = inferenceFixture(12, 4);
  const proof = await reconstructOne(state, state.races[1]);
  assert.equal(proof.status, "insufficient");
  const result = applyReconstruction(state, state.races[1], proof);
  assert.deepEqual(
    result.races.filter((race) => race.status === "pending").map((race) => race.number),
    [2, 3],
  );
  assert.deepEqual(result.races[1].placements, []);
});

test("substitution withdraws the former identity proof and leaves its replacement and credit pending", async () => {
  let state = inferenceFixture();
  state = applyReconstruction(state, state.races[1], await reconstructOne(state, state.races[1]));
  state = registerSubstitution(state, { slotId: "p1", fromRace: 2, loungeName: "Reserve", ign: "ReserveKart" });
  const normalized = (await normalizeReconstructions({ mogis: [state] })).mogis[0];
  assert.deepEqual(resultCoverage(normalized).included, [1]);
  assert.deepEqual(resultCoverage(normalized).pending, [2, 3]);
  assert.equal(normalized.races[1].status, "pending");
  assert.ok(normalized.races[1].reconstructionHistory?.some((proof) => proof.status === "unique"));
});
