import type { SharedReceipt, TrackerState } from "../mogi/types.ts";
import { type CompressedImage, originalFingerprint } from "./compressed.ts";
import { fingerprint } from "./fingerprint.ts";
import { type ImageReceiptTime, importedPhotoMoment, PHOTO_MOMENT_BYTES } from "./photo-moment.ts";
import { assertPendingImageDimensions, pendingImageMime } from "./policy.ts";
export function receivedImageTime(pastedAt?: number): ImageReceiptTime {
  return { receivedAt: pastedAt ?? Date.now(), pastedAt };
}
export type KnownOriginal = CompressedImage & { original: Blob; fingerprint?: string; otherMogi?: string };

/**
 * Every image a new one would repeat, seen from the mogi `mogiId`: captures of every mogi, and pending
 * images under review in one. `otherMogi` names the mogi when it isn't this one. An image held by Undo
 * was removed, so adding it again reads it afresh; Undo then finds the new capture and only releases.
 */
export function knownOriginals(state: TrackerState, mogiId: string): KnownOriginal[] {
  const owners = new Map(
    state.mogis.flatMap((entry) =>
      (entry.captureReview?.items ?? []).flatMap((item) =>
        item.source.fileId ? [[item.source.fileId, entry] as const] : [],
      ),
    ),
  );
  return [
    ...state.mogis.flatMap((entry) =>
      (entry.captures ?? []).flatMap((capture) =>
        capture.original
          ? [
              {
                original: capture.original,
                fingerprint: capture.fingerprint,
                compressedFrom: capture.compressedFrom,
                otherMogi: entry.id === mogiId ? undefined : entry.name,
              },
            ]
          : [],
      ),
    ),
    ...(state.sharedReceipts ?? []).flatMap((receipt) =>
      receipt.files.flatMap((file) => {
        const owner = owners.get(file.id);
        return owner ? [{ original: file.original, otherMogi: owner.id === mogiId ? undefined : owner.name }] : [];
      }),
    ),
  ];
}

/** Where each known image already is, by fingerprint: undefined for this mogi, else the other mogi's name. */
async function knownPlaces(knownOriginals: KnownOriginal[]) {
  const fingerprints = new Map<string, string | undefined>();
  for (const [hash, otherMogi] of await Promise.all(
    knownOriginals.map(async (known) => [(await originalFingerprint(known))!, known.otherMogi] as const),
  )) {
    // If the image is in both, its presence in the current mogi is the useful information.
    if (!fingerprints.has(hash) || otherMogi === undefined) fingerprints.set(hash, otherMogi);
  }
  return fingerprints;
}

/**
 * The same repetition `galleryReceipt` skips, checked before anything is stored: for each file, null
 * when it is already in this mogi, the other mogi's name, or undefined when it is new.
 */
export async function repeatedImages(
  files: Blob[],
  knownOriginals: KnownOriginal[],
): Promise<(string | null | undefined)[]> {
  const fingerprints = await knownPlaces(knownOriginals);
  return Promise.all(
    files.map(async (file) => {
      const hash = await fingerprint(file);
      return fingerprints.has(hash) ? (fingerprints.get(hash) ?? null) : undefined;
    }),
  );
}

export async function galleryReceipt(
  files: File[],
  knownOriginals: KnownOriginal[] = [],
  time: ImageReceiptTime = receivedImageTime(),
): Promise<{ receipt: SharedReceipt; ids: (string | undefined)[]; duplicates: (string | null)[] }> {
  if (files.length > 32 || files.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024)
    throw new Error("Choose up to 32 screenshots and 100 MB at a time.");
  const originals = [],
    ids: (string | undefined)[] = [],
    rejections: string[] = [],
    duplicates: (string | null)[] = [];
  const fingerprints = await knownPlaces(knownOriginals);
  for (const [index, file] of files.entries()) {
    try {
      const mimeType = await pendingImageMime(file);
      if (!mimeType) throw new Error("Choose a PNG, JPEG or WebP screenshot of up to 25 MB.");
      // Copy the bytes: a disk File is reread on every write and fails if moved or changed.
      const original = new Blob([await file.arrayBuffer()], { type: mimeType });
      await assertPendingImageDimensions(original);
      const hash = await fingerprint(original);
      if (fingerprints.has(hash)) {
        ids.push(undefined);
        const otherMogi = fingerprints.get(hash);
        duplicates.push(otherMogi ?? null);
        continue;
      }
      fingerprints.set(hash, undefined);
      const id = crypto.randomUUID();
      const pastedAt = time.pastedAt === undefined ? undefined : time.pastedAt + index;
      originals.push({
        id,
        name: file.name,
        mimeType,
        lastModified: file.lastModified,
        receivedAt: time.receivedAt,
        pastedAt,
        photoMoment: importedPhotoMoment(
          new Uint8Array(await original.slice(0, PHOTO_MOMENT_BYTES).arrayBuffer()),
          file.name,
          { ...time, pastedAt, lastModified: file.lastModified },
        ),
        original,
      });
      ids.push(id);
    } catch {
      ids.push(undefined);
      rejections.push(`${file.name} couldn't be opened and was left out. Check the file and choose it again.`);
    }
  }
  return {
    receipt: {
      id: crypto.randomUUID(),
      source: "gallery",
      receivedAt: new Date(time.receivedAt).toISOString(),
      files: originals,
      rejections,
    },
    ids,
    duplicates,
  };
}

/** The toast for repeated images: where they already are (null is this mogi), in one short line. */
export function duplicateImagesMessage(duplicates: (string | null)[]) {
  const places = new Set(duplicates);
  const where = (place: string | null) => place ?? "this mogi";
  if (duplicates.length === 1) return `Screenshot already in ${where(duplicates[0])}`;
  if (places.size === 1) return `${duplicates.length} screenshots already in ${where(duplicates[0])}`;
  return `${duplicates.length} screenshots were already added`;
}
