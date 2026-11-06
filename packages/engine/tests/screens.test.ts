import assert from "node:assert/strict";
import test from "node:test";

import { isScreen, momentLabels, momentOffset, screenProperties, screens } from "@mkw/engine";

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
