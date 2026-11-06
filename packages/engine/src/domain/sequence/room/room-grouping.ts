import type { Mogi } from "../../types.ts";
import { distance, type RoomBoundary } from "./room-boundary.ts";
import { answeredReopening, epochByPhotoTime } from "./room-reopening.ts";

export interface RoomPair {
  from: number;
  to: number;
  distance: number;
}

/** race.vector-continuity: boundaries at the same local position must agree on their shared totals. */
export function roomPositionsAgree(first: RoomBoundary, second: RoomBoundary): boolean {
  return (
    first.localRace === undefined ||
    second.localRace === undefined ||
    first.localRace - first.offset !== second.localRace - second.offset ||
    [...first.values].every(([key, value]) => !second.values.has(key) || second.values.get(key) === value)
  );
}

/** race.vector-continuity: a position reaches every source already joined to it, so the shortest pairs place the room
 * and a longer pair that disagrees with them is rejected. A longer pair can hide a restart (a person back at zero
 * who has since scored past their old total), which only the race-by-race comparison shows. */
function placeAlong(nodes: RoomBoundary[], accepted: RoomPair[]) {
  for (let changed = true; changed;) {
    changed = false;
    for (const pair of accepted) {
      const from = nodes[pair.from],
        to = nodes[pair.to];
      if (to.localRace === undefined && from.localRace !== undefined) {
        to.localRace = from.localRace - from.offset + pair.distance + to.offset;
        changed = true;
      }
      if (from.localRace === undefined && to.localRace !== undefined) {
        from.localRace = to.localRace - to.offset - pair.distance + from.offset;
        changed = true;
      }
    }
  }
}

export function groupRoomSources(mogi: Mogi, nodes: RoomBoundary[]) {
  // Coherent photo times tell apart the same vector reappearing after a room reopening.
  let epoch = 0,
    previous: RoomBoundary | undefined;
  for (const boundary of nodes
    .filter((boundary) => boundary.time !== undefined)
    .sort((from, to) => from.time! - to.time!)) {
    epoch = epochByPhotoTime(
      previous,
      boundary,
      epoch,
      nodes.filter((entry) => entry.epoch === epoch),
    );
    boundary.epoch = epoch;
    previous = boundary;
  }
  const parents = nodes.map((_, index) => index);
  const root = (index: number): number => (parents[index] === index ? index : (parents[index] = root(parents[index])));
  const pairs: RoomPair[] = [],
    accepted: RoomPair[] = [];
  for (let from = 0; from < nodes.length; from++)
    for (let to = from + 1; to < nodes.length; to++) {
      if (answeredReopening(mogi, nodes[from].source, nodes[to].source)) continue;
      const forward = distance(nodes[from].values, nodes[to]);
      if (forward !== undefined) pairs.push({ from, to, distance: forward });
      else {
        const backward = distance(nodes[to].values, nodes[from]);
        if (backward !== undefined) pairs.push({ from: to, to: from, distance: backward });
      }
    }
  for (const pair of pairs.sort((from, to) => from.distance - to.distance)) {
    // An internal relation no longer changes the session: the accepted pairs already place both sources.
    if (root(pair.from) === root(pair.to)) continue;
    const left = nodes.filter((_, index) => root(index) === root(pair.from)),
      right = nodes.filter((_, index) => root(index) === root(pair.to));
    if (
      new Set([...left, ...right].flatMap((boundary) => (boundary.epoch === undefined ? [] : [boundary.epoch]))).size >
      1
    )
      continue;
    if (left.some((from) => right.some((to) => answeredReopening(mogi, from.source, to.source)))) continue;
    const shifts = [...left, ...right].flatMap((boundary) =>
      boundary.answeredNumber !== undefined && boundary.localRace !== undefined
        ? [boundary.answeredNumber - boundary.localRace]
        : [],
    );
    if (new Set(shifts).size > 1) continue;
    const from = nodes[pair.from],
      to = nodes[pair.to];
    if (!left.every((a) => right.every((b) => roomPositionsAgree(a, b)))) continue;
    if (
      from.localRace !== undefined &&
      to.localRace !== undefined &&
      to.localRace - to.offset - (from.localRace - from.offset) !== pair.distance
    )
      continue;
    accepted.push(pair);
    placeAlong(nodes, accepted);
    parents[root(pair.to)] = root(pair.from);
  }
  const groups = [...new Set(nodes.map((_, index) => root(index)))].map((groupRoot) =>
    nodes
      .filter((_, index) => root(index) === groupRoot)
      .sort(
        (from, to) =>
          (from.localRace === undefined ? Infinity : from.localRace - from.offset) -
            (to.localRace === undefined ? Infinity : to.localRace - to.offset) ||
          Number(to.exact) - Number(from.exact) ||
          (from.time !== undefined && to.time !== undefined ? from.time - to.time : 0) ||
          (from.source.fingerprint ?? "").localeCompare(to.source.fingerprint ?? "") ||
          from.source.id.localeCompare(to.source.id),
      ),
  );
  return { groups, pairs };
}

export function completeRoomPositions(group: RoomBoundary[], start: number | undefined) {
  // A room short of its native points (a player left with no points) fits no sum: an answered number then anchors
  // its capture, relative to the room's start when known, and per-person continuity places the rest.
  for (const boundary of group)
    if (boundary.localRace === undefined && boundary.answeredNumber !== undefined && start !== undefined)
      boundary.localRace = boundary.answeredNumber - start + 1;
  const anchor = group.every((boundary) => boundary.localRace === undefined)
    ? group.find((boundary) => boundary.answeredNumber !== undefined)
    : undefined;
  if (anchor) anchor.localRace = anchor.answeredNumber;
  for (let pass = 0; pass < group.length && group.some((boundary) => boundary.localRace === undefined); pass++)
    for (const from of group)
      for (const to of group) {
        if (from.localRace === undefined || to.localRace !== undefined) continue;
        const steps = distance(from.values, to);
        if (steps !== undefined) to.localRace = from.localRace - from.offset + steps + to.offset;
      }
  group.sort(
    (from, to) =>
      (from.localRace === undefined ? Infinity : from.localRace - from.offset) -
        (to.localRace === undefined ? Infinity : to.localRace - to.offset) ||
      Number(to.exact) - Number(from.exact) ||
      (from.time !== undefined && to.time !== undefined ? from.time - to.time : 0) ||
      (from.source.fingerprint ?? "").localeCompare(to.source.fingerprint ?? "") ||
      from.source.id.localeCompare(to.source.id),
  );
}
