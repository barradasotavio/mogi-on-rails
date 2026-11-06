import type { NumericReading } from "../domain/capture/observations.ts";
import type { OCRReader } from "./worker.ts";
export interface NameRegionReading {
  text: string;
  confidence: number;
  location: NumericReading["location"];
  alternatives: { text: string; confidence: number }[];
}
/** Original spelling stays observable; participant association belongs to the caller. */
export async function readNameRegion(
  canvas: HTMLCanvasElement,
  reader: OCRReader,
  location: NumericReading["location"],
): Promise<NameRegionReading> {
  return { ...(await reader.read(canvas, location)), location };
}
