import assert from "node:assert/strict";
import { test } from "node:test";

import { springFrames } from "../components/ui/paging.ts";

test("a settle never passes its target", () => {
  // A very fast flick, a slow release, a release away, from rest, and a rubber band back from an end.
  for (const [from, to, velocity] of [
    [-200, -400, -5],
    [-200, -400, -0.2],
    [-200, -400, 1],
    [-200, -400, 0],
    [40, 0, 0],
  ] as const) {
    const { frames } = springFrames(from, to, velocity);
    assert.ok(
      frames.every((x) => (x - to) * (from - to) >= 0),
      `${from} → ${to} at ${velocity}`,
    );
    assert.equal(frames.at(-1), to);
  }
});
