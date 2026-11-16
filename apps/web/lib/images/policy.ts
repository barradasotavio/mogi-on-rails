import { FINISHED_IMAGE_QUALITY, webpSupported } from "./compressed.ts";

/** Accepted pending-image policy, shared by window, standalone worker and backup intake. */
export const maxImageBytes = 25 * 1024 * 1024;
export const maxImageDimension = 16384;
const unsupportedSize = "Screenshot size not supported.";
export async function pendingImageMime(blob: Blob): Promise<string> {
  if (!blob.size || blob.size > maxImageBytes) return "";
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
    ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "image/jpeg"
      : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
        ? "image/webp"
        : "";
}
export async function assertPendingImageDimensions(blob: Blob): Promise<void> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bitmap.width > maxImageDimension ||
      bitmap.height > maxImageDimension
    )
      throw new Error(unsupportedSize);
  } finally {
    bitmap.close();
  }
}

/**
 * A received screenshot as intake stores it. One that decodes is returned untouched. Only when decoding fails, the
 * image is redrawn: Chrome refuses a JPEG cut short (a Switch capture that ends in zero padding, with no end marker),
 * yet an `<img>` still paints what the file holds. The redrawn image is encoded as finished images are stored. A file
 * that still can't be drawn, or that decodes at an unsupported size, is refused as before.
 */
export async function receivedImage(blob: Blob): Promise<Blob> {
  try {
    await assertPendingImageDimensions(blob);
    return blob;
  } catch (error) {
    if (error instanceof Error && error.message === unsupportedSize) throw error;
    const redrawn = await redrawnImage(blob);
    if (!redrawn) throw error;
    await assertPendingImageDimensions(redrawn);
    return redrawn;
  }
}

/** Undefined outside a window, or when nothing of the image can be drawn (not even its first pixel). */
async function redrawnImage(blob: Blob): Promise<Blob | undefined> {
  if (typeof Image === "undefined" || typeof OffscreenCanvas === "undefined") return undefined;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (width <= 0 || height <= 0 || width > maxImageDimension || height > maxImageDimension) return undefined;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(image, 0, 0);
    if (context.getImageData(0, 0, 1, 1).data[3] === 0) return undefined;
    const type = (await webpSupported()) ? "image/webp" : "image/png";
    return await canvas.convertToBlob({ type, quality: FINISHED_IMAGE_QUALITY });
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}
