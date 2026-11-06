import type { CaptureInterpretation, CaptureNumericRow, NumericReading } from "../domain/capture/observations.ts";
import { type NameRegionReading, readNameRegion } from "./names.ts";
import { readNumberRegion } from "./numbers.ts";
import type { OCRReader } from "./worker.ts";

export interface ObservedGroup {
  rows: number[];
  total?: NumericReading;
  label?: string;
}
export interface TeamsRecognition {
  rows: NameRegionReading[];
  numericRows: CaptureNumericRow[];
  interpretation: Omit<CaptureInterpretation, "screen"> & { screen: "teamStandings"; groups: ObservedGroup[] };
}

/** Four full-width group panels distinguish this observed screen from lists and the pre-race map. */
export function hasTeamsBoard(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const colors = [
    (r: number, g: number, b: number) => r > 160 && g < 150 && b < 120,
    (r: number, g: number, b: number) => b > 150 && r < 130,
    (r: number, g: number, b: number) => r > 170 && g > 110 && b < 130,
    (r: number, g: number, b: number) => g > 140 && r < 140 && b > 70,
  ];
  return colors.every((matches, column) => {
    const pixels = context.getImageData(235 + column * 480, 330, 20, 20).data;
    let matching = 0;
    for (let n = 0; n < pixels.length; n += 4) if (matches(pixels[n], pixels[n + 1], pixels[n + 2])) matching++;
    return matching > 240;
  });
}

/** Source ordinals run down each physical group; they never imply a finish order rank. */
export async function recognizeTeams(
  canvas: HTMLCanvasElement,
  worker: OCRReader,
  progress: (message: string) => void,
  cancelled: () => boolean,
): Promise<TeamsRecognition | undefined> {
  if (!hasTeamsBoard(canvas)) return;
  const groups: ObservedGroup[] = [];
  const rows: NameRegionReading[] = [];
  const numericRows: CaptureNumericRow[] = [];
  const nameX = [90, 565, 1040, 1515];
  const pointX = [400, 875, 1350, 1825];
  for (let column = 0; column < 4; column++) {
    if (cancelled()) throw new DOMException("Cancelled", "AbortError");
    progress(`Reading total of group ${column + 1}…`);
    const total = await readNumberRegion(canvas, worker, { x: 155 + column * 475, y: 382, width: 260, height: 135 });
    groups.push({ rows: [column * 3 + 1, column * 3 + 2, column * 3 + 3], total, label: `Grupo ${column + 1}` });
  }
  for (let column = 0; column < 4; column++)
    for (let member = 0; member < 3; member++) {
      if (cancelled()) throw new DOMException("Cancelled", "AbortError");
      progress(`Reading name in group ${column + 1}, row ${member + 1}…`);
      rows.push(
        await readNameRegion(canvas, worker, { x: nameX[column], y: 565 + member * 65, width: 305, height: 50 }),
      );
    }
  for (let column = 0; column < 4; column++)
    for (let member = 0; member < 3; member++) {
      if (cancelled()) throw new DOMException("Cancelled", "AbortError");
      progress(`Reading total in group ${column + 1}, row ${member + 1}…`);
      const location = { x: pointX[column], y: 565 + member * 65, width: 75, height: 50 };
      const right = await readNumberRegion(canvas, worker, location);
      // This presentation has no addition field. An empty reading is not zero points.
      numericRows.push({
        row: column * 3 + member + 1,
        right,
        addition: { text: "", value: null, confidence: 0, uncertain: true, location },
      });
    }
  return {
    rows,
    numericRows,
    interpretation: {
      version: 1,
      screen: "teamStandings",
      origin: "visual",
      positions: [],
      movementRows: [],
      groups,
      reasons: ["Four total panels and four player groups"],
    },
  };
}
