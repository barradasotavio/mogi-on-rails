import { mogiOverview } from "@mkw/engine";

import { isCompressed } from "../images/compressed.ts";
import { fingerprint } from "../images/fingerprint.ts";
import type { TrackerState } from "./types.ts";

export interface PendingImage {
  mogiId: string;
  kind: "capture";
  id: string;
  original: Blob;
}
export interface CompressedResult extends PendingImage {
  encoded: Blob;
  sha256: string;
}
/** Pending receipts are deliberately outside this traversal. */
export function pendingImages(state: TrackerState): PendingImage[] {
  return state.mogis.flatMap((mogi) =>
    !mogiOverview(mogi).finished
      ? []
      : [
          ...(mogi.captures ?? []).flatMap((capture) =>
            capture.original && !isCompressed(capture)
              ? [{ mogiId: mogi.id, kind: "capture" as const, id: capture.id, original: capture.original }]
              : [],
          ),
        ],
  );
}

/** Apply only bytes, over the latest snapshot; edits, deletion and replacement always win. */
export async function mergeCompressedImages(state: TrackerState, results: CompressedResult[]): Promise<TrackerState> {
  let changed = false;
  const mogis = [];
  for (const mogi of state.mogis) {
    const batch = results.filter((result) => result.mogiId === mogi.id);
    if (!batch.length || !mogiOverview(mogi).finished) {
      mogis.push(mogi);
      continue;
    }
    async function merge<
      T extends { original: Blob | null; fingerprint?: string; compressedFrom?: { sha256: string; size: number } },
    >(image: T, kind: PendingImage["kind"], id: string): Promise<T> {
      const result = batch.find((result) => result.kind === kind && result.id === id);
      if (
        !result ||
        !image.original ||
        isCompressed(image) ||
        (image.original !== result.original && (await fingerprint(image.original)) !== result.sha256)
      )
        return image;
      changed = true;
      return {
        ...image,
        original: result.encoded,
        compressedFrom: { sha256: result.sha256, size: result.original.size },
        fingerprint: image.fingerprint ?? result.sha256,
      };
    }
    mogis.push({
      ...mogi,
      ...(mogi.captures
        ? { captures: await Promise.all(mogi.captures.map((capture) => merge(capture, "capture", capture.id))) }
        : {}),
    });
  }
  return changed ? { ...state, mogis } : state;
}
