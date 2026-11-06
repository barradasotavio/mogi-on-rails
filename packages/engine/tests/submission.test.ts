import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyReviewedRace,
  type Capture,
  individualStandings,
  loungeSubmission,
  type Mogi,
  participantsForRace,
  registerSubstitution,
} from "@mkw/engine";

import { people } from "./support/mogi.ts";

const lt = JSON.parse(readFileSync(new URL("./fixtures/lt-submissions.json", import.meta.url), "utf8")) as {
  cases: { format: Mogi["format"]; players: { points: number }[]; expected: string }[];
};

const completed: Mogi = {
  id: "submission",
  name: "Lounge submission",
  createdAt: "2026-10-28",
  format: "FFA",
  submissionTier: "D",
  participants: people,
  races: Array.from({ length: 12 }, (_, index) => ({
    id: `r${index + 1}`,
    number: index + 1,
    origin: "manual",
    placements: people.map(({ id }) => id).reverse(),
  })),
};

test("a final FFA submit equals the output captured from LT in roster order", () => {
  assert.deepEqual(
    people.map(({ id }) => individualStandings(completed).find((row) => row.id === id)!.points),
    lt.cases[0].players.map(({ points }) => points),
  );
  assert.deepEqual(loungeSubmission(completed), { available: true, text: lt.cases[0].expected });
});

test("a missing tier returns a blocker instead of a submit command with an empty tier", () => {
  for (const submissionTier of [undefined, "", "   "]) {
    assert.deepEqual(loungeSubmission({ ...completed, submissionTier }), {
      available: false,
      blockers: { pendingRaces: [], unknownTotals: [], openQuestions: [], missingTier: true },
    });
  }
});

test("a missing or discarded race returns its number instead of a partial submit", () => {
  for (const races of [
    completed.races.slice(0, 11),
    completed.races.map((race) => (race.number === 12 ? { ...race, status: "discarded" as const } : race)),
  ]) {
    assert.deepEqual(loungeSubmission({ ...completed, races }), {
      available: false,
      blockers: { pendingRaces: [12], unknownTotals: [], openQuestions: [] },
    });
  }
});

test("substitution credit blocks submit until the chosen Lounge name receives the slot total", () => {
  let replaced = registerSubstitution(completed, { slotId: "p1", loungeName: "Replacement", ign: "New", fromRace: 12 });
  replaced = applyReviewedRace(replaced, {
    ...replaced.races[11],
    status: "confirmed",
    placements: participantsForRace(replaced, 12)
      .map(({ id }) => id)
      .reverse(),
  });
  assert.deepEqual(loungeSubmission(replaced), {
    available: false,
    blockers: { pendingRaces: [], unknownTotals: [], openQuestions: [{ id: "credit:p1", kind: "credit" }] },
  });
  const credited = { ...replaced, creditedParticipantIds: { p1: replaced.substitutions![0].incomingParticipantId } };
  assert.deepEqual(loungeSubmission(credited), {
    available: true,
    text: lt.cases[0].expected.replace("Player 1 12", "Replacement 12"),
  });
});

test("unanswered source questions block submit even with all twelve totals proven", () => {
  const capture: Capture = {
    id: "unresolved",
    width: 1920,
    height: 1080,
    rows: [],
    stage: "context",
    reviewedAt: "2026-10-28",
    reviewedPlacements: [],
    context: { phase: "after" },
  };
  assert.deepEqual(loungeSubmission({ ...completed, captures: [capture] }), {
    available: false,
    blockers: {
      pendingRaces: [],
      unknownTotals: [],
      openQuestions: [
        { id: "origin:unresolved", kind: "origin" },
        { id: "number:unresolved", kind: "number" },
        { id: "source:unresolved", kind: "source-occurrence" },
      ],
    },
  });
});

test("final 2v2 and 3v3 submits equal LT including blank lines between teams", () => {
  for (const fixture of lt.cases.slice(1)) {
    const size = Number(fixture.format[0]);
    const mogi: Mogi = {
      ...completed,
      format: fixture.format as Mogi["format"],
      participants: people.map((person, index) => ({ ...person, teamId: `team-${Math.floor(index / size)}` })),
      teams: Array.from({ length: 12 / size }, (_, index) => ({ id: `team-${index}`, name: `Team ${index + 1}` })),
    };
    assert.deepEqual(loungeSubmission(mogi), { available: true, text: fixture.expected });
  }
});

test("an unknown total returns structured blockers instead of a submit command with zero", () => {
  const unknown: Mogi = {
    ...completed,
    races: completed.races.map((race) => ({
      ...race,
      placements: race.placements.filter((id) => id !== "p1"),
    })),
  };
  assert.deepEqual(loungeSubmission(unknown), {
    available: false,
    blockers: { pendingRaces: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], unknownTotals: ["p1"], openQuestions: [] },
  });
});
