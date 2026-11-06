import { type CaptureNumericRow, type NumericReading, numericTextValue } from "../domain/capture/observations.ts";
import { nativePlacementPoints } from "../domain/scoring/native-points.ts";
import type { OCRReader } from "./worker.ts";
export async function readNumberRegion(
  canvas: HTMLCanvasElement,
  reader: OCRReader,
  location: NumericReading["location"],
  addition = false,
): Promise<NumericReading> {
  const reading = await reader.read(canvas, location);
  const parse = (text: string) => numericTextValue(text, addition);
  const value = parse(reading.text);
  return {
    text: reading.text,
    value,
    confidence: reading.confidence,
    uncertain: value === null || reading.confidence < 80,
    location,
    alternatives: reading.alternatives.map((attempt) => ({ ...attempt, value: parse(attempt.text) })),
  };
}
export async function recognizeNumbers(
  canvas: HTMLCanvasElement,
  worker: OCRReader,
  progress: (message: string) => void,
  isCancelled: () => boolean,
) {
  const numericRows: CaptureNumericRow[] = [];
  for (let row = 0; row < 12; row++) {
    if (isCancelled()) throw new DOMException("Cancelled", "AbortError");
    progress(`Reading numbers on row ${row + 1} of 12…`);
    const right = await readNumberRegion(canvas, worker, { x: 1728, y: 50 + row * 77, width: 112, height: 56 });
    const addition = await readNumberRegion(canvas, worker, { x: 1650, y: 50 + row * 77, width: 78, height: 56 }, true);
    numericRows.push({ row: row + 1, right, addition });
  }
  const matchesScale = (field: "right" | "addition") =>
    [10, 11, 12].some((count) =>
      numericRows.every((row, n) => row[field].value === (nativePlacementPoints(count)[n] ?? null)),
    );
  const additions = numericRows.filter((row) => row.addition.value !== null);
  const numericStageSuggestion =
    additions.length && !matchesScale("addition")
      ? ("animation" as const)
      : !additions.length && matchesScale("right")
        ? ("points-only" as const)
        : ("unverified" as const);
  return { numericRows, numericStageSuggestion };
}
