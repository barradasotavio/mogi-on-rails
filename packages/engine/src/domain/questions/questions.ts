import { contextPhase } from "../capture/capture-context.ts";
import { captureNumericQuestions } from "../capture/capture-evidence.ts";
import { teamCaptureQuestions } from "../capture/team-evidence.ts";
import { sharedTotalsContinue } from "../numeric-readings/numeric-candidates.ts";
import { usefulQuestion } from "../reconstruction/known-positions.ts";
import { sequenceInputSignature } from "../sequence/sequence.ts";
import type { Capture, Mogi } from "../types.ts";

export interface ClarificationQuestion {
  id: string;
  kind:
    | "origin"
    | "number"
    | "person-continuity"
    | "continuity"
    | "validity"
    | "row-identity"
    | "source-occurrence"
    | "numeric-reading"
    | "group-evidence"
    | "representation"
    | "position";
  signature: string;
  captureIds: string[];
  mode: "pending" | "correction";
  reason: string;
  options: (string | number)[];
  captureId?: string;
  row?: number;
  participantId?: string;
  raceId?: string;
  gapId?: string;
  number?: number;
  key?: string;
}

/** Existing product question policy; UI draft bookkeeping remains with its caller. */
/** An unrecognized screen with no legible name (a game error, a loading screen) asks nothing and takes no race. */
export function blankUnknownScreen(capture: Capture): boolean {
  return capture.interpretation?.screen === "unknown" && !capture.rows.some((row) => row.text.trim());
}

