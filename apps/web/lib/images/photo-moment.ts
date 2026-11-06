import type { PhotoMoment } from "@mkw/engine";

function timestamp(value: string, offset?: string): number | undefined {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (
    year < 1 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return;
  if (offset !== undefined) {
    if (!/^[+-](?:[01]\d|2[0-3]):[0-5]\d$/.test(offset)) return;
    const minutes = Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4));
    return calendar.getTime() - (offset[0] === "+" ? minutes : -minutes) * 60000;
  }
  const local = new Date(0);
  local.setFullYear(year, month - 1, day);
  local.setHours(hour, minute, second, 0);
  return local.getTime();
}

function exifTime(bytes: Uint8Array): number | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let p = 2; p + 4 <= bytes.length;) {
    if (bytes[p++] !== 0xff) return;
    while (bytes[p] === 0xff) p++;
    const marker = bytes[p++];
    if (marker === 0xda || marker === 0xd9) return;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (p + 2 > bytes.length) return;
    const length = view.getUint16(p);
    if (length < 2 || p + length > bytes.length) return;
    const start = p + 8,
      end = p + length;
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(p + 2, start)) === "Exif\0\0") {
      const tiff = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
      const little = tiff.getUint16(0) === 0x4949;
      if ((!little && tiff.getUint16(0) !== 0x4d4d) || tiff.getUint16(2, little) !== 42) return;
      const directory = (offset: number) => {
        const count = tiff.getUint16(offset, little);
        if (offset + 2 + count * 12 > tiff.byteLength) throw new RangeError("Truncated EXIF");
        return Array.from({ length: count }, (_, i) => offset + 2 + i * 12);
      };
      const ascii = (entries: number[], tag: number) => {
        const entry = entries.find((entry) => tiff.getUint16(entry, little) === tag);
        if (entry === undefined || tiff.getUint16(entry + 2, little) !== 2) return;
        const count = tiff.getUint32(entry + 4, little);
        const offset = count <= 4 ? entry + 8 : tiff.getUint32(entry + 8, little);
        if (!count || count > 64 || offset + count > tiff.byteLength) return;
        return String.fromCharCode(...bytes.subarray(start + offset, start + offset + count)).replace(/\0+$/, "");
      };
      const main = directory(tiff.getUint32(4, little));
      const pointer = main.find((entry) => tiff.getUint16(entry, little) === 0x8769);
      const exif =
        pointer !== undefined && tiff.getUint16(pointer + 2, little) === 4 && tiff.getUint32(pointer + 4, little) === 1
          ? directory(tiff.getUint32(pointer + 8, little))
          : [];
      const original = ascii(exif, 0x9003);
      if (original) return timestamp(original, ascii(exif, 0x9011));
      // The Switch stamps its own captures only with the main directory's DateTime, its capture moment.
      const saved = ascii(main, 0x0132);
      if (saved) return timestamp(saved, ascii(exif, 0x9010));
      return;
    }
    p = end;
  }
}

/** EXIF lives in an APP1 segment of at most 64 KB near the start, so readers never need the whole image. */
export const PHOTO_MOMENT_BYTES = 131072;

/** Reads original JPEG bytes offline. Missing or malformed metadata is not a date. */
export function readPhotoMoment(bytes: Uint8Array, name: string): PhotoMoment | undefined {
  try {
    const at = exifTime(bytes);
    if (at !== undefined) return { at, source: "exif" };
  } catch {
    // A malformed APP1 must not prevent importing an otherwise decodable image.
  }
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d{2}-[\da-f]{32}\.(?:jpe?g|png)$/i.exec(name);
  if (match) {
    const at = timestamp(`${match[1]}:${match[2]}:${match[3]} ${match[4]}:${match[5]}:${match[6]}`);
    if (at !== undefined) return { at, source: "switch-name" };
  }
}

export interface ImageReceiptTime {
  receivedAt: number;
  pastedAt?: number;
}
export function importedPhotoMoment(
  bytes: Uint8Array,
  name: string,
  time: ImageReceiptTime & { lastModified?: number },
): PhotoMoment | undefined {
  const metadata = readPhotoMoment(bytes, name);
  if (metadata) return metadata;
  if (time.pastedAt !== undefined) return { at: time.pastedAt, source: "pasted" };
  if (
    time.lastModified !== undefined &&
    time.lastModified > 0 &&
    Number.isFinite(time.lastModified) &&
    time.receivedAt - time.lastModified > 60000
  )
    return { at: time.lastModified, source: "file-date" };
}
