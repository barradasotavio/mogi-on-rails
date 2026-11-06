import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { normalizeReconstructions } from "@mkw/engine";

import { emptyRealMogi, ingestReadings, raw } from "../../../../packages/engine/tests/support/real-captures.ts";
import { answerCurrentQuestion } from "./question-answers.ts";
import { mogiOverview, mogiQuestions } from "./questions.ts";
import type { TrackerState } from "./types.ts";

test("the Tiny first capture's header counts exactly the answers consumed by the app", async () => {
  const tiny = JSON.parse(
    readFileSync(
      new URL("../../../../packages/engine/tests/fixtures/tiny-numeric-readings.json", import.meta.url),
      "utf8",
    ),
  );
  const c = structuredClone(raw.captures[0]),
    reading = tiny.captures[0];
  c.rows.forEach((row, i) => Object.assign(row, reading.names[i]));
  c.numericRows!.forEach((row, i) => Object.assign(row.right, reading.right[i]));
  const initial = await ingestReadings(emptyRealMogi(), [c]);
  const header = mogiOverview(initial).action;
  assert.deepEqual(header, { kind: "questions", count: 1 });
  let state: TrackerState = { version: 1, activeMogiId: initial.id, mogis: [initial] },
    answers = 0;
  while (mogiQuestions(state.mogis[0]).length) {
    const question = mogiQuestions(state.mogis[0])[0];
    assert.equal(question.kind, "name");
    const person = state.mogis[0].participants.find((p) => p.loungeName === "iggy")!;
    state = await answerCurrentQuestion(state, initial.id, question, {
      kind: "name",
      answer: { participantId: person.id },
    });
    state = { ...state, ...(await normalizeReconstructions(state)) };
    answers++;
    assert.ok(answers <= 2, "The answer must advance the queue");
  }
  assert.equal(header.kind === "questions" ? header.count : 0, answers);
  assert.deepEqual(mogiOverview(state.mogis[0]).action, { kind: "copy-table" });
});
