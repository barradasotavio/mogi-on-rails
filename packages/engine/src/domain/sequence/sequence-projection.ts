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

/** A confirmed observed race shows the screenshots its occurrence holds. Older versions, and finish order screens
 * accepted before the race had a link, left `captureIds` empty although the occurrence still maps the race to its
 * screen; a screenshot already linked to another race stays there. Only the link changes, never the result. */
export function withOccurrenceScreenshots<T extends Mogi>(mogi: T): T {
  const present = new Set(mogi.captures?.map((capture) => capture.id));
  const linked = new Set(mogi.races.flatMap((race) => race.captureIds ?? []));
  let changed = false;
  const races = mogi.races.map((race) => {
    if (race.origin !== "observed" || race.status !== "confirmed") return race;
    const missing = (mogi.sequence?.occurrences ?? [])
      .filter((occurrence) => occurrence.raceId === race.id)
      .flatMap((occurrence) => occurrence.captureIds)
      .filter((id) => present.has(id) && !linked.has(id));
    if (!missing.length) return race;
    changed = true;
    for (const id of missing) linked.add(id);
    return { ...race, captureIds: [...(race.captureIds ?? []), ...new Set(missing)] };
  });
  return changed ? { ...mogi, races } : mogi;
}
