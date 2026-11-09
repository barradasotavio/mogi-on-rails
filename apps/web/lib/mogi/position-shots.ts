import { captureNameAssociations, contextPhase, type PositionQuestion } from "@mkw/engine";

import { captureLabel, chronological, imageRace } from "./capture-label.ts";
import type { Capture, Mogi } from "./types.ts";

/**
 * The screenshots a position question is answered from: the race's results screen when there is one, otherwise
 * the nearest totals before the race and after it. Chronological, each with its moment and the person's row when linked.
 */
export function positionShots(mogi: Mogi, question: Pick<PositionQuestion, "number" | "participantId">) {
  const number = question.number;
  if (number === undefined) return [];
  const placed = chronological(mogi, mogi.captures ?? []).map((capture) => ({
    capture,
    number: imageRace(mogi, capture),
    moment: capture.context?.phase ?? contextPhase(capture),
  }));
  const results = placed.filter((entry) => entry.number === number && entry.moment === "after");
  // The final standings come after the last race whether or not they carry its number.
  const later = (entry: (typeof placed)[number]) =>
    entry.moment === "event-final" ? (entry.number ?? number) >= number : (entry.number ?? 0) > number;
  const bounds = [
    placed.findLast((entry) => entry.number !== undefined && !later(entry) && entry.number <= number),
    placed.find(later),
  ].filter((entry) => !!entry);
  return (results.length ? results : bounds).map(({ capture }) => ({
    capture,
    label: captureLabel(mogi, capture),
    row: personRow(capture, question.participantId),
  }));
}

function personRow(capture: Capture, participantId: string) {
  const index = captureNameAssociations(capture).findIndex((entry) => entry.participantId === participantId);
  return index < 0 ? undefined : index + 1;
}
