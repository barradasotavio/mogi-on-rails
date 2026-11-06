import { fingerprint } from "./fingerprint.ts";

export interface CompressedImage {
  compressedFrom?: { sha256: string; size: number };
}
export function isCompressed(image: CompressedImage): boolean {
  return image.compressedFrom !== undefined;
}
/** File identity stays with the original, even when the stored bytes change. */
export async function originalFingerprint(
  image: CompressedImage & { fingerprint?: string; original: Blob | null },
): Promise<string | undefined> {
  return (
    image.compressedFrom?.sha256 ?? image.fingerprint ?? (image.original ? fingerprint(image.original) : undefined)
  );
}

export const FINISHED_IMAGE_QUALITY = 0.75;
let support: Promise<boolean> | undefined;

/** Safari answers a WebP request with PNG; probe once with a tiny canvas before decoding any original. */
export function webpSupported(): Promise<boolean> {
  return (support ??= (async () => {
    try {
      // convertToBlob throws until the canvas has a rendering context.
      const canvas = new OffscreenCanvas(1, 1);
      canvas.getContext("2d");
      return (
        (await canvas.convertToBlob({ type: "image/webp", quality: FINISHED_IMAGE_QUALITY })).type === "image/webp"
      );
    } catch {
      return false;
    }
  })());
}

/** Decoding and encoding run off the main thread in the browser; null leaves the original in place. */
export async function compressImage(original: Blob): Promise<{ encoded: Blob; sha256: string } | null> {
  try {
    const bitmap = await createImageBitmap(original);
    const { width, height } = bitmap;
    let encoded: Blob;
    try {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      encoded = await canvas.convertToBlob({ type: "image/webp", quality: FINISHED_IMAGE_QUALITY });
    } finally {
      bitmap.close();
    }
    if (encoded.type !== "image/webp") return null;
    const check = await createImageBitmap(encoded);
    const sameDimensions = check.width === width && check.height === height;
    check.close();
    return sameDimensions ? { encoded, sha256: await fingerprint(original) } : null;
  } catch {
    return null;
  }
}
