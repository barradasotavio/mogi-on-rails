import assert from "node:assert/strict";

import { type Mogi, mogiOverview, mogiQuestions, resultCoverage } from "@mkw/engine";

/** Every count must match real pages, including in the races a group affects, and no race in conflict is a dead
 * end: it keeps at least one question that can settle it. */
export function questionsWithOverviewInvariant(mogi: Mogi) {
  const questions = mogiQuestions(mogi),
    overview = mogiOverview(mogi);
  assert.equal(overview.action.kind === "questions" ? overview.action.count : 0, questions.length);
  const waitingNumber = overview.positions.find(
    (position) => !resultCoverage(mogi).included.includes(position.number),
  )?.number;
  for (const position of overview.positions) {
    const pages = questions.filter(
      (question) =>
        question.number === position.number ||
        (question.number === undefined && question.captureId && position.number === waitingNumber) ||
        (question.kind === "name" && question.occurrences.some((occurrence) => occurrence.number === position.number)),
    );
    assert.equal(position.questionCount, pages.length);
    if (position.state === "questions") assert.ok(position.questionCount > 0);
  }
  for (const race of mogi.races)
    if (race.status === "pending" && race.reconstruction?.status === "conflict")
      assert.ok(
        questions.some((question) => question.raceId === race.id || question.number === race.number),
        `Race ${race.number} in conflict keeps a question`,
      );
  return questions;
}
