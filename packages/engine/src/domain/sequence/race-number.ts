import { contextPhase } from "../capture/capture-context.ts";
import { screenProperties } from "../capture/screens.ts";
import type { CaptureSequence } from "../types.ts";
import { recordRoomExplanation, roomExplanationSteps } from "./capture-explanation.ts";
import type { OccurrenceNode } from "./occurrences.ts";
import type { RoomAnalysis } from "./room/room-sequence.ts";
import type { Capture, Mogi } from "./sequence-input-signature.ts";

/** race.finish-order: a result screen without one legible total takes the race whose established placements
 * its accepted finish order repeats exactly, when only one race does and no other result screen holds it. */
export function finishOrderNumber(mogi: Mogi, capture: Capture): number | undefined {
  if (contextPhase(capture) !== "after" || screenProperties(capture.interpretation?.screen)?.order !== "finishOrder")
    return;
  if (capture.numericRows?.some((row) => row.right?.value != null && !row.right.uncertain)) return;
  const order = capture.nameAssociations?.map((answer) => answer.participantId);
  if (!order?.length || order.some((id) => !id) || new Set(order).size !== order.length) return;
  const matches = mogi.races.filter(
    (race) =>
      race.status === "confirmed" &&
      race.number !== undefined &&
      race.placements.length === order.length &&
      race.placements.every((id, index) => id === order[index]) &&
      !race.captureIds?.some((id) => {
        const other = mogi.captures?.find((entry) => entry.id === id);
        return other && other.id !== capture.id && contextPhase(other) === "after";
      }),
  );
  return matches.length === 1 ? matches[0].number : undefined;
}
/** race.answered: an answered number places an unrecognized screen without inventing its result. */
export function numberedCapture(mogi: Mogi, capture: Capture): boolean {
  return (
    !!capture.interpretation &&
    (screenProperties(capture.interpretation.screen).order !== "unknown" ||
      !!mogi.sequence?.numbers.some((fact) => fact.captureId === capture.id && fact.number != null))
  );
}

/** Record each source's race explanation on the number its occurrence finally takes. */
export function recordRaceNumberExplanations(
  input: Mogi,
  captures: Capture[],
  nodes: OccurrenceNode[],
  numbers: CaptureSequence["numbers"],
  roomAnalysis: RoomAnalysis,
): void {
  // Keep explanations on the same final decisions that establish each occurrence.
  for (const capture of captures) {
    const occurrence = nodes.find((node) => node.occurrence.captureIds.includes(capture.id))?.occurrence;
    const fact = numbers.find((fact) => fact.captureId === capture.id && fact.phase === contextPhase(capture));
    const steps = roomExplanationSteps(roomAnalysis).filter((step) => step.subject === capture.id);
    const rest = steps.filter((step) => step.kind !== "race");
    const race = steps.find((step) => step.kind === "race");
    recordRoomExplanation(roomAnalysis, [
      ...roomExplanationSteps(roomAnalysis).filter((step) => step.subject !== capture.id),
      ...(fact
        ? [
            {
              kind: "race" as const,
              subject: capture.id,
              value: occurrence?.number ?? fact.number,
              origin: "answered" as const,
              rule: "race.answered" as const,
              evidence: {},
            },
            ...rest,
          ]
        : occurrence?.number !== undefined && race
          ? [{ ...race, value: occurrence.number }, ...rest]
          : occurrence?.number !== undefined && finishOrderNumber(input, capture) === occurrence.number
            ? [
                {
                  kind: "race" as const,
                  subject: capture.id,
                  value: occurrence.number,
                  origin: "deduced" as const,
                  rule: "race.finish-order" as const,
                  evidence: {},
                },
                ...rest,
              ]
            : rest),
    ]);
  }
}
