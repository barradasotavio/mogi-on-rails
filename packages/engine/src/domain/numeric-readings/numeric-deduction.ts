import { capturePhaseOffset } from "../capture/capture-context.ts";
import { screenProperties } from "../capture/screens.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import type { CaptureExplanationStep } from "../sequence/capture-explanation.ts";
import type { Capture, Mogi } from "../types.ts";
import { nativePriorScale, numericCandidates, representedPlayers } from "./numeric-candidates.ts";
import {
  cumulativeInRange,
  MAX_COUNTED_RACES,
  MAX_POINTS_PER_RACE,
  MIN_SHARED_PLAYERS,
  type PersonVector,
  rowAnchors,
  sum,
  vectorDistance,
} from "./per-person-vector.ts";

// Only a complete twelve-player room supports numbering by the cumulative sum.
export const FULL_ROOM_PLAYERS = 12;
// The native twelve-player placement table sums to eighty-two points per race.
export const FULL_ROOM_POINTS = 82;
// More than one missing total cannot be determined by the sum alone.
export const MAX_MISSING_TOTALS = 1;

export const POINTS_SUM_RULE: CaptureExplanationStep["rule"] = "points.sum";

export type DeducedTotal = { row: number; value: number; origin: "deduced" };

/** Deduced totals and their explanation for one capture; the readings themselves stay untouched. */
export interface NumericPlan {
  source: Capture;
  deductions: DeducedTotal[];
  pointSteps: Map<number, CaptureExplanationStep>;
  readRows: Set<number>;
  unresolvedTotals?: number[];
  /** People whose legible total restarted from zero since an earlier neighbour (`restartedTotal`). */
  restarted?: Set<string>;
}
export type NumericBoundary = NumericPlan & PersonVector;

/** points.out-of-range: no game cumulative exceeds fifteen points for every race played, discarded ones included. */
export function maxGameCumulative(mogi: Mogi): number {
  return MAX_POINTS_PER_RACE * (MAX_COUNTED_RACES + mogi.races.filter((race) => race.status === "discarded").length);
}

/** points.noise-candidate: a reading with one spurious character ("545" → 54) only yields a value the vector corroborates. */
export function spuriousCharacterCandidate(text: string, value: number): boolean {
  return numericCandidates(text).includes(value);
}

/** Store a deduced total and its explanation; a later deduction for the row replaces it. */
export function recordDeducedTotal(
  plan: NumericPlan,
  row: number,
  value: number,
  rule: CaptureExplanationStep["rule"],
  discarded?: number,
) {
  const reading = plan.source.numericRows?.find((reading) => reading.row === row)?.right;
  discarded ??= plan.pointSteps.get(row)?.evidence.discarded;
  if (discarded !== undefined) rule = "points.out-of-range";
  // A candidate is selected only after the native vector has corroborated this total.
  const candidate = !!reading && spuriousCharacterCandidate(reading.text, value);
  if (candidate) {
    rule = "points.noise-candidate";
    discarded ??= reading.value ?? undefined;
  }
  plan.deductions = plan.deductions.filter((deduction) => deduction.row !== row);
  plan.deductions.push({ row, value, origin: "deduced" });
  plan.readRows.delete(row);
  plan.pointSteps.set(row, {
    kind: "points",
    subject: plan.source.id,
    value,
    origin: candidate ? "read" : "deduced",
    rule,
    evidence: {
      row,
      playerId: plan.source.nameAssociations?.[row - 1]?.participantId ?? undefined,
      readText: reading?.text ?? "",
      ...(discarded === undefined ? {} : { discarded }),
    },
  });
}

/** A majority of read zeros, including uncertain ones, supports a zero column; blank alone never does. */
export function zeroGameCumulativeColumn(source: Capture): boolean {
  const column = source.rows
    .slice(0, representedPlayers(source))
    .map((_, index) => source.numericRows?.find((reading) => reading.row === index + 1)?.right);
  return (
    column.every(
      (reading, index) =>
        (source.numericAnswers?.find((answer) => answer.row === index + 1)?.value ?? reading?.value ?? 0) === 0 &&
        (!reading?.text.trim() || reading.value === 0),
    ) && column.filter((reading) => reading?.value === 0).length > column.length / 2
  );
}

