import { contextPhase } from "../../capture/capture-context.ts";
import { representedPlayers } from "../../numeric-readings/numeric-candidates.ts";
import { FULL_ROOM_PLAYERS, zeroGameCumulativeColumn } from "../../numeric-readings/numeric-deduction.ts";
import { MAX_COUNTED_RACES, MAX_POINTS_PER_RACE, sum } from "../../numeric-readings/per-person-vector.ts";
import { nativePlacementPoints } from "../../scoring/native-points.ts";
import type { Mogi } from "../../types.ts";
import type { CaptureExplanationStep } from "../capture-explanation.ts";
import { distance, type RoomBoundary } from "./room-boundary.ts";
import { completeRoomPositions, placeAlongShortest } from "./room-grouping.ts";
import { answeredNumberTieBreak, orderQuestion, photoTimeTieBreak, rememberPhotoOrder } from "./room-order.ts";
import { answeredReopening, precedesAnchor, reopeningByTotals } from "./room-reopening.ts";
import type { RoomAnalysis, RoomSession } from "./room-sequence.ts";

// Ten is the smallest represented room with a supported native placement scale.
const MIN_ROOM_PLAYERS = 10;

interface Continuation {
  group: RoomBoundary[];
  boundary: RoomBoundary;
  distance: number;
}

interface RoomStartContext {
  leadingRaces: number;
  previousSession: boolean;
  orderPending?: boolean;
  reopening?: boolean;
  continuation?: Continuation;
}

/** race.answered / race.reopen-first / race.vector-continuity: establish from room's absolute start. */
export function roomStart(group: RoomBoundary[], context: RoomStartContext): number | undefined {
  const start = anyRoomStart(group, context);
  // An answer below its local race contradicts the totals: the room keeps no start and the conflict asks again.
  return start === undefined || start >= 1 ? start : undefined;
}

function anyRoomStart(group: RoomBoundary[], context: RoomStartContext): number | undefined {
  const chosen = context.continuation;
  if (chosen && chosen.boundary.localRace !== undefined) {
    return chosen.boundary.answeredNumber !== undefined
      ? chosen.boundary.answeredNumber - chosen.boundary.localRace + 1
      : context.leadingRaces + chosen.distance + chosen.boundary.offset - chosen.boundary.localRace + 1;
  }
  const explicit = group.find((boundary) => boundary.answeredNumber !== undefined && boundary.localRace !== undefined);
  if (explicit) return explicit.answeredNumber! - explicit.localRace! + 1;
  if (context.orderPending) return;
  // Later zeros alone never take race 1; a proven zero start in the same room still does.
  const provenStart = group.some((boundary) => zeroGameCumulativeColumn(boundary.source) && !boundary.needsNumber);
  if (!context.previousSession && group[0].exact && (!group.some((boundary) => boundary.needsNumber) || provenStart))
    return 1;
  if (
    context.reopening &&
    group.some((boundary) => boundary.localRace === 1 && !zeroGameCumulativeColumn(boundary.source))
  )
    return context.leadingRaces + 1;
}

/** Fewest races that can have produced these totals: nobody gains more than 15 a race, a room gives at most its
 * top places, and one race gives distinct points. Rejoins, departures and unseen rows only lower totals. */
function fewestRaces(values: number[]): number {
  if (values.every((value) => value === 0)) return 0;
  const top = sum(nativePlacementPoints(FULL_ROOM_PLAYERS).slice(0, values.length));
  const races = Math.max(1, Math.ceil(Math.max(...values) / MAX_POINTS_PER_RACE), Math.ceil(sum(values) / top));
  return races === 1 && new Set(values).size !== values.length ? 2 : races;
}

/** race.vector-continuity: a room whose totals fit no race sum (an 11-player race, a rejoin at 0, a departure) still
 * has a number when its chained screens leave room for one start only: each screen's totals need at least so many
 * races, and no screen can show a race past the ceiling. Returns whether it placed the room. */
export function raceNumberByCeiling(mogi: Mogi, group: RoomBoundary[]): boolean {
  if (group.some((boundary) => boundary.localRace !== undefined)) return false;
  const completed = placeAlongShortest(group, new Map([[group[0], 0]]));
  if (completed.size !== group.length) return false;
  const ceiling = MAX_COUNTED_RACES + mogi.races.filter((race) => race.status === "discarded").length;
  const lowest = Math.max(
    ...group.map((boundary) => fewestRaces([...boundary.values.values()]) - completed.get(boundary)!),
  );
  const highest = Math.min(...group.map((boundary) => ceiling - completed.get(boundary)! - boundary.offset));
  if (lowest !== highest) return false;
  for (const boundary of group) boundary.localRace = completed.get(boundary)! + lowest + boundary.offset;
  return true;
}

