import assert from "node:assert/strict";
import { test } from "node:test";

import { answerNameQuestion } from "@mkw/engine";

import { answerCurrentQuestion } from "./question-answers.ts";
import { mogiQuestions } from "./questions.ts";
import type { Mogi, TrackerState } from "./types.ts";

function scenario(): TrackerState {
  const participants = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    loungeName: `Player ${i}`,
    ign: `Player ${i}`,
  }));
  const mogi: Mogi = {
    id: "m",
    name: "Mogi",
    format: "FFA",
    createdAt: "2026-10-29",
    participants,
    races: [{ id: "r", number: 1, origin: "observed", status: "pending", placements: [], captureIds: ["b"] }],
    captures: [
      {
        id: "b",
        fileName: "b.jpeg",
        original: new Blob(),
        width: 1920,
        height: 1080,
        reviewedAt: "",
        reviewedPlacements: [],
        stage: "context",
        context: { phase: "after", raceId: "r" },
        rows: participants.map((person, i) => ({
          text: i < 3 ? `Reading ${i}` : person.ign,
          confidence: 90,
          uncertain: i < 3,
          suggestedParticipantId: person.id,
        })),
        nameAssociations: participants.map((person, i) => ({ participantId: i < 3 ? null : person.id })),
      },
    ],
  };
  return { version: 1, activeMogiId: "m", mogis: [mogi] };
}

test("confirming a resolved question refreshes the queue without an error or overwriting the answer", async () => {
  const state = scenario(),
    shown = mogiQuestions(state.mogis[0])[0];
  state.mogis[0] = answerNameQuestion(state.mogis[0], shown.id, { participantId: "p0" });
  const result = await answerCurrentQuestion(state, "m", shown, { kind: "name", answer: { participantId: "p1" } });
  assert.equal(result, state);
  assert.equal(mogiQuestions(result.mogis[0])[0].kind, "name");
  assert.equal(result.mogis[0].captures![0].nameAssociations![0].participantId, "p0");
});

test("the answer follows the same spelling when another capture represents the group", async () => {
  const state = scenario(),
    shown = mogiQuestions(state.mogis[0])[0];
  const capture = state.mogis[0].captures![0];
  // The write published by Tracker creates a new mogi identity.
  state.mogis[0] = {
    ...state.mogis[0],
    captures: [{ ...structuredClone(capture), id: "a" }, capture],
    races: state.mogis[0].races.map((race) => ({ ...race, captureIds: [...race.captureIds!, "a"] })),
  };
  assert.notEqual(mogiQuestions(state.mogis[0])[0].id, shown.id);
  const result = await answerCurrentQuestion(state, "m", shown, { kind: "name", answer: { participantId: "p0" } });
  assert.deepEqual(
    result.mogis[0].captures!.map((capture) => capture.nameAssociations![0].participantId),
    ["p0", "p0"],
  );
});

test("an option occupied by another answer refreshes the question without a visible error", async () => {
  const state = scenario(),
    [shown, other] = mogiQuestions(state.mogis[0]);
  state.mogis[0] = answerNameQuestion(state.mogis[0], other.id, { participantId: "p0" });
  const result = await answerCurrentQuestion(state, "m", shown, { kind: "name", answer: { participantId: "p0" } });
  assert.equal(result, state);
  assert.equal(result.mogis[0].captures![0].nameAssociations![1].participantId, "p0");
});

test("an old answer does not move to another row with the same spelling in the capture", async () => {
  const state = scenario();
  state.mogis[0].captures![0].rows[1].text = "Reading 0";
  const shown = mogiQuestions(state.mogis[0])[0];
  state.mogis[0] = answerNameQuestion(state.mogis[0], shown.id, { participantId: "p0" });
  const result = await answerCurrentQuestion(state, "m", shown, { kind: "name", answer: { participantId: "p1" } });
  assert.equal(result.mogis[0].captures![0].nameAssociations![1].participantId, null);
});
