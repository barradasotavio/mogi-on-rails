/** Accepted pending-image policy, shared by window, standalone worker and backup intake. */
export const maxImageBytes = 25 * 1024 * 1024;
export const maxImageDimension = 16384;
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
      throw new Error("Screenshot size not supported.");
  } finally {
    bitmap.close();
  }
}
