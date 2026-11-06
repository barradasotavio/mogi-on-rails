import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  acceptedCaptureEvidence,
  type Capture,
  captureBoundaryValues,
  type CaptureObservation,
  type NumericReading,
  type Race,
  reconcileCaptureEvidence,
} from "@mkw/engine";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/thirteen-captures.json", import.meta.url), "utf8")) as {
  observations: CaptureObservation[];
};
const number = (value: number | null): NumericReading => ({
  text: String(value ?? ""),
  value,
  confidence: 99,
  uncertain: value === null,
  location: { x: 0, y: 0, width: 1, height: 1 },
});
const names = Array.from({ length: 12 }, (_, index) => `Player${String(index + 1).padStart(2, "0")}`);
const totals = [50, 42, 35, 30, 27, 24, 21, 18, 15, 12, 9, 6];
const gain = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
function source(
  id: string,
  screen: "finishOrderAdding" | "finishOrderAdded" | "overallStandings" | "twoColumns" = "finishOrderAdded",
  values = totals,
): Capture {
  return {
    id,
    stage: "context",
    context: { phase: screen === "twoColumns" ? "before" : "after" },
    reviewedAt: "",
    reviewedPlacements: [],
    nameAssociations: names.map((participantId) => ({ participantId })),
    width: 1920,
    height: 1080,
    rows: names.map((text) => ({ text, confidence: 99, suggestedParticipantId: text, uncertain: false })),
    interpretation: {
      version: 1,
      screen,
      origin: "visual",
      positions: [],
      movementRows: [],
      reasons: [],
      ...(screen === "finishOrderAdding" ? { currentScale: 12 } : {}),
    },
    numericRows: values.map((value, index) => ({
      row: index + 1,
      right: number(value),
      addition: number(screen === "finishOrderAdding" ? gain[index] : null),
    })),
  };
}

const race: Race = { id: "race", origin: "observed", placements: names };

test("complementary additions and game cumulatives retain their source rows when merged", () => {
  const animation = source("animation", "finishOrderAdding");
  const final = source("final");
  const unchanged = structuredClone([animation, final]);
  const merged = reconcileCaptureEvidence(
    acceptedCaptureEvidence(animation, race),
    acceptedCaptureEvidence(final, race),
  );
  assert.equal(merged?.readings[names[0]].current?.value, 15);
  assert.equal(merged?.readings[names[0]].current?.sourceCaptureId, "animation");
  assert.equal(merged?.readings[names[0]].cumulative?.value, 50);
  assert.equal(merged?.readings[names[0]].cumulative?.sourceCaptureId, "final");
  assert.equal(merged?.readings[names[0]].useAsAnchor, true);
  assert.deepEqual(merged?.rowAssociations, { animation: names, final: names });
  assert.deepEqual([animation, final], unchanged);
});

test("conflicting game cumulatives reject the merge and preserve both source readings", () => {
  const first = source("first");
  const conflicting = source(
    "conflicting",
    "overallStandings",
    totals.map((value) => value + 100),
  );
  const previous = acceptedCaptureEvidence(first, race);
  const incoming = acceptedCaptureEvidence(conflicting, race);
  const unchanged = structuredClone([previous, incoming]);
  assert.throws(() => reconcileCaptureEvidence(previous, incoming), /incompatible numbers/);
  assert.deepEqual([previous, incoming], unchanged);
  assert.equal(first.numericRows![0].right.value, 50);
  assert.equal(conflicting.numericRows![0].right.value, 150);
});

test("pre-race game cumulatives stay separate from the result's final anchors", () => {
  const before = source(
    "before",
    "twoColumns",
    totals.map((value, index) => value - gain[index]),
  );
  const after = source("after");
  assert.equal(captureBoundaryValues(before).get(names[0])?.value, 35);
  assert.equal(captureBoundaryValues(after).get(names[0])?.value, 50);
  assert.equal(acceptedCaptureEvidence(before, race), undefined);
  const final = acceptedCaptureEvidence(after, race);
  assert.equal(reconcileCaptureEvidence(final, acceptedCaptureEvidence(before, race)), final);
});

test("an intermediate finish-order animation cannot supply a cumulative boundary merely by its score total", () => {
  const raw = structuredClone(fixture.observations);
  const finishOrder = raw.find(
    (source) => source.interpretation.screen === "finishOrderAdding" && source.numericRows[0].right.value === 53,
  )!;
  for (const row of finishOrder.numericRows) if (row.right.value !== null) row.right.value += 1;
  const capture: Capture = {
    ...finishOrder,
    stage: "context",
    context: { phase: "after" },
    reviewedAt: "",
    reviewedPlacements: [],
    nameAssociations: finishOrder.rows.map((row) => ({ participantId: row.text })),
    rows: finishOrder.rows.map((row) => ({ ...row, suggestedParticipantId: row.text, uncertain: false })),
  };
  assert.equal(captureBoundaryValues(capture).size, 0);
  const evidence = acceptedCaptureEvidence(capture, {
    id: "race",
    origin: "observed",
    placements: finishOrder.rows.map((row) => row.text),
  });
  assert.ok(evidence);
  assert.equal(evidence.verified, false);
  assert.ok(Object.values(evidence.readings).every((reading) => !reading.cumulative && !reading.useAsAnchor));
});
