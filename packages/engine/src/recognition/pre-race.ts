import type { CaptureNumericRow, NumericReading } from "../domain/capture/observations.ts";
import { readNameRegion } from "./names.ts";
import { readNumberRegion } from "./numbers.ts";
import { trackBanner } from "./track-banner.ts";
import type { OCRReader } from "./worker.ts";

function occupiedCard(canvas: HTMLCanvasElement, column: number, slot: number): boolean {
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const light = (y: number) => {
    const pixels = context.getImageData(400 + column * 505, y + slot * 76, 40, 1).data;
    let total = 0;
    for (let n = 0; n < pixels.length; n += 4)
      total += (pixels[n] * 299 + pixels[n + 1] * 587 + pixels[n + 2] * 114) / 1000;
    return total / 40;
  };
  const edge = Math.max(...Array.from({ length: 9 }, (_, n) => light(87 + n)));
  const inside = light(104),
    outside = light(84);
  const body = context.getImageData(400 + column * 505, 104 + slot * 76, 40, 1).data;
  const channels = [0, 0, 0];
  for (let n = 0; n < body.length; n += 4) for (let c = 0; c < 3; c++) channels[c] += body[n + c] / 40;
  const colored = Math.max(...channels) > 140 && Math.max(...channels) - Math.min(...channels) > 60;
  return edge > outside + 16 && (edge > inside + 8 || (colored && edge > inside + 2));
}

function observedHue(canvas: HTMLCanvasElement, column: number, slot: number): number | undefined {
  const pixels = canvas
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(440 + column * 505, 110 + slot * 76, 20, 20).data;
  const channels = [0, 0, 0];
  for (let n = 0; n < pixels.length; n += 4) for (let c = 0; c < 3; c++) channels[c] += pixels[n + c] / 400;
  const [r, g, b] = channels,
    high = Math.max(...channels),
    low = Math.min(...channels),
    delta = high - low;
  if (delta < 60) return undefined;
  const hue = high === r ? ((g - b) / delta + 6) % 6 : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return hue;
}

/** A lone digit, like each 0 before race 1, escapes the wide crop; the tight one clips 102, so it only retries. */
async function readCardTotal(canvas: HTMLCanvasElement, worker: OCRReader, column: number, slot: number) {
  const wide = await readNumberRegion(canvas, worker, {
    x: 455 + column * 505,
    y: 99 + slot * 76,
    width: 80,
    height: 47,
  });
  if (wide.value !== null) return wide;
  const tight = await readNumberRegion(canvas, worker, {
    x: 485 + column * 505,
    y: 104 + slot * 76,
    width: 50,
    height: 37,
  });
  const alternatives = [...(wide.alternatives ?? []), ...(tight.alternatives ?? [])];
  return { ...(tight.value !== null ? tight : wide), alternatives };
}

/** The map moves its label with the track's marker, so the crop follows the banner wherever it sits: `trackBanner`. */
async function readNextTrack(canvas: HTMLCanvasElement, worker: OCRReader) {
  const image = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
  const location = trackBanner(image);
  return location && readNameRegion(canvas, worker, location);
}

/** Two-column lobby cards and their upcoming-track label supply context, never finish order. */
export async function recognizePreRace(
  canvas: HTMLCanvasElement,
  worker: OCRReader,
  progress: (message: string) => void,
  cancelled: () => boolean,
) {
  const cells: { column: number; slot: number; right: NumericReading }[] = [];
  for (let column = 0; column < 2; column++)
    for (let slot = 0; slot < 12; slot++) {
      if (cancelled()) throw new DOMException("Cancelled", "AbortError");
      if (!occupiedCard(canvas, column, slot)) continue;
      cells.push({
        column,
        slot,
        right: await readCardTotal(canvas, worker, column, slot),
      });
    }
  if (cells.filter((cell) => cell.right.value !== null).length < 10) return;
  const occupied = [];
  for (const cell of cells) {
    if (cancelled()) throw new DOMException("Cancelled", "AbortError");
    progress("Reading players before the race…");
    const name = await readNameRegion(canvas, worker, {
      x: 140 + cell.column * 505,
      y: 99 + cell.slot * 76,
      width: 315,
      height: 47,
    });
    if (cell.right.value !== null || (name.confidence >= 25 && (name.text.match(/\p{L}/gu)?.length ?? 0) >= 2))
      occupied.push({ ...cell, name });
  }
  if (occupied.length > 12 || occupied.filter((cell) => cell.name.text).length < 10) return;
  const nextTrack = await readNextTrack(canvas, worker);
  const hues = occupied.map((cell) => observedHue(canvas, cell.column, cell.slot));
  // Hue uses six units per turn: 0.05 is three degrees. Require proximity to
  // every member so sampling noise cannot split a swatch at an integer bin,
  // and nearby intermediates cannot chain together distinct observed colors.
  const observedHueTolerance = 0.05;
  const hueGroups: { hues: number[]; rows: number[] }[] = [];
  hues.forEach((hue, index) => {
    if (hue === undefined) return;
    let group = hueGroups.find((entry) =>
      entry.hues.every((value) => {
        const distance = Math.abs(value - hue);
        return Math.min(distance, 6 - distance) <= observedHueTolerance;
      }),
    );
    if (!group) {
      group = { hues: [], rows: [] };
      hueGroups.push(group);
    }
    group.hues.push(hue);
    group.rows.push(index + 1);
  });
  const grouped = hues.filter((hue) => hue !== undefined).length >= 9 && hueGroups.length >= 2;
  const groups = grouped
    ? hueGroups.map((group, n) => ({ label: `Grupo observado ${n + 1}`, rows: group.rows }))
    : undefined;
  const numericRows: CaptureNumericRow[] = occupied.map((cell, index) => ({
    row: index + 1,
    right: cell.right,
    addition: { text: "", value: null, confidence: 0, uncertain: true, location: cell.right.location },
  }));
  return {
    rows: occupied.map((cell) => cell.name),
    numericRows,
    numericStageSuggestion: "unverified" as const,
    interpretation: {
      version: 1 as const,
      screen: grouped ? ("twoColumnsByTeam" as const) : ("twoColumns" as const),
      origin: "visual" as const,
      positions: [],
      movementRows: [],
      ...(groups ? { groups } : {}),
      ...(nextTrack?.text ? { nextTrack: { ...nextTrack, uncertain: nextTrack.confidence < 80 } } : {}),
      reasons: [
        "Players in two columns before the race",
        "The track label refers to the next race",
        "The name layout doesn't establish the finish order or the Lounge format",
      ],
    },
  };
}
