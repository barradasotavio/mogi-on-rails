import { nativePlacementPoints } from "../scoring/native-points.ts";
import {
  FULL_ROOM_POINTS,
  missingTotalsByScale,
  type NumericBoundary,
  recordDeducedTotal,
} from "./numeric-deduction.ts";
import { cumulativeInRange, MAX_POINTS_PER_RACE, sum, vectorDistance } from "./per-person-vector.ts";

type NumberedBoundary = NumericBoundary & { localRace?: number; conflictRows?: number[]; time?: number };

/** points.sum: adjacent adding columns compare the same boundary; otherwise the native vector must close the interval. */
export function neighbouringCumulatives(
  boundary: NumberedBoundary,
  neighbour: NumberedBoundary,
): Map<string, number> | undefined {
  if (
    neighbour === boundary ||
    neighbour.localRace === undefined ||
    neighbour.conflictRows?.length ||
    neighbour.keys.length !== boundary.keys.length ||
    !boundary.keys.every((key) => neighbour.values.has(key))
  )
    return;
  const scale = nativePlacementPoints(boundary.keys.length);
  const completed = neighbour.localRace - neighbour.offset;
  const target = boundary.localRace === undefined ? undefined : boundary.localRace - boundary.offset;
  let values: Map<string, number> | undefined;
  if (boundary.prior && (target === undefined || target === completed + 1)) {
    values = new Map(boundary.keys.map((key, row) => [key, neighbour.values.get(key)! + scale[row]]));
  } else if (neighbour.prior && target === completed - 1) {
    const prior = new Map(neighbour.keys.map((key, row) => [key, neighbour.values.get(key)! - scale[row]]));
    values = new Map(boundary.keys.map((key) => [key, prior.get(key)!]));
  } else if (target === undefined || target > completed) {
    values = missingTotalsByScale(neighbour.values, boundary)?.values;
  }
  if (!values) return;
  return nativeCumulativeInterval(boundary, neighbour, values) ? values : undefined;
}

/** race.vector-continuity: a candidate must close the room sum and every person's native interval, in photo order when known. */
export function nativeCumulativeInterval(
  boundary: NumberedBoundary,
  neighbour: NumberedBoundary,
  values: Map<string, number>,
): boolean {
  const scale = nativePlacementPoints(boundary.keys.length);
  const completed = neighbour.localRace! - neighbour.offset;
  const target = boundary.localRace === undefined ? undefined : boundary.localRace - boundary.offset;
  const count = sum(values.values()) / FULL_ROOM_POINTS;
  if (!Number.isInteger(count) || count < 1 || (target !== undefined && target !== count)) return false;
  if (boundary.keys.some((key, row) => values.get(key)! - (boundary.prior ? scale[row] : 0) < 0)) return false;
  const earlier = count > completed;
  if (
    boundary.keys.some(
      (key) =>
        !cumulativeInRange(
          earlier ? neighbour.values.get(key)! : values.get(key)!,
          earlier ? values.get(key)! : neighbour.values.get(key)!,
          Math.abs(count - completed),
        ),
    )
  )
    return false;
  if (
    boundary.time !== undefined &&
    neighbour.time !== undefined &&
    (earlier ? boundary.time < neighbour.time : boundary.time > neighbour.time)
  )
    return false;
  const distance = earlier
    ? vectorDistance(neighbour.values, values, scale.length)
    : vectorDistance(values, neighbour.values, scale.length);
  return distance === Math.abs(count - completed);
}

