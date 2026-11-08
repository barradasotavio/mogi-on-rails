import assert from "node:assert/strict";
import test from "node:test";

import type { TrackStanding } from "@mkw/engine";

import type { TrackerState } from "./mogi/types.ts";
import { savedTrackOrder, voteLight, voteTracks, withTrackOrder } from "./track-order.ts";

/** A track's standing as the vote light reads it: races in the window, usual range and Typical +/−. */
const standing = (short: string, recent: number, lowerQuartile: number, upperQuartile: number, typical = 0) =>
  ({ track: { short, name: short }, recent, lowerQuartile, upperQuartile, typical }) as TrackStanding;

test("voteLight: Good above zero, Bad below, Mixed across zero or under 3 races", () => {
  assert.equal(voteLight(standing("A", 3, 0.5, 4)), "good");
  assert.equal(voteLight(standing("A", 3, -4, -0.5)), "bad");
  assert.equal(voteLight(standing("A", 3, -2, 2)), "mixed");
  assert.equal(voteLight(standing("A", 3, 0, 3)), "mixed");
  assert.equal(voteLight(standing("A", 2, 1, 4)), "mixed");
  assert.equal(voteLight(standing("A", 2, -4, -1)), "mixed");
});

test("voteTracks: Good, then Mixed, then Bad, each by Typical +/−, best first", () => {
  const ordered = voteTracks([
    standing("bad-high", 4, -3, -1, -1),
    standing("mixed-low", 4, -2, 2, -0.5),
    standing("good-low", 4, 1, 3, 1),
    standing("few", 1, 2, 2, 2),
    standing("bad-low", 4, -5, -2, -4),
    standing("good-high", 4, 2, 5, 3),
  ]);
  assert.deepEqual(
    ordered.map(({ track, light }) => `${track.short}:${light}`),
    ["good-high:good", "good-low:good", "few:mixed", "mixed-low:mixed", "bad-high:bad", "bad-low:bad"],
  );
});

test("withTrackOrder saves a default and writes Typical +/− as no field", () => {
  const state: TrackerState = { version: 1, mogis: [], activeMogiId: null };
  const saved = withTrackOrder(state, { by: "total", count: "plus" });
  assert.deepEqual(savedTrackOrder(saved), { by: "total", count: "plus" });
  assert.equal("trackOrder" in withTrackOrder(saved, { by: "typical", count: "both" }), false);
});
