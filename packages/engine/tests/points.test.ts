import { strict as assert } from "node:assert";
import { test } from "node:test";

import { pointsFor } from "@mkw/engine";

test("credits a known twelve-player result, absence and an unregistered participant", () => {
  const race = {
    placements: [
      "first",
      "second",
      "third",
      "fourth",
      "fifth",
      "sixth",
      "seventh",
      "eighth",
      "ninth",
      "tenth",
      "eleventh",
      "twelfth",
    ],
    absentParticipantIds: ["absent"],
  };
  assert.deepEqual(
    ["first", "third", "twelfth", "absent", "unknown"].map((id) => pointsFor(race, id)),
    [15, 10, 1, 1, 0],
  );
});
