import { acceptedCaptureEvidence, reconcileCaptureEvidence } from "../capture/capture-evidence.ts";
import { acceptNameAssociations } from "../names/name-associations.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import { countedRaces, materializePendingGaps, nextRaceNumber, raceNumber } from "../scoring/scoring.ts";
import type { Capture, Mogi, Participant, Race, RaceReviewFields } from "../types.ts";
export function initialRaceReview(race: Race): RaceReviewFields {
  return {
    placements: race.placements.filter((id) => !race.absentParticipantIds?.includes(id)),
    absentParticipantIds: race.absentParticipantIds ?? [],
    rawOverrides: Object.fromEntries(
      Object.entries(race.nativePoints ?? {})
        .filter(([id]) => race.nativePointOrigins?.[id] !== "modeled")
        .map(([id, points]) => [id, String(points)]),
    ),
    reviewed: false,
  };
}

export function reviewedRace(race: Race, fields: RaceReviewFields, participants: Participant[]): Race | null {
  const people = new Set(participants.map((person) => person.id));
  const ids = [...fields.placements, ...fields.absentParticipantIds];
  if (
    fields.placements.length < 10 ||
    fields.placements.length > 12 ||
    fields.absentParticipantIds.length > 2 ||
    ids.length !== 12 ||
    new Set(ids).size !== 12 ||
    ids.some((id) => !people.has(id))
  )
    return null;
  if (
    fields.placements.some((id) => {
      const value = fields.rawOverrides[id];
      return (
        value !== undefined &&
        (value.trim() === "" || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 15)
      );
    })
  )
    return null;
  const scale = nativePlacementPoints(fields.placements.length);
  return {
    ...race,
    placements: fields.placements,
    absentParticipantIds: fields.absentParticipantIds,
    nativePoints: Object.fromEntries(
      fields.placements.map((id, position) => [id, Number(fields.rawOverrides[id] ?? scale[position])]),
    ),
    nativePointOrigins: Object.fromEntries(
      fields.placements.map((id) => [id, fields.rawOverrides[id] === undefined ? "modeled" : "manual"]),
    ),
  };
}

/** One confirmation transition for manual edits, capture review and autosave. */
export function applyReviewedRace<T extends Mogi, C extends Capture>(
  mogi: T,
  input: Race,
  capture?: C,
  derived = false,
): T {
  const existing = mogi.races.find((item) => item.id === input.id);
  let race = !capture && input.origin === "observed" ? { ...input, origin: "manual" as const } : input;
  if (race.origin === "reconstructed")
    race = {
      ...race,
      origin: capture ? "observed" : "manual",
      reconstructionHistory: race.reconstruction
        ? [...(race.reconstructionHistory ?? []), race.reconstruction]
        : race.reconstructionHistory,
      reconstruction: undefined,
      assistedGroupId: undefined,
    };
  if (
    (race.status ?? "confirmed") !== "discarded" &&
    !countedRaces(mogi).some((item) => item.id === race.id) &&
    countedRaces(mogi).length >= 12
  )
    throw new Error("12 races already count. Discard another one first.");
  race = {
    ...race,
    ...(mogi.races.some((entry) => entry.physicalNumber !== undefined)
      ? {
          physicalNumber:
            existing?.physicalNumber ??
            race.physicalNumber ??
            Math.max(0, ...mogi.races.map((entry) => entry.physicalNumber ?? entry.number ?? 0)) + 1,
        }
      : {}),
    status: race.status === "discarded" ? "discarded" : "confirmed",
    participationReview: undefined,
    number: race.number ?? (existing ? raceNumber(mogi, existing) : nextRaceNumber(mogi)),
  };
  if (!existing && mogi.races.some((item) => item.status !== "discarded" && raceNumber(mogi, item) === race.number)) {
    throw new Error("This race number is already taken. Check the recorded race before confirming another.");
  }
  if (!capture && existing?.participationReview && race.gameEvidence) {
    const active = new Set([...race.placements, ...(race.absentParticipantIds ?? [])]);
    const evidence = race.gameEvidence;
    const readings = Object.fromEntries(Object.entries(evidence.readings).filter(([id]) => active.has(id)));
    if (Object.keys(readings).length !== Object.keys(evidence.readings).length)
      race = {
        ...race,
        gameEvidence: {
          ...evidence,
          readings,
          verified: evidence.verified && Object.values(readings).some((reading) => reading.useAsAnchor),
        },
        gameEvidenceHistory: [...(race.gameEvidenceHistory ?? []), { changedAt: new Date().toISOString(), evidence }],
      };
  }
  const projected = capture && acceptedCaptureEvidence(capture, race);
  const unchanged =
    existing &&
    JSON.stringify([existing.placements, [...(existing.absentParticipantIds ?? [])].sort()]) ===
      JSON.stringify([race.placements, [...(race.absentParticipantIds ?? [])].sort()]);
  const evidence =
    capture && unchanged
      ? reconcileCaptureEvidence(
          existing.gameEvidence,
          projected,
          existing.captureIds?.includes(capture.id) ? capture.id : undefined,
        )
      : projected;
  if (capture?.interpretation)
    race = {
      ...race,
      gameEvidence: evidence,
      gameEvidenceHistory: existing?.gameEvidence
        ? [
            ...(existing.gameEvidenceHistory ?? []),
            { changedAt: new Date().toISOString(), evidence: existing.gameEvidence },
          ]
        : existing?.gameEvidenceHistory,
    };
  const races = existing ? mogi.races.map((item) => (item.id === race.id ? race : item)) : [...mogi.races, race];
  return {
    ...(capture ? acceptNameAssociations(mogi, capture, race.number ?? 1, race.id) : mogi),
    ...(mogi.sequence && !derived
      ? {
          sequence: {
            ...mogi.sequence,
            projectedRaceIds: mogi.sequence.projectedRaceIds?.filter((id) => id !== race.id),
            associations: capture
              ? mogi.sequence.associations?.filter((entry) => entry.captureId !== capture.id)
              : mogi.sequence.associations,
          },
        }
      : {}),
    captures: capture
      ? mogi.captures?.some((item) => item.id === capture.id)
        ? mogi.captures.map((item) => (item.id === capture.id ? capture : item))
        : [...(mogi.captures ?? []), capture]
      : mogi.captures?.map((item) =>
          race.captureIds?.includes(item.id)
            ? {
                ...item,
                reviewedPlacements: race.placements,
                reviewedAt: new Date().toISOString(),
              }
            : item,
        ),
    races: materializePendingGaps(mogi, races, (race.number ?? 1) - 1),
  };
}

/**
 * Withdraws a manual result, absences included, so the race counts again only from what its images prove:
 * it becomes pending with no placements, and the next normalization reads or reconstructs it afresh.
 */
export function withdrawManualResult<T extends Mogi>(mogi: T, raceId: string): T {
  const race = mogi.races.find((entry) => entry.id === raceId);
  if (!race || race.origin !== "manual" || race.status === "pending")
    throw new Error("The race changed. Reopen it before editing.");
  const withdrawn: Race = {
    ...race,
    origin: race.reconstructionHistory?.length ? "reconstructed" : "observed",
    status: race.status === "discarded" ? "discarded" : "pending",
    placements: [],
    absentParticipantIds: [],
    nativePoints: undefined,
    nativePointOrigins: undefined,
  };
  return { ...mogi, races: mogi.races.map((entry) => (entry.id === raceId ? withdrawn : entry)) };
}
