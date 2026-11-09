import assert from "node:assert/strict";
import test from "node:test";

import type { TrackStanding } from "@mkw/engine";

import type { TrackerState } from "./mogi/types.ts";
import { naturalBreaks, savedTrackOrder, voteTracks, withTrackOrder } from "./track-order.ts";

/** A track's standing with the measures Vote reads; the rest stay at 0. */
const standing = (short: string, measures: Partial<TrackStanding> = {}) =>
  ({
    track: { short, name: short },
    recent: 0,
    typical: 0,
    typicalPlus: null,
    typicalMinus: null,
    cost: 0,
    totalPlus: null,
    totalMinus: null,
    ...measures,
  }) as TrackStanding;
const read = (tracks: ReturnType<typeof voteTracks>) => tracks.map(({ track, light }) => `${track.short}:${light}`);

test("naturalBreaks: breaks at the largest gaps, keeps ties together, and degrades to 2 or 1 groups", () => {
  assert.deepEqual(naturalBreaks([1, 1.5, 2, 9, 10, 20, 21, 22], 3), [0, 0, 0, 1, 1, 2, 2, 2]);
  assert.deepEqual(naturalBreaks([0, 0, 0, 0, 5, 5, 6, 10], 3), [0, 0, 0, 0, 1, 1, 1, 2]);
  assert.deepEqual(naturalBreaks([3, -1, 3, -1], 3), [1, 0, 1, 0]);
  assert.deepEqual(naturalBreaks([2, 2, 2], 3), [0, 0, 0]);
});

test("voteTracks: best first by the chosen measure, lit by natural breaks; the sort changes both", () => {
  const tracks = [
    standing("A", { typical: -4, cost: 30, recent: 2, typicalMinus: -4 }),
    standing("B", { typical: 3, cost: -9, recent: 9, typicalPlus: 3 }),
    standing("C", { typical: 2.5, cost: 1, recent: 5, typicalPlus: 4, typicalMinus: -1 }),
    standing("D", { typical: 0, cost: 2, recent: 4 }),
  ];
  assert.deepEqual(read(voteTracks(tracks, { by: "typical", count: "both" })), [
    "B:good",
    "C:good",
    "D:mixed",
    "A:bad",
  ]);
  assert.deepEqual(read(voteTracks(tracks, { by: "total", count: "both" })), ["A:good", "D:mixed", "C:mixed", "B:bad"]);
  assert.deepEqual(read(voteTracks(tracks, { by: "races", count: "both" })), ["B:good", "C:mixed", "D:mixed", "A:bad"]);
  // No race on the chosen side counts as 0: no gain under Plus Only, no loss (the best) under Minus Only.
  assert.deepEqual(read(voteTracks(tracks, { by: "typical", count: "plus" })), ["C:good", "B:mixed", "A:bad", "D:bad"]);
  assert.deepEqual(read(voteTracks(tracks, { by: "typical", count: "minus" })), [
    "B:good",
    "D:good",
    "C:mixed",
    "A:bad",
  ]);
  // Two distinct values light Good and Bad; one lights every track Mixed.
  assert.deepEqual(read(voteTracks(tracks.slice(1, 3), { by: "races", count: "both" })), ["B:good", "C:bad"]);
  assert.deepEqual(read(voteTracks([tracks[3]], { by: "typical", count: "both" })), ["D:mixed"]);
});

test("withTrackOrder saves a default and writes Typical +/− as no field", () => {
  const state: TrackerState = { version: 1, mogis: [], activeMogiId: null };
  const saved = withTrackOrder(state, { by: "total", count: "plus" });
  assert.deepEqual(savedTrackOrder(saved), { by: "total", count: "plus" });
  assert.equal("trackOrder" in withTrackOrder(saved, { by: "typical", count: "both" }), false);
});
