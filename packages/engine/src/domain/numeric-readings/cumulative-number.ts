import { contextPhase } from "../capture/capture-context.ts";
import { screenProperties } from "../capture/screens.ts";
import { consistentTeamRows } from "../capture/team-evidence.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import type { Capture } from "../types.ts";
import { FULL_ROOM_PLAYERS, FULL_ROOM_POINTS, MAX_MISSING_TOTALS } from "./numeric-deduction.ts";
import { MAX_COUNTED_RACES, MAX_POINTS_PER_RACE, MIN_POINTS_PER_RACE } from "./per-person-vector.ts";

/** race.vector-continuity: the sum anchors a suggested number for a capture outside the room analysis;
 * it declares neither a zero origin nor continuity. */
export function cumulativeNumber(capture: Capture): number | undefined {
  const prior =
    capture.interpretation?.screen === "finishOrderAdding" && capture.interpretation.currentScale === FULL_ROOM_PLAYERS;
  if (
    capture.rows.length !== FULL_ROOM_PLAYERS ||
    (screenProperties(capture.interpretation?.screen)?.cumulative !== "final" && !prior)
  )
    return;
  if (
    screenProperties(capture.interpretation?.screen)?.teamTotals &&
    consistentTeamRows(capture).length !== FULL_ROOM_PLAYERS
  )
    return;
  if (
    prior &&
    capture.rows.some((_, index) => {
      const row = capture.numericRows?.find((row) => row.row === index + 1);
      return !row || row.addition.uncertain || row.addition.value !== nativePlacementPoints(FULL_ROOM_PLAYERS)[index];
    })
  )
    return;
  const values = capture.rows.map((_, index) => {
    const row = capture.numericRows?.find((row) => row.row === index + 1);
    return (
      capture.numericAnswers?.find((answer) => answer.row === index + 1)?.value ??
      (row && !row.right.uncertain ? row.right.value : undefined)
    );
  });
  const readable = values.filter((value): value is number => value !== null && value !== undefined);
  if (readable.some((value) => !Number.isSafeInteger(value) || value < 0)) return;
  const missing = values.length - readable.length,
    sum = readable.reduce((total, value) => total + value, 0);
  // A single missing reading does not block the suggestion when the native
  // limits leave only one possible sum. The missing value stays unknown.
  if (missing > MAX_MISSING_TOTALS) return;
  const offset = prior || contextPhase(capture) === "before" ? 1 : 0;
  const counts = Array.from({ length: MAX_COUNTED_RACES + 1 - offset }, (_, count) => count).filter(
    (count) =>
      count + offset >= 1 &&
      (missing
        ? readable.every((value) => value >= MIN_POINTS_PER_RACE * count && value <= count * MAX_POINTS_PER_RACE) &&
          FULL_ROOM_POINTS * count - sum >= MIN_POINTS_PER_RACE * count &&
          FULL_ROOM_POINTS * count - sum <= count * MAX_POINTS_PER_RACE
        : sum === FULL_ROOM_POINTS * count),
  );
  if (counts.length === 1) return counts[0] + offset;
}
