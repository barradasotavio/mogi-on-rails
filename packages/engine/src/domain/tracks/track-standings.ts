import { pointsFor } from "../scoring/points.ts";
import { countedRaces, raceNumber } from "../scoring/scoring.ts";
import type { Mogi, MogiFormat, Race } from "../types.ts";
import { raceTrack, type Track, tracks } from "./tracks.ts";

/** The player's most recent mogis describe how tracks currently go for them. */
export const RECENT_MOGIS = 36;
/** Instability needs at least three races to describe repeated variation. */
export const UNSTABLE_MIN_RACES = 3;
/** An unstable track's usual range reaches at least two places on each side of zero. */
export const UNSTABLE_REACH = 2;

export interface TrackRace {
  mogiId: string;
  mogiName: string;
  format: MogiFormat;
  /** The mogi's creation time. */
  createdAt: string;
  raceId: string;
  raceNumber: number;
  place: number;
  points: number;
  /** Average place across all your placed races in the mogi, including trackless races. */
  mogiAverage: number;
  /** Mogi average minus place; positive means better than your level that night. */
  value: number;
  /** Whether this race is in the player's most recent RECENT_MOGIS mogis. */
  recent: boolean;
  /** Median value on this track from the window's first race through this race; null outside the window. */
  runningTypical: number | null;
}

export interface TrackStanding {
  /** The track these results describe. */
  track: Track;
  /** All races on the track, chronological by mogi creation time, then race number. */
  races: TrackRace[];
  /** The track's frequency: number of races in the player's recent mogi window, with no per-track cap. */
  recent: number;
  /** Median race value in the recent window, for choosing tracks to vote for. */
  typical: number;
  /** Median of the window's race values above zero; null when none. */
  typicalPlus: number | null;
  /** Median of the window's race values below zero; null when none. */
  typicalMinus: number | null;
  /** Sum of the window's race values above zero; null when none. */
  totalPlus: number | null;
  /** Sum of the window's race values below zero; null when none. */
  totalMinus: number | null;
  /** First quartile of recent race values, using type 7 linear interpolation. */
  lowerQuartile: number;
  /** Third quartile of recent race values, using type 7 linear interpolation. */
  upperQuartile: number;
  /** Minimum race value in the recent window. */
  worst: number;
  /** Maximum race value in the recent window. */
  best: number;
  /** Whether enough recent races have a usual range reaching UNSTABLE_REACH on each side of zero. */
  unstable: boolean;
  /** Sum of race values on this track in the recent window; negative means places lost overall. */
  cost: number;
  /** Negative sum of race values in the recent window; higher means practice first. */
  priority: number;
}

export interface TrackStandings {
  /** Your Lounge names, trimmed, without repeats; empty means Tracks doesn't know which player is you. */
  loungeNames: string[];
  /** Mogis in the recent window with at least one placed, counted race on a track. */
  mogis: number;
  /** Placed, counted races on tracks in the recent window. */
  races: number;
  /** The player's mogis outside the recent window, including those without track races. */
  olderMogis: number;
  /** Tracks with races in the window: best typical first, then more window races, then catalog order. */
  tracks: TrackStanding[];
}

function normalizedLoungeName(name: string): string {
  return name.trim().toLowerCase();
}

/** The single Lounge name present in every mogi, ignoring case and surrounding whitespace: a suggestion for Your Lounge names. */
export function defaultLoungeName(mogis: readonly Mogi[]): string | null {
  if (!mogis.length) return null;
  const names = new Map(
    mogis[0].participants
      .filter((participant) => participant.loungeName.trim())
      .map((participant) => [normalizedLoungeName(participant.loungeName), participant.loungeName.trim()]),
  );
  for (const mogi of mogis.slice(1)) {
    const present = new Set(mogi.participants.map((participant) => normalizedLoungeName(participant.loungeName)));
    for (const name of names.keys()) if (!present.has(name)) names.delete(name);
  }
  return names.size === 1 ? names.values().next().value! : null;
}

interface PlacedRace {
  race: Race;
  participantId: string;
  place: number;
}

function placedRaces(mogi: Mogi, names: ReadonlySet<string>): PlacedRace[] {
  const ids = [
    ...new Set(
      mogi.participants
        .filter((participant) => participant.id && names.has(normalizedLoungeName(participant.loungeName)))
        .map((participant) => participant.id),
    ),
  ];
  return countedRaces(mogi).flatMap((race) => {
    const placed = ids.filter((id) => !race.absentParticipantIds?.includes(id) && race.placements.indexOf(id) >= 0);
    if (placed.length !== 1) return [];
    const participantId = placed[0];
    return [{ race, participantId, place: race.placements.indexOf(participantId) + 1 }];
  });
}

