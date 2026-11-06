import assert from "node:assert/strict";
import test from "node:test";

import { type Capture, individualStandings, type Mogi, resultCoverage, teamStandings } from "@mkw/engine";

const participants = Array.from({ length: 12 }, (_, index) => ({
  id: `p${index + 1}`,
  loungeName: `Player ${index + 1}`,
  ign: `P${index + 1}`,
  teamId: `team-${Math.floor(index / 3) + 1}`,
}));
const mogi: Mogi = {
  id: "m",
  name: "Known results",
  createdAt: "2026-10-27",
  format: "3v3",
  participants,
  teams: ["A", "B", "C", "D"].map((name, index) => ({ id: `team-${index + 1}`, name })),
  races: [
    { id: "r1", origin: "manual", number: 1, placements: participants.map(({ id }) => id) },
    { id: "r2", origin: "manual", number: 2, status: "pending", placements: [] },
  ],
};
const completed: Mogi = {
  ...mogi,
  races: Array.from({ length: 12 }, (_, index) => ({
    ...mogi.races[0],
    id: `r${index + 1}`,
    number: index + 1,
  })),
};

test("twelve established races make the result final without a closing action", () => {
  assert.equal(resultCoverage(completed).final, true);
  assert.deepEqual(resultCoverage(completed).blockers, { pendingRaces: [], unknownTotals: [], openQuestions: [] });
});

test("twelve results numbered outside the expected races cannot skip race one", () => {
  const shifted = { ...completed, races: completed.races.map((race) => ({ ...race, number: race.number! + 1 })) };
  assert.equal(resultCoverage(shifted).final, false);
  assert.deepEqual(resultCoverage(shifted).blockers.pendingRaces, [1]);
});

test("eleven races and a discarded twelfth return the result to partial", async () => {
  const { applyReviewedRace } = await import("@mkw/engine");
  for (const partial of [
    { ...completed, races: completed.races.slice(0, 11) },
    applyReviewedRace(completed, { ...completed.races[11], status: "discarded" }),
  ]) {
    assert.equal(resultCoverage(partial).final, false);
    assert.deepEqual(resultCoverage(partial).blockers.pendingRaces, [12]);
  }
});

test("twelve races with an unknown total identify the participation that blocks finality", () => {
  const unknown = {
    ...completed,
    races: completed.races.map((race) => ({ ...race, placements: race.placements.slice(1) })),
  };
  assert.equal(resultCoverage(unknown).final, false);
  assert.deepEqual(resultCoverage(unknown).blockers.unknownTotals, ["p1"]);
  assert.equal(individualStandings(unknown).find(({ id }) => id === "p1")?.points, null);
  assert.equal(teamStandings(unknown).find(({ id }) => id === "team-1")?.points, null);
});

test("pending substitution credit is an open question until a player is chosen", async () => {
  const { registerSubstitution, participantsForRace, applyReviewedRace } = await import("@mkw/engine");
  let replaced = registerSubstitution(completed, { slotId: "p1", loungeName: "Replacement", ign: "New", fromRace: 12 });
  replaced = applyReviewedRace(replaced, {
    ...replaced.races[11],
    status: "confirmed",
    placements: participantsForRace(replaced, 12).map(({ id }) => id),
  });
  assert.equal(resultCoverage(replaced).complete, true);
  assert.equal(resultCoverage(replaced).final, false);
  assert.deepEqual(resultCoverage(replaced).blockers.openQuestions, [{ id: "credit:p1", kind: "credit" }]);
  const credited = { ...replaced, creditedParticipantIds: { p1: replaced.substitutions![0].incomingParticipantId } };
  assert.equal(resultCoverage(credited).final, true);
});

test("an unresolved source question prevents finality even when all totals are proven", () => {
  const capture: Capture = {
    id: "unresolved",
    width: 1920,
    height: 1080,
    rows: [],
    stage: "context",
    reviewedAt: "2026-10-27",
    reviewedPlacements: [],
    context: { phase: "after" },
  };
  const unresolved = { ...completed, captures: [capture] };
  assert.equal(resultCoverage(unresolved).complete, true);
  assert.equal(resultCoverage(unresolved).final, false);
  assert.deepEqual(
    resultCoverage(unresolved).blockers.openQuestions.map(({ kind }) => kind),
    ["origin", "number", "source-occurrence"],
  );
});

