import assert from "node:assert/strict";
import test from "node:test";

import type { TrackStanding } from "@mkw/engine";

import type { TrackerState } from "./mogi/types.ts";
import { orderTracks, savedTrackOrder, withTrackOrder } from "./track-order.ts";

const standing = (short: string, typicalMinus: number | null, recent: number) =>
  ({ track: { short, name: short }, typicalMinus, recent }) as TrackStanding;

test("orderTracks starts at the extreme the measure is about, tracks without that side last", () => {
  const tracks = [standing("A", -1, 5), standing("B", null, 9), standing("C", -4, 2)];
  const order = (by: "typical" | "races") =>
    orderTracks(tracks, { by, count: "minus" }).map(({ standing }) => standing.track.short);
  assert.deepEqual(order("typical"), ["C", "A", "B"]);
  // Races counts every race, so Minus Only leaves it most races first.
  assert.deepEqual(order("races"), ["B", "A", "C"]);
});

test("withTrackOrder saves a default and writes Typical +/− as no field", () => {
  const state: TrackerState = { version: 1, mogis: [], activeMogiId: null };
  const saved = withTrackOrder(state, { by: "total", count: "plus" });
  assert.deepEqual(savedTrackOrder(saved), { by: "total", count: "plus" });
  assert.equal("trackOrder" in withTrackOrder(saved, { by: "typical", count: "both" }), false);
});