type TrackRaceValue = Omit<TrackRace, "runningTypical">;

function mogiTrackRaces(
  mogi: Mogi,
  names: ReadonlySet<string>,
  recent: boolean,
): { track: Track; race: TrackRaceValue }[] {
  const placed = placedRaces(mogi, names);
  if (!placed.length) return [];
  const mogiAverage = placed.reduce((sum, entry) => sum + entry.place, 0) / placed.length;
  return placed.flatMap(({ race, participantId, place }) => {
    const track = raceTrack(mogi, race);
    if (!track) return [];
    return [
      {
        track,
        race: {
          mogiId: mogi.id,
          mogiName: mogi.name,
          format: mogi.format,
          createdAt: mogi.createdAt,
          raceId: race.id,
          raceNumber: raceNumber(mogi, race),
          place,
          points: pointsFor(race, participantId),
          mogiAverage,
          value: mogiAverage - place,
          recent,
        },
      },
    ];
  });
}

function quantile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * p;
  const lower = Math.floor(h);
  return sorted[lower] + (h - lower) * (sorted[Math.ceil(h)] - sorted[lower]);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function standingForTrack(track: Track, values: TrackRaceValue[]): TrackStanding {
  const raceValues = values.filter((race) => race.recent).map((race) => race.value);
  const positiveValues = raceValues.filter((value) => value > 0);
  const negativeValues = raceValues.filter((value) => value < 0);
  const typical = median(raceValues);
  const lowerQuartile = quantile(raceValues, 0.25);
  const upperQuartile = quantile(raceValues, 0.75);
  const cost = raceValues.reduce((sum, value) => sum + value, 0) || 0;
  const runningValues: number[] = [];
  const races = values.map((race) => {
    if (race.recent) runningValues.push(race.value);
    return { ...race, runningTypical: race.recent ? median(runningValues) : null };
  });
  return {
    track,
    races,
    recent: raceValues.length,
    typical,
    typicalPlus: positiveValues.length ? median(positiveValues) : null,
    typicalMinus: negativeValues.length ? median(negativeValues) : null,
    totalPlus: positiveValues.length ? positiveValues.reduce((sum, value) => sum + value, 0) : null,
    totalMinus: negativeValues.length ? negativeValues.reduce((sum, value) => sum + value, 0) : null,
    lowerQuartile,
    upperQuartile,
    worst: Math.min(...raceValues),
    best: Math.max(...raceValues),
    unstable:
      raceValues.length >= UNSTABLE_MIN_RACES && lowerQuartile <= -UNSTABLE_REACH && upperQuartile >= UNSTABLE_REACH,
    cost,
    priority: -cost || 0,
  };
}

/**
 * Compare placed, counted track results in the player's latest RECENT_MOGIS mogis by creation time. Each of
 * `loungeNames` counts as you, since a Lounge name can change; matching ignores case and surrounding whitespace.
 */
export function trackStandings(mogis: readonly Mogi[], loungeNames: readonly string[]): TrackStandings {
  const trimmed = loungeNames.map((name) => name.trim()).filter(Boolean);
  const names = trimmed.filter(
    (name, index) => trimmed.findIndex((other) => normalizedLoungeName(other) === normalizedLoungeName(name)) === index,
  );
  const result: TrackStandings = { loungeNames: names, mogis: 0, races: 0, olderMogis: 0, tracks: [] };
  if (!names.length) return result;
  const normalizedNames = new Set(names.map(normalizedLoungeName));
  const played = mogis
    .filter((mogi) =>
      mogi.participants.some((participant) => normalizedNames.has(normalizedLoungeName(participant.loungeName))),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  result.olderMogis = Math.max(0, played.length - RECENT_MOGIS);
  const chronological = played.flatMap((mogi, index) => {
    const recent = index >= result.olderMogis;
    const races = mogiTrackRaces(mogi, normalizedNames, recent);
    if (recent && races.length) {
      result.mogis++;
      result.races += races.length;
    }
    return races;
  });
  chronological.sort(
    (a, b) => Date.parse(a.race.createdAt) - Date.parse(b.race.createdAt) || a.race.raceNumber - b.race.raceNumber,
  );
  const grouped = new Map<Track["short"], TrackRaceValue[]>();
  for (const { track, race } of chronological) {
    const previous = grouped.get(track.short) ?? [];
    previous.push(race);
    grouped.set(track.short, previous);
  }
  result.tracks = tracks.flatMap((track) => {
    const races = grouped.get(track.short);
    return races?.some((race) => race.recent) ? [standingForTrack(track, races)] : [];
  });
  // Stable sorting preserves catalog order when both typical and race count tie.
  result.tracks.sort((a, b) => b.typical - a.typical || b.recent - a.recent);
  return result;
}
