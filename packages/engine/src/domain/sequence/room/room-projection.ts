import { representedPlayers } from "../../numeric-readings/numeric-candidates.ts";
import { restartedZeros, sequencingCumulatives } from "../../numeric-readings/numeric-continuity.ts";
import { deduceFromAnchor, FULL_ROOM_PLAYERS, pointExplanation } from "../../numeric-readings/numeric-deduction.ts";
import { cumulativeInRange, MAX_COUNTED_RACES, mixedRoomRaceCounts } from "../../numeric-readings/per-person-vector.ts";
import { nativePlacementPoints } from "../../scoring/native-points.ts";
import type { Mogi } from "../../types.ts";
import type { CaptureExplanationStep } from "../capture-explanation.ts";
import type { RoomBoundary } from "./room-boundary.ts";
import { roomCaptureSteps } from "./room-explanation.ts";
import type { RoomPair } from "./room-grouping.ts";
import type { RoomAnalysis, RoomCapture, RoomSession } from "./room-sequence.ts";
import type { RoomSequenceState, SelectedRoom } from "./room-start.ts";

/** race.vector-continuity: independent edits must leave feasible native gains inside the initial interval. */
export function initialFactsFit(
  mogi: Mogi,
  boundary: Pick<RoomBoundary, "keys" | "values">,
  completed: number,
): boolean {
  if (completed < 1 || boundary.keys.length !== FULL_ROOM_PLAYERS || boundary.values.size !== FULL_ROOM_PLAYERS)
    return true;
  const edits = mogi.races.filter(
    (race) =>
      race.origin === "manual" &&
      race.status !== "pending" &&
      race.status !== "discarded" &&
      (race.physicalNumber ?? race.number ?? 0) > 0 &&
      (race.physicalNumber ?? race.number ?? 0) <= completed,
  );
  if (
    edits.some(
      (race) =>
        race.participationReview ||
        race.placements.length !== FULL_ROOM_PLAYERS ||
        race.absentParticipantIds?.length ||
        race.placements.some(
          (id, index) =>
            race.nativePoints?.[id] !== undefined &&
            race.nativePoints[id] !== nativePlacementPoints(FULL_ROOM_PLAYERS)[index],
        ),
    )
  )
    return false;
  const missing = completed - edits.length;
  if (missing < 0) return false;
  return boundary.keys.every((id) => {
    if (!mogi.participants.some((person) => person.id === id) || edits.some((race) => !race.placements.includes(id)))
      return true;
    const known = edits.reduce(
      (total, race) => total + nativePlacementPoints(FULL_ROOM_PLAYERS)[race.placements.indexOf(id)],
      0,
    );
    const value = boundary.values.get(id)!;
    return cumulativeInRange(known, value, missing);
  });
}
/** Reconciliation never projects more than twelve valid races: a number past the ceiling (plus discarded races) is a conflict. */
export function raceNumberWithinCeiling(mogi: Mogi, number: number): boolean {
  return number >= 1 && number <= MAX_COUNTED_RACES + mogi.races.filter((race) => race.status === "discarded").length;
}

function nativePlacements(mogi: Mogi, boundary: RoomBoundary, before: Map<string, number>): string[] | undefined {
  const ranked = [...boundary.values]
    .map(([id, value]) => [id, value - (before.get(id) ?? NaN)] as const)
    .sort((from, to) => to[1] - from[1]);
  if (
    !boundary.offset &&
    ranked.length === representedPlayers(boundary.source) &&
    ranked.every(
      ([id, gain], index) =>
        mogi.participants.some((person) => person.id === id) && gain === nativePlacementPoints(ranked.length)[index],
    )
  )
    return ranked.map(([id]) => id);
}

type ContinuitySegments = Map<string, { id: string; count: number }>;

function recordContinuitySegments(
  mogi: Mogi,
  boundary: RoomBoundary,
  entry: RoomCapture,
  comparison: Map<string, number>,
  sessionId: string,
  first: RoomBoundary,
  past: Set<string>,
  segments: ContinuitySegments,
) {
  for (const [participantId, value] of boundary.values) {
    const interrupted =
      (comparison.has(participantId) && value < comparison.get(participantId)!) ||
      !!boundary.restarted?.has(participantId) ||
      (!comparison.has(participantId) && past.has(participantId) && boundary !== first);
    const segment =
      interrupted || !segments.has(participantId)
        ? { id: `${sessionId}:${interrupted ? boundary.source.id : "initial"}:${participantId}`, count: 0 }
        : segments.get(participantId)!;
    segment.count++;
    segments.set(participantId, segment);
    if (mogi.participants.some((person) => person.id === participantId))
      entry.segments.push({
        participantId,
        id: segment.id,
        // A restart the room proved (`restartedTotal`, `restartedZeros`) starts from a known total, so it anchors at once.
        anchor:
          (!interrupted && segment.count > 1) ||
          segment.id.includes(":initial:") ||
          !!boundary.restarted?.has(participantId),
      });
  }
}

