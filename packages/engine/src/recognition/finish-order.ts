import type { CaptureInterpretation, CaptureNumericRow, ObservedNameRow } from "../domain/capture/observations.ts";
import { nativePlacementPoints } from "../domain/scoring/native-points.ts";
import { readNumberRegion } from "./numbers.ts";
import type { OCRReader } from "./worker.ts";

/** A right-side list is not necessarily a race result. Keep its independent visual cues. */
export async function recognizeFinishOrder(
  canvas: HTMLCanvasElement,
  worker: OCRReader,
  rows: CaptureNumericRow[],
  names: readonly Pick<ObservedNameRow, "text">[],
  cancelled: () => boolean,
): Promise<CaptureInterpretation> {
  const positions: CaptureInterpretation["positions"] = [];
  const movementRows: number[] = [];
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  for (let row = 0; row < 12; row++) {
    if (cancelled()) throw new DOMException("Cancelled", "AbortError");
    positions.push(await readNumberRegion(canvas, worker, { x: 1115, y: 48 + row * 77, width: 65, height: 58 }));
    // Overall standings show colored movement arrows/dashes before the displayed rank.
    const pixels = context.getImageData(1070, 58 + row * 77, 35, 35).data;
    let colored = 0;
    for (let n = 0; n < pixels.length; n += 4) {
      const r = pixels[n],
        g = pixels[n + 1],
        b = pixels[n + 2];
      if (Math.max(r, g, b) > 160 && Math.max(r, g, b) - Math.min(r, g, b) > 100) colored++;
    }
    if (colored > 220 && colored < 1000) movementRows.push(row + 1);
  }
  return interpretRightList(rows, positions, movementRows, names);
}

type RoomSize = 10 | 11 | 12;
type Positions = CaptureInterpretation["positions"];
type NameRows = readonly Pick<ObservedNameRow, "text">[];

// Supported native placement scales, largest first.
const ROOM_SIZES = [12, 11, 10] as const;
// Fewer stable ranks could come from a different list that happens to be numbered.
const MIN_STABLE_RANKS = 6;
// Fewer readable totals cannot show whether the list is sorted by cumulative.
const MIN_READABLE_TOTALS = 10;
// Two or more movement arrows mark the overall standings re-sort.
const MIN_MOVEMENT_ROWS = 2;
// Overall standings tolerate this many ranks that disagree with the cumulative order, and a finish order proven by a
// complete native scale this many misread ranks (OCR noise).
const MAX_RANK_DISAGREEMENTS = 2;
// Share of the read ranks that must agree with the cumulative order.
const MIN_RANK_AGREEMENT = 0.8;

/** Complete native scale: every addition matches the native points of one room size, and the rows past it are empty. */
export function completeNativeScale(rows: readonly CaptureNumericRow[]): RoomSize | undefined {
  return ROOM_SIZES.find((count) =>
    rows.every((row, n) =>
      n < count
        ? !row.addition.uncertain && row.addition.value === nativePlacementPoints(count)[n]
        : row.addition.value === null && row.right.value === null,
    ),
  );
}

/** Scale vote: at least two readable additions, all pointing at the same room size by their place in its native scale. */
export function votedNativeScale(rows: readonly CaptureNumericRow[]): RoomSize | undefined {
  const votes = rows.flatMap((row, index) => {
    if (row.addition.uncertain || row.addition.value === null) return [];
    const scale = ROOM_SIZES.find((count) => nativePlacementPoints(count)[index] === row.addition.value);
    return scale === undefined ? [] : [scale];
  });
  return votes.length >= 2 && votes.every((scale) => scale === votes[0]) ? votes[0] : undefined;
}

/**
 * Represented room: the room size and what shows it, in order of strength: the user's answer, a scale vote,
 * a complete native scale, or (weakest, `rows`) trailing rows empty in names and numbers with the last rank read.
 */
export function representedRoom(
  rows: readonly CaptureNumericRow[],
  positions: Positions,
  names: NameRows,
  answeredExtent?: RoomSize,
): Pick<CaptureInterpretation, "represented" | "representedBy"> {
  const currentScale = completeNativeScale(rows),
    votedScale = votedNativeScale(rows);
  // Without a vote, the trailing rows must also be empty in the name reading.
  const occupied = ROOM_SIZES.find(
    (count) =>
      rows
        .slice(count)
        .every(
          (row, n) =>
            row.addition.value === null &&
            row.right.value === null &&
            positions[count + n]?.value == null &&
            names[count + n]?.text.trim() === "",
        ) && rows[count - 1]?.right.value != null,
  );
  const represented =
    answeredExtent ??
    votedScale ??
    currentScale ??
    (occupied && !positions[occupied - 1]?.uncertain && positions[occupied - 1]?.value === occupied
      ? occupied
      : undefined);
  const representedBy: CaptureInterpretation["representedBy"] =
    answeredExtent !== undefined
      ? "user"
      : currentScale
        ? "scale"
        : votedScale
          ? "vote"
          : represented
            ? "rows"
            : undefined;
  return represented ? { represented, representedBy } : {};
}

/** Unsorted cumulative totals corroborate finish order; sorted totals could be overall standings. */
function unsortedTotals(rows: readonly CaptureNumericRow[]): boolean {
  const readable = rows.filter((row) => !row.right.uncertain && row.right.value !== null);
  return readable.some((row, n) => n > 0 && row.right.value! > readable[n - 1].right.value!);
}

/** Settled totals: no additions on screen and enough readable totals. */
function settledTotals(rows: readonly CaptureNumericRow[]): boolean {
  return (
    !rows.some((row) => row.addition.value !== null) &&
    rows.filter((row) => row.right.value !== null).length >= MIN_READABLE_TOTALS
  );
}

