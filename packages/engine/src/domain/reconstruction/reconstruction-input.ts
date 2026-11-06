import { raceNumber } from "../scoring/scoring.ts";
import type { Mogi, Race } from "../types.ts";
import { sha256Hex } from "./sha256.ts";
/** Derived outputs never support their own numerical inference. */
export function reconstructionSourceSignature(mogi: Mogi, target: Race): string {
  return JSON.stringify([
    mogi.substitutions ?? [],
    ...(mogi.races.some((race) => race.physicalNumber !== undefined)
      ? [mogi.races.map((race) => [race.id, race.physicalNumber, race.status === "discarded"])]
      : []),
    mogi.orderReview && [mogi.orderReview.raceIds, mogi.orderReview.basis],
    mogi.races.map((r) =>
      r.id === target.id || r.origin === "reconstructed" || (r.status === "pending" && !r.placements.length)
        ? [r.id, raceNumber(mogi, r), "derived", r.participationReview]
        : [
            r.id,
            raceNumber(mogi, r),
            r.status,
            r.placements,
            r.absentParticipantIds,
            r.nativePoints,
            r.nativePointOrigins,
            r.gameEvidence,
            r.captureIds,
            r.participationReview,
          ],
    ),
    mogi.captures?.map((c) => [
      c.id,
      c.fingerprint,
      c.numericRows,
      c.rows,
      c.reviewedPlacements,
      c.nameAssociations,
      c.interpretation,
      c.numericAnswers,
      ...(c.context !== undefined || c.groupTotalAnswers !== undefined
        ? [{ context: c.context, groupTotalAnswers: c.groupTotalAnswers }]
        : []),
    ]),
    mogi.deletedCaptureIds,
    ...(mogi.sequence ? [[mogi.sequence.numbers, mogi.sequence.links, mogi.sequence.origins]] : []),
  ]);
}

/** Position facts are proof dependencies, not changes to the reviewed chronology. Stored with every proof, so a digest. */
export function reconstructionSignature(mogi: Mogi, target: Race): string {
  const source = reconstructionSourceSignature(mogi, target);
  return sha256Hex(mogi.assistance?.facts.length ? JSON.stringify([source, mogi.assistance.facts]) : source);
}
