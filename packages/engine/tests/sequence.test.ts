import assert from "node:assert/strict";
import test from "node:test";

import { type Capture, type Mogi, reconcileSequence } from "@mkw/engine";

const participants = Array.from({ length: 12 }, (_, n) => ({
  id: `p${n + 1}`,
  loungeName: `Player ${n + 1}`,
  ign: `P${n + 1}`,
}));
const totals = [103, 52, 87, 94, 44, 85, 89, 97, 89, 96, 77, 72];
const reading = (value: number) => ({
  text: String(value),
  value,
  confidence: 100,
  uncertain: false,
  location: { x: 0, y: 0, width: 1, height: 1 },
});
function capture(id: string, screen: "finishOrderAdded" | "finalStandings", values = totals): Capture {
  return {
    id,
    width: 1920,
    height: 1080,
    rows: participants.map((p) => ({ text: p.ign, confidence: 100, suggestedParticipantId: p.id, uncertain: false })),
    stage: "context",
    reviewedAt: "2026-10-27",
    reviewedPlacements: [],
    context: { phase: screen === "finalStandings" ? "event-final" : "after" },
    nameAssociations: participants.map((p) => ({ participantId: p.id })),
    interpretation: { version: 1, screen, origin: "visual", positions: [], movementRows: [], reasons: [] },
    numericRows: values.map((value, n) => ({
      row: n + 1,
      right: reading(value),
      addition: { ...reading(0), value: null, uncertain: true },
    })),
  };
}
function mogi(captures: Capture[]): Mogi {
  return { id: "m", name: "Sequence", createdAt: "2026-10-27", format: "FFA", participants, races: [], captures };
}

test("complementary sources share an occurrence without inventing an absolute number or a result (complementarySourceGroups)", () => {
  const result = reconcileSequence(
    mogi([capture("final", "finalStandings"), capture("finishOrder", "finishOrderAdded")]),
  );
  assert.equal(result.sequence?.occurrences.length, 1);
  assert.deepEqual(new Set(result.sequence?.occurrences[0].captureIds), new Set(["final", "finishOrder"]));
  assert.equal(result.sequence?.occurrences[0].number, undefined);
  assert.equal(result.races.length, 0);
  assert.equal(result.sequence?.relations[0].completedSteps, 0);
});

test("unrelated captures preserve uncertain order regardless of selection order", () => {
  const before = capture("a", "finishOrderAdded"),
    after = capture(
      "b",
      "finalStandings",
      totals.map((v) => v + 100),
    );
  const first = reconcileSequence(mogi([after, before]));
  const second = reconcileSequence(mogi([before, after]));
  assert.equal(first.sequence?.occurrences.length, 2);
  assert.equal(second.sequence?.occurrences.length, 2);
  assert.equal(first.sequence?.gaps[0].order, "unknown");
  assert.equal(second.sequence?.gaps[0].order, "unknown");
  assert.equal(first.sequence?.gaps[0].count, undefined);
  assert.equal(first.races.length, 0);
});

test("per-person continuity orders captures independently of selection order without inventing a race number", () => {
  const initial = [50, 42, 35, 30, 27, 24, 21, 18, 15, 12, 9, 6];
  const gain = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const older = capture("z-older", "finishOrderAdded", initial);
  const newer = capture(
    "a-newer",
    "finalStandings",
    initial.map((value, index) => value + gain[index]),
  );
  for (const sources of [
    [older, newer],
    [newer, older],
  ]) {
    const result = reconcileSequence(mogi(sources));
    assert.deepEqual(
      result.sequence?.relations.map((relation) => [
        relation.fromCaptureId,
        relation.toCaptureId,
        relation.completedSteps,
      ]),
      [[older.id, newer.id, 1]],
    );
    assert.ok(result.sequence?.occurrences.every((occurrence) => occurrence.number === undefined));
    assert.deepEqual(result.races, []);
  }
});