/** points.out-of-range: one contradictory reading stays a question while the other rows keep the room's sum and continuity. */
export function singleMisreadTotal(boundary: NumberedBoundary, neighbours: NumberedBoundary[]): void {
  const scale = nativePlacementPoints(boundary.keys.length);
  const candidates = neighbours.flatMap((neighbour) => {
    const values = neighbouringCumulatives(boundary, neighbour);
    if (!values) return [];
    const conflicts: number[] = [];
    const restarts: string[] = [];
    for (const [index, key] of boundary.keys.entries()) {
      const expected = values.get(key)! - (boundary.prior ? scale[index] : 0);
      const answer = boundary.source.numericAnswers?.find((answer) => answer.row === index + 1);
      const reading = boundary.source.numericRows?.find((reading) => reading.row === index + 1)?.right;
      // An answered total is checked like a certain reading: a restart stands, and a contradiction is asked again.
      const total = answer ? answer.value : reading && !reading.uncertain ? reading.value : null;
      if (total === null || total === expected) continue;
      const restart = restartedTotal(boundary, neighbour, key, total + (boundary.prior ? scale[index] : 0), values);
      if (restart === "new") restarts.push(key);
      else if (!restart) conflicts.push(index + 1);
    }
    if (!conflicts.length && restarts.length)
      boundary.restarted = new Set([...(boundary.restarted ?? []), ...restarts]);
    // A restart still deviates: with another deviating row, neither is a lone misread.
    return conflicts.length === 1 && !restarts.length ? [{ values, conflicts }] : [];
  });
  const candidate = candidates[0];
  if (
    !candidate ||
    candidates.some((other) => boundary.keys.some((key) => other.values.get(key) !== candidate.values.get(key)))
  )
    return;
  boundary.localRace = sum(candidate.values.values()) / FULL_ROOM_POINTS + boundary.offset;
  boundary.unresolvedTotals = candidate.conflicts;
  boundary.conflictRows = [...new Set([...(boundary.conflictRows ?? []), ...candidate.conflicts])];
  for (const [index, key] of boundary.keys.entries()) {
    const value = candidate.values.get(key)!;
    if (value === boundary.values.get(key)) continue;
    boundary.values.set(key, value);
    recordDeducedTotal(
      boundary,
      index + 1,
      value - (boundary.prior ? scale[index] : 0),
      candidate.conflicts.includes(index + 1) ? "points.out-of-range" : "points.sum",
    );
  }
}

/** points.restart: a legible total below the continuity value, but within what the person gained since the earlier
 * neighbour, is a restart from zero (a reconnection), not a misread. It is "new" when the neighbour is one race
 * earlier; across a wider interval, the screen in between may already have shown it. A neighbour total the room's sum
 * filled in (the row was unreadable) assumed nobody restarted, so it bounds nothing: the restart came earlier, and
 * the reading stands while it fits the races played. */
export function restartedTotal(
  boundary: NumberedBoundary,
  neighbour: NumberedBoundary,
  key: string,
  read: number,
  values: Map<string, number>,
): "new" | "earlier" | undefined {
  const races = sum(values.values()) / FULL_ROOM_POINTS - (neighbour.localRace! - neighbour.offset);
  const gain = values.get(key)! - neighbour.values.get(key)!;
  if (races < 1 || read >= values.get(key)!) return;
  const row = neighbour.keys.indexOf(key) + 1;
  if (!neighbour.readRows.has(row) && neighbour.deductions.some((deduction) => deduction.row === row))
    return read <= (sum(values.values()) / FULL_ROOM_POINTS) * MAX_POINTS_PER_RACE ? "earlier" : undefined;
  if (read > gain) return;
  return races === 1 ? "new" : "earlier";
}

/** points.restart: a restart shows a zero, which OCR rates below certainty. A row read only as zero, whose total was
 * deduced as continuing one race from the previous screen or could not be deduced at all, restarted there: the
 * screen's zero stands. */
export function restartedZeros(boundary: NumberedBoundary, before: Map<string, number>): void {
  const scale = nativePlacementPoints(boundary.keys.length);
  if (boundary.prior || vectorDistance(before, boundary.values, scale.length) !== 1) return;
  for (const [index, key] of boundary.keys.entries()) {
    const reading = boundary.source.numericRows?.find((reading) => reading.row === index + 1)?.right;
    if (
      reading?.uncertain &&
      reading.value === 0 &&
      (reading.alternatives ?? []).every((alternative) => alternative.value === 0) &&
      (boundary.deductions.some((deduction) => deduction.row === index + 1 && deduction.value > 0) ||
        !boundary.values.has(key)) &&
      !boundary.source.numericAnswers?.some((answer) => answer.row === index + 1) &&
      before.get(key)! > 0
    ) {
      boundary.values.set(key, 0);
      recordDeducedTotal(boundary, index + 1, 0, "points.restart");
      boundary.restarted = new Set([...(boundary.restarted ?? []), key]);
    }
  }
}

/** points.out-of-range: an unanswered contradictory reading supplies no per-person sequencing evidence. */
export function sequencingCumulatives(boundary: NumberedBoundary): Map<string, number> {
  const unknown = new Set(boundary.unresolvedTotals?.map((row) => boundary.keys[row - 1]));
  return new Map([...boundary.values].filter(([key]) => !unknown.has(key)));
}