test("a known race ranks individuals and teams while a missing race stays pending", () => {
  assert.deepEqual(
    individualStandings(mogi).map(({ points, rank }) => [points, rank]),
    [
      [15, 1],
      [12, 2],
      [10, 3],
      [9, 4],
      [8, 5],
      [7, 6],
      [6, 7],
      [5, 8],
      [4, 9],
      [3, 10],
      [2, 11],
      [1, 12],
    ],
  );
  assert.deepEqual(
    teamStandings(mogi).map(({ name, points }) => [name, points]),
    [
      ["Team 1", 37],
      ["Team 2", 24],
      ["Team 3", 15],
      ["P1", 6],
    ],
  );
  assert.deepEqual(resultCoverage(mogi).included, [1]);
  assert.deepEqual(resultCoverage(mogi).pending, [2]);
  assert.equal(resultCoverage(mogi).complete, false);
});

test("ten and eleven represented players retain native scales and adjusted absence credit", async () => {
  const { nativePlacementPoints, pointsFor, raceTotal } = await import("@mkw/engine");
  assert.deepEqual(nativePlacementPoints(10), [11, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(nativePlacementPoints(11), [12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const ten = {
    id: "ten",
    origin: "manual" as const,
    placements: participants.slice(0, 10).map(({ id }) => id),
    absentParticipantIds: ["p11", "p12"],
  };
  const eleven = { ...ten, placements: participants.slice(0, 11).map(({ id }) => id), absentParticipantIds: ["p12"] };
  assert.deepEqual([raceTotal(ten), raceTotal(eleven)], [81, 82]);
  assert.deepEqual([pointsFor(ten, "p1"), pointsFor(ten, "p10"), pointsFor(ten, "p11")], [15, 3, 1]);
  assert.equal(pointsFor({ placements: ["p1", ""] }, "unreadable"), 0);
});

test("a substitution retains the slot total and chosen credit without conflating physical and valid races", async () => {
  const { registerSubstitution, participantsForRace, correctSubstitutionBoundary, pendingCreditSlots } =
    await import("@mkw/engine");
  const withDiscard: Mogi = {
    ...mogi,
    races: [
      { ...mogi.races[0], physicalNumber: 1 },
      {
        id: "discard",
        origin: "manual",
        status: "discarded",
        physicalNumber: 2,
        placements: participants.map(({ id }) => id),
      },
      { ...mogi.races[1], physicalNumber: 3 },
    ],
  };
  const changed = registerSubstitution(withDiscard, {
    slotId: "p1",
    loungeName: "Replacement",
    ign: "New",
    fromRace: 2,
  });
  const incoming = changed.participants.find(({ slotId }) => slotId === "p1")!;
  assert.equal(changed.substitutions?.[0].fromPhysicalNumber, 3);
  assert.equal(participantsForRace(changed, 1)[0].id, "p1");
  assert.equal(participantsForRace(changed, 2)[0].id, incoming.id);
  assert.deepEqual(
    pendingCreditSlots(changed).map(({ id }) => id),
    ["p1"],
  );
  const credited: Mogi = {
    ...changed,
    creditedParticipantIds: { p1: incoming.id },
    races: changed.races.map((race) =>
      race.id === "r2"
        ? { ...race, status: "confirmed", placements: [incoming.id, ...participants.slice(1).map(({ id }) => id)] }
        : race,
    ),
  };
  const leader = individualStandings(credited)[0];
  assert.deepEqual([leader.id, leader.loungeName, leader.points], ["p1", "Replacement", 30]);
  assert.equal(teamStandings(credited)[0].points, 74);
  const corrected = correctSubstitutionBoundary(credited, changed.substitutions![0].id, 3);
  assert.equal(corrected.races.find(({ id }) => id === "r2")?.status, "pending");
  assert.deepEqual(
    corrected.races.find(({ id }) => id === "r2")?.participationHistory?.[0].result.placements,
    credited.races.find(({ id }) => id === "r2")?.placements,
  );
});

test("proven cumulative totals coexist with pending detail and are never added twice", async () => {
  const { sourcePairSignature, normalizeCoverage, changePositionFact } = await import("@mkw/engine");
  const totals = [30, 24, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2];
  const capture: Capture = {
    id: "c",
    width: 1920,
    height: 1080,
    stage: "context" as const,
    rows: [],
    reviewedPlacements: [],
    reviewedAt: "2026-10-27",
    context: { phase: "after" as const },
    interpretation: {
      version: 1,
      screen: "finishOrderAdded",
      origin: "user",
      positions: [],
      movementRows: [],
      reasons: [],
    },
    nameAssociations: participants.map(({ id }) => ({ participantId: id })),
    numericRows: totals.map((value, index) => ({
      row: index + 1,
      right: {
        value,
        text: String(value),
        confidence: 100,
        uncertain: false,
        location: { x: 0, y: 0, width: 1, height: 1 },
      },
      addition: {
        value: null,
        text: "",
        confidence: 0,
        uncertain: true,
        location: { x: 0, y: 0, width: 1, height: 1 },
      },
    })),
  };
  const scoped: Mogi = {
    ...mogi,
    captures: [capture],
    sequence: {
      version: 1,
      relations: [],
      links: [],
      numbers: [],
      gaps: [],
      inputSignature: "known",
      occurrences: [{ id: "o2", aliases: [], captureIds: ["c"], number: 2 }],
      origins: [{ captureId: "c", signature: sourcePairSignature(capture, capture), answer: "zero-valid-12" }],
    },
  };
  assert.deepEqual(
    individualStandings(scoped).map(({ points }) => points),
    totals,
  );
  assert.equal(teamStandings(scoped)[0].points, 74);
  assert.deepEqual(resultCoverage(scoped).included, [1, 2]);
  assert.deepEqual(resultCoverage(scoped).detailPending, [2]);
  assert.deepEqual(resultCoverage(scoped).pending, []);
  assert.equal(resultCoverage(scoped).complete, false);
  const finalCapture: Capture = {
    ...capture,
    context: { phase: "after", raceId: "r12" },
    numericRows: capture.numericRows!.map((row) => ({ ...row, right: { ...row.right, value: row.right.value! * 6 } })),
  };
  const intervalFinal: Mogi = {
    ...scoped,
    captures: [finalCapture],
    races: [mogi.races[0], { ...mogi.races[1], id: "r12", number: 12, captureIds: [capture.id] }],
    sequence: {
      ...scoped.sequence!,
      occurrences: [{ id: "r12", aliases: [], captureIds: [capture.id], number: 12 }],
      origins: [
        { captureId: capture.id, signature: sourcePairSignature(finalCapture, finalCapture), answer: "zero-valid-12" },
      ],
    },
  };
  assert.equal(resultCoverage(intervalFinal).final, true);
  assert.deepEqual(resultCoverage(intervalFinal).detailPending, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const coverage = normalizeCoverage(scoped).coverage;
  assert.equal(coverage?.intervals[0].values[0].raw, 30);
  assert.equal(coverage?.intervals[0].values[0].adjusted, 30);
  const contradiction = changePositionFact(scoped, { raceId: "r2", participantId: "p1", position: 12 });
  assert.equal(normalizeCoverage(contradiction).coverage?.intervals.length ?? 0, 0);
  const normalized = normalizeCoverage(scoped);
  const invalid = normalizeCoverage({ ...normalized, captures: [{ ...capture, nameAssociations: [] }] });
  assert.equal(invalid.coverage?.intervals.length, 0);
  assert.equal(invalid.coverage?.history.length, 1);
  assert.deepEqual(resultCoverage(invalid).pending, [2]);
  assert.equal(individualStandings(invalid)[0].points, 15);
});

test("before any counted race every total is a known zero", () => {
  const fresh: Mogi = { ...mogi, races: [] };
  assert.deepEqual(
    individualStandings(fresh).map(({ points }) => points),
    Array(12).fill(0),
  );
  assert.deepEqual(resultCoverage(fresh).blockers.unknownTotals, []);
  assert.equal(resultCoverage(fresh).final, false);
});
