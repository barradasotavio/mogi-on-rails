import { answerMogiQuestion } from "@mkw/engine";

import { answerImageQuestion } from "./ingestion.ts";
import { currentQuestion, type MogiQuestion, type MogiQuestionAnswer, mogiQuestions } from "./questions.ts";
import type { TrackerState } from "./types.ts";

export async function answerCurrentQuestion(
  state: TrackerState,
  mogiId: string,
  shown: MogiQuestion,
  answer: MogiQuestionAnswer,
): Promise<TrackerState> {
  const mogi = state.mogis.find((mogi) => mogi.id === mogiId);
  const questions = mogi ? mogiQuestions(mogi) : [];
  // Repeated spellings in a capture are questions per row; an answered row keeps its target.
  if (
    shown.kind === "name" &&
    !questions.some(
      (question) =>
        question.kind === "name" &&
        [question, ...question.occurrences].some(
          (entry) => entry.captureId === shown.captureId && entry.row === shown.row,
        ),
    ) &&
    mogi?.captures?.find((capture) => capture.id === shown.captureId)?.nameAssociations?.[shown.row - 1]?.participantId
  )
    return state;
  const question = currentQuestion(questions, shown);
  if (!question || question.kind !== answer.kind) return state;
  // A choice that is no longer free needs the current page, without trying to save the old draft.
  if (
    question.kind === "name" &&
    answer.kind === "name" &&
    !question.options.some(
      (option) => option.id === (answer.answer.participantId ?? answer.answer.substitute?.replacedParticipantId),
    )
  )
    return state;
  if (
    question.kind === "team" &&
    answer.kind === "team" &&
    !question.options.some((option) => option.value === answer.value && !option.disabled)
  )
    return state;
  if (
    question.kind === "race" &&
    answer.kind === "race" &&
    ![...question.options, ...(question.otherRaces ?? [])].some((option) => option.value === answer.value)
  )
    return state;
  if (
    question.kind === "position" &&
    answer.kind === "position" &&
    !question.options.some((option) => option.value === answer.value)
  )
    return state;
  if (
    question.kind === "sequence" &&
    answer.kind === "sequence" &&
    !question.options.some((option) => option.value === answer.value)
  )
    return state;
  if (
    question.kind === "credit" &&
    answer.kind === "credit" &&
    !question.options.some((option) => option.value === answer.value)
  )
    return state;
  if (answer.kind === "image") return answerImageQuestion(state, mogiId, question.id, answer.value);
  return {
    ...state,
    mogis: await Promise.all(
      state.mogis.map((mogi) => (mogi.id === mogiId ? answerMogiQuestion(mogi, question.id, answer) : mogi)),
    ),
  };
}
