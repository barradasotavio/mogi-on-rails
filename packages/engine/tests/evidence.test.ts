import assert from "node:assert/strict";
import test from "node:test";

import { type Capture, captureBoundaryValues, type NumericReading } from "@mkw/engine";

const number = (value: number | null, uncertain = false): NumericReading => ({
  value,
  uncertain,
  text: value === null ? "" : String(value),
  confidence: 99,
  location: { x: 1, y: 2, width: 3, height: 4 },
});
const source = (id: string, names: string[], totals: number[]): Capture => ({
  id,
  stage: "context",
  context: { phase: "before" },
  reviewedAt: "",
  reviewedPlacements: [],
  nameAssociations: names.map((participantId) => ({ participantId })),
  width: 1920,
  height: 1080,
  rows: names.map((text) => ({ text, confidence: 99, suggestedParticipantId: text, uncertain: false })),
  interpretation: { version: 1, screen: "twoColumns", origin: "visual", positions: [], movementRows: [], reasons: [] },
  numericRows: totals.map((value, index) => ({ row: index + 1, right: number(value), addition: number(null, true) })),
});

test("accepted cumulative boundaries exclude unreadable numbers and unresolved identities", () => {
  const image = source("image", ["Tavo", "Unreadable", "Unknown"], [45, 39, 20]);
  image.numericRows![1].right.uncertain = true;
  image.nameAssociations![2].participantId = null;
  assert.deepEqual(
    [...captureBoundaryValues(image)],
    [
      [
        "Tavo",
        {
          value: 45,
          origin: "observed",
          sourceCaptureId: "image",
          sourceRow: 1,
          sourceField: "right",
        },
      ],
    ],
  );
  assert.equal(captureBoundaryValues({ ...image, context: undefined }).size, 0);
});

test("accepted application context preserves manual values and roster links without overwriting raw fields", () => {
  const image = source("accepted", ["OCR typo"], [17]);
  image.numericRows![0].right.uncertain = true;
  image.rows = [];
  image.nameAssociations = [{ participantId: "actual-player" }];
  image.numericAnswers = [{ row: 1, field: "right", value: 77 }];
  assert.deepEqual(
    [...captureBoundaryValues(image)],
    [
      [
        "actual-player",
        {
          value: 77,
          origin: "manual",
          sourceCaptureId: "accepted",
          sourceRow: 1,
          sourceField: "right",
        },
      ],
    ],
  );
  assert.equal(image.numericRows![0].right.value, 17);
});

test("group arithmetic gates cumulative boundaries until the group total is answered", () => {
  const teams = source("teams", ["One", "Two", "Three"], [60, 61, 65]);
  teams.interpretation = {
    ...teams.interpretation!,
    screen: "teamStandings",
    groups: [{ rows: [1, 2, 3], total: number(186, true) }],
  };
  assert.equal(captureBoundaryValues(teams).size, 0);
  teams.groupTotalAnswers = [{ group: 1, value: 186 }];
  assert.deepEqual(
    [...captureBoundaryValues(teams).values()].map((reading) => reading.value),
    [60, 61, 65],
  );
  assert.equal(teams.interpretation.groups![0].total!.uncertain, true);
});
