import type { CaptureObservation, ObservedNameRow } from "../domain/capture/observations.ts";
import { captureRowBounds } from "../domain/capture/row-bounds.ts";
import { recognitionConfiguration } from "./configuration.ts";
import { recognizeFinishOrder } from "./finish-order.ts";
import { recognizeFinal } from "./general.ts";
import { readNameRegion } from "./names.ts";
import { recognizeNumbers } from "./numbers.ts";
/* Grid, normalization, weighted Levenshtein and global assignment adapted from
 * PFQNiet/mkw-lounge-tracker (Niet.dev), MIT. See THIRD_PARTY_NOTICES.md. */
import { recognizePreRace } from "./pre-race.ts";
import { recognizeTeams } from "./teams.ts";
import type { OCRReader } from "./worker.ts";
import { createLocalOCRReader } from "./worker.ts";

/** The observation payload before the caller assigns its stable source id. */
export interface RawRecognition extends Omit<CaptureObservation, "id"> {
  numericStageSuggestion: "points-only" | "animation" | "unverified";
  unreadableRowNumbers: number[];
}
/** A cancellable local worker session; no images leave the device. */
export function recognizeImage(file: Blob, progress: (message: string) => void) {
  let worker: OCRReader | undefined;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    worker?.close();
  };
  const result = (async (): Promise<RawRecognition> => {
    if (file.size > 25 * 1024 * 1024)
      throw new Error("This file is over 25 MB. Choose the original Switch screenshot.");
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error("Couldn't open this file. Choose a PNG or JPEG screenshot.");
    }
    const { width, height } = bitmap;
    if (Math.abs(width / height - 16 / 9) > 0.04 || width < 640 || width * height > 17000000) {
      bitmap.close();
      throw new Error("Choose the full 16:9 screenshot (at least 640 × 360), without cropping the results screen.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = recognitionConfiguration.normalization.width;
    canvas.height = recognitionConfiguration.normalization.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      bitmap.close();
      throw new Error("This browser couldn't prepare the screenshot.");
    }
    context.drawImage(bitmap, 0, 0, 1920, 1080);
    bitmap.close();
    progress("Preparing recognition on this device…");
    const created = await createLocalOCRReader();
    worker = created;
    if (cancelled) {
      created.close();
      throw new DOMException("Cancelled", "AbortError");
    }
    try {
      const final =
        (await recognizePreRace(canvas, created, progress, () => cancelled)) ??
        (await recognizeTeams(canvas, created, progress, () => cancelled)) ??
        (await recognizeFinal(canvas, created, progress, () => cancelled));
      if (final) {
        return {
          ...final,
          rows: final.rows.map((row, i) => ({ ...row, bounds: captureRowBounds(final, i + 1) })),
          numericStageSuggestion: "unverified",
          width,
          height,
          unreadableRowNumbers: final.rows.flatMap((row, n) => (row.text.trim() ? [] : [n + 1])),
        };
      }
      const rows: ObservedNameRow[] = [];
      for (let row = 0; row < 12; row++) {
        if (cancelled) throw new DOMException("Cancelled", "AbortError");
        progress(`Reading name ${row + 1} of 12…`);
        rows.push(await readNameRegion(canvas, created, { x: 1270, y: 50 + row * 77, width: 385, height: 56 }));
      }
      const unreadableRowNumbers = rows.flatMap((row, n) => (row.text.trim() ? [] : [n + 1]));
      const numeric = await recognizeNumbers(canvas, created, progress, () => cancelled);
      const interpretation = await recognizeFinishOrder(canvas, created, numeric.numericRows, rows, () => cancelled);
      return {
        ...numeric,
        interpretation,
        rows: rows.map((row, i) => ({ ...row, bounds: captureRowBounds({ rows, interpretation }, i + 1) })),
        width,
        height,
        unreadableRowNumbers,
      };
    } finally {
      if (!cancelled) created.close();
      worker = undefined;
    }
  })();
  return { result, cancel };
}
