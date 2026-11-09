import type { TrackStanding } from "@mkw/engine";

import type { TrackerState, TrackOrder } from "@/lib/mogi/types";

export type { TrackOrder };
export type SortBy = TrackOrder["by"];
export type Count = TrackOrder["count"];

/** Tracks opens in Typical +/− until the player makes another order the default. */
export const DEFAULT_TRACK_ORDER: TrackOrder = { by: "typical", count: "both" };

/** The saved default track order, or Typical +/− while none is saved. */
export const savedTrackOrder = (state: Pick<TrackerState, "trackOrder">): TrackOrder =>
  state.trackOrder ?? DEFAULT_TRACK_ORDER;

/** The state with `order` as the default; Typical +/− is written as no field, as before any default existed. */
export function withTrackOrder(state: TrackerState, order: TrackOrder): TrackerState {
  const next: TrackerState = { ...state, trackOrder: order };
  if (sameTrackOrder(order, DEFAULT_TRACK_ORDER)) delete next.trackOrder;
  return next;
}

/** The state with Vote shown or hidden on the mogi screen; shown, the default, is written as no field. */
export function withVoteShown(state: TrackerState, shown: boolean): TrackerState {
  const next: TrackerState = { ...state, voteShown: shown };
  if (shown) delete next.voteShown;
  return next;
}

/** Races counts every race, so its count never tells two orders apart. */
export const sameTrackOrder = (a: TrackOrder, b: TrackOrder) =>
  a.by === b.by && (a.by === "races" || a.count === b.count);

/** The chosen measure of a track; null when it has no race on that side. */
export const measureOf = (standing: TrackStanding, { by, count }: TrackOrder): number | null =>
  by === "races"
    ? standing.recent
    : by === "typical"
      ? { both: standing.typical, plus: standing.typicalPlus, minus: standing.typicalMinus }[count]
      : { both: standing.cost, plus: standing.totalPlus, minus: standing.totalMinus }[count];

/**
 * The tracks from the extreme the measure is about: the highest for plus and +/−, the most negative for minus, the
 * most races for Races. Tracks with no race on the chosen side follow; engine order (typical, then races, then
 * catalog) breaks ties, since the sort is stable.
 */
export function orderTracks(tracks: readonly TrackStanding[], order: TrackOrder) {
  const direction = order.by !== "races" && order.count === "minus" ? 1 : -1;
  return tracks
    .map((standing) => ({ standing, value: measureOf(standing, order) }))
    .sort((a, b) =>
      a.value === null ? (b.value === null ? 0 : 1) : b.value === null ? -1 : direction * (a.value - b.value),
    );
}

/** A track's vote light: Good, Mixed or Bad, from where its value falls among every shown track's. */
export type VoteLight = "good" | "mixed" | "bad";
export interface VoteTrack {
  track: TrackStanding["track"];
  light: VoteLight;
}

/**
 * The optimal split of `values` into at most `groups` groups (1-D k-means, Fisher–Jenks): the one with the least
 * squared deviation from each group's mean, solved exactly by dynamic programming over the sorted distinct values,
 * so equal values always share a group. Each value's group, 0 for the lowest; as many groups as distinct values when
 * there are fewer.
 */
export function naturalBreaks(values: readonly number[], groups: number): number[] {
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  const n = distinct.length;
  const k = Math.min(groups, n);
  if (k <= 1) return values.map(() => 0);
  const count = distinct.map((value) => values.filter((other) => other === value).length);
  // Prefix sums of count, value·count and value²·count give any run's squared deviation in constant time.
  const [w, s, q] = [[0], [0], [0]];
  distinct.forEach((value, i) => {
    w.push(w[i] + count[i]);
    s.push(s[i] + value * count[i]);
    q.push(q[i] + value * value * count[i]);
  });
  const deviation = (from: number, to: number) => {
    const weight = w[to] - w[from];
    const sum = s[to] - s[from];
    return q[to] - q[from] - (sum * sum) / weight;
  };
  // best[g][j]: least deviation of the first j distinct values in g + 1 groups; start[g][j]: where the last begins.
  const best = [Array.from({ length: n + 1 }, (_, j) => (j ? deviation(0, j) : 0))];
  const start = [Array.from({ length: n + 1 }, () => 0)];
  for (let g = 1; g < k; g++) {
    best.push(Array(n + 1).fill(Infinity));
    start.push(Array(n + 1).fill(0));
    for (let j = g + 1; j <= n; j++)
      for (let i = g; i < j; i++) {
        const cost = best[g - 1][i] + deviation(i, j);
        if (cost < best[g][j]) [best[g][j], start[g][j]] = [cost, i];
      }
  }
  const groupOf = new Map<number, number>();
  for (let g = k - 1, j = n; g >= 0; j = start[g][j], g--)
    for (let i = start[g][j]; i < j; i++) groupOf.set(distinct[i], g);
  return values.map((value) => groupOf.get(value)!);
}

/** The lights by how many groups the values fall into, lowest group first. */
const lightsByGroups: Record<number, VoteLight[]> = {
  1: ["mixed"],
  2: ["bad", "good"],
  3: ["bad", "mixed", "good"],
};

/**
 * The mogi screen's Vote: every track in the window, best for voting first by the measure Tracks › Sort shows
 * (higher is better for every measure; no race on the chosen side counts as 0). Its natural breaks over every
 * track's value light the highest group Good, the middle Mixed and the lowest Bad. The engine's order (typical, then
 * races, then catalog) breaks ties, since the sort is stable.
 */
export function voteTracks(tracks: readonly TrackStanding[], order: TrackOrder): VoteTrack[] {
  const ranked = tracks
    .map((standing) => ({ standing, value: measureOf(standing, order) ?? 0 }))
    .sort((a, b) => b.value - a.value);
  const groups = naturalBreaks(
    ranked.map(({ value }) => value),
    3,
  );
  const lights = lightsByGroups[Math.max(0, ...groups) + 1];
  return ranked.map(({ standing }, index) => ({ track: standing.track, light: lights[groups[index]] }));
}