export function projectRoom(
  mogi: Mogi,
  room: SelectedRoom,
  session: RoomSession,
  state: RoomSequenceState,
  result: RoomAnalysis,
  explanation: CaptureExplanationStep[],
  nodes: RoomBoundary[],
  pairs: RoomPair[],
  photoOrder: Map<RoomBoundary[], RoomBoundary>,
) {
  const { group, start, reopening } = room;
  const id = session.id;
  const segments = new Map<string, { id: string; count: number }>();
  const previousValues = state.anchor,
    previousCompleted = state.anchorCompleted;
  const answeredOrderAnchor = group.some((boundary) => boundary.answeredNumber !== undefined)
    ? state.anchorSource
    : undefined;
  const sharedBefore = [...group[0].values].filter(([key]) => state.anchor.has(key));
  const decreased = sharedBefore.filter(([key, value]) => value < state.anchor.get(key)!).length;
  let last = new Map<string, number>();
  for (const boundary of group) {
    if (
      state.leadingRaces > 0 ||
      boundary.localRace !== undefined ||
      representedPlayers(boundary.source) === FULL_ROOM_PLAYERS
    )
      deduceFromAnchor(
        boundary,
        last.size ? last : reopening ? new Map(mogi.participants.map((person) => [person.id, 0])) : previousValues,
      );
    if (last.size) restartedZeros(boundary, last);
    let number = start !== undefined && boundary.localRace !== undefined ? start + boundary.localRace - 1 : undefined;
    const editedBeyondPrefix =
      number !== undefined &&
      mogi.races.some(
        (race) =>
          race.origin === "manual" &&
          race.status !== "pending" &&
          race.status !== "discarded" &&
          (race.physicalNumber ?? race.number ?? 0) > state.leadingRaces &&
          (race.physicalNumber ?? race.number ?? 0) <= number! - boundary.offset,
      );
    if (
      number !== undefined &&
      start === 1 &&
      boundary.answeredNumber === undefined &&
      (!state.previousSession || editedBeyondPrefix) &&
      !initialFactsFit(mogi, boundary, number - boundary.offset)
    )
      number = undefined;
    const entry: RoomCapture = {
      captureId: boundary.source.id,
      sessionId: id,
      j: boundary.localRace,
      number,
      values: boundary.deductions,
      segments: [],
      conflictRows: boundary.conflictRows,
    };
    const steps = roomCaptureSteps(boundary, number, {
      room,
      state,
      compared: sharedBefore.length,
      decreased,
      nodes,
      pairs,
      explanation,
      photoAnchor: photoOrder.get(group),
      answeredOrderAnchor,
    });
    const unresolved = boundary.keys.flatMap((key, index) => {
      if (boundary.values.has(key)) return [];
      const row = index + 1;
      const reading = boundary.source.numericRows?.find((reading) => reading.row === row)?.right;
      // A deduced native scale tolerates unreadable prior totals, not readable contradictions.
      const unreadablePrior =
        boundary.prior &&
        !boundary.source.numericAnswers?.some((answer) => answer.row === row) &&
        (!reading || reading.uncertain || reading.value === null);
      return unreadablePrior ? [] : [row];
    });
    if (unresolved.length) {
      entry.conflictRows = [...new Set([...(entry.conflictRows ?? []), ...unresolved])];
      result.conflicts.push(boundary.source.id);
    }
    if (
      number === undefined &&
      representedPlayers(boundary.source) < FULL_ROOM_PLAYERS &&
      boundary.values.size === representedPlayers(boundary.source)
    ) {
      const values = [...boundary.values.values()];
      const origin = reopening ? state.leadingRaces : 0;
      const completed = mixedRoomRaceCounts(values, values.length).find(
        (races) => origin + races + boundary.offset >= state.leadingRaces + 1,
      );
      if (completed !== undefined) entry.suggestion = origin + completed + boundary.offset;
    }
    const before = last.size
      ? last
      : reopening
        ? new Map(mogi.participants.map((person) => [person.id, 0]))
        : previousValues;
    const placements = nativePlacements(mogi, boundary, before);
    if (placements) entry.placements = placements;
    if (
      boundary.source.interpretation?.screen === "finishOrderAdding" &&
      boundary.localRace === previousCompleted + 1 &&
      !reopening
    ) {
      const rows = boundary.source.rows.flatMap((_, index) => {
        const id = boundary.source.nameAssociations?.[index]?.participantId;
        const raw = boundary.source.numericRows?.find((reading) => reading.row === index + 1)?.right;
        const value =
          boundary.source.numericAnswers?.find((answer) => answer.row === index + 1)?.value ??
          (raw && !raw.uncertain ? raw.value : undefined);
        return id && previousValues.has(id) && value != null && value !== previousValues.get(id) ? [index + 1] : [];
      });
      if (rows.length) {
        entry.conflictRows = [...new Set([...(entry.conflictRows ?? []), ...rows])];
        result.conflicts.push(boundary.source.id);
      }
    }
    const comparison = last.size ? last : reopening ? new Map<string, number>() : previousValues;
    recordContinuitySegments(mogi, boundary, entry, comparison, id, group[0], state.past, segments);
    for (const key of last.keys()) state.past.add(key);
    last = sequencingCumulatives(boundary);
    if (number !== undefined && number - boundary.offset >= state.leadingRaces) {
      state.leadingRaces = number - boundary.offset;
      state.anchor = new Map(
        [...sequencingCumulatives(boundary)].filter(
          ([id]) => !entry.segments.some((segment) => segment.participantId === id && !segment.anchor),
        ),
      );
      state.anchorSource = boundary;
      state.anchorCompleted = boundary.localRace! - boundary.offset;
      state.previousSession = true;
    }
    if (number !== undefined && !raceNumberWithinCeiling(mogi, number)) {
      entry.number = undefined;
      result.conflicts.push(boundary.source.id);
    }
    explanation.push(...steps, ...pointExplanation(boundary));
    result.captures.push(entry);
  }
  if (start === undefined && !reopening && !result.order)
    for (const boundary of group) {
      if (
        representedPlayers(boundary.source) === FULL_ROOM_PLAYERS &&
        boundary.values.size === FULL_ROOM_PLAYERS &&
        !boundary.localRace
      )
        result.conflicts.push(boundary.source.id);
    }
}
