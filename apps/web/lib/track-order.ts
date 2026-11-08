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

/** A track's vote light: Good, Mixed or Bad, from its usual range. */
export type VoteLight = "good" | "mixed" | "bad";
export interface VoteTrack {
  track: TrackStanding["track"];
  light: VoteLight;
}
/** Fewer races than this in the recent window leave a track Mixed: its usual range says too little. */
export const VOTE_MIN_RACES = 3;

/** Good when even the usual range's low end gains positions (Q1 > 0), Bad when its high end loses them (Q3 < 0). */
export function voteLight(standing: TrackStanding): VoteLight {
  if (standing.recent < VOTE_MIN_RACES) return "mixed";
  return standing.lowerQuartile > 0 ? "good" : standing.upperQuartile < 0 ? "bad" : "mixed";
}

const lightRank: Record<VoteLight, number> = { good: 0, mixed: 1, bad: 2 };

/**
 * The mogi screen's Vote: every track in the window, Good, then Mixed, then Bad, each by Typical +/−, best first.
 * The engine's order (typical, then races, then catalog) breaks ties, since the sort is stable.
 */
export function voteTracks(tracks: readonly TrackStanding[]): VoteTrack[] {
  return tracks
    .map((standing) => ({ standing, light: voteLight(standing) }))
    .sort((a, b) => lightRank[a.light] - lightRank[b.light] || b.standing.typical - a.standing.typical)
    .map(({ standing, light }) => ({ track: standing.track, light }));
}
