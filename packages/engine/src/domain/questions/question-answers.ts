import { applyCaptureContext } from "../capture/capture-context.ts";
import { applyReviewedRace, initialRaceReview } from "../mogi/race-review.ts";
import { answerNameQuestion, type NameQuestionAnswer } from "../names/name-answers.ts";
import { participationSlot } from "../participation/participation.ts";
import { assistanceTargets, setAssistanceAnalysis, solveAssistance } from "../reconstruction/assistance.ts";
import { changePositionFact } from "../reconstruction/known-positions.ts";
import { raceNumber, resultCoverage } from "../scoring/scoring.ts";
import { reconcileSequence, sequenceInputSignature } from "../sequence/sequence.ts";
import { sourcePairSignature } from "../sequence/source-pair-signature.ts";
import type { Mogi } from "../types.ts";
import { captureNameAssociations, mogiQuestions, questionOccurrence } from "./mogi-questions.ts";
import { applySequenceAnswer } from "./sequence-answer.ts";

export type MogiQuestionAnswer =
  | { kind: "name"; answer: NameQuestionAnswer }
  | { kind: "points"; value: number }
  | { kind: "race"; value: number | "reopening" }
  | { kind: "team" | "credit"; value: string }
  | { kind: "sequence"; value: string }
  | { kind: "position"; value: number | "absent" };

/** The answer is checked again against the current state of the serialized write. */
export async function answerMogiQuestion<T extends Mogi>(mogi: T, id: string, answer: MogiQuestionAnswer): Promise<T> {
  const question = mogiQuestions(mogi).find((question) => question.id === id);
  if (!question || question.kind !== answer.kind) throw new Error("This question changed. Open the questions again.");
  if (question.kind === "name" && answer.kind === "name") return answerNameQuestion(mogi, id, answer.answer);
  if (question.kind === "credit" && answer.kind === "credit") {
    if (!question.options.some((option) => option.value === answer.value))
      throw new Error("Choose a player from this participation.");
    return { ...mogi, creditedParticipantIds: { ...mogi.creditedParticipantIds, [question.slotId]: answer.value } };
  }
  if (question.kind === "sequence" && answer.kind === "sequence") {
    const option = question.options.find((option) => option.value === answer.value);
    if (!option) throw new Error("Choose an answer.");
    const next = applySequenceAnswer(mogi, option.answer, sequenceInputSignature(mogi));
    return ["room-order", "representation"].includes(option.answer.kind) ? reconcileSequence(next) : next;
  }
  if (question.kind === "race" && answer.kind === "race") {
    if (![...question.options, ...(question.otherRaces ?? [])].some((option) => option.value === answer.value))
      throw new Error("Choose an available race.");
    if (question.sessionCaptureIds && typeof answer.value === "number") {
      const plan = mogi.sequence!.roomAnalysis!;
      const first = plan.captures.find((c) => c.captureId === question.captureId)!;
      let next = mogi;
      for (const id of question.sessionCaptureIds) {
        const entry = plan.captures.find((c) => c.captureId === id)!;
        // Without local race positions, the answer numbers only the capture asked about.
        const offset =
          entry.j !== undefined && first.j !== undefined
            ? entry.j - first.j
            : id === question.captureId
              ? 0
              : undefined;
        if (offset === undefined) continue;
        next = applySequenceAnswer(
          next,
          { kind: "number", captureId: id, value: answer.value + offset },
          sequenceInputSignature(next),
        );
      }
      return reconcileSequence(next);
    }
    const number = answer.value === "reopening" ? resultCoverage(mogi).through + 1 : answer.value;
    const capture = mogi.captures!.find((source) => source.id === question.captureId)!;
    const target = mogi.races.find((race) => race.status !== "discarded" && raceNumber(mogi, race) === number);
    let next = target
      ? applyCaptureContext(
          mogi,
          capture,
          {
            placements: [],
            absentParticipantIds: [],
            reviewed: false,
            nameAssociations: captureNameAssociations(capture),
            numericAnswers: capture.numericAnswers,
            groupTotalAnswers: capture.groupTotalAnswers,
            nextTrackAnswer: capture.nextTrackAnswer,
          },
          target.id,
        )
      : mogi;
    next = applySequenceAnswer(
      next,
      { kind: "number", captureId: capture.id, value: number },
      sequenceInputSignature(next),
    );
    if (answer.value === "reopening") {
      const previous = [...(mogi.captures ?? [])]
        .filter((source) => source.id !== capture.id)
        .sort((a, b) => (questionOccurrence(mogi, b).number ?? 0) - (questionOccurrence(mogi, a).number ?? 0))[0];
      if (previous)
        next = {
          ...next,
          sequence: {
            ...next.sequence!,
            links: [
              ...next.sequence!.links.filter(
                (link) =>
                  !(link.fromCaptureId === previous.id && link.toCaptureId === capture.id) &&
                  !(link.fromCaptureId === capture.id && link.toCaptureId === previous.id),
              ),
              {
                fromCaptureId: previous.id,
                toCaptureId: capture.id,
                signature: sourcePairSignature(previous, capture),
                continuity: "reset",
              },
            ],
          },
        };
    }
    return reconcileSequence(next);
  }
  if (question.kind === "team" && answer.kind === "team") {
    if (!question.options.some((option) => !option.disabled && option.value === answer.value))
      throw new Error("Choose a team with a free place.");
    const slot = participationSlot(mogi.participants.find((person) => person.id === question.participantId)!);
    return {
      ...mogi,
      participants: mogi.participants.map((person) =>
        participationSlot(person) === slot ? { ...person, teamId: answer.value } : person,
      ),
    };
  }
  if (question.kind === "position" && answer.kind === "position") {
    if (!question.options.some((option) => option.value === answer.value))
      throw new Error("Choose an available position.");
    const next = changePositionFact(mogi, {
      raceId: question.raceId!,
      participantId: question.participantId,
      position: answer.value,
    });
    return setAssistanceAnalysis(next, await solveAssistance(next, assistanceTargets(next), next.assistance!.facts));
  }
  if (question.kind === "points" && answer.kind === "points") {
    if (!Number.isSafeInteger(answer.value) || answer.value < 0 || answer.value > 9999)
      throw new Error("Enter points from 0 to 9999.");
    const source = mogi.captures!.find((source) => source.id === question.captureId)!;
    const capture = {
      ...source,
      numericAnswers: [
        ...(source.numericAnswers ?? []).filter((answer) => answer.row !== question.row),
        { row: question.row, field: "right" as const, value: answer.value },
      ],
    };
    const { race } = questionOccurrence(mogi, capture);
    const fields = {
      ...(race ? initialRaceReview(race) : { placements: [], absentParticipantIds: [], reviewed: false }),
      nameAssociations: captureNameAssociations(capture),
      numericAnswers: capture.numericAnswers,
      groupTotalAnswers: capture.groupTotalAnswers,
      nextTrackAnswer: capture.nextTrackAnswer,
    };
    if (capture.context)
      return applyCaptureContext(
        mogi,
        capture,
        fields,
        race?.id,
        mogi.sequence?.associations?.some((entry) => entry.captureId === capture.id),
      );
    if (race && race.status !== "pending" && fields.nameAssociations.every((answer) => answer.participantId))
      return applyReviewedRace(mogi, race, capture);
    return { ...mogi, captures: mogi.captures!.map((source) => (source.id === capture.id ? capture : source)) };
  }
  throw new Error("This question changed. Open the questions again.");
}
