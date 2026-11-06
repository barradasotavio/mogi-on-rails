import assert from "node:assert/strict";
import { test } from "node:test";

import {
  individualStandings,
  type Mogi,
  mogiOverview,
  mogiPlayerChanges,
  mogiQuestions,
  mogiSummary,
  participantsForRace,
  registerSubstitution,
  teamStandings,
} from "@mkw/engine";

const mogi: Mogi = {
  id: "m",
  name: "Mogi",
  format: "FFA",
  createdAt: "2026-10-28",
  participants: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, loungeName: `Player ${i}`, ign: `Player ${i}` })),
  races: [],
};

test("the scoreboard stops at the first gap even with a later counted result and unordered races", () => {
  const placements = mogi.participants.map((person) => person.id);
  const current: Mogi = {
    ...mogi,
    races: [
      { id: "r4", number: 4, origin: "manual", status: "confirmed", placements: [...placements].reverse() },
      { id: "r2", number: 2, origin: "manual", status: "confirmed", placements },
      { id: "r3", number: 3, origin: "manual", status: "pending", placements: [] },
      { id: "r1", number: 1, origin: "manual", status: "confirmed", placements },
    ],
  };
  assert.equal(mogiOverview(current).count, 2);
  assert.equal(individualStandings(current).find((person) => person.id === "p0")!.points, 30);
  assert.deepEqual(
    mogiPlayerChanges(current).find((person) => person.slotId === "p0"),
    { slotId: "p0", movement: 0, gain: 15 },
  );
  assert.equal(mogiSummary(current).text, "Race 2 of 12 · Player 0 leads with 30");
  const teams: Mogi = {
    ...current,
    format: "2v2",
    teams: [{ id: "t", name: "Team 1" }],
    participants: current.participants.map((person) => ({ ...person, teamId: "t" })),
  };
  assert.equal(teamStandings(teams)[0].points, 164);
  const missingFirst = { ...current, races: current.races.filter((race) => race.number !== 1) };
  assert.equal(mogiOverview(missingFirst).count, 0);
  assert.ok(individualStandings(missingFirst).every((person) => person.points === null));
});

test("a new mogi reserves all twelve future positions without a header action", () => {
  const overview = mogiOverview(mogi);
  assert.deepEqual(
    overview.positions.map(({ number, state }) => [number, state]),
    [
      [1, "future"],
      [2, "future"],
      [3, "future"],
      [4, "future"],
      [5, "future"],
      [6, "future"],
      [7, "future"],
      [8, "future"],
      [9, "future"],
      [10, "future"],
      [11, "future"],
      [12, "future"],
    ],
  );
  assert.equal(overview.action.kind, "none");
});

test("only queue pages count as questions, pending races stay actionable, and a discarded result cannot enable copying", () => {
  const race = { id: "r1", number: 1, origin: "manual" as const, placements: mogi.participants.map((p) => p.id) };
  assert.deepEqual(mogiOverview({ ...mogi, races: [race] }).action, { kind: "copy-table" });
  assert.deepEqual(mogiOverview({ ...mogi, races: [race] }, { questions: [{ number: 1, count: 2 }] }).action, {
    kind: "copy-table",
  });
  const pending = mogiOverview({ ...mogi, races: [{ ...race, status: "pending", placements: [] }] });
  assert.deepEqual(pending.action, { kind: "none" });
  assert.equal(pending.positions[0].state, "pending");
  assert.equal(pending.positions[0].questionCount, 0);
  assert.equal(mogiOverview({ ...mogi, races: [{ ...race, status: "discarded" }] }).action.kind, "none");
});

test("a final result offers submit after reading and questions, and returns to table when a race is discarded", () => {
  const final: Mogi = {
    ...mogi,
    races: Array.from({ length: 12 }, (_, index) => ({
      id: `r${index + 1}`,
      number: index + 1,
      origin: "manual",
      placements: mogi.participants.map((p) => p.id),
    })),
  };
  assert.deepEqual(mogiOverview(final).action, { kind: "copy-submit" });
  assert.deepEqual(mogiOverview(final, { questions: [{ count: 1 }] }).action, { kind: "copy-submit" });
  assert.deepEqual(
    mogiOverview(final, { reading: { current: 1, total: 2, numbers: [12] }, questions: [{ count: 1 }] }).action,
    { kind: "reading", current: 1, total: 2 },
  );
  assert.deepEqual(
    mogiOverview({
      ...final,
      races: final.races.map((race) => (race.number === 12 ? { ...race, status: "discarded" } : race)),
    }).action,
    { kind: "copy-table" },
  );

  const substituted: Mogi = registerSubstitution(
    { ...final, races: [] },
    { slotId: "p0", loungeName: "Replacement", ign: "New", fromRace: 9 },
  );
  substituted.races = final.races.map((race) => ({
    ...race,
    status: "confirmed",
    placements: participantsForRace(substituted, race.number!).map((p) => p.id),
  }));
  assert.deepEqual(mogiOverview(substituted).action, { kind: "questions", count: 1 });
  assert.deepEqual(
    mogiQuestions(substituted).map((q) => q.kind),
    ["credit"],
  );
  assert.equal(mogiOverview(substituted).count, 12);
  assert.equal(mogiOverview(substituted).positions[11].state, "counted");
  assert.ok(mogiOverview(substituted).positions.every((position) => position.questionCount === 0));
  assert.deepEqual(mogiOverview({ ...substituted, creditedParticipantIds: { p0: "p0" } }).action, {
    kind: "copy-submit",
  });
});

