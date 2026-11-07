import assert from "node:assert/strict";
import test from "node:test";

import { coverageConflictText, sharingText, submissionBlockerText } from "./exports.ts";
import type { Mogi } from "./types.ts";

test("coverage conflict codes have one English presentation for sharing", () => {
  assert.equal(
    coverageConflictText({ kind: "detail-total-mismatch", raceNumbers: [2] }),
    "Race 2: detailed results contradict the proven total.",
  );
  assert.equal(
    coverageConflictText({ kind: "detail-total-mismatch", raceNumbers: [2, 3, 4] }),
    "Races 2–4: detailed results contradict the proven total.",
  );
  assert.equal(
    coverageConflictText({ kind: "overlapping-intervals" }),
    "Overlapping intervals do not yet have a proven partition.",
  );
  assert.equal(
    coverageConflictText({ kind: "incompatible-totals" }),
    "Screenshots of the same interval have incompatible totals.",
  );
});

test("!submit's blocker is one short state, never a list of races", () => {
  const participants = Array.from({ length: 12 }, (_, index) => ({
    id: `p${index}`,
    loungeName: `Player ${index + 1}`,
    ign: `Player ${index + 1}`,
  }));
  const mogi: Mogi = { id: "m", name: "Mogi", format: "FFA", createdAt: "2026-10-29", participants, races: [] };
  const none = { pendingRaces: [], unknownTotals: [], openQuestions: [] };
  assert.equal(submissionBlockerText(mogi, { ...none, missingTier: true }), null);
  assert.equal(
    submissionBlockerText(mogi, { ...none, pendingRaces: [3, 4, 5], openQuestions: [{ id: "q1", kind: "number" }] }),
    "Waiting on 3 races",
  );
  assert.equal(submissionBlockerText(mogi, { ...none, pendingRaces: [12] }), "Waiting on race 12");
  assert.equal(submissionBlockerText(mogi, { ...none, unknownTotals: ["p2"] }), "Unknown total for Player 3");
  assert.equal(
    submissionBlockerText(mogi, {
      ...none,
      openQuestions: [
        { id: "credit:p2", kind: "credit" },
        { id: "q1", kind: "row-identity" },
      ],
    }),
    "2 open questions",
  );
});

test("sharing uses the same continuous race prefix as the visible scoreboard", () => {
  const participants = Array.from({ length: 12 }, (_, index) => ({
    id: `p${index}`,
    loungeName: `Player ${index}`,
    ign: `Player ${index}`,
  }));
  const mogi: Mogi = {
    id: "m",
    name: "Mogi",
    format: "FFA",
    createdAt: "2026-10-29",
    participants,
    races: [
      {
        id: "r1",
        number: 1,
        origin: "manual",
        status: "confirmed",
        placements: participants.map((person) => person.id),
      },
      { id: "r2", number: 2, origin: "manual", status: "pending", placements: [] },
      {
        id: "r3",
        number: 3,
        origin: "manual",
        status: "confirmed",
        placements: participants.map((person) => person.id).reverse(),
      },
    ],
  };
  const text = sharingText(mogi);
  assert.match(text, /Table after race 1 of 12/);
  assert.match(text, /Incomplete partial result · 1\/12 counted/);
  assert.match(text, /Included: 1 · Pending: 2/);
  assert.match(text, /1\. Player 0 — 15\n/);
});