/** Stable ranks that contradict their row; a complete native scale of additions proves the row order instead. */
function misreadRanks(positions: Positions): number[] {
  return positions.flatMap((reading, n) =>
    !reading.uncertain && reading.value !== null && reading.value !== n + 1 ? [n] : [],
  );
}

/**
 * Finish-order cues: ranks 1..N corroborated by several stable readings (a scale vote can stand in for an unread
 * last rank), plus visible additions or, without them, few movement arrows and unsorted totals. With a complete
 * native scale of additions, a few misread ranks (a "7" read as "1") don't hide the finish order.
 * A missing `+` alone never makes `finishOrderAdded`; without these cues the screen stays `unknown`.
 */
export function showsFinishOrder(
  rows: readonly CaptureNumericRow[],
  positions: Positions,
  movementRows: readonly number[],
  extent: number,
  scaleProven: boolean,
): boolean {
  const ranks = positions.filter((reading) => !reading.uncertain && reading.value !== null);
  // Missing inner glyphs stay missing rather than being rewritten to the expected value.
  const ranked =
    ranks.length >= MIN_STABLE_RANKS &&
    (scaleProven || positions[extent - 1]?.value === extent) &&
    (misreadRanks(positions).length === 0 ||
      (completeNativeScale(rows) !== undefined && misreadRanks(positions).length <= MAX_RANK_DISAGREEMENTS));
  const additions = rows.some((row) => row.addition.value !== null);
  return (
    ranked && (additions || (movementRows.length < MIN_MOVEMENT_ROWS && settledTotals(rows) && unsortedTotals(rows)))
  );
}

/**
 * Overall standings ranks: the read ranks follow the cumulative order, where only a legible tie shares a rank,
 * within a small tolerance. Movement arrows are optional, so this screen never fixes the race number.
 */
export function overallStandingsRanks(rows: readonly CaptureNumericRow[], positions: Positions) {
  const expectedRank = (index: number) => {
    const reading = rows[index]?.right;
    // An unreadable row doesn't move the others. Only a legible tie changes the expected rank; missing totals stay uncertain.
    return !reading || reading.uncertain || reading.value === null
      ? index + 1
      : rows.findIndex((row) => !row.right.uncertain && row.right.value === reading.value) + 1;
  };
  const ranks = positions.filter((reading) => !reading.uncertain && reading.value !== null);
  const agreeing = positions.filter(
    (reading, index) => !reading.uncertain && reading.value !== null && reading.value === expectedRank(index),
  ).length;
  const disagreements = ranks.length - agreeing;
  const ranked =
    agreeing >= MIN_STABLE_RANKS &&
    disagreements <= MAX_RANK_DISAGREEMENTS &&
    agreeing >= ranks.length * MIN_RANK_AGREEMENT &&
    rows.length === 12 &&
    positions[11]?.value === expectedRank(11);
  return { ranked, disagreements, expectedRank };
}

/** Pure interpretation shared by OCR and batch analysis; raw readings stay unchanged. */
export function interpretRightList(
  rows: CaptureNumericRow[],
  positions: Positions,
  movementRows: number[],
  names: NameRows,
  answeredExtent?: RoomSize,
): CaptureInterpretation {
  const additions = rows.filter((row) => row.addition.value !== null);
  const currentScale = completeNativeScale(rows);
  const representation = representedRoom(rows, positions, names, answeredExtent);
  const extent = representation.represented ?? 12;
  const ranks = positions.filter((reading) => !reading.uncertain && reading.value !== null);
  const finishOrder = showsFinishOrder(
    rows,
    positions,
    movementRows,
    extent,
    answeredExtent !== undefined || votedNativeScale(rows) !== undefined,
  );
  const unsorted = unsortedTotals(rows);
  const overall = overallStandingsRanks(rows, positions);
  const general = !finishOrder && overall.ranked && settledTotals(rows) && !unsorted;
  if (general)
    return {
      version: 1,
      screen: "overallStandings",
      ...representation,
      origin: "visual",
      positions: positions.map((reading, index) => ({
        ...reading,
        uncertain: reading.uncertain || reading.value !== overall.expectedRank(index),
      })),
      movementRows,
      reasons: [
        "Ranks and totals in overall order; movement is optional",
        "Totals in overall order; no finish order",
        ...(overall.disagreements ? [`${overall.disagreements} rank(s) disagree with the set; readings kept`] : []),
      ],
    };
  return {
    version: 1,
    screen: finishOrder ? (additions.length ? "finishOrderAdding" : "finishOrderAdded") : "unknown",
    origin: "visual",
    positions: finishOrder
      ? positions.map((reading, index) =>
          misreadRanks(positions).includes(index) ? { ...reading, uncertain: true } : reading,
        )
      : positions,
    movementRows,
    ...(currentScale ? { currentScale } : {}),
    ...representation,
    reasons: [
      `Stable positions: ${ranks.length} of ${MIN_STABLE_RANKS} minimum`,
      `Last position: ${positions[extent - 1]?.value ?? "not read"} of ${extent} expected`,
      `Numbers on the right: ${rows.filter((row) => row.right.value !== null).length} of ${MIN_READABLE_TOTALS} minimum`,
      `Movement cues on rows: ${movementRows.join(", ") || "none"}`,
      `Totals out of descending order: ${unsorted ? "yes" : "no"}`,
      `Finish order without additions: needs stable positions, fewer than ${MIN_MOVEMENT_ROWS} movement cues and totals out of descending order`,
      `${additions.length} readable additions`,
      currentScale ? `Complete native scale of ${currentScale}` : "Full gains not proven",
    ],
  };
}