test("mogiPlayerChanges waits for two counted races", () => {
  const first = { id: "r1", number: 1, origin: "manual" as const, placements: mogi.participants.map((p) => p.id) };
  assert.deepEqual(mogiPlayerChanges({ ...mogi, races: [first] }), []);
});

test("stored name questions reach the header and their counted race without UI bookkeeping", () => {
  const current: Mogi = {
    ...mogi,
    races: [
      { id: "r1", number: 1, origin: "manual", placements: mogi.participants.map((p) => p.id), captureIds: ["c"] },
    ],
    captures: [
      {
        id: "c",
        width: 1920,
        height: 1080,
        rows: [{ text: "Unclear", confidence: 30, uncertain: true, suggestedParticipantId: "p0" }],
        nameAssociations: [{ participantId: null }],
        stage: "finish-order-confirmed",
        reviewedAt: "",
        reviewedPlacements: [],
      },
    ],
  };
  const overview = mogiOverview(current);
  assert.deepEqual(overview.action, { kind: "questions", count: 1 });
  assert.equal(overview.positions[0].state, "questions");
});

test("an unnumbered source waits at the next available position without becoming a counted race", () => {
  const current: Mogi = {
    ...mogi,
    captures: [
      {
        id: "unknown",
        stage: "finish-order-confirmed",
        width: 1920,
        height: 1080,
        rows: [{ text: "Unclear", confidence: 30, uncertain: true, suggestedParticipantId: "p0" }],
        reviewedAt: "",
        reviewedPlacements: [],
      },
    ],
  };
  const overview = mogiOverview(current);
  assert.equal(overview.positions[0].state, "questions");
  assert.equal(overview.positions[0].questionCount, 2);
  assert.equal(overview.count, 0);
});

test("a team question without a capture counts in the header without marking a race", () => {
  const current: Mogi = {
    ...mogi,
    format: "2v2",
    participants: mogi.participants.map((person, index) => ({
      ...person,
      teamId: index ? `t${Math.floor(index / 2)}` : undefined,
    })),
    teams: Array.from({ length: 6 }, (_, index) => ({ id: `t${index}`, name: `Team ${index + 1}` })),
  };
  assert.deepEqual(mogiOverview(current).action, { kind: "questions", count: 1 });
  assert.ok(
    mogiOverview(current).positions.every((position) => position.state === "future" && position.questionCount === 0),
  );
});

test("reading takes precedence over questions and counted results without moving their positions", () => {
  const current: Mogi = {
    ...mogi,
    captures: [
      {
        id: "c",
        width: 1920,
        height: 1080,
        stage: "context",
        reviewedAt: "",
        reviewedPlacements: [],
        rows: [0, 1, 2].map((index) => ({
          text: `Unknown ${index}`,
          confidence: 20,
          uncertain: true,
          suggestedParticipantId: `p${index}`,
        })),
        nameAssociations: [0, 1, 2].map(() => ({ participantId: null })),
      },
    ],
    races: [
      { id: "r1", number: 1, origin: "manual", status: "confirmed", placements: mogi.participants.map((p) => p.id) },
      { id: "r2", number: 2, origin: "manual", status: "pending", placements: [], captureIds: ["c"] },
      {
        id: "discarded",
        number: 3,
        origin: "manual",
        status: "discarded",
        placements: mogi.participants.map((p) => p.id),
      },
    ],
  };
  const overview = mogiOverview(current, {
    reading: { current: 1, total: 2, numbers: [3, 4] },
    questions: [{ number: 2, count: 3, raceId: "r2" }],
  });
  assert.deepEqual(overview.action, { kind: "reading", current: 1, total: 2 });
  assert.deepEqual(
    overview.positions.slice(0, 5).map((p) => p.state),
    ["counted", "questions", "reading", "reading", "future"],
  );
  assert.equal(overview.positions[0].raceId, "r1");
  assert.equal(overview.positions[1].raceId, "r2");
});

test("a question about a received image counts in the header before any race exists", () => {
  const overview = mogiOverview(mogi, { imageQuestions: [{}] });
  assert.deepEqual(overview.action, { kind: "questions", count: 1 });
  assert.equal(overview.positions[0].questionCount, 1);
});
