import { reconcileCaptureEvidence } from "../capture/capture-evidence.ts";
import type { Mogi } from "../types.ts";

export function sequenceAssociation(mogi: Mogi, captureId: string, raceId?: string): boolean {
  return !!mogi.sequence?.associations?.some((entry) => entry.captureId === captureId && entry.raceId === raceId);
}
/** Retract only our source associations before evaluating current evidence again.
 * Manual assignments and observed finish order identities remain independent input. */
export function withoutSequenceAssociations<T extends Mogi>(mogi: T): T {
  const associations = mogi.sequence?.associations ?? [];
  return {
    ...mogi,
    captures: mogi.captures?.map((capture) =>
      sequenceAssociation(mogi, capture.id, capture.context?.raceId)
        ? { ...capture, context: { phase: capture.context!.phase } }
        : capture,
    ),
    races: mogi.races.map((race) => {
      const sources = associations.filter(
        (entry) =>
          entry.raceId === race.id &&
          mogi.captures?.some((capture) => capture.id === entry.captureId && capture.context?.raceId === race.id),
      );
      if (!sources.length) return race;
      let evidence = race.gameEvidence;
      for (const source of sources) evidence = reconcileCaptureEvidence(evidence, undefined, source.captureId);
      return {
        ...race,
        captureIds: race.captureIds?.filter((id) => !sources.some((source) => source.captureId === id)),
        gameEvidence: evidence,
      };
    }),
  };
}
