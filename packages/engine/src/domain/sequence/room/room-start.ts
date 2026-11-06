import { contextPhase } from "../../capture/capture-context.ts";
import { representedPlayers } from "../../numeric-readings/numeric-candidates.ts";
import { FULL_ROOM_PLAYERS, zeroGameCumulativeColumn } from "../../numeric-readings/numeric-deduction.ts";
import { MAX_COUNTED_RACES } from "../../numeric-readings/per-person-vector.ts";
import { nativePlacementPoints } from "../../scoring/native-points.ts";
import type { Mogi } from "../../types.ts";
import type { CaptureExplanationStep } from "../capture-explanation.ts";
import { distance, type RoomBoundary } from "./room-boundary.ts";
import { completeRoomPositions } from "./room-grouping.ts";
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
