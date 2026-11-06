import { capturePhaseOffset } from "../../capture/capture-context.ts";
import { sequencingCumulatives, singleMisreadTotal } from "../../numeric-readings/numeric-continuity.ts";
import {
  type DeducedTotal,
  pointExplanation,
  readGameCumulatives,
  zeroGameCumulativeColumn,
} from "../../numeric-readings/numeric-deduction.ts";
import type { Mogi } from "../../types.ts";
import { type CaptureExplanationStep, recordRoomExplanation } from "../capture-explanation.ts";
import { sourcePairSignature } from "../source-pair-signature.ts";
import { type RoomBoundary, roomBoundary } from "./room-boundary.ts";
import { completeRoomPositions, groupRoomSources } from "./room-grouping.ts";
import { projectRoom } from "./room-projection.ts";
import { zeroRoomBoundary } from "./room-reopening.ts";
import { raceNumberCandidates, roomSequenceState, selectRoom } from "./room-start.ts";

export { raceNumberBySum, sharedPhotoMoment } from "./room-boundary.ts";
export { roomPositionsAgree } from "./room-grouping.ts";
export { answeredNumberTieBreak, orderQuestion, photoTimeTieBreak } from "./room-order.ts";
export { initialFactsFit, raceNumberWithinCeiling } from "./room-projection.ts";
export { answeredReopening, epochByPhotoTime, precedesAnchor, reopeningByTotals } from "./room-reopening.ts";
export {
  continuityBySmallestDistance,
  initialRoomByContinuity,
  raceNumberCandidates,
  roomStart,
} from "./room-start.ts";

export interface RoomCapture {
  captureId: string;
  sessionId: string;
  // Existing projection field; calculations use localRace at the room boundary.
  j?: number;
  number?: number;
  suggestion?: number;
  values: DeducedTotal[];
  conflictRows?: number[];
  placements?: string[];
  segments: { participantId: string; id: string; anchor: boolean }[];
}
export interface RoomSession {
  id: string;
  captureIds: string[];
  start?: number;
  reopening: boolean;
  candidates?: number[];
}
export interface RoomAnalysis {
  origin: "deduced";
  sessions: RoomSession[];
  captures: RoomCapture[];
  conflicts: string[];
  order?: { sessionIds: string[]; captureIds: string[] };
}
/** race.vector-continuity: the earliest boundary in the first room supplies a retractable initial origin. */
export function initialRoomSources(mogi: Mogi, includeAnswered = false): string[] {
  const room = mogi.sequence?.roomAnalysis;
  const first = room?.sessions[0];
  if (!first || first.start !== 1 || first.reopening || room?.order) return [];
  const captures = room.captures.flatMap((entry) => {
    const source = mogi.captures?.find((capture) => capture.id === entry.captureId);
    return source && entry.sessionId === first.id && entry.number !== undefined
      ? [{ source, completed: entry.number - capturePhaseOffset(source) }]
      : [];
  });
  const earliest = Math.min(...captures.map((entry) => entry.completed));
  return captures
    .filter(
      ({ source, completed }) =>
        completed === earliest &&
        (includeAnswered ||
          !mogi.sequence?.origins?.some(
            (fact) => fact.captureId === source.id && fact.signature === sourcePairSignature(source, source),
          )),
    )
    .map(({ source }) => source.id);
}

/** Only fixed physical coordinates establish a result gap's count; pending detail does not change it. */
export function numberedRoomSpan(mogi: Mogi, fromId: string, toId: string, steps: number): boolean {
  const occurrence = (id: string) => mogi.sequence?.occurrences.find((entry) => entry.captureIds.includes(id));
  const from = occurrence(fromId),
    to = occurrence(toId);
  const source = (id: string) => mogi.captures?.find((capture) => capture.id === id);
  const older = source(fromId),
    newer = source(toId);
  const left = from?.physicalNumber ?? from?.number,
    right = to?.physicalNumber ?? to?.number;
  if (left === undefined || right === undefined || !older || !newer) return false;
  return right - capturePhaseOffset(newer) - (left - capturePhaseOffset(older)) === steps;
}

/** Retractable projection: every reconciliation starts from the facts, never from the previous output. */
export function analyzeRoomSequence(mogi: Mogi): RoomAnalysis {
  const result: RoomAnalysis = { origin: "deduced", sessions: [], captures: [], conflicts: [] };
  const explanation: CaptureExplanationStep[] = [];
  recordRoomExplanation(result, explanation);
  const readings = (mogi.captures ?? []).map((capture) => readGameCumulatives(mogi, capture));
  const known = readings.map((reading) => roomBoundary(mogi, reading.numeric.source, reading));
  const nodes = readings
    .map((reading, index) => {
      const source = reading.numeric.source;
      let boundary = known[index];
      if (zeroGameCumulativeColumn(source) && boundary?.localRace === undefined)
        boundary = zeroRoomBoundary(mogi, source, known) ?? boundary;
      if (!boundary) explanation.push(...pointExplanation(reading.numeric));
      return boundary;
    })
    .filter((boundary): boundary is RoomBoundary => !!boundary);
  for (const boundary of nodes) singleMisreadTotal(boundary, nodes);
  for (const boundary of nodes) boundary.values = sequencingCumulatives(boundary);
  const { groups, pairs } = groupRoomSources(mogi, nodes);
  const state = roomSequenceState(mogi);
  const remaining = [...groups];
  const photoOrder = new Map<RoomBoundary[], RoomBoundary>();
  while (remaining.length) {
    const room = selectRoom(mogi, remaining, state, result, photoOrder);
    const { group, reopening } = room;
    completeRoomPositions(group, room.start);
    // Confirmed totals that fit no sum use their answered number as the room anchor.
    if (
      room.start === undefined &&
      group.some((boundary) =>
        boundary.source.rows.every((_, index) =>
          boundary.source.numericAnswers?.some((answer) => answer.row === index + 1),
        ),
      )
    ) {
      const answered = group.find(
        (boundary) => boundary.answeredNumber !== undefined && boundary.localRace !== undefined,
      );
      if (answered) room.start = answered.answeredNumber! - answered.localRace! + 1;
    }
    remaining.splice(remaining.indexOf(group), 1);
    const id = `room:${group[0].source.id}`;
    if (result.order?.sessionIds.includes(id)) room.start = undefined;
    const firstLocalRace = group[0].localRace;
    const maxCompleted = Math.max(0, ...group.map((boundary) => (boundary.localRace ?? 0) - boundary.offset));
    const session: RoomSession = {
      id,
      captureIds: group.map((boundary) => boundary.source.id),
      start: room.start,
      reopening,
    };
    const candidates = raceNumberCandidates(session, state.leadingRaces, firstLocalRace, maxCompleted);
    if (candidates) session.candidates = candidates;
    result.sessions.push(session);
    projectRoom(mogi, room, session, state, result, explanation, nodes, pairs, photoOrder);
  }
  return result;
}
