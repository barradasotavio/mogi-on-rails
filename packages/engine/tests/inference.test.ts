import assert from "node:assert/strict";
import test from "node:test";

import { type Mogi, orderingInputSignature, type Race, reconstructOne } from "@mkw/engine";

const scale = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const post = [31, 26, 23, 22, 21, 20, 19, 18, 17, 16, 16, 17];
const people = Array.from({ length: 12 }, (_, n) => ({
  id: `p${n + 1}`,
  loungeName: `Player ${n + 1}`,
  ign: `P${n + 1}`,
}));
export function inferenceMogi(anchorCount = 12): Mogi {
  const source = (id: string, number: number, values: number[]): Race => ({
    id,
    number,
    origin: "manual",
    placements: people.map((p) => p.id),
    gameEvidence: {
      stage: "post-race",
      session: "room",
      verified: true,
      readings: Object.fromEntries(
        people.slice(0, anchorCount).map((p, n) => [
          p.id,
          {
            segment: "room",
            useAsAnchor: true,
            current: { value: scale[n], origin: "manual" },
            cumulative: { value: values[n], origin: "manual" },
          },
        ]),
      ),
    },
  });
  const state: Mogi = {
    id: "m",
    name: "Inference",
    createdAt: "2026-10-27",
    format: "FFA",
    participants: people,
    races: [
      source("older", 1, scale),
      { id: "missing", number: 2, status: "pending", origin: "manual", placements: [] },
      source("newer", 3, post),
    ],
  };
  state.orderReview = {
    raceIds: ["older", "missing", "newer"],
    basis: "manual",
    acceptedAt: "2026-10-27",
    gaps: [],
    unresolvedRaceIds: [],
    inputSignature: orderingInputSignature(state),
  };
  return state;
}
test("one missing race is reconstructed only as the complete unique native result with source anchors", async () => {
  const state = inferenceMogi();
  const result = await reconstructOne(state, state.races[1]);
  assert.equal(result.status, "unique");
  assert.deepEqual(result.placements, ["p12", "p11", "p10", "p9", "p8", "p7", "p6", "p5", "p4", "p3", "p2", "p1"]);
  assert.equal(result.anchors[0].gain, 1);
  assert.equal(result.fromRaceId, "older");
  assert.equal(result.toRaceId, "newer");
  assert.equal(state.races[1].placements.length, 0);
});

test("accepted application facts select correction, origin and continuity questions and reject stale answers", async () => {
  const { analyzeCaptures, applySequenceAnswer, sequenceInputSignature, reconcileSequence } =
    await import("@mkw/engine");
  const state = inferenceMogi();
  const capture = {
    id: "source",
    width: 1920,
    height: 1080,
    rows: people.map((p) => ({ text: p.ign, confidence: 100, suggestedParticipantId: p.id, uncertain: false })),
    nameAssociations: people.map((p) => ({ participantId: p.id })),
    stage: "context" as const,
    reviewedAt: "2026-10-27",
    reviewedPlacements: [],
    context: { phase: "after" as const },
    interpretation: {
      version: 1 as const,
      screen: "finalStandings" as const,
      origin: "visual" as const,
      positions: [],
      movementRows: [],
      reasons: [],
    },
  };
  state.captures = [capture];
  const current = reconcileSequence(state);
  const questions = analyzeCaptures(current).questions!;
  assert.ok(questions.some((q) => q.kind === "origin" && q.captureId === "source" && q.mode === "pending"));
  const signature = sequenceInputSignature(current);
  const numbered = applySequenceAnswer(current, { kind: "number", captureId: "source", value: 7 }, signature);
  assert.equal(numbered.sequence?.numbers[0].number, 7);
  assert.throws(
    () => applySequenceAnswer(numbered, { kind: "number", captureId: "source", value: 8 }, signature),
    /changed/,
  );
  assert.throws(
    () =>
      applySequenceAnswer(
        numbered,
        { kind: "number", captureId: "source", value: 100 },
        sequenceInputSignature(numbered),
      ),
    /number/,
  );
  const answered = applySequenceAnswer(current, { kind: "origin", captureId: "source", value: "unknown" }, signature);
  assert.equal(answered.sequence?.origins?.[0].answer, "unknown");
});

test("reconstructed results retain their proof and are revoked when source evidence changes", async () => {
  const { applyReconstruction, normalizeReconstructions } = await import("@mkw/engine");
  let state = inferenceMogi();
  const proof = await reconstructOne(state, state.races[1]);
  state = applyReconstruction(state, state.races[1], proof);
  assert.equal(state.races[1].reconstruction?.status, "unique");
  assert.equal(state.races[1].reconstruction?.anchors[0].gain, 1);
  state.races[2].gameEvidence!.readings.p1.cumulative!.value = 32;
  const normalized = await normalizeReconstructions({ mogis: [state], sentinel: "retained" });
  assert.equal(normalized.sentinel, "retained");
  assert.equal(normalized.mogis[0].races[1].status, "pending");
  assert.equal(normalized.mogis[0].races[1].reconstruction?.status, "stale");
  assert.ok(normalized.mogis[0].races[1].reconstructionHistory?.some((proof) => proof.status === "unique"));
});

