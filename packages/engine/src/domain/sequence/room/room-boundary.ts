import { capturePhaseOffset, contextPhase } from "../../capture/capture-context.ts";
import { screenProperties } from "../../capture/screens.ts";
import { recognizedParticipant } from "../../names/name-recognition.ts";
import { spelling } from "../../names/spelling.ts";
import { nativePriorScale, representedPlayers } from "../../numeric-readings/numeric-candidates.ts";
import {
  duplicateFirstRaceRows,
  firstRacePermutation,
  FULL_ROOM_PLAYERS,
  FULL_ROOM_POINTS,
  MAX_MISSING_TOTALS,
  missingTotalsByScale,
  type NumericPlan,
  POINTS_SUM_RULE,
  readGameCumulatives,
  recordDeducedTotal,
  totalByRemainder,
  zeroGameCumulativeColumn,
} from "../../numeric-readings/numeric-deduction.ts";
import {
  MAX_COUNTED_RACES,
  MAX_POINTS_PER_RACE,
  MIN_SHARED_PLAYERS,
  type PersonVector,
  rowAnchors,
  sum,
  vectorDistance,
} from "../../numeric-readings/per-person-vector.ts";
import { nativePlacementPoints } from "../../scoring/native-points.ts";
import type { Capture, Mogi } from "../../types.ts";

export interface RoomBoundary extends PersonVector, NumericPlan {
  localRace?: number;
  exact: boolean;
  time?: number;
  epoch?: number;
  answeredNumber?: number;
  conflictRows?: number[];
  needsNumber?: boolean;
}

/** race.vector-continuity: a unique native sum fixes the local completed race count. */
export function raceNumberBySum(totals: (number | undefined)[], represented: number): number | undefined {
  const missing = totals.filter((value) => value === undefined).length;
  if (represented !== FULL_ROOM_PLAYERS || missing > MAX_MISSING_TOTALS) return;
  const known = totals.filter((value): value is number => value !== undefined);
  const total = sum(known);
  const possible = Array.from({ length: MAX_COUNTED_RACES + 1 }, (_, racesCompleted) => racesCompleted).filter(
    (racesCompleted) =>
      known.every((value) => value >= 0 && value <= racesCompleted * MAX_POINTS_PER_RACE) &&
      (missing
        ? FULL_ROOM_POINTS * racesCompleted - total >= 0 &&
          FULL_ROOM_POINTS * racesCompleted - total <= racesCompleted * MAX_POINTS_PER_RACE
        : total === FULL_ROOM_POINTS * racesCompleted),
  );
  return possible.length === 1 ? possible[0] : undefined;
}

/** A twelve-person room's cumulative crop that misses exactly one row, with every other row
 * legible and named, leaves that person's total to the fixed race sum. The row count never proves an absence, so
 * the person must show in another capture and have no absence on record up to this screen: an absence in a later
 * race leaves the sum of the races before it whole. */
function unseenRowParticipant(
  mogi: Mogi,
  source: Capture,
  keys: string[],
  values: Map<string, number>,
): string | undefined {
  if (
    mogi.participants.length !== FULL_ROOM_PLAYERS ||
    source.interpretation?.represented !== undefined ||
    source.rows.length !== FULL_ROOM_PLAYERS - 1 ||
    values.size !== keys.length ||
    new Set(keys).size !== keys.length ||
    !keys.every((key) => mogi.participants.some((person) => person.id === key))
  )
    return;
  const unseen = mogi.participants.filter((person) => !keys.includes(person.id));
  const id = unseen[0]?.id;
  const completed = raceNumberBySum([...values.values(), undefined], FULL_ROOM_PLAYERS);
  // A race without a number could be any of them; an absence there still counts.
  const upToHere = (raceId: string) => {
    const index = mogi.races.findIndex((race) => race.id === raceId);
    const race = mogi.races[index];
    return !race || completed === undefined || (race.physicalNumber ?? race.number ?? index + 1) <= completed;
  };
  if (
    unseen.length !== 1 ||
    mogi.races.some((race) => race.absentParticipantIds?.includes(id) && upToHere(race.id)) ||
    mogi.assistance?.facts.some(
      (fact) => fact.participantId === id && fact.position === "absent" && upToHere(fact.raceId),
    ) ||
    !mogi.captures?.some(
      (other) => other.id !== source.id && other.nameAssociations?.some((answer) => answer.participantId === id),
    )
  )
    return;
  return id;
}