export function contextQuestions(
  mogi: Mogi,
  kinds?: readonly ClarificationQuestion["kind"][],
): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = [];
  const sequence = mogi.sequence;
  let signature: string | undefined;
  const inputSignature = () => (signature ??= sequenceInputSignature(mogi));
  const add = (question: Omit<ClarificationQuestion, "signature"> & { signature?: string }) => {
    if (kinds && !kinds.includes(question.kind)) return;
    questions.push({ signature: question.signature ?? inputSignature(), ...question });
  };
  const sourceKinds: ClarificationQuestion["kind"][] = [
    "origin",
    "number",
    "source-occurrence",
    "row-identity",
    "numeric-reading",
    "group-evidence",
  ];
  const sources = !kinds || kinds.some((kind) => sourceKinds.includes(kind)) ? (mogi.captures ?? []) : [];
  for (const capture of sources) {
    if (blankUnknownScreen(capture)) continue;
    const occurrence = sequence?.occurrences.find((item) => item.captureIds.includes(capture.id));
    const attached = mogi.races.find((race) => race.captureIds?.includes(capture.id));
    const discarded = mogi.races.some(
      (race) => (race.id === occurrence?.id || race.id === attached?.id) && race.status === "discarded",
    );
    const number = occurrence?.number ?? attached?.number;
    const base = { captureId: capture.id, captureIds: [capture.id] };
    if (!discarded) {
      if (!number || sequence?.origins?.some((fact) => fact.captureId === capture.id))
        add({
          ...base,
          id: `origin:${capture.id}`,
          kind: "origin",
          mode: number ? "correction" : "pending",
          reason: "Did these totals start at zero, with all 12 in every race and no reopening or discarded race?",
          options: ["zero-valid-12", "unknown"],
        });
      add({
        ...base,
        id: `number:${capture.id}`,
        kind: "number",
        mode: number && !sequence?.conflict ? "correction" : "pending",
        number,
        reason:
          capture.context?.phase === "before"
            ? "Enter the number of the race about to start."
            : "Enter the number of the race that finished.",
        options: ["number-1-99", "unknown"],
      });
    }
    if (
      !attached &&
      !mogi.races.some(
        (race) =>
          race.id ===
          (capture.context?.raceId ?? sequence?.associations?.find((item) => item.captureId === capture.id)?.raceId),
      )
    )
      add({
        ...base,
        id: `source:${capture.id}`,
        kind: "source-occurrence",
        mode: "pending",
        reason: "Which race is this?",
        options: [],
      });
    const rows =
      capture.nameAssociations ??
      capture.rows.map((row) => ({ participantId: row.uncertain ? null : row.suggestedParticipantId }));
    rows.forEach((answer, index) => {
      if (!answer.participantId || !mogi.participants.some((person) => person.id === answer.participantId))
        add({
          ...base,
          id: `identity:${capture.id}:${index + 1}`,
          kind: "row-identity",
          row: index + 1,
          mode: "pending",
          reason: "Which participant is on this observed row?",
          options: [],
        });
    });
    // The pre-race screen of race 1 asks no points: every total is zero there.
    if (number !== 1 || contextPhase(capture) !== "before")
      for (const question of captureNumericQuestions(capture))
        add({
          ...base,
          id: `numeric:${capture.id}:${question.row}`,
          kind: "numeric-reading",
          row: question.row,
          mode: "pending",
          reason: "Check this row's uncertain total before using it as evidence.",
          options: [],
        });
    for (const question of teamCaptureQuestions(mogi, capture))
      add({
        ...base,
        id: `group:${capture.id}:${question.group}`,
        kind: "group-evidence",
        mode: "pending",
        reason: question.message,
        options: [],
      });
  }
  for (const relation of sequence?.relations ?? [])
    for (const participantId of relation.unknownParticipantIds)
      add({
        id: `person:${relation.fromCaptureId}:${relation.toCaptureId}:${participantId}`,
        kind: "person-continuity",
        captureIds: [relation.fromCaptureId, relation.toCaptureId],
        participantId,
        mode: "pending",
        reason:
          "Did this person's total restart between these screenshots? The other players are still available to check the interval.",
        options: ["reset", "unknown"],
      });
  for (const gap of sequence?.gaps ?? []) {
    const from = mogi.captures?.find((capture) => capture.id === gap.sourceCaptureIds[0]);
    const to = mogi.captures?.find((capture) => capture.id === gap.sourceCaptureIds[1]);
    if (gap.count === undefined && from && to && !sharedTotalsContinue(from, to))
      add({
        id: `continuity:${gap.id}`,
        kind: "continuity",
        gapId: gap.id,
        captureIds: gap.sourceCaptureIds,
        mode: "pending",
        reason: "Did the same twelve players keep their totals, with no reopening in this stretch?",
        options: ["continuous-12", "reset", "unknown"],
      });
    else if (gap.count !== undefined && gap.validCount === undefined)
      add({
        id: `validity:${gap.id}`,
        kind: "validity",
        gapId: gap.id,
        captureIds: gap.sourceCaptureIds,
        mode: "pending",
        reason: gap.count === 1 ? "Did this race count for the mogi?" : "Did all these races count for the mogi?",
        options: ["counted", "discarded", "unknown"],
      });
  }
  const position = !kinds || kinds.includes("position") ? usefulQuestion(mogi) : undefined;
  if (position)
    add({
      id: `position:${position.key}`,
      kind: "position",
      signature: mogi.assistance?.analysis?.inputSignature ?? inputSignature(),
      captureIds: [],
      mode: "pending",
      reason: "What was the position, or was the player absent? This tells the possible examples apart.",
      raceId: position.raceId,
      participantId: position.participantId,
      key: position.key,
      options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, "absent", "unknown"],
    });
  return questions;
}

export function captureNeedsClarification(mogi: Mogi, capture: Capture): boolean {
  const sequence = mogi.sequence;
  const race =
    mogi.races.find((race) => race.captureIds?.includes(capture.id)) ??
    mogi.races.find(
      (race) =>
        race.id ===
        (capture.context?.raceId ?? sequence?.associations?.find((entry) => entry.captureId === capture.id)?.raceId),
    );
  if (!race || race.status === "pending" || capture.context?.phase === "before" || sequence?.conflict) return true;
  const names = capture.nameAssociations
    ? capture.nameAssociations.some(
        (answer) => !answer.participantId || !mogi.participants.some((person) => person.id === answer.participantId),
      )
    : capture.rows.some(
        (row) => row.uncertain || !mogi.participants.some((person) => person.id === row.suggestedParticipantId),
      );
  return (
    names ||
    !!captureNumericQuestions(capture).length ||
    !!teamCaptureQuestions(mogi, capture).length ||
    !!sequence?.relations.some(
      (relation) =>
        (relation.fromCaptureId === capture.id || relation.toCaptureId === capture.id) &&
        relation.unknownParticipantIds.length > 0,
    )
  );
}