test("insufficient, ambiguous, conflicting and interrupted searches remain distinct and never confirm the first example", async () => {
  const {
    solveAssistance,
    assistanceTargets,
    setAssistanceAnalysis,
    changePositionFact,
    analyzeCaptures,
    skipQuestion,
  } = await import("@mkw/engine");
  const insufficient = inferenceMogi(1);
  assert.equal((await reconstructOne(insufficient, insufficient.races[1])).status, "insufficient");
  const ambiguous = inferenceMogi(2);
  const found = await solveAssistance(ambiguous, assistanceTargets(ambiguous), []);
  assert.equal(found.status, "ambiguous");
  assert.ok(found.hypotheses.length >= 2);
  const pending = setAssistanceAnalysis(ambiguous, found);
  assert.equal(pending.races[1].placements.length, 0);
  const question = analyzeCaptures(pending).questions?.find((q) => q.kind === "position");
  assert.equal(question?.raceId, "missing");
  assert.ok(question?.participantId);
  assert.equal(question?.signature, found.inputSignature);
  assert.notEqual(question?.participantId, "p1");
  assert.notEqual(question?.participantId, "p2");
  const skipped = skipQuestion(pending, question!.key!);
  assert.notEqual(analyzeCaptures(skipped).questions?.find((q) => q.kind === "position")?.key, question?.key);
  const conflicting = changePositionFact(inferenceMogi(), { raceId: "missing", participantId: "p1", position: 1 });
  const conflict = await solveAssistance(conflicting, assistanceTargets(conflicting), conflicting.assistance!.facts);
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.complete, true);
  const interrupted = await solveAssistance(ambiguous, assistanceTargets(ambiguous), [], () => true);
  assert.equal(interrupted.status, "incomplete");
  assert.equal(interrupted.complete, false);
  assert.equal(interrupted.stats.cancelled, true);
  assert.equal(setAssistanceAnalysis(ambiguous, interrupted).races[1].placements.length, 0);
});

test("questions retain scoped per-person reset, count and validity decisions instead of treating them as positional facts", async () => {
  const { analyzeCaptures, applySequenceAnswer, sequenceInputSignature } = await import("@mkw/engine");
  const state = inferenceMogi();
  const source = (id: string) => ({
    id,
    width: 1920,
    height: 1080,
    rows: people.map((p) => ({ text: p.ign, confidence: 100, suggestedParticipantId: p.id, uncertain: false })),
    nameAssociations: people.map((p) => ({ participantId: p.id })),
    stage: "context" as const,
    reviewedAt: "2026-10-27",
    reviewedPlacements: [],
    context: { phase: "before" as const },
    interpretation: {
      version: 1 as const,
      screen: "twoColumns" as const,
      origin: "visual" as const,
      positions: [],
      movementRows: [],
      reasons: [],
    },
  });
  state.captures = [source("a"), source("b")];
  state.sequence = {
    version: 1,
    inputSignature: "reviewed",
    numbers: [],
    links: [],
    occurrences: [],
    relations: [
      {
        fromCaptureId: "a",
        toCaptureId: "b",
        completedSteps: 2,
        stableParticipantIds: ["p2"],
        resetParticipantIds: [],
        unknownParticipantIds: ["p1"],
      },
    ],
    gaps: [{ id: "gap", fromId: "first", toId: "next", sourceCaptureIds: ["a", "b"], order: "unknown" }],
  };
  let questions = analyzeCaptures(state).questions!;
  const person = questions.find((q) => q.kind === "person-continuity")!;
  assert.equal(person.participantId, "p1");
  assert.deepEqual(person.captureIds, ["a", "b"]);
  assert.deepEqual(person.options, ["reset", "unknown"]);
  assert.ok(
    questions.some((q) => q.kind === "continuity" && q.gapId === "gap"),
    "Zero comparable totals leave continuity unknown",
  );
  assert.equal(
    questions.some((q) => q.kind === "validity"),
    false,
  );
  const answered = applySequenceAnswer(
    state,
    { kind: "person-continuity", fromCaptureId: "a", toCaptureId: "b", participantId: "p1", value: "reset" },
    sequenceInputSignature(state),
  );
  assert.equal(answered.sequence?.links[0].people?.[0].answer, "reset");
  state.captures.forEach((capture, index) => {
    const reading = {
      text: String(10 + index),
      value: 10 + index,
      confidence: 100,
      uncertain: false,
      location: { x: 0, y: 0, width: 1, height: 1 },
    };
    capture.numericRows = people.map((_, row) => ({
      row: row + 1,
      right: row === 0 ? reading : { ...reading, text: "", value: null, uncertain: true },
      addition: { ...reading, text: "", value: null, uncertain: true },
    }));
  });
  assert.equal(
    analyzeCaptures(state).questions?.some((q) => q.kind === "continuity"),
    false,
    "One increasing shared total proves continuity despite unreadable others",
  );
  state.sequence.gaps[0].count = 1;
  questions = analyzeCaptures(state).questions!;
  assert.equal(
    questions.some((q) => q.kind === "continuity"),
    false,
  );
  assert.ok(questions.some((q) => q.kind === "validity" && q.gapId === "gap"));
  state.sequence.gaps[0].validCount = 1;
  assert.equal(
    analyzeCaptures(state).questions?.some((q) => q.kind === "validity"),
    false,
  );
});
