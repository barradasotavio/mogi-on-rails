import assert from "node:assert/strict";
import test from "node:test";

test("normal Lounge formats define team sizes and reserve races one through twelve", async () => {
  const engine = await import("@mkw/engine");
  assert.deepEqual(engine.teamSizes, { FFA: 1, "2v2": 2, "3v3": 3 });
  assert.deepEqual(engine.raceNumbers(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const numbers = engine.raceNumbers();
  numbers.pop();
  assert.equal(engine.raceNumbers().at(-1), 12);
});
