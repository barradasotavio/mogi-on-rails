import { captureBoundaryValues } from "../capture/capture-boundary.ts";
import { screenProperties } from "../capture/screens.ts";
import { coverageProjection } from "../reconstruction/coverage.ts";
import { native12OriginScope } from "../reconstruction/origin-scope.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import type { Capture, Mogi, Race } from "../types.ts";
import type { RoomAnalysis } from "./room/room-sequence.ts";

/** Cumulatives after race N minus the proven native prefix determine the finish order,
 * without promoting the image's overall order or assuming results in the gaps. */
function cumulativeRaceGains(mogi: Mogi, race: Race, source: Capture) {
  const number = race.physicalNumber ?? race.number;
  const numbered =
    mogi.sequence?.numbers.some(
      (fact) =>
        fact.captureId === source.id && (fact.physicalNumber ?? fact.number) === number && fact.phase === "after",
    ) ||
    (number !== undefined &&
      mogi.sequence?.occurrences.some(
        (occurrence) =>
          occurrence.raceId === race.id &&
          occurrence.captureIds.includes(source.id) &&
          (occurrence.physicalNumber ?? occurrence.number) === number,
      ));
  if (
    !number ||
    source.context?.phase !== "after" ||
    screenProperties(source.interpretation?.screen)?.order !== "general" ||
    ("contextDraft" in source && source.contextDraft) ||
    !numbered
  )
    return;
  const prefix = mogi.races.filter((entry) => (entry.physicalNumber ?? entry.number ?? Infinity) < number);
  const scale = nativePlacementPoints(12),
    values = captureBoundaryValues(source);
  if (
    prefix.length !== number - 1 ||
    new Set(prefix.map((entry) => entry.physicalNumber ?? entry.number)).size !== number - 1 ||
    prefix.some(
      (entry) =>
        (entry.placements.length > 0 && entry.placements.length !== 12) ||
        entry.absentParticipantIds?.length ||
        entry.placements.some(
          (id, place) => entry.nativePoints?.[id] !== undefined && entry.nativePoints[id] !== scale[place],
        ),
    ) ||
    !native12OriginScope(mogi, [...prefix, race], values.keys())
  )
    return;
  const proven = coverageProjection({ ...mogi, races: prefix }, { through: number - 1 });
  if (proven.common.length !== number - 1 || proven.conflicts.length || proven.unequal) return;
  const gains = [...values]
    .map(([id, value]) => {
      const slot = mogi.participants.find((person) => person.id === id)!;
      return [id, value.value - proven.rows.find((row) => row.slotId === (slot.slotId ?? id))!.points] as const;
    })
    .sort((a, b) => b[1] - a[1]);
  if (gains.some(([id, value]) => race.nativePoints?.[id] !== undefined && race.nativePoints[id] !== value)) return;
  return gains;
}

export function cumulativeRacePlacements(
  mogi: Mogi,
  race: Race,
  source: Capture,
  plan = mogi.sequence?.roomAnalysis as RoomAnalysis | undefined,
): string[] | undefined {
  const entry = plan?.captures.find((c) => c.captureId === source.id),
    placements = entry?.placements;
  const number = race.physicalNumber ?? race.number;
  const prefix = mogi.races.filter((r) => (r.physicalNumber ?? r.number ?? Infinity) < (number ?? 0));
  if (
    placements?.length === 12 &&
    entry?.number === number &&
    !plan?.conflicts.includes(source.id) &&
    source.context?.phase === "after" &&
    screenProperties(source.interpretation?.screen)?.order === "general" &&
    !("contextDraft" in source && source.contextDraft) &&
    native12OriginScope(mogi, [...prefix, race], placements) &&
    placements.every(
      (id, i) => race.nativePoints?.[id] === undefined || race.nativePoints[id] === nativePlacementPoints(12)[i],
    )
  )
    return placements;
  const ranked = cumulativeRaceGains(mogi, race, source);
  if (!ranked || ranked.length !== 12 || ranked.some(([, value], index) => value !== nativePlacementPoints(12)[index]))
    return;
  return ranked.map(([id]) => id);
}

/** An impossible or repeated difference asks to check the cumulative of its
 * row, through the same answer path as illegible points. */
export function cumulativeRacePointRows(mogi: Mogi, race: Race, source: Capture): number[] {
  if (race.status !== "pending") return [];
  const gains = cumulativeRaceGains(mogi, race, source),
    scale = nativePlacementPoints(12);
  if (!gains || gains.length !== 12) return [];
  return source.nameAssociations!.flatMap((answer, index) => {
    const gain = gains.find(([id]) => id === answer.participantId)?.[1];
    return gain !== undefined && (!scale.includes(gain) || gains.filter(([, value]) => value === gain).length > 1)
      ? [index + 1]
      : [];
  });
}

/** Acceptance by the vector keeps the context and the checked placements. An
 * independent finish order or manual edit keeps its own result. */
export function cumulativeRaceDependsOnSource(mogi: Mogi, race: Race, source: Capture): boolean {
  return (
    race.origin === "observed" &&
    race.status !== "discarded" &&
    race.placements.length === 12 &&
    source.context?.raceId === race.id &&
    screenProperties(source.interpretation?.screen)?.order !== "finishOrder" &&
    JSON.stringify(source.reviewedPlacements) === JSON.stringify(race.placements) &&
    !mogi.captures?.some(
      (other) =>
        other.id !== source.id &&
        race.captureIds?.includes(other.id) &&
        other.stage === "finish-order-confirmed" &&
        JSON.stringify(other.reviewedPlacements) === JSON.stringify(race.placements),
    )
  );
}

export function withoutCumulativeRaceResult(race: Race): Race {
  // Withdraw only the modeled values compatible with the previous finish order;
  // independent or diverging numbers keep blocking a new deduction.
  const scale = nativePlacementPoints(race.placements.length);
  const retained = Object.entries(race.nativePoints ?? {}).filter(
    ([id, value]) => race.nativePointOrigins?.[id] !== "modeled" || value !== scale[race.placements.indexOf(id)],
  );
  return {
    ...race,
    status: "pending",
    placements: [],
    absentParticipantIds: race.absentParticipantIds ?? [],
    nativePoints: retained.length ? Object.fromEntries(retained) : undefined,
    nativePointOrigins: retained.length
      ? Object.fromEntries(
          retained.flatMap(([id]) => (race.nativePointOrigins?.[id] ? [[id, race.nativePointOrigins[id]]] : [])),
        )
      : undefined,
  };
}
