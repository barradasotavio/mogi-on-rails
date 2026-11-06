import { acceptNameAssociations } from "../names/name-associations.ts";
import { participantsForOccurrence } from "../participation/participation.ts";
import { raceNumber } from "../scoring/scoring.ts";
import { cumulativeRaceDependsOnSource, withoutCumulativeRaceResult } from "../sequence/first-race.ts";
import type { Capture, Mogi, RaceReviewFields } from "../types.ts";
import { acceptedCaptureEvidence, reconcileCaptureEvidence } from "./capture-evidence.ts";
import { screenProperties } from "./screens.ts";

export function contextPhase(capture: Pick<Capture, "interpretation">): "before" | "after" | "event-final" {
  return screenProperties(capture.interpretation?.screen)?.moment ?? "after";
}
/** A pre-race source describes the next physical occurrence at its cumulative boundary. */
export function capturePhaseOffset(capture: Pick<Capture, "interpretation">): number {
  return screenProperties(capture.interpretation?.screen)?.offset ?? 0;
}
/** Accept a source, not a fabricated race. Call inside the latest-state serialized persist. */
export function applyCaptureContext<T extends Mogi, C extends Capture>(
  mogi: T,
  source: C,
  fields: RaceReviewFields,
  targetId?: string,
  derived = false,
): T {
  const target = targetId ? mogi.races.find((race) => race.id === targetId) : undefined;
  if (targetId && !target) throw new Error("The race for this screenshot changed. Choose again.");
  const eligible = new Set(
    (target ? participantsForOccurrence(mogi, target) : mogi.participants).map((person) => person.id),
  );
  const seen = new Set<string>();
  for (const answer of fields.nameAssociations ?? [])
    if (answer.participantId) {
      if (!eligible.has(answer.participantId) || seen.has(answer.participantId))
        throw new Error("Check the links and the participation span for this screenshot.");
      seen.add(answer.participantId);
    }
  if (
    fields.nextTrackAnswer !== undefined &&
    (contextPhase(source) !== "before" ||
      typeof fields.nextTrackAnswer !== "string" ||
      !fields.nextTrackAnswer.trim() ||
      fields.nextTrackAnswer.length > 120)
  )
    throw new Error("Check the next track name you entered.");
  const capture = {
    ...source,
    stage: "context",
    context: { phase: contextPhase(source), ...(target ? { raceId: target.id } : {}) },
    contextDraft: undefined,
    nextTrackAnswer: fields.nextTrackAnswer?.trim(),
    nameAssociations: fields.nameAssociations,
    numericAnswers: fields.numericAnswers,
    groupTotalAnswers: fields.groupTotalAnswers,
    reviewedAt: new Date().toISOString(),
    reviewedPlacements: [],
  };
  const complete =
    capture.rows.length > 0 &&
    capture.nameAssociations?.length === capture.rows.length &&
    capture.nameAssociations.every((answer) => answer.participantId);
  const named = target && complete ? acceptNameAssociations(mogi, capture, raceNumber(mogi, target), target.id) : mogi;
  const races = named.races.map((race) => {
    const wasAssociated = race.captureIds?.includes(capture.id);
    const selected = race.id === target?.id;
    const projected =
      selected && complete && capture.context?.phase !== "before" ? acceptedCaptureEvidence(capture, race) : undefined;
    const evidence =
      wasAssociated || selected
        ? reconcileCaptureEvidence(race.gameEvidence, projected, wasAssociated ? capture.id : undefined)
        : race.gameEvidence;
    const previous = mogi.captures?.find((entry) => entry.id === capture.id);
    const result =
      previous && cumulativeRaceDependsOnSource(mogi, race, previous) ? withoutCumulativeRaceResult(race) : race;
    return wasAssociated || selected
      ? {
          ...result,
          captureIds: selected
            ? [...new Set([...(race.captureIds ?? []), capture.id])]
            : race.captureIds?.filter((id) => id !== capture.id),
          gameEvidence: evidence,
          gameEvidenceHistory:
            race.gameEvidence && JSON.stringify(race.gameEvidence) !== JSON.stringify(evidence)
              ? [
                  ...(race.gameEvidenceHistory ?? []),
                  { changedAt: new Date().toISOString(), evidence: race.gameEvidence },
                ]
              : race.gameEvidenceHistory,
        }
      : race;
  });
  return {
    ...named,
    races,
    ...(named.sequence && !derived
      ? {
          sequence: {
            ...named.sequence,
            associations: named.sequence.associations?.filter((entry) => entry.captureId !== source.id),
          },
        }
      : {}),
    captures: mogi.captures?.some((entry) => entry.id === capture.id)
      ? mogi.captures.map((entry) => (entry.id === capture.id ? capture : entry))
      : [...(mogi.captures ?? []), capture],
  };
}
