import { participantsForOccurrence } from "../participation/participation.ts";
import { nativePlacementPoints } from "../scoring/scoring.ts";
import type { Mogi, Race } from "../types.ts";

export const lostInferredNumberReview = "The inferred number lost its support. Enter the number for this race.";
/** Marks the projected races while the sequence conflicts; withdrawn once it no longer does. */
export const sequenceConflictReview = "The sequence changed. Check this race before using its breakdown.";
/** Wordings saved before a copy change; stored reviews are compared by text, so they read as the current ones. */
const earlierReviews: Record<string, string> = {
  "The inferred number lost its support. Enter the number for this occurrence.": lostInferredNumberReview,
  "The sequence changed. Check this occurrence before using its breakdown.": sequenceConflictReview,
};
export function withCurrentReviews<T extends Mogi>(mogi: T): T {
  if (!mogi.races.some((race) => race.participationReview && earlierReviews[race.participationReview])) return mogi;
  return {
    ...mogi,
    races: mogi.races.map((race) =>
      race.participationReview && earlierReviews[race.participationReview]
        ? { ...race, participationReview: earlierReviews[race.participationReview] }
        : race,
    ),
  };
}

/** Independent facts can contradict the declared native12 scope; derived results cannot support it. */
export function native12OriginScope(
  mogi: Mogi,
  races: Race[],
  people: Iterable<string>,
  allowNumberReview = false,
): boolean {
  const ids = new Set(people),
    scale = nativePlacementPoints(12);
  const scope = new Set(races.map((race) => race.id));
  if (ids.size !== 12 || mogi.assistance?.facts.some((fact) => scope.has(fact.raceId) && fact.position === "absent"))
    return false;
  return races.every((race) => {
    const eligible = participantsForOccurrence(mogi, race);
    if (
      race.status === "discarded" ||
      (race.participationReview && !(allowNumberReview && race.participationReview === lostInferredNumberReview)) ||
      eligible.length !== 12 ||
      eligible.some((person) => !ids.has(person.id))
    )
      return false;
    if (race.origin === "reconstructed") return true;
    if (race.absentParticipantIds?.length) return false;
    if (!race.placements.length) return true;
    return (
      race.placements.length === 12 &&
      !race.absentParticipantIds?.length &&
      race.placements.every(
        (id, index) => ids.has(id) && (race.nativePoints?.[id] === undefined || race.nativePoints[id] === scale[index]),
      )
    );
  });
}