/** points.sum: a zero column starts the room unless another source proves an earlier or competing start. */
export function zeroColumnRoomStart(mogi: Mogi, source: Capture): boolean {
  const scale = nativePriorScale(source);
  const totals = new Map(
    source.rows.map((row, index) => [source.nameAssociations?.[index]?.participantId ?? row.text, scale?.[index] ?? 0]),
  );
  return !(mogi.captures ?? []).some((other) => {
    if (other.id === source.id) return false;
    if (
      zeroGameCumulativeColumn(other) &&
      mogi.sequence?.numbers.some(
        (fact) => fact.captureId === other.id && (fact.physicalNumber ?? fact.number ?? 0) > 1,
      )
    )
      return false;
    if (other.photoMoment && source.photoMoment && other.photoMoment.at !== source.photoMoment.at)
      return other.photoMoment.at < source.photoMoment.at;
    if (zeroGameCumulativeColumn(other)) return true;
    const prior = nativePriorScale(other);
    const shared = other.rows.flatMap((row, index) => {
      const key = other.nameAssociations?.[index]?.participantId ?? row.text;
      const reading = other.numericRows?.find((reading) => reading.row === index + 1)?.right;
      const value =
        other.numericAnswers?.find((answer) => answer.row === index + 1)?.value ??
        (reading && !reading.uncertain ? reading.value : undefined);
      return totals.has(key) && value != null ? [value + (prior?.[index] ?? 0) < totals.get(key)!] : [];
    });
    return shared.length >= MIN_SHARED_PLAYERS && shared.filter(Boolean).length > shared.length / 2;
  });
}

/** points.as-shown / points.out-of-range: answers win, readings beyond `maxGameCumulative` are discarded, uncertain ones stay unknown. */
export function readGameCumulatives(mogi: Mogi, source: Capture, roomStart = false) {
  const numeric: NumericPlan = { source, deductions: [], pointSteps: new Map(), readRows: new Set() };
  const answered = mogi.sequence?.numbers.some((fact) => fact.captureId === source.id);
  const first = zeroColumnRoomStart(mogi, source);
  // Later zeros need a corroborated totals drop (a local room start), or an answered number.
  const zeros = (answered || first || roomStart) && zeroGameCumulativeColumn(source);
  const shown = source.rows.map((_, index) => {
    const reading = source.numericRows?.find((reading) => reading.row === index + 1)?.right;
    const manual = source.numericAnswers?.find((answer) => answer.row === index + 1);
    if (manual) return manual.value;
    if (zeros && (reading?.value == null || reading.uncertain)) {
      recordDeducedTotal(numeric, index + 1, 0, POINTS_SUM_RULE);
      return 0;
    }
    const value = reading?.value ?? undefined;
    if (value !== undefined && value >= 0 && value <= maxGameCumulative(mogi)) {
      if (reading?.uncertain && !zeros) return undefined;
      numeric.readRows.add(index + 1);
      return value;
    }
    if (value !== undefined)
      numeric.pointSteps.set(index + 1, {
        kind: "points",
        subject: source.id,
        value: null,
        origin: "deduced",
        rule: "points.out-of-range",
        evidence: {
          row: index + 1,
          playerId: source.nameAssociations?.[index]?.participantId ?? undefined,
          readText: reading?.text ?? "",
          discarded: value,
        },
      });
    return undefined;
  });
  return { numeric, shown, zeroStart: zeros };
}

export function pointExplanation(plan: NumericPlan): CaptureExplanationStep[] {
  return [
    {
      kind: "points",
      subject: plan.source.id,
      value: plan.readRows.size,
      origin: "read",
      rule: "points.as-shown",
      evidence: { compared: representedPlayers(plan.source) },
    },
    ...[...plan.pointSteps.values()].sort((from, to) => from.evidence.row! - to.evidence.row!),
  ];
}

