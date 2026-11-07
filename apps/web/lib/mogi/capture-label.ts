import { contextPhase, momentLabels, raceNumber } from "@mkw/engine";

import type { Capture, Mogi } from "./types.ts";

/** Numbering and association remain engine facts; this only presents existing facts. */
export function imageRace(mogi: Mogi, capture: Capture) {
  const race = captureRace(mogi, capture);
  return race
    ? raceNumber(mogi, race)
    : (mogi.sequence?.numbers.find((entry) => entry.captureId === capture.id)?.number ?? undefined);
}

/** The race a screenshot belongs to: its proof, its pre-race context or its sequence association. */
export function captureRace(mogi: Mogi, capture: Capture) {
  const association = mogi.sequence?.associations?.find((entry) => entry.captureId === capture.id);
  return mogi.races.find(
    (race) =>
      race.captureIds?.includes(capture.id) || race.id === capture.context?.raceId || race.id === association?.raceId,
  );
}

export function imageMoment(capture?: Capture) {
  if (!capture) return "not read";
  return momentLabels[capture.context?.phase ?? contextPhase(capture)].toLowerCase();
}

/** "Race N · after the race", like the Images list; a pending image has no capture yet. */
export function imageLabel(number: number | undefined, capture?: Capture) {
  return `${number ? `Race ${number}` : "Race not assigned"} · ${imageMoment(capture)}`;
}

export function captureLabel(mogi: Mogi, capture: Capture, number = imageRace(mogi, capture)) {
  return imageLabel(number, capture);
}

const momentOrder = { before: 0, after: 1, "event-final": 2 } as const;
/** Chronological display order: race and moment; without numbering, preserve received order. */
export function chronological(mogi: Mogi, captures: Capture[]) {
  return captures
    .map((capture, index) => ({
      capture,
      index,
      number: imageRace(mogi, capture) ?? Infinity,
      moment: momentOrder[capture.context?.phase ?? contextPhase(capture)],
    }))
    .sort((a, b) =>
      a.number === Infinity || b.number === Infinity
        ? a.index - b.index
        : a.number - b.number || a.moment - b.moment || a.index - b.index,
    )
    .map((entry) => entry.capture);
}
