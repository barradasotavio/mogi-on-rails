import { participantsForOccurrence, participantsForRace, raceNumber, screenProperties } from "@mkw/engine";
import { matchRows } from "@mkw/engine/browser";

import type { Capture, Mogi, Race } from "../mogi/types.ts";
import type { IntakeItem } from "./intake.ts";

/** Read into a batch item and stored with it, so a pending batch keeps the wording it was read with. */
export const identicalDuplicateNotice =
  "Identical screenshot: add it to the race already saved, without counting the race twice.";
// Every opening the notice has shipped with. Rewording it adds the new opening here; the test pins the shipped ones.
const identicalOpenings = ["Identical screenshot", "Identical image"];

/** A screenshot already saved joins its race; it never starts a new one. */
export function identicalDuplicate(item: { duplicate?: string }): boolean {
  return identicalOpenings.some((opening) => item.duplicate?.startsWith(opening));
}

/** Standings and pre-race screens show no finish order of their own, so they start no numbered race. */
export function withoutRace(capture: Capture | undefined): boolean {
  return ["general", "grouped", "none"].includes(screenProperties(capture?.interpretation?.screen)?.order ?? "");
}

/**
 * What the player reviews for `item`, read as `reading`: the race it joins (the associated race, or a new one with the
 * item's number), the players in that race, and the capture with names matched to them. An accepted item reviews the
 * mogi's stored capture (`canonical`) instead of its own reading.
 */
export function prepareIntakeReview(mogi: Mogi, item: IntakeItem, reading: Capture) {
  const existing = mogi.races.find((r) => r.id === item.association);
  const number = existing ? raceNumber(mogi, existing) : item.number;
  const participants = existing ? participantsForOccurrence(mogi, existing) : participantsForRace(mogi, number);
  const canonical = mogi.captures?.find((capture) => capture.id === (item.sourceCaptureId ?? reading.id));
  const source = canonical ?? reading;
  const rows = matchRows(source.rows, participants);
  const unreadable = source.unreadableRowNumbers ?? rows.flatMap((row, n) => (row.text.trim() ? [] : [n + 1]));
  const capture = {
    ...source,
    rows,
    unreadableRowNumbers: unreadable,
    possibleAbsentParticipantIds: unreadable.flatMap((number) =>
      rows[number - 1] ? [rows[number - 1].suggestedParticipantId] : [],
    ),
  };
  const race: Race = existing
    ? {
        ...existing,
        ...(existing.status === "pending"
          ? {
              origin: "observed" as const,
              placements: capture.rows.map((row) => row.suggestedParticipantId),
            }
          : {}),
        captureIds: [...new Set([capture.id, ...(existing.captureIds ?? [])])],
      }
    : {
        id: item.id,
        origin: "observed",
        status: item.discarded ? "discarded" : "confirmed",
        number: item.number,
        captureIds: [capture.id],
        placements: capture.rows.map((row) => row.suggestedParticipantId),
      };
  return { existing, number, participants, canonical, capture, race };
}

/**
 * Why `item` can't be saved as a new race, or null when it can (always when it joins `existing`). An empty message
 * blocks without explaining: the race number question is already on screen.
 */
export function newRaceProblem(mogi: Mogi, item: IntakeItem, existing: Race | undefined): string | null {
  if (existing) return null;
  if (item.numberKnown === false) return "";
  if (identicalDuplicate(item)) return "Add this identical screenshot to the race already saved.";
  if (mogi.races.some((r) => raceNumber(mogi, r) === item.number))
    return "This race number already exists. Add the screenshot to that race or fix the numbering.";
  return null;
}