/** points.sum: subtract the known totals from the native interval total. */
export function totalByRemainder(
  totals: (number | undefined)[],
  racesCompleted: number,
  anchorTotal = 0,
  pointsPerRace = FULL_ROOM_POINTS,
): { row: number; value: number } | undefined {
  const missing = totals.flatMap((value, row) => (value === undefined ? [row] : []));
  if (missing.length !== MAX_MISSING_TOTALS) return;
  return {
    row: missing[0],
    value:
      anchorTotal +
      pointsPerRace * racesCompleted -
      sum(totals.filter((value): value is number => value !== undefined)),
  };
}

/** points.race1-permutation: in race one the overall order is also the finish order, so the readable native values
 * fix the remaining places without promoting the OCR's uncertain suggestion; a prior vector of zeros fills its blanks. */
export function firstRacePermutation(
  plan: NumericPlan,
  shown: (number | undefined)[],
  scale: readonly number[],
  prior: boolean,
): void {
  const source = plan.source;
  const readable = shown.filter((value): value is number => value !== undefined);
  if (
    !prior &&
    !capturePhaseOffset(source) &&
    ["general", "finishOrder"].includes(screenProperties(source.interpretation!.screen).order) &&
    shown.filter((value, index) => value === scale[index]).length >= MIN_SHARED_PLAYERS &&
    readable.every((value) => value <= MAX_POINTS_PER_RACE) &&
    new Set(readable).size === readable.length &&
    source.numericAnswers?.every((answer) => answer.value === scale[answer.row - 1]) !== false
  ) {
    shown.forEach((value, index) => {
      if (value === scale[index]) return;
      shown[index] = scale[index];
      recordDeducedTotal(plan, index + 1, scale[index], "points.race1-permutation");
    });
  }
  if (prior && readable.length >= MIN_SHARED_PLAYERS && readable.every((value) => value === 0)) {
    shown.forEach((value, index) => {
      if (value !== undefined) return;
      shown[index] = 0;
      recordDeducedTotal(plan, index + 1, 0, "points.race1-permutation");
    });
  }
}

/** Ambiguity asks only for the points of the ambiguous rows: repeated race-one values mark just those rows. */
export function duplicateFirstRaceRows(
  source: Capture,
  shown: (number | undefined)[],
  readable: number[],
  prior: boolean,
): number[] {
  return !prior && !capturePhaseOffset(source) && readable.every((value) => value <= MAX_POINTS_PER_RACE)
    ? shown.flatMap((value, index) =>
        value !== undefined && shown.filter((other) => other === value).length > 1 ? [index + 1] : [],
      )
    : [];
}

/** points.sum: a pre-race screen lists the coming race's room; when it lists fewer players than the previous totals,
 * the race its totals close may have had more, so its points sum is unknown. */
function roomLeftBefore(anchor: Map<string, number>, boundary: NumericBoundary): boolean {
  return !boundary.prior && boundary.keys.length < FULL_ROOM_PLAYERS && boundary.keys.length < anchor.size;
}

/** points.sum / points.out-of-range: several missing or impossible totals take the remaining places of one race,
 * or the remainder of the sum across several races, as long as the completed vector keeps the same distance. */