test("known continuity and numbering expose a missing interval while unproved validity stays pending", async () => {
  const { sourcePairSignature, analyzeCaptures } = await import("@mkw/engine");
  const a = {
    ...capture("before", "finishOrderAdded"),
    interpretation: { ...capture("before", "finishOrderAdded").interpretation!, screen: "twoColumns" as const },
    context: { phase: "before" as const },
  };
  const b = {
    ...capture(
      "later",
      "finishOrderAdded",
      totals.map((v, n) => v + [30, 24, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2][n]),
    ),
    interpretation: { ...a.interpretation },
    context: { phase: "before" as const },
  };
  const state = mogi([b, a]);
  state.sequence = {
    version: 1,
    inputSignature: "initial",
    occurrences: [],
    relations: [],
    gaps: [],
    numbers: [{ captureId: a.id, phase: "before", number: 9 }],
    links: [
      { fromCaptureId: a.id, toCaptureId: b.id, signature: sourcePairSignature(a, b), continuity: "continuous-12" },
    ],
  };
  const result = reconcileSequence(state);
  assert.equal(result.sequence?.gaps[0].count, 1);
  assert.equal(result.sequence?.gaps[0].validCount, undefined);
  const analysis = analyzeCaptures(result);
  assert.equal(analysis.sequence?.accepted.gaps[0].order, "forward");
  assert.equal(analysis.sequence?.accepted.gaps[0].count, 1);
  assert.equal(analysis.sequence?.accepted, result.sequence);
  assert.deepEqual(result.sequence?.occurrences.map((o) => o.number).sort(), [9, undefined]);
});

test("two stable numeric anchors establish reverse order without permuting results; interrupted search stays incomplete", async () => {
  const { analyzeOrder } = await import("@mkw/engine");
  const state = mogi([]);
  const race = (id: string, number: number, a: number, b: number) => ({
    id,
    number,
    origin: "manual" as const,
    placements: participants.map((p) => p.id),
    gameEvidence: {
      stage: "post-race" as const,
      session: "known",
      verified: true,
      readings: {
        p1: {
          segment: "known",
          useAsAnchor: true,
          current: { value: 15, origin: "manual" as const },
          cumulative: { value: a, origin: "manual" as const },
        },
        p2: {
          segment: "known",
          useAsAnchor: true,
          current: { value: 12, origin: "manual" as const },
          cumulative: { value: b, origin: "manual" as const },
        },
      },
    },
  });
  state.races = [race("r1", 1, 30, 24), race("r2", 2, 15, 12)];
  const unchanged = structuredClone(state);
  const result = await analyzeOrder(state);
  assert.equal(result.status, "unique");
  assert.deepEqual(result.orders, [["r2", "r1"]]);
  assert.deepEqual(
    result.transitions
      .find((pair) => pair.fromRaceId === "r2" && pair.toRaceId === "r1")
      ?.anchors.map((anchor) => anchor.intermediateGain),
    [0, 0],
  );
  assert.deepEqual(state, unchanged);
  assert.equal((await analyzeOrder(state, () => true)).status, "incomplete");
});

test("equal cumulative boundaries do not collapse a before-race source into the previous result", async () => {
  const before = {
    ...capture("a", "finishOrderAdded"),
    interpretation: { ...capture("a", "finishOrderAdded").interpretation!, screen: "twoColumns" as const },
    context: { phase: "before" as const },
  };
  const after = capture("b", "finishOrderAdded");
  const result = reconcileSequence(mogi([before, after]));
  assert.equal(result.sequence?.relations[0].completedSteps, 0);
  assert.equal(result.sequence?.occurrences.length, 2);
  const earlier = result.sequence!.occurrences.find((entry) => entry.captureIds.includes(after.id))!;
  const later = result.sequence!.occurrences.find((entry) => entry.captureIds.includes(before.id))!;
  assert.notEqual(earlier.id, later.id);
  assert.equal(later.number, earlier.number === undefined ? undefined : earlier.number + 1);
});

test("every wording a stored race review ever shipped reads as the current one (withCurrentReviews)", () => {
  // Reviews are matched by text. Rewording one keeps this list and maps the earlier text, or saved races strand.
  const shipped = [
    [
      "The inferred number lost its support. Enter the number for this occurrence.",
      "The inferred number lost its support. Enter the number for this race.",
    ],
    [
      "The sequence changed. Check this occurrence before using its breakdown.",
      "The sequence changed. Check this race before using its breakdown.",
    ],
  ];
  for (const wordings of shipped) {
    const read = wordings.map(
      (participationReview) =>
        reconcileSequence({
          ...mogi([]),
          races: [{ id: "r1", number: 1, origin: "observed", status: "pending", placements: [], participationReview }],
        }).races[0].participationReview,
    );
    assert.deepEqual(new Set(read).size, 1, wordings[0]);
  }
});
