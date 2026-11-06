import type { CaptureInterpretation, CaptureNumericRow, ObservedNameRow } from "../domain/capture/observations.ts";
import { interpretRightList } from "./finish-order.ts";
import { type NameRegionReading, readNameRegion } from "./names.ts";
import { readNumberRegion } from "./numbers.ts";
import type { OCRReader } from "./worker.ts";

// The final standings banner is mostly red with a yellow title; these counts cover it in the 740 by 145 crop.
const MIN_RED_BANNER_PIXELS = 20000;
const MIN_YELLOW_TITLE_PIXELS = 10000;
// A few misread totals can break overall order; more suggest a different screen.
const MAX_OUT_OF_ORDER_TOTALS = 2;

/**
 * Final standings banner: the red and yellow header of the event's closing screen, told apart by color.
 * The header text only needs to be present; its words depend on the console's language, so they are never matched.
 */
export function finalStandingsBanner(banner: ArrayLike<number>): boolean {
  let red = 0,
    yellow = 0;
  for (let n = 0; n < banner.length; n += 4) {
    if (banner[n] > 150 && banner[n] > banner[n + 1] * 1.35 && banner[n] > banner[n + 2] * 1.6) red++;
    if (banner[n] > 180 && banner[n + 1] > 140 && banner[n + 2] < 120) yellow++;
  }
  return red > MIN_RED_BANNER_PIXELS && yellow > MIN_YELLOW_TITLE_PIXELS;
}

/** Left-side event-final list: the banner, any header text and the rank/value grid in overall order corroborate the screen. */
export async function recognizeFinal(
  canvas: HTMLCanvasElement,
  worker: OCRReader,
  progress: (message: string) => void,
  cancelled: () => boolean,
) {
  if (!finalStandingsBanner(canvas.getContext("2d", { willReadFrequently: true })!.getImageData(40, 10, 740, 145).data))
    return;
  const title = (await readNameRegion(canvas, worker, { x: 0, y: 0, width: 1920, height: 185 })).text;
  if (!title.trim()) return;
  const rows: NameRegionReading[] = [];
  for (let row = 0; row < 12; row++) {
    if (cancelled()) throw new DOMException("Cancelled", "AbortError");
    progress(`Reading overall standings ${row + 1} of 12…`);
    rows.push(await readNameRegion(canvas, worker, { x: 280, y: 190 + row * 69, width: 455, height: 52 }));
  }
  const numericRows: CaptureNumericRow[] = [],
    positions: CaptureInterpretation["positions"] = [];
  for (let row = 0; row < 12; row++) {
    if (cancelled()) throw new DOMException("Cancelled", "AbortError");
    const position = await readNumberRegion(canvas, worker, { x: 150, y: 190 + row * 69, width: 50, height: 52 });
    // A rank belongs to the twelve-person list. Keep impossible OCR alternatives
    // as raw evidence without treating them as competing plausible ranks.
    const viable = (position.alternatives ?? [position])
      .filter((reading) => reading.value !== null && reading.value >= 1 && reading.value <= 12)
      .sort((a, b) => b.confidence - a.confidence);
    const best = viable[0];
    positions.push({
      ...position,
      text: best?.text ?? position.text,
      value: best?.value ?? null,
      confidence: best?.confidence ?? 0,
      uncertain: !best || best.confidence < 80 || viable.some((reading) => reading.value !== best.value),
    });
    numericRows.push({
      row: row + 1,
      right: await readNumberRegion(canvas, worker, { x: 755, y: 190 + row * 69, width: 120, height: 52 }),
      addition: {
        text: "",
        value: null,
        confidence: 0,
        uncertain: true,
        location: { x: 755, y: 190 + row * 69, width: 120, height: 52 },
      },
    });
  }
  const final = interpretFinalList(numericRows, positions, rows);
  if (!final) return;
  return {
    rows,
    ...final,
    interpretation: {
      ...final.interpretation,
      reasons: [`Header seen: ${title.trim()}`, ...final.interpretation.reasons],
    },
  };
}

/** The final banner establishes overall order, so a few contradictory totals stay uncertain without hiding the screen. */
export function interpretFinalList(
  numericRows: CaptureNumericRow[],
  positions: CaptureInterpretation["positions"],
  rows: readonly Pick<ObservedNameRow, "text">[],
) {
  const readable = numericRows.flatMap((row, index) =>
    !row.right.uncertain && row.right.value !== null ? [{ index, value: row.right.value }] : [],
  );
  const subsequences: number[][] = [];
  let longest: number[] = [];
  // Keep the first subsequence on ties, so equally long candidates resolve in row order.
  for (let index = 0; index < readable.length; index++) {
    let previous: number[] = [];
    for (let before = 0; before < index; before++) {
      if (readable[before].value >= readable[index].value && subsequences[before].length > previous.length)
        previous = subsequences[before];
    }
    const sequence = [...previous, readable[index].index];
    subsequences.push(sequence);
    if (sequence.length > longest.length) longest = sequence;
  }
  const outOfOrder = new Set(readable.filter(({ index }) => !longest.includes(index)).map(({ index }) => index));
  const marked = outOfOrder.size <= MAX_OUT_OF_ORDER_TOTALS ? outOfOrder.size : 0;
  const adjustedRows = marked
    ? numericRows.map((row, index) =>
        outOfOrder.has(index) ? { ...row, right: { ...row.right, uncertain: true } } : row,
      )
    : numericRows;
  const ordering = interpretRightList(adjustedRows, positions, [], rows);
  if (ordering.screen !== "overallStandings") return;
  return {
    numericRows: adjustedRows,
    interpretation: {
      version: 1 as const,
      screen: "finalStandings" as const,
      origin: "visual" as const,
      positions: ordering.positions,
      movementRows: [],
      reasons: [
        "Overall list on the left; read ranks keep ties",
        ...(marked ? [`${marked} total(s) out of overall order; readings kept as uncertain`] : []),
      ],
    },
  };
}
