import assert from "node:assert/strict";
import { test } from "node:test";

import { captureRowBounds } from "@mkw/engine";

test("A1/A2 bounds cover the slot-zero card in each column, old captures included (captureRowBounds)", () => {
  for (const screen of ["twoColumns", "twoColumnsByTeam"] as const) {
    const capture = {
      interpretation: { screen },
      rows: [
        { location: { x: 140, y: 99, width: 315, height: 47 } },
        { location: { x: 645, y: 99, width: 315, height: 47 } },
      ],
    };
    assert.deepEqual(captureRowBounds(capture, 1), { x: 45, y: 89, width: 490, height: 67 });
    assert.deepEqual(captureRowBounds(capture, 2), { x: 550, y: 89, width: 490, height: 67 });
    const stored = { ...capture, rows: [{ ...capture.rows[0], bounds: { x: 46, y: 90, width: 488, height: 66 } }] };
    assert.deepEqual(captureRowBounds(stored, 1), { x: 46, y: 90, width: 488, height: 66 });
    assert.deepEqual(captureRowBounds(capture, 1, 3), { x: 42, y: 86, width: 496, height: 73 });
  }
});
