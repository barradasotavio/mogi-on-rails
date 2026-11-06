import assert from "node:assert/strict";
import { test } from "node:test";

import {
  answerMogiQuestion,
  correctSubstitutionBoundary,
  creditSuggestion,
  type Mogi,
  mogiOverview,
  mogiQuestions,
  participantsForRace,
  registerSubstitution,
  reopenCreditQuestion,
  requireParticipationReview,
  resultCoverage,
} from "@mkw/engine";

import { mogi } from "./support/mogi.ts";

function completed(fromRace: number, slotId = "p1"): Mogi {
  const state = registerSubstitution(mogi([]), { slotId, loungeName: "Replacement", ign: "New", fromRace });
  return {
    ...state,
    races: Array.from({ length: 12 }, (_, i) => ({
      id: `r${i + 1}`,
      number: i + 1,
      origin: "manual",
      status: "confirmed",
      placements: participantsForRace(state, i + 1).map((person) => person.id),
    })),
  };
}

test("credit suggests the substitute who entered from race 1 without changing the mogi", () => {
  const state = completed(1),
    before = structuredClone(state);
  assert.deepEqual(creditSuggestion(state, "p1"), {
    participantId: state.substitutions![0].incomingParticipantId,
    reason: "Subbed in from race 1",
  });
  assert.deepEqual(state, before);
});

test("credit suggests a winning substitute with four or more counted races", () => {
  for (const [from, races] of [
    [9, 4],
    [2, 11],
  ]) {
    const state = completed(from);
    assert.deepEqual(creditSuggestion(state, "p1"), {
      participantId: state.substitutions![0].incomingParticipantId,
      reason: `Played ${races} races in a winning position`,
    });
  }
});

test("credit stays with the original for short winning substitutions and losing positions", () => {
  for (const state of [completed(10), completed(12), completed(9, "p7"), completed(2, "p12")]) {
    const slot = state.substitutions![0].slotId;
    assert.deepEqual(creditSuggestion(state, slot), {
      participantId: slot,
      reason: "Original player keeps the credit",
    });
  }
  // Entering at race one takes precedence even in last place.
  const first = completed(1, "p12");
  assert.equal(creditSuggestion(first, "p12")?.participantId, first.substitutions![0].incomingParticipantId);
});

test("a tie at the FFA winning boundary counts as a winning position", () => {
  const state = completed(9, "p7");
  // Six races in sixth and six in seventh tie participations p6 and p7 at 78.
  state.races.slice(0, 6).forEach((race) => {
    [race.placements[5], race.placements[6]] = [race.placements[6], race.placements[5]];
  });
  assert.deepEqual(creditSuggestion(state, "p7"), {
    participantId: state.substitutions![0].incomingParticipantId,
    reason: "Played 4 races in a winning position",
  });
});

test("teams use their team position instead of the substitute's individual position", () => {
  for (const format of ["2v2", "3v3"] as const) {
    const size = format === "2v2" ? 2 : 3;
    const state = completed(9, "p12");
    state.format = format;
    state.teams = Array.from({ length: 12 / size }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` }));
    // p12 is last individually but plays with p1 on the winning team.
    const order = ["p1", "p12", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11"];
    state.participants = state.participants.map((person) => ({
      ...person,
      teamId: `t${Math.floor(order.indexOf(person.slotId ?? person.id) / size)}`,
    }));
    assert.equal(creditSuggestion(state, "p12")?.participantId, state.substitutions![0].incomingParticipantId);
    // p2's team is outside the winning half despite p2's individual second place.
    const losing = completed(9, "p2");
    losing.format = format;
    losing.teams = state.teams;
    const losingOrder = ["p1", "p11", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p2", "p12"];
    losing.participants = losing.participants.map((person) => ({
      ...person,
      teamId: `t${Math.floor(losingOrder.indexOf(person.slotId ?? person.id) / size)}`,
    }));
    assert.equal(creditSuggestion(losing, "p2")?.participantId, "p2");
  }
});

test("credit waits for the counted races and comparable positions, including a race-1 substitute", () => {
  for (const from of [1, 9]) {
    const state = completed(from);
    assert.equal(creditSuggestion({ ...state, races: state.races.slice(0, 11) }, "p1"), null);
    assert.equal(
      creditSuggestion(
        { ...state, races: state.races.map((race) => ({ ...race, placements: race.placements.slice(0, 11) })) },
        "p1",
      ),
      null,
    );
    const teams = {
      ...state,
      format: "2v2" as const,
      teams: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` })),
    };
    assert.equal(creditSuggestion(teams, "p1"), null);
  }
  assert.equal(creditSuggestion(mogi([]), "p1"), null);
});

