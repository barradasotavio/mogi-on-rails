import assert from "node:assert/strict";
import test from "node:test";

import { individualStandings, raceTotal, resultCoverage } from "@mkw/engine";

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