/** race.answered: per-person continuity placed every screen of the room one race apart at most, so no race between
 * them lacks a screen: one answered number then numbers them all. Across an unseen race the validity stays open. */
export function gaplessRoom(group: RoomBoundary[]): boolean {
  if (group.some((boundary) => boundary.localRace === undefined)) return false;
  const completed = [...new Set(group.map((boundary) => boundary.localRace! - boundary.offset))].sort((a, b) => a - b);
  return completed.every((races, index) => !index || races === completed[index - 1] + 1);
}

/** race.vector-continuity: prefer the smallest physical interval, then existing answers and photo time. */
export function continuityBySmallestDistance(candidates: Continuation[]): Continuation[] {
  return candidates.sort(
    (first, second) =>
      first.distance - second.distance ||
      answeredNumberTieBreak(first.boundary, second.boundary) ||
      (first.boundary.time ?? Infinity) - (second.boundary.time ?? Infinity),
  );
}

/** No RuleCode until answered: candidates must leave room for the rest of the reopened session. */
export function raceNumberCandidates(
  session: Pick<RoomSession, "reopening" | "start">,
  leadingRaces: number,
  firstLocalRace: number | undefined,
  maxCompleted: number,
): number[] | undefined {
  if (!session.reopening || session.start !== undefined || firstLocalRace === undefined) return;
  return Array.from({ length: MAX_COUNTED_RACES }, (_, index) => index + 1).filter(
    (number) =>
      number >= leadingRaces + firstLocalRace && number <= MAX_COUNTED_RACES - (maxCompleted - firstLocalRace),
  );
}

export interface RoomSequenceState {
  leadingRaces: number;
  anchor: Map<string, number>;
  previousSession: boolean;
  anchorCompleted: number;
  anchorSource?: RoomBoundary;
  past: Set<string>;
}

export function roomSequenceState(mogi: Mogi): RoomSequenceState {
  const manual: Mogi["races"] = [];
  for (let physical = 1; ; physical++) {
    const race = mogi.races.find(
      (race) => (race.physicalNumber ?? race.number ?? mogi.races.indexOf(race) + 1) === physical,
    );
    if (
      !race ||
      race.origin !== "manual" ||
      race.status === "pending" ||
      race.participationReview ||
      race.placements.length < MIN_ROOM_PLAYERS
    )
      break;
    manual.push(race);
  }
  const leadingRaces = manual.length;
  const anchor = new Map(
    mogi.participants.map((person) => [
      person.id,
      manual.reduce(
        (total, race) =>
          total +
          (race.nativePoints?.[person.id] ??
            nativePlacementPoints(race.placements.length)[race.placements.indexOf(person.id)] ??
            0),
        0,
      ),
    ]),
  );
  return {
    leadingRaces,
    anchor,
    previousSession: leadingRaces > 0,
    anchorCompleted: leadingRaces,
    past: new Set(anchor.keys()),
  };
}

export interface SelectedRoom {
  group: RoomBoundary[];
  start?: number;
  reopening: boolean;
  reopeningBasis?: CaptureExplanationStep["evidence"]["reopeningBasis"];
}

/** race.vector-continuity: when photo times cannot order zero starts, prefer the unique longest contiguous room. */
export function initialRoomByContinuity(groups: RoomBoundary[][]): RoomBoundary[] | undefined {
  const starts = groups.filter((group) => group.some((boundary) => zeroGameCumulativeColumn(boundary.source)));
  if (starts.length < 2) return;
  for (const group of starts) completeRoomPositions(group, undefined);
  const length = (group: RoomBoundary[]) => {
    const completed = new Set(group.map((boundary) => (boundary.localRace ?? -1) - boundary.offset));
    let races = 0;
    while (completed.has(races + 1)) races++;
    return races;
  };
  const ordered = starts
    .filter(
      (group) =>
        !group.some(
          (boundary) => boundary.answeredNumber !== undefined && boundary.answeredNumber !== boundary.localRace,
        ),
    )
    .sort((a, b) => length(b) - length(a));
  const first = ordered[0];
  if (first && (ordered.length === 1 || length(first) > length(ordered[1]))) return first;
}