export function missingTotalsByScale(anchor: Map<string, number>, boundary: NumericBoundary) {
  anchor = rowAnchors(anchor, boundary);
  const scale = nativePlacementPoints(boundary.keys.length);
  if (
    roomLeftBefore(anchor, boundary) ||
    !boundary.keys.every((key) => anchor.has(key)) ||
    (vectorDistance(anchor, boundary.values, scale.length) !== undefined && boundary.values.size === scale.length)
  )
    return;
  // An individual restart is another continuity segment, not a reading error.
  if ([...boundary.values].some(([key, value]) => value < anchor.get(key)!)) return;
  const limit = [...anchor.values()].every((value) => value === 0) ? 1 : MAX_COUNTED_RACES;
  for (let steps = 1; steps <= limit; steps++) {
    const discarded = new Map<string, number>();
    const usable = new Map(
      [...boundary.values].filter(([key, value]) => {
        if (boundary.source.numericAnswers?.some((answer) => boundary.keys[answer.row - 1] === key)) return true;
        const valid = cumulativeInRange(anchor.get(key)!, value, steps);
        if (!valid) discarded.set(key, value - (boundary.prior ? scale[boundary.keys.indexOf(key)] : 0));
        return valid;
      }),
    );
    const missing = boundary.keys.filter((key) => !usable.has(key));
    if (!missing.length || usable.size < MIN_SHARED_PLAYERS) continue;
    const completed = new Map(usable),
      gains = [...usable].map(([key, value]) => value - anchor.get(key)!);
    if (steps === 1) {
      if (gains.some((gain) => !scale.includes(gain)) || new Set(gains).size !== gains.length) continue;
      const remaining = scale.filter((value) => !gains.includes(value));
      if (remaining.length !== missing.length) continue;
      missing.forEach((key, index) => completed.set(key, anchor.get(key)! + remaining[index]));
    } else {
      if (missing.length !== MAX_MISSING_TOTALS) continue;
      const remainder = totalByRemainder(
        [undefined, ...usable.values()],
        steps,
        sum(boundary.keys.map((key) => anchor.get(key)!)),
        sum(scale),
      )!;
      completed.set(missing[0], remainder.value);
    }
    if (vectorDistance(anchor, completed, scale.length) === steps)
      return {
        values: completed,
        changes: missing.map((key) => ({
          key,
          value: completed.get(key)! - (boundary.prior ? scale[boundary.keys.indexOf(key)] : 0),
          rule: discarded.has(key) ? ("points.out-of-range" as const) : POINTS_SUM_RULE,
          discarded: discarded.get(key),
        })),
      };
  }
}

/** Deduce the totals a capture is missing from the previous vector: `missingTotalsByScale`, else one remainder. */
export function deduceFromAnchor(boundary: NumericBoundary, anchor: Map<string, number>) {
  anchor = rowAnchors(anchor, boundary);
  const scale = nativePlacementPoints(representedPlayers(boundary.source)),
    missing = boundary.keys.filter((key) => !boundary.values.has(key));
  // duplicate.same-vector: a screen repeating the anchor's totals repeats the unread one too.
  if (
    missing.length === MAX_MISSING_TOTALS &&
    boundary.values.size >= MIN_SHARED_PLAYERS &&
    boundary.keys.every((key) => anchor.has(key)) &&
    [...boundary.values].every(([key, value]) => anchor.get(key) === value)
  ) {
    const row = boundary.keys.indexOf(missing[0]),
      value = anchor.get(missing[0])!;
    boundary.values.set(missing[0], value);
    recordDeducedTotal(boundary, row + 1, value - (boundary.prior ? scale[row] : 0), "duplicate.same-vector");
    return;
  }
  const completed = missingTotalsByScale(anchor, boundary);
  if (completed) {
    for (const { key, value: total, rule, discarded } of completed.changes) {
      const row = boundary.keys.indexOf(key),
        value = completed.values.get(key)!;
      boundary.values.set(key, value);
      recordDeducedTotal(boundary, row + 1, total, rule, discarded);
    }
    return;
  }
  const distance = vectorDistance(anchor, boundary.values, scale.length);
  if (
    missing.length !== MAX_MISSING_TOTALS ||
    roomLeftBefore(anchor, boundary) ||
    !boundary.keys.every((key) => anchor.has(key)) ||
    !distance
  )
    return;
  const remainder = totalByRemainder(
    [undefined, ...boundary.values.values()],
    distance,
    sum(boundary.keys.map((key) => anchor.get(key)!)),
    sum(scale),
  )!;
  const row = boundary.keys.indexOf(missing[0]);
  boundary.values.set(missing[0], remainder.value);
  recordDeducedTotal(boundary, row + 1, remainder.value - (boundary.prior ? scale[row] : 0), POINTS_SUM_RULE);
}
