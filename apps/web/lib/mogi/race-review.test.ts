import assert from "node:assert/strict";
import test from "node:test";

import { raceReviewSignature, withRaceDraft } from "./race-review.ts";
import type { Mogi } from "./types.ts";

test("autosaving a complete edit keeps it in the draft: the race and its absences change only on Save Result", async () => {
  const participants = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    loungeName: `Player ${i}`,
    ign: `Player ${i}`,
  }));
  const race = {
    id: "r1",
    number: 1,
    origin: "reconstructed" as const,
    status: "confirmed" as const,
    placements: participants.map((p) => p.id),
  };
  const mogi: Mogi = { id: "m", name: "Mogi", createdAt: "2026-11-05", format: "FFA", participants, races: [race] };
  const fields = {
    placements: race.placements.slice(1),
    absentParticipantIds: ["p0"],
    rawOverrides: {},
    reviewed: false,
  };
  const drafted = await withRaceDraft(mogi, race, fields, await raceReviewSignature(race));
  assert.equal(drafted.races, mogi.races);
  assert.deepEqual(drafted.raceDraft?.fields, fields);
});