test("only the last substitute's counted races qualify, without adding discarded races", () => {
  const first = registerSubstitution(mogi([]), { slotId: "p1", loungeName: "First", ign: "First", fromRace: 1 });
  for (const from of [9, 10]) {
    const state = registerSubstitution(first, { slotId: "p1", loungeName: "Last", ign: "Last", fromRace: from });
    state.races = completed(1).races.map((race) => ({
      ...race,
      physicalNumber: race.number! + (race.number! >= 10 ? 1 : 0),
      placements: participantsForRace(state, race.number!).map((person) => person.id),
    }));
    state.races.push({
      id: "discard",
      origin: "manual",
      status: "discarded",
      physicalNumber: 10,
      placements: participantsForRace(state, 10).map((person) => person.id),
    });
    assert.deepEqual(
      creditSuggestion(state, "p1"),
      from === 9
        ? {
            participantId: state.substitutions!.at(-1)!.incomingParticipantId,
            reason: "Played 4 races in a winning position",
          }
        : { participantId: "p1", reason: "Original player keeps the credit" },
    );
  }
});

test("team ties at the winning boundary include both teams", () => {
  for (const [format, order, slot] of [
    ["2v2", ["p1", "p12", "p2", "p11", "p3", "p10", "p4", "p9", "p5", "p8", "p6", "p7"], "p9"],
    ["3v3", ["p1", "p2", "p3", "p4", "p5", "p12", "p6", "p7", "p8", "p9", "p10", "p11"], "p12"],
  ] as const) {
    const state = completed(9, slot),
      size = format === "2v2" ? 2 : 3;
    state.format = format;
    state.teams = Array.from({ length: 12 / size }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` }));
    state.participants = state.participants.map((person) => ({
      ...person,
      teamId: `t${Math.floor((order as readonly string[]).indexOf(person.slotId ?? person.id) / size)}`,
    }));
    assert.equal(creditSuggestion(state, slot)?.participantId, state.substitutions![0].incomingParticipantId);
  }
});

test("credit is a crop-free question after races and stays a final blocker before it can be suggested", async () => {
  const state = completed(9);
  const pending = { ...state, races: state.races.slice(0, 11) };
  assert.deepEqual(mogiQuestions(pending), []);
  assert.ok(resultCoverage(pending).blockers.openQuestions.some((question) => question.id === "credit:p1"));
  assert.deepEqual(mogiOverview(pending).action, { kind: "copy-table" });
  const question = mogiQuestions(state).find((question) => question.kind === "credit");
  assert.ok(question);
  assert.equal(question.slotId, "p1");
  assert.equal(question.reading, "Player 1");
  assert.equal(question.crop, undefined);
  assert.equal(question.suggestion, state.substitutions![0].incomingParticipantId);
  assert.deepEqual(
    question.options.map((option) => option.value),
    ["p1", state.substitutions![0].incomingParticipantId],
  );
  assert.deepEqual(mogiOverview(state).action, { kind: "questions", count: 1 });
  await assert.rejects(() => answerMogiQuestion(state, question.id, { kind: "credit", value: "p2" }));
  const answered = await answerMogiQuestion(state, question.id, { kind: "credit", value: "p1" });
  assert.deepEqual(answered.creditedParticipantIds, { p1: "p1" });
  assert.equal(resultCoverage(answered).final, true);
  assert.deepEqual(mogiQuestions(answered), []);
  assert.equal(creditSuggestion(answered, "p1")?.participantId, state.substitutions![0].incomingParticipantId);
  await assert.rejects(() => answerMogiQuestion(answered, question.id, { kind: "credit", value: question.suggestion }));
});

test("adding, removing or correcting a substitution clears only that participation's saved credit", () => {
  const state = { ...completed(9), creditedParticipantIds: { p1: "p1", p2: "p2" } };
  const added = registerSubstitution(state, { slotId: "p1", loungeName: "Last", ign: "Last", fromRace: 10 });
  assert.deepEqual(added.creditedParticipantIds, { p2: "p2" });
  const corrected = correctSubstitutionBoundary(state, state.substitutions![0].id, 10);
  assert.deepEqual(corrected.creditedParticipantIds, { p2: "p2" });
  const removed = requireParticipationReview(state, {
    ...state,
    substitutions: [],
    participants: state.participants.filter((person) => !person.slotId),
  });
  assert.deepEqual(removed.creditedParticipantIds, { p2: "p2" });
  assert.deepEqual(state.creditedParticipantIds, { p1: "p1", p2: "p2" });
  const changedResults = { ...state, races: [...state.races].reverse() };
  assert.deepEqual(
    requireParticipationReview(state, changedResults).creditedParticipantIds,
    state.creditedParticipantIds,
  );
});

test("saved credit survives a changed suggestion and can be reopened for correction", async () => {
  const state = completed(9);
  const answered = await answerMogiQuestion(state, "credit:p1", {
    kind: "credit",
    value: state.substitutions![0].incomingParticipantId,
  });
  const changed = {
    ...answered,
    races: answered.races.map((race) => ({ ...race, placements: [...race.placements].reverse() })),
  };
  assert.equal(creditSuggestion(changed, "p1")?.participantId, "p1");
  assert.equal(changed.creditedParticipantIds!.p1, state.substitutions![0].incomingParticipantId);
  assert.deepEqual(mogiQuestions(changed), []);
  const reopened = reopenCreditQuestion(changed, "p1");
  assert.equal(mogiQuestions(reopened)[0].id, "credit:p1");
  assert.equal(reopened.creditedParticipantIds!.p1, undefined);
});

test("credit follows capture questions and keeps roster-slot order across multiple participations", () => {
  let state = registerSubstitution(mogi([]), { slotId: "p2", loungeName: "Second", ign: "Second", fromRace: 9 });
  state = registerSubstitution(state, { slotId: "p1", loungeName: "First", ign: "First", fromRace: 9 });
  state.races = completed(1).races.map((race) => ({
    ...race,
    placements: participantsForRace(state, race.number!).map((person) => person.id),
  }));
  state.captures = [
    {
      id: "known",
      width: 1920,
      height: 1080,
      stage: "context",
      reviewedAt: "",
      reviewedPlacements: [],
      context: { phase: "after", raceId: "r12" },
      rows: [{ text: "Unknown", confidence: 0, uncertain: true, suggestedParticipantId: "" }],
      nameAssociations: [{ participantId: null }],
    },
    {
      id: "unknown",
      width: 1920,
      height: 1080,
      stage: "context",
      reviewedAt: "",
      reviewedPlacements: [],
      rows: [],
      context: { phase: "after" },
    },
  ];
  assert.deepEqual(
    mogiQuestions(state).map((question) => question.id),
    ["name:known:1", "credit:p1", "credit:p2"],
  );
  // Frees a race number so the capture of an unknown race is observed too.
  state = { ...state, races: state.races.map((race, index) => (index === 11 ? { ...race, status: "pending" } : race)) };
  assert.deepEqual(
    mogiQuestions(state).map((question) => question.id),
    ["name:known:1", "race:unknown"],
  );
});
