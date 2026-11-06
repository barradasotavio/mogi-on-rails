import { screenProperties } from "../capture/screens.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import type { Capture } from "../types.ts";

// Six shared players prevent coincidental agreement between sparse vectors.
export const MIN_SHARED_PLAYERS = 6;
// A Lounge mogi counts twelve races; discarded occurrences are added separately.
export const MAX_COUNTED_RACES = 12;
// First place awards at most fifteen native points in one race.
export const MAX_POINTS_PER_RACE = 15;
// Last place awards one native point in every supported room size.
export const MIN_POINTS_PER_RACE = 1;
// Native room scales stop at the twelve represented players of a Lounge mogi.
const MAX_ROOM_PLAYERS = 12;

export const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);

/** A capture's cumulatives keyed by person, with the row order that produced each key. */
export interface PersonVector {
  source: Capture;
  values: Map<string, number>;
  keys: string[];
  prior: boolean;
  offset: number;
}

/** points.out-of-range: after `races` races a cumulative `previous` can only reach `previous + n ≤ total ≤ previous + 15·n`. */
export function cumulativeInRange(previous: number, total: number, races: number): boolean {
  const gain = total - previous;
  return gain >= MIN_POINTS_PER_RACE * races && gain <= MAX_POINTS_PER_RACE * races;
}

/** race.vector-continuity: shared people occupy any places in each room between the two boundary sizes. */
export function mixedRoomRaceCounts(gains: number[], represented: number, largestRoom = MAX_ROOM_PLAYERS): number[] {
  const scales = Array.from(
    { length: Math.max(0, Math.min(largestRoom, MAX_ROOM_PLAYERS) - represented + 1) },
    (_, i) => nativePlacementPoints(represented + i),
  ).filter((scale) => scale.length && scale.length >= gains.length);
  if (!scales.length || !gains.length) return [];
  const minimum = Math.min(...scales.map((scale) => sum(scale.slice(-gains.length))));
  const maximum = Math.max(...scales.map((scale) => sum(scale.slice(0, gains.length))));
  const total = sum(gains);
  // Supported scales' shared-sum ranges overlap, so all mixes fill this combined range.
  return Array.from({ length: MAX_COUNTED_RACES }, (_, i) => i + 1).filter(
    (races) =>
      total >= races * minimum &&
      total <= races * maximum &&
      gains.every((gain) => cumulativeInRange(0, gain, races)) &&
      (races !== 1 ||
        (new Set(gains).size === gains.length && scales.some((scale) => gains.every((gain) => scale.includes(gain))))),
  );
}

/** Local numeric pairing that never accepts an identity: the match must be unique on both sides. */
export function rowAnchors(anchor: Map<string, number>, boundary: PersonVector): Map<string, number> {
  const scale = nativePlacementPoints(boundary.keys.length),
    available = [...anchor].filter(([key]) => !boundary.keys.includes(key));
  const candidates = boundary.keys.map((key, row) => {
    // The boundary already checked recognition against the current name; raw certainty may be stale.
    // A row inferred past the crop (`unseenRowParticipant`) has no reading to pair.
    if (
      row >= boundary.source.rows.length ||
      anchor.has(key) ||
      boundary.source.nameAssociations?.[row]?.participantId ||
      key === boundary.source.rows[row].suggestedParticipantId
    )
      return [];
    const value = boundary.values.get(key);
    if (value === undefined) return [];
    return available.filter(([, previous]) =>
      boundary.prior || screenProperties(boundary.source.interpretation?.screen)?.order === "finishOrder"
        ? value - previous === scale[row]
        : boundary.offset
          ? value === previous
          : scale.includes(value - previous),
    );
  });
  const result = new Map(anchor);
  candidates.forEach((options, row) => {
    if (options.length !== 1 || candidates.filter((other) => other.some(([key]) => key === options[0][0])).length !== 1)
      return;
    result.delete(options[0][0]);
    result.set(boundary.keys[row], options[0][1]);
  });
  return result;
}

/** points.restart: a drop is a person's restart only while the people who kept their totals still decide the step. */
function restartsAside(kept: number[], shared: number): boolean {
  return kept.length >= MIN_SHARED_PLAYERS && kept.length * 2 > shared;
}

/** points.restart: a restarted total was scored after the restart, inside the races of the step. */
function restartsFit(shared: [string, number][], anchor: Map<string, number>, races: number): boolean {
  return shared.every(([id, value]) => value >= anchor.get(id)! || value <= races * MAX_POINTS_PER_RACE);
}

/** race.vector-continuity / duplicate.same-vector: compare shared identities without treating absence as zero. */
export function vectorDistance(
  anchor: Map<string, number>,
  current: Map<string, number>,
  represented: number,
): number | undefined {
  const scale = nativePlacementPoints(represented);
  const shared = [...current].filter(([id]) => anchor.has(id));
  if (shared.length < MIN_SHARED_PLAYERS || !scale.length) return;
  if (anchor.size === represented && current.size === represented - 1 && shared.length === current.size) {
    const id = [...anchor.keys()].find((id) => !current.has(id))!;
    // The smallest distance that closes the vector is the explanation with no unseen event.
    for (let racesCompleted = 1; racesCompleted <= MAX_COUNTED_RACES; racesCompleted++) {
      const value = sum(anchor.values()) + sum(scale) * racesCompleted - sum(current.values());
      if (!cumulativeInRange(anchor.get(id)!, value, racesCompleted)) continue;
      const candidate = new Map(current).set(id, value);
      if (vectorDistance(anchor, candidate, represented) === racesCompleted) return racesCompleted;
    }
    return;
  }
  const gains = shared.map(([id, value]) => value - anchor.get(id)!);
  if (gains.every((gain) => gain === 0)) return 0;
  const positive = gains.filter((gain) => gain >= 0);
  if (anchor.size > represented && shared.length === current.size) {
    // Restarts (a person back near zero) leave the comparison to everyone else; the room shrank, it never reopened.
    if (!restartsAside(positive, shared.length)) return;
    const possible = mixedRoomRaceCounts(positive, represented, anchor.size).filter((races) =>
      restartsFit(shared, anchor, races),
    );
    return possible.length === 1 ? possible[0] : undefined;
  }
  if (positive.length < MIN_SHARED_PLAYERS) return;
  if (positive.every((gain) => scale.includes(gain)) && new Set(positive).size === positive.length) return 1;
  if (positive.length !== represented) return;
  const racesCompleted = sum(positive) / sum(scale);
  if (
    Number.isInteger(racesCompleted) &&
    racesCompleted > 1 &&
    racesCompleted <= MAX_COUNTED_RACES &&
    positive.every((gain) => gain >= racesCompleted * scale.at(-1)! && gain <= racesCompleted * MAX_POINTS_PER_RACE)
  )
    return racesCompleted;
}