export function roomBoundary(
  mogi: Mogi,
  source: Capture,
  { numeric, shown, zeroStart }: ReturnType<typeof readGameCumulatives>,
): RoomBoundary | undefined {
  const represented = representedPlayers(source),
    scale = nativePlacementPoints(represented);
  if (!scale.length || !source.interpretation || screenProperties(source.interpretation.screen).order === "unknown")
    return;
  shown = shown.slice(0, represented);
  const prior = !!nativePriorScale(source);
  if (screenProperties(source.interpretation.screen).cumulative !== "final" && !prior) return;
  const readable = shown.filter((value): value is number => value !== undefined);
  firstRacePermutation(numeric, shown, scale, prior);
  const missing = shown.flatMap((value, index) => (value === undefined ? [index] : []));
  const duplicateRows = duplicateFirstRaceRows(source, shown, readable, prior);
  const completed = raceNumberBySum(shown, represented);
  if (completed !== undefined && missing.length) {
    const remainder = totalByRemainder(shown, completed)!;
    shown[remainder.row] = remainder.value;
    recordDeducedTotal(numeric, remainder.row + 1, remainder.value, POINTS_SUM_RULE);
  }
  const offset = capturePhaseOffset(source);
  let localRace = completed === undefined ? undefined : completed + (prior ? 1 : offset);
  const values = new Map<string, number>();
  const spellings = source.rows.slice(0, represented).map((row) => spelling(row.text));
  const frequencies = new Map<string, number>();
  for (const key of spellings) frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  const keys = source.rows.slice(0, represented).map((row, index) => {
    const answer = source.nameAssociations?.[index];
    const accepted = answer?.participantId ?? (!answer?.unlinked ? recognizedParticipant(mogi, row) : undefined);
    const key =
      accepted ||
      (spellings[index] && frequencies.get(spellings[index]) === 1
        ? `name:${spellings[index]}`
        : `row:${source.id}:${index}`);
    if (shown[index] !== undefined) values.set(key, shown[index]! + (prior ? scale[index] : 0));
    return key;
  });
  const unseen = prior || completed !== undefined ? undefined : unseenRowParticipant(mogi, source, keys, values);
  const unseenRaces = unseen ? raceNumberBySum([...values.values(), undefined], FULL_ROOM_PLAYERS) : undefined;
  if (unseen && unseenRaces !== undefined) {
    keys.push(unseen);
    values.set(unseen, FULL_ROOM_POINTS * unseenRaces - sum(values.values()));
    localRace = unseenRaces + offset;
  }
  if (values.size < MIN_SHARED_PLAYERS && localRace === undefined) return;
  const fact = mogi.sequence?.numbers.find(
    (fact) => fact.captureId === source.id && fact.phase === contextPhase(source),
  );
  const manualTarget =
    !mogi.sequence?.associations?.some((association) => association.captureId === source.id) && source.context?.raceId;
  const race = manualTarget ? mogi.races.find((race) => race.id === manualTarget) : undefined;
  return {
    ...numeric,
    source,
    values,
    keys,
    prior,
    offset,
    localRace,
    exact: localRace !== undefined,
    needsNumber: zeroGameCumulativeColumn(source) && !zeroStart,
    conflictRows: duplicateRows.length ? duplicateRows : undefined,
    answeredNumber:
      fact?.physicalNumber ??
      fact?.number ??
      (race && !(mogi.sequence?.projectedRaceIds ?? []).includes(race.id) ? race.number : undefined),
    time: sharedPhotoMoment(mogi, source) ? undefined : source.photoMoment?.at,
  };
}

/**
 * order.photo-time: a moment several screenshots share to the second is when they were saved together (a phone saving
 * a batch), not when each was taken, so it orders nothing.
 */
export function sharedPhotoMoment(mogi: Mogi, source: Capture): boolean {
  const at = source.photoMoment?.at;
  return (
    at !== undefined && (mogi.captures ?? []).some((other) => other.id !== source.id && other.photoMoment?.at === at)
  );
}

export function distance(anchor: Map<string, number>, boundary: RoomBoundary) {
  // A restart the room proved (`restartedTotal`) leaves the comparison: right after race 1 it can still look like a gain.
  anchor = rowAnchors(
    boundary.restarted ? new Map([...anchor].filter(([key]) => !boundary.restarted!.has(key))) : anchor,
    boundary,
  );
  return vectorDistance(
    anchor,
    missingTotalsByScale(anchor, boundary)?.values ?? boundary.values,
    boundary.keys.length,
  );
}