export function selectRoom(
  mogi: Mogi,
  remaining: RoomBoundary[][],
  state: RoomSequenceState,
  result: RoomAnalysis,
  photoOrder: Map<RoomBoundary[], RoomBoundary>,
): SelectedRoom {
  // Keep the first room’s zero or answered anchor ahead of a later room’s answered number. The event-final screen
  // closes the event, so it never anchors the first room, even when its photo time comes first.
  const photoGroups = photoTimeTieBreak(remaining);
  let chronological =
    photoGroups &&
    photoGroups[0].some(
      (boundary) =>
        zeroGameCumulativeColumn(boundary.source) ||
        (boundary.answeredNumber !== undefined && contextPhase(boundary.source) !== "event-final"),
    )
      ? photoGroups
      : undefined;
  const initial = !chronological && !state.previousSession ? initialRoomByContinuity(remaining) : undefined;
  if (initial) chronological = [initial];
  // First try to continue the current vector, across the smallest possible interval.
  const continuing = continuityBySmallestDistance(
    remaining.flatMap((group) =>
      group.flatMap((boundary) => {
        const first = group[0];
        if (chronological && chronological[0] !== group) return [];
        if (
          group !== initial &&
          group.some((entry) => entry.needsNumber) &&
          !group.some((entry) => entry.answeredNumber !== undefined)
        )
          return [];
        if (
          state.previousSession &&
          reopeningByTotals(state.anchor, first.values) &&
          (state.anchorSource || !precedesAnchor(state.anchor, first))
        )
          return [];
        const steps =
          state.anchorSource && answeredReopening(mogi, state.anchorSource.source, boundary.source)
            ? undefined
            : distance(state.anchor, boundary);
        return steps !== undefined &&
          (state.leadingRaces > 0 || representedPlayers(boundary.source) === FULL_ROOM_PLAYERS)
          ? [{ group, boundary, distance: steps }]
          : [];
      }),
    ),
  );
  const tied = continuing.filter((candidate) => candidate.distance === continuing[0]?.distance);
  const tiedGroups = [...new Set(tied.map((candidate) => candidate.group))],
    timedGroups = photoTimeTieBreak(tiedGroups);
  const ambiguous =
    tiedGroups.length > 1 && !tied.some((candidate) => candidate.boundary.answeredNumber !== undefined) && !timedGroups;
  const chosen = ambiguous
    ? undefined
    : timedGroups && tiedGroups.length > 1 && !tied.some((candidate) => candidate.boundary.answeredNumber !== undefined)
      ? tied.find((candidate) => candidate.group === timedGroups[0])
      : continuing[0];
  if (
    timedGroups &&
    tiedGroups.length > 1 &&
    !tied.some((candidate) => candidate.boundary.answeredNumber !== undefined)
  )
    rememberPhotoOrder(photoOrder, timedGroups);
  if (chosen && chosen.boundary.localRace === undefined)
    chosen.boundary.localRace = state.anchorCompleted + chosen.distance + chosen.boundary.offset;
  let group: RoomBoundary[],
    start: number | undefined,
    reopening = false;
  let reopeningBasis: CaptureExplanationStep["evidence"]["reopeningBasis"];
  if (chosen && chosen.boundary.localRace !== undefined) {
    group = chosen.group;
    start = roomStart(group, {
      leadingRaces: state.leadingRaces,
      previousSession: state.previousSession,
      continuation: chosen,
    });
  } else {
    const answeredGroups = remaining.filter((group) =>
      group.some((boundary) => boundary.answeredNumber !== undefined && boundary.localRace !== undefined),
    );
    const viable = remaining.filter((group) =>
      group.some((boundary) => boundary.localRace !== undefined || boundary.answeredNumber !== undefined),
    );
    let ordered =
      chronological ?? (answeredGroups.length ? answeredGroups : viable.length ? viable : remaining.slice(0, 1));
    const timed = photoTimeTieBreak(ordered);
    if (ordered.length > 1 && timed) {
      ordered = timed;
      rememberPhotoOrder(photoOrder, timed);
    } else if (ordered.length > 1 && !answeredGroups.length) {
      result.order = orderQuestion(ordered, answeredGroups.length > 0);
    }
    group = ordered[0];
    const first = group[0];
    const answeredReset = !!state.anchorSource && !!answeredReopening(mogi, state.anchorSource.source, first.source);
    const answered = group.find((boundary) => boundary.answeredNumber !== undefined);
    const totalsReset =
      state.previousSession &&
      (!answered || answered.answeredNumber! > state.leadingRaces) &&
      reopeningByTotals(state.anchor, first.values);
    reopening = answeredReset || totalsReset;
    reopeningBasis = answeredReset ? "answered" : totalsReset ? "totals" : undefined;
    start = roomStart(group, {
      leadingRaces: state.leadingRaces,
      previousSession: state.previousSession,
      orderPending: !!result.order,
      reopening,
    });
    if (start === undefined && answeredReset && group.some((boundary) => boundary.localRace === 1))
      start = state.leadingRaces + 1;
  }
  return { group, start, reopening, reopeningBasis };
}
