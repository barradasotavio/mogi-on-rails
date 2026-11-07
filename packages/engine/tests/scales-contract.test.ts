import assert from "node:assert/strict";
import test from "node:test";

import { individualStandings, normalizeReconstructions, raceTotal, resultCoverage } from "@mkw/engine";

import { mogi, source } from "./support/mogi.ts";

test("native twelve eleven and ten rooms yield adjusted totals without a universal 984 rule", () => {
  const races = [source("twelve", 1, [], 12, 0), source("eleven", 2, [], 11, 0), source("ten", 3, [], 10, 0)];
  const state = mogi(races);
  assert.deepEqual(races.map(raceTotal), [82, 82, 81]);
  assert.equal(individualStandings(state).find((person) => person.id === "p1")?.points, 45);
  assert.equal(individualStandings(state).find((person) => person.id === "p11")?.points, 5);
  assert.equal(individualStandings(state).find((person) => person.id === "p12")?.points, 3);
  assert.deepEqual(resultCoverage(state).included, [1, 2, 3]);
  assert.equal(resultCoverage(state).final, false);
  const twelveRaces = mogi([
    source("ten", 1, [], 10, 0),
    ...Array.from({ length: 11 }, (_, n) => source(`full${n}`, n + 2, [], 12, 0)),
  ]);
  assert.equal(
    individualStandings(twelveRaces).reduce((sum, person) => sum + person.points!, 0),
    983,
  );
  assert.equal(resultCoverage(twelveRaces).final, true);
});

test("a race whose in-game points were entered by hand loads with the native scale and the same Lounge points", async () => {
  const eleven = source("eleven", 1, [], 11, 0);
  const placements = eleven.placements;
  const manual = {
    ...eleven,
    nativePoints: Object.fromEntries(
      placements.map((id, n) => [id, n === 0 ? 9 : [12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1][n]]),
    ),
    nativePointOrigins: Object.fromEntries(
      placements.map((id, n) => [id, n === 0 ? ("manual" as const) : ("modeled" as const)]),
    ),
  };
  const pending = {
    ...source("pending", 2, []),
    status: "pending" as const,
    placements: [],
    nativePoints: { p1: 9 },
    nativePointOrigins: { p1: "manual" as const },
  };
  const stored = mogi([manual, pending]);
  const loaded = (await normalizeReconstructions({ mogis: [stored] })).mogis[0];
  const [race, withdrawn] = loaded.races;
  assert.deepEqual(
    race.nativePoints,
    Object.fromEntries(placements.map((id, n) => [id, [12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1][n]])),
  );
  assert.deepEqual(new Set(Object.values(race.nativePointOrigins!)), new Set(["modeled"]));
  assert.equal(withdrawn.nativePoints, undefined);
  assert.deepEqual(individualStandings(loaded), individualStandings(stored));
  assert.equal(await normalizeReconstructions({ mogis: [loaded] }).then((state) => state.mogis[0]), loaded);
});
