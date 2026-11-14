import assert from "node:assert/strict";
import test from "node:test";

import { isScreen, momentLabels, momentOffset, screenProperties, screens } from "@mkw/engine";

import { occupiedCard } from "../src/recognition/lobby-cards.ts";

test("each screen implies its name, moment, order, stability, offset and game groups", () => {
  assert.deepEqual(
    Object.entries(screens).map(([id, p]) => [
      id,
      p.name,
      p.moment,
      p.order,
      p.cumulative,
      p.offset,
      p.gameTeamGroups,
      p.teamTotals,
    ]),
    [
      ["twoColumns", "Two columns", "before", "none", "final", 1, false, false],
      ["twoColumnsByTeam", "Two columns, by team", "before", "grouped", "final", 1, true, false],
      ["finishOrderAdding", "Finish order, adding points", "after", "finishOrder", "unsettled", 0, false, false],
      ["finishOrderAdded", "Finish order, points added", "after", "finishOrder", "final", 0, false, false],
      ["overallStandings", "Overall standings", "after", "general", "final", 0, false, false],
      ["teamStandings", "Team standings", "after", "grouped", "final", 0, true, true],
      ["finalStandings", "Final standings", "event-final", "general", "final", 0, false, false],
      ["unknown", "Not recognized", undefined, "unknown", "unknown", 0, false, false],
    ],
  );
  for (const id of Object.keys(screens)) {
    assert.ok(isScreen(id));
    assert.equal(screenProperties(id), screens[id]);
  }
  for (const value of [null, undefined, "", "toString", "__proto__", "after"]) assert.equal(isScreen(value), false);
  assert.equal(screenProperties(undefined), undefined);
  assert.deepEqual(momentLabels, {
    before: "Before the race",
    after: "After the race",
    "event-final": "End of the event",
  });
  assert.deepEqual(
    Object.keys(momentLabels).map((moment) => momentOffset(moment as keyof typeof momentLabels)),
    [1, 0, 0],
  );
});

test("a team lobby board yields every filled card, green ones with no lit edge included, and skips darker empty slots", () => {
  const width = 1920,
    height = 1080,
    data = new Uint8ClampedArray(width * height * 4);
  const paint = (x0: number, y0: number, w: number, h: number, [r, g, b]: number[]) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set([r, g, b, 255], (y * width + x) * 4);
  };
  paint(0, 0, width, height, [8, 14, 22]);
  // Four teams of three: each team holds three slots in each column, filled from the top of the left column.
  const teams = [
    { filled: [252, 57, 5], edge: [255, 140, 110], empty: [77, 20, 20] },
    { filled: [3, 116, 255], edge: [90, 170, 255], empty: [1, 38, 83] },
    { filled: [255, 176, 13], edge: [255, 220, 120], empty: [77, 63, 34] },
    { filled: [17, 174, 134], edge: [17, 176, 136], empty: [6, 53, 35] }, // Green: the edge is as bright as the body.
  ];
  const filled = new Set(["0,0", "0,1", "1,0", "0,3", "0,4", "1,3", "0,6", "0,7", "1,6", "0,9", "0,10", "1,9"]);
  for (let column = 0; column < 2; column++)
    for (let slot = 0; slot < 12; slot++) {
      const team = teams[Math.floor(slot / 3)],
        x = 45 + column * 505,
        y = 89 + slot * 76;
      const full = filled.has(`${column},${slot}`);
      paint(x, y, 490, 64, full ? team.filled : team.empty);
      paint(x, y, 490, 3, full ? team.edge : team.empty);
    }
  const occupied = [0, 1].flatMap((column) =>
    Array.from({ length: 12 }, (_, slot) => slot).flatMap((slot) =>
      occupiedCard({ data, width, height }, column, slot) ? [`${column},${slot}`] : [],
    ),
  );
  assert.deepEqual(new Set(occupied), filled);
});
