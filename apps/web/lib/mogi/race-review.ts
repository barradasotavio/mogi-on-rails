import { participantsForRace, raceNumber } from "@mkw/engine";

import type { Mogi, Race, RaceDraft, RaceReviewFields } from "./types.ts";

/** An editing baseline survives ZIP transfer without copying the whole result. */
export async function raceReviewSignature(race: Race | undefined): Promise<string | null> {
  if (!race) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(race));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function raceDraftProblem(
  mogi: Mogi,
  draft: RaceDraft,
): Promise<"race-changed" | "participation-changed" | undefined> {
  const original = mogi.races.find((race) => race.id === draft.raceId);
  // A changed baseline takes priority when both checks would reject the draft.
  if ((!original && draft.purpose === "manual") || (await raceReviewSignature(original)) !== draft.baseSignature)
    return "race-changed";
  const people = new Set(participantsForRace(mogi, draft.number).map((person) => person.id));
  if ([...draft.fields.placements, ...draft.fields.absentParticipantIds].some((id) => !people.has(id)))
    return "participation-changed";
}

/**
 * Autosave of Edit Result keeps the edit beside the race, never in it: only Save Result applies it, so
 * Discard Draft always leaves the race as it was. `expected` signs the race the editor opened, before any draft.
 */
export async function withRaceDraft<T extends Mogi>(
  mogi: T,
  race: Race,
  fields: RaceReviewFields,
  expected: string | null,
): Promise<T> {
  const existing = mogi.races.find((candidate) => candidate.id === race.id);
  if (!existing) throw new Error("The race changed. Reopen it before editing.");
  const signature = await raceReviewSignature(existing);
  if (signature !== (mogi.raceDraft?.raceId === race.id ? mogi.raceDraft.baseSignature : expected))
    throw new Error("The race changed. Go back and reopen the editor to check the current data.");
  return {
    ...mogi,
    raceDraft: {
      version: 1,
      purpose: "manual",
      raceId: race.id,
      number: race.number ?? raceNumber(mogi, race),
      baseSignature: signature,
      fields,
      updatedAt: new Date().toISOString(),
    },
  };
}
