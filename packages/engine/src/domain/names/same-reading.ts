import { capturePhaseOffset } from "../capture/capture-context.ts";
import { screenProperties } from "../capture/screens.ts";
import { captureNameAssociations } from "../questions/mogi-questions.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import type { Capture, Mogi, NameAssociation } from "../types.ts";
import { spelling } from "./spelling.ts";

// Two boards are the same layout only when enough people keep their order on both; a strict majority of a full
// room, as for the room's continuity.
const MIN_SHARED_PEOPLE = 6;
// A board read between races: each team keeps its rows in fixed slots, whatever the totals.
const SLOT_SCREEN = "twoColumnsByTeam";
// No race gives one person more than 15 points.
const MAX_POINTS_PER_RACE = 15;

/** Accepted total of each row: an answer, the room's deduction or a certain reading. */
export function rowTotals(capture: Capture): (number | undefined)[] {
  return capture.rows.map((_, index) => {
    const row = index + 1,
      reading = capture.numericRows?.find((entry) => entry.row === row)?.right;
    return (
      capture.numericAnswers?.find((answer) => answer.row === row)?.value ??
      capture.numericDeductions?.find((deduction) => deduction.row === row)?.value ??
      (reading && !reading.uncertain && reading.value != null ? reading.value : undefined)
    );
  });
}

export interface SameReadingLinks {
  rows: [number, string][];
  anchorCaptureId: string;
}

