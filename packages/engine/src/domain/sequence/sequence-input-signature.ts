import type { Capture as CaptureFacts, Mogi as MogiFacts } from "../types.ts";
import { withoutSequenceAssociations } from "./sequence-projection.ts";

/** Opaque product review marker blocks automatic acceptance and participates in invalidation. */
export type Capture = CaptureFacts & { contextDraft?: unknown };
export type Mogi = MogiFacts & { captures?: Capture[] };

export function sequenceInputSignature(mogi: Mogi): string {
  const input = withoutSequenceAssociations(mogi),
    projected = new Set(mogi.sequence?.projectedRaceIds ?? []);
  const manualTargets = new Set(
    input.captures?.flatMap((capture) => (capture.context?.raceId ? [capture.context.raceId] : [])) ?? [],
  );
  return JSON.stringify([
    (input.captures ?? []).map((capture) => [
      capture.id,
      capture.fingerprint,
      capture.photoMoment,
      capture.rows,
      capture.interpretation,
      capture.context,
      capture.nameAssociations,
      capture.numericAnswers,
      capture.groupTotalAnswers,
      capture.nextTrackAnswer,
      capture.numericRows,
      "contextDraft" in capture ? capture.contextDraft : undefined,
    ]),
    input.substitutions,
    input.participants.map((person) => [person.id, person.slotId]),
    input.races
      .filter((race) => race.origin !== "reconstructed")
      .filter((race) => manualTargets.has(race.id) || race.status !== "pending" || race.placements.length)
      .map((race) => [
        race.id,
        projected.has(race.id) && !manualTargets.has(race.id) ? null : race.number,
        projected.has(race.id) ? null : race.status,
        race.captureIds,
        race.placements,
        race.absentParticipantIds,
        race.nativePoints,
        race.nativePointOrigins,
        race.participationReview,
      ]),
    mogi.sequence?.numbers,
    mogi.sequence?.links,
    mogi.sequence?.origins,
    ...(mogi.races.some((race) => race.physicalNumber !== undefined)
      ? [mogi.races.map((race) => [race.id, race.physicalNumber, race.status === "discarded"])]
      : []),
  ]);
}
