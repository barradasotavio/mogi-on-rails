import assert from "node:assert/strict";
import test from "node:test";

import {
  type Capture,
  coverageProjection,
  type Mogi,
  normalizeCoverage,
  resultCoverage,
  sourcePairSignature,
} from "@mkw/engine";

import { people, scale12 } from "./support/mogi.ts";

function source(id: string, multiplier: number): Capture {
  const reading = (value: number) => ({
    value,
    text: String(value),
    confidence: 100,
    uncertain: false,
    location: { x: 0, y: 0, width: 1, height: 1 },
  });
  return {
    id,
    width: 1920,
    height: 1080,
    stage: "context",
    context: { phase: "after" },
    reviewedAt: "2026-10-29",
    reviewedPlacements: [],
    interpretation: {
      version: 1,
      screen: "finishOrderAdded",
      origin: "user",
      positions: [],
      movementRows: [],
      reasons: [],
    },
    rows: people.map((person) => ({
      text: person.ign,
      confidence: 100,
      uncertain: false,
      suggestedParticipantId: person.id,
    })),
    nameAssociations: people.map((person) => ({ participantId: person.id })),
    numericRows: scale12.map((points, index) => ({
      row: index + 1,
      right: reading(points * multiplier),
      addition: reading(0),
    })),
  };
}

function scoped(captures: Capture[], numbers: number[], origins: string[]): Mogi {
  return {
    id: "coverage",
    name: "Coverage",
    createdAt: "2026-10-29",
    format: "FFA",
    participants: people,
    races: [],
    captures,
    sequence: {
      version: 1,
      relations: [],
      links: [],
      numbers: [],
      gaps: [],
      inputSignature: "known",
      occurrences: captures.map((capture, index) => ({
        id: `o:${capture.id}`,
        aliases: [],
        captureIds: [capture.id],
        number: numbers[index],
      })),
      origins: captures
        .filter((capture) => origins.includes(capture.id))
        .map((capture) => ({
          captureId: capture.id,
          signature: sourcePairSignature(capture, capture),
          answer: "zero-valid-12",
        })),
    },
  };
}

test("a proof is suspended when remaining races cannot reach the total, reported with its race numbers (detailContradictsInterval)", () => {
  const mogi = scoped([source("a", 2)], [2], ["a"]);
  mogi.races = [{ id: "r1", number: 1, origin: "manual", placements: people.map((person) => person.id).reverse() }];
  // p1 proved 30 over races 1-2 but scored 1 in race 1: race 2 would need 29, above first place.
  assert.deepEqual(coverageProjection(mogi).conflicts, [{ kind: "detail-total-mismatch", raceNumbers: [1, 2] }]);
  assert.deepEqual(resultCoverage(mogi).conflicts, [{ kind: "detail-total-mismatch", raceNumbers: [1, 2] }]);
});

test("overlapping intervals without a common partition return a conflict code", () => {
  const mogi = scoped([source("a", 2), source("b", 1), source("c", 3)], [2, 1, 3], ["a"]);
  mogi.sequence!.relations = [
    {
      fromCaptureId: "b",
      toCaptureId: "c",
      completedSteps: 2,
      stableParticipantIds: people.map((person) => person.id),
      resetParticipantIds: [],
      unknownParticipantIds: [],
    },
  ];
  assert.deepEqual(coverageProjection(mogi).conflicts, [{ kind: "overlapping-intervals" }]);
});

test("sources proving incompatible totals for the same interval return a conflict code", () => {
  const other = source("b", 2);
  [other.numericRows![0].right, other.numericRows![1].right] = [
    other.numericRows![1].right,
    other.numericRows![0].right,
  ];
  const mogi = scoped([source("a", 2), other], [2, 2], ["a", "b"]);
  assert.deepEqual(coverageProjection(mogi).conflicts, [{ kind: "incompatible-totals" }]);
});

test("a proven total keeps a fixed-size signature, so superseded proofs don't grow the saved mogi", () => {
  // A long reading stands in for real captures, whose OCR detail made each stored signature ~80 KB.
  const long = source("a", 2);
  long.interpretation!.reasons = Array.from({ length: 500 }, (_, index) => `reading detail ${index}`);
  const proven = normalizeCoverage(scoped([long], [2], ["a"]));
  const stale = structuredClone(proven);
  // A proof saved before signatures were digests is superseded once and kept in history.
  stale.coverage!.intervals[0].signature = JSON.stringify(long);
  const superseded = normalizeCoverage(stale);
  const signatures = [
    ...superseded.coverage!.intervals,
    ...superseded.coverage!.history.map((entry) => entry.contribution),
  ].map((contribution) => contribution.signature);
  assert.equal(signatures.length, 2);
  for (const signature of signatures) assert.ok(signature.length <= 64, `${signature.length} characters`);
});