/** Rows whose reading appears more than once on the screen, by spelling, each group in row order. */
function repeatedReadings(capture: Capture, answers: readonly NameAssociation[]): number[][] {
  const groups = new Map<string, number[]>();
  capture.rows.forEach((row, index) => {
    const key = spelling(row.text);
    if (key) groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return [...groups.values()].filter(
    (rows) => rows.length > 1 && rows.some((index) => !answers[index]?.participantId && !answers[index]?.unlinked),
  );
}

/** The other screen's rows with the same reading, when each is linked to a distinct eligible person. */
function linkedTwins(other: Capture, key: string, eligible: ReadonlySet<string>): string[] | undefined {
  const links = captureNameAssociations(other);
  const ids = other.rows.flatMap((row, index) => (spelling(row.text) === key ? [links[index]?.participantId] : []));
  if (ids.some((id) => !id || !eligible.has(id)) || new Set(ids).size !== ids.length) return;
  return ids as string[];
}

/** Fills a group's rows with one pairing, unless an answered row, a withdrawn row or another row disagrees. */
function fill(rows: number[], pairing: string[], answers: readonly NameAssociation[]): [number, string][] | undefined {
  if (rows.some((index, i) => answers[index]?.unlinked || (answers[index]?.participantId ?? pairing[i]) !== pairing[i]))
    return;
  if (answers.some((answer, index) => !rows.includes(index) && pairing.includes(answer.participantId ?? ""))) return;
  return rows.flatMap((index, i) => (answers[index]?.participantId ? [] : [[index, pairing[i]] as [number, string]]));
}

/**
 * name.slot: a team board lists each team in fixed slots, so two boards of one room show the same person in the
 * same slot. Two rows reading the same name take, in order, the people that another board's same rows hold, when
 * every person linked on both boards keeps their order there (the same room's layout) and no board disagrees.
 */
export function boardSlots(
  mogi: Mogi,
  capture: Capture,
  answers: readonly NameAssociation[],
  people: readonly { id: string }[],
): SameReadingLinks | undefined {
  if (capture.interpretation?.screen !== SLOT_SCREEN) return;
  const eligible = new Set(people.map((person) => person.id));
  const result: [number, string][] = [];
  let anchorCaptureId: string | undefined;
  for (const rows of repeatedReadings(capture, answers)) {
    const key = spelling(capture.rows[rows[0]].text);
    const own = answers.flatMap((answer, index) =>
      rows.includes(index) || !answer.participantId ? [] : [answer.participantId],
    );
    let pairing: string[] | undefined;
    let anchor: string | undefined;
    let disagree = false;
    for (const other of mogi.captures ?? []) {
      if (other.id === capture.id || other.interpretation?.screen !== SLOT_SCREEN) continue;
      const twins = linkedTwins(other, key, eligible);
      if (!twins || twins.length !== rows.length) continue;
      const theirs = captureNameAssociations(other).flatMap((answer, index) =>
        spelling(other.rows[index].text) === key || !answer.participantId ? [] : [answer.participantId],
      );
      const shared = own.filter((id) => theirs.includes(id));
      if (shared.length < MIN_SHARED_PEOPLE || shared.join() !== theirs.filter((id) => own.includes(id)).join())
        continue;
      if (pairing && pairing.join() !== twins.join()) disagree = true;
      pairing ??= twins;
      anchor ??= other.id;
    }
    const filled = pairing && !disagree ? fill(rows, pairing, answers) : undefined;
    if (!filled?.length) continue;
    result.push(...filled);
    anchorCaptureId ??= anchor;
  }
  return anchorCaptureId ? { rows: result, anchorCaptureId } : undefined;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/**
 * name.continuity, for rows reading the same name: their people are the ones another screen links to that
 * reading, and each pairing must continue that screen's totals. At the same moment (everyone else linked on both
 * keeps their total) the totals are equal; one race apart in the room, each gain is a native place or a restart.
 * Exactly one pairing has to fit every such screen.
 */
export function sameReadingTotals(
  mogi: Mogi,
  capture: Capture,
  answers: readonly NameAssociation[],
  people: readonly { id: string }[],
): SameReadingLinks | undefined {
  const eligible = new Set(people.map((person) => person.id));
  const values = rowTotals(capture);
  const scale = nativePlacementPoints(12);
  const room = mogi.sequence?.roomAnalysis;
  const completed = (source: Capture) => {
    const entry = room?.captures.find((entry) => entry.captureId === source.id);
    return entry?.number === undefined || screenProperties(source.interpretation?.screen)?.cumulative !== "final"
      ? undefined
      : { session: entry.sessionId, races: entry.number - capturePhaseOffset(source) };
  };
  const result: [number, string][] = [];
  let anchorCaptureId: string | undefined;
  for (const rows of repeatedReadings(capture, answers)) {
    if (rows.some((index) => answers[index]?.participantId || values[index] === undefined)) continue;
    const key = spelling(capture.rows[rows[0]].text);
    let pairings: string[][] | undefined;
    let anchor: string | undefined;
    for (const other of mogi.captures ?? []) {
      if (other.id === capture.id) continue;
      const twins = linkedTwins(other, key, eligible);
      if (!twins || twins.length !== rows.length) continue;
      const totals = rowTotals(other),
        before = new Map<string, number>();
      captureNameAssociations(other).forEach((answer, index) => {
        if (answer.participantId && totals[index] !== undefined) before.set(answer.participantId, totals[index]!);
      });
      if (
        !twins.every((id) => before.has(id)) ||
        (pairings && [...twins].sort().join() !== [...(pairings[0] ?? twins)].sort().join())
      )
        continue;
      const shared = answers.flatMap((answer, index) =>
        answer.participantId && !rows.includes(index) && before.has(answer.participantId) && values[index] !== undefined
          ? [values[index]! - before.get(answer.participantId)!]
          : [],
      );
      const own = completed(capture),
        theirs = completed(other);
      const distance =
        shared.length >= MIN_SHARED_PEOPLE && shared.every((gain) => gain === 0)
          ? 0
          : own && theirs && own.session === theirs.session
            ? own.races - theirs.races
            : undefined;
      if (distance === undefined || Math.abs(distance) > 1) continue;
      const fits = (pairing: string[]) =>
        pairing.every((id, i) => {
          const [earlier, later] =
            distance >= 0 ? [before.get(id)!, values[rows[i]]!] : [values[rows[i]]!, before.get(id)!];
          return distance === 0
            ? earlier === later
            : scale.includes(later - earlier) || (later < earlier && later <= MAX_POINTS_PER_RACE);
        });
      pairings = (pairings ?? permutations(twins)).filter(fits);
      anchor ??= other.id;
    }
    const filled = pairings?.length === 1 ? fill(rows, pairings[0], answers) : undefined;
    if (!filled?.length) continue;
    result.push(...filled);
    anchorCaptureId ??= anchor;
  }
  return anchorCaptureId ? { rows: result, anchorCaptureId } : undefined;
}
