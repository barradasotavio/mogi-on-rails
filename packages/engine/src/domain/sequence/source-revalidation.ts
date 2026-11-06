import { screenProperties } from "../capture/screens.ts";
import { resolveCaptureNames } from "../names/name-answers.ts";
import { nameEvidence } from "../names/name-evidence.ts";
import { roomSizeNeedsAnswer } from "../numeric-readings/numeric-candidates.ts";
import { captureNameAssociations } from "../questions/mogi-questions.ts";
import type { CaptureExplanationStep } from "./capture-explanation.ts";
import { cumulativeRaceDependsOnSource, cumulativeRacePlacements, withoutCumulativeRaceResult } from "./first-race.ts";
import { analyzeRoomSequence } from "./room/room-sequence.ts";
import type { Mogi } from "./sequence-input-signature.ts";

/** Refresh each source with the room's numeric deductions and resolved names, then withdraw results obtained
 * from the cumulatives that their source and prefix no longer reproduce. */
export function revalidateSourceEvidence<T extends Mogi>(original: T) {
  const numericPlan = analyzeRoomSequence(original);
  original = {
    ...original,
    captures: original.captures?.map((capture) => ({
      ...capture,
      numericDeductions: numericPlan.captures
        .find((c) => c.captureId === capture.id)
        ?.values.map((value) => ({ ...value, field: "right" as const })),
    })),
  };
  const names = nameEvidence(original);
  let namesChanged = false;
  const nameSteps: CaptureExplanationStep[] = [];
  original = {
    ...original,
    captures: original.captures?.map((capture) => {
      const current = captureNameAssociations(capture);
      const resolved = resolveCaptureNames(original, capture, undefined, names);
      const completed = resolved.associations;
      nameSteps.push(...resolved.steps);
      if (JSON.stringify(current) === JSON.stringify(completed)) return capture;
      namesChanged = true;
      return { ...capture, nameAssociations: completed };
    }),
  };
  // Results obtained from the cumulatives stay dependent on their source and prefix.
  let revalidated = original;
  for (const race of [...original.races].sort(
    (a, b) => (a.physicalNumber ?? a.number ?? Infinity) - (b.physicalNumber ?? b.number ?? Infinity),
  )) {
    const finishOrders =
      original.captures?.filter(
        (source) =>
          race.captureIds?.includes(source.id) &&
          screenProperties(source.interpretation?.screen)?.order === "finishOrder",
      ) ?? [];
    if (
      race.origin === "observed" &&
      race.status !== "pending" &&
      race.status !== "discarded" &&
      finishOrders.some((source) => roomSizeNeedsAnswer(original, source, numericPlan)) &&
      !finishOrders.some(
        (source) =>
          !roomSizeNeedsAnswer(original, source, numericPlan) &&
          JSON.stringify(source.reviewedPlacements) === JSON.stringify(race.placements),
      )
    ) {
      revalidated = {
        ...revalidated,
        races: revalidated.races.map((entry) =>
          entry.id === race.id ? { ...withoutCumulativeRaceResult(entry), absentParticipantIds: [] } : entry,
        ),
      };
    }
    const sources = original.captures?.filter((source) => cumulativeRaceDependsOnSource(original, race, source)) ?? [];
    if (
      sources.length &&
      !sources.some(
        (source) =>
          JSON.stringify(cumulativeRacePlacements(revalidated, race, source, numericPlan)) ===
          JSON.stringify(race.placements),
      )
    )
      revalidated = {
        ...revalidated,
        races: revalidated.races.map((entry) => (entry.id === race.id ? withoutCumulativeRaceResult(entry) : entry)),
      };
  }
  return { original, revalidated, numericPlan, namesChanged, nameSteps };
}
