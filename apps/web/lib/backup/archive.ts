import { normalizeReconstructions } from "@mkw/engine";
import { strToU8, unzipSync, type Zippable, zipSync } from "fflate";

import { assertPendingImageDimensions, maxImageBytes, pendingImageMime } from "@/lib/images/policy";
import type { TrackerState } from "@/lib/mogi/types";

import { MAX_BACKUP_ITEMS } from "./limits";
import { object, validateCompressedImage, validateTracker } from "./validation";

const MANIFEST = "manifest.json";
const BACKUP_VERSION = 3;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 2 * MAX_ARCHIVE_BYTES;
// The manifest holds every capture's OCR readings, so a device with many mogis outgrows a few megabytes; the bound only
// keeps a hostile file from exhausting memory before validation.
const MAX_MANIFEST_BYTES = 256 * 1024 * 1024;

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function serializable(value: unknown, depth = 0): void {
  if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (depth > 50) throw new Error("The data structure is too deeply nested.");
  if (Array.isArray(value)) {
    for (const child of value) serializable(child, depth + 1);
    return;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsupported data property.");
      serializable(child, depth + 1);
    }
    return;
  }
  throw new Error("A data field isn't supported by the backup format. Export stopped.");
}
export async function createBackup(state: TrackerState): Promise<Blob> {
  validateTracker(state);
  const files: Zippable = {};
  let expanded = 0;
  const mogis = [];
  for (let m = 0; m < state.mogis.length; m++) {
    const mogi = state.mogis[m];
    const captures = [];
    for (let c = 0; c < (mogi.captures?.length ?? 0); c++) {
      const { original, ...capture } = mogi.captures![c];
      if (original === null) {
        captures.push({ ...capture, original: null });
        continue;
      }
      const path = `images/${m}/${c}.bin`;
      const bytes = new Uint8Array(await original.arrayBuffer());
      expanded += bytes.byteLength;
      if (expanded > MAX_EXPANDED_BYTES) throw new Error("The data exceeds the 2 GB backup limit.");
      const sha256 = await digest(bytes);
      if (capture.fingerprint !== undefined && capture.fingerprint !== (capture.compressedFrom?.sha256 ?? sha256))
        throw new Error("A screenshot fingerprint doesn't match its original file.");
      files[path] = [bytes, { level: 0 }];
      captures.push({
        ...capture,
        original: {
          path,
          mimeType: original.type,
          size: original.size,
          sha256,
        },
      });
    }
    mogis.push({
      ...mogi,
      ...(mogi.captures === undefined ? {} : { captures }),
    });
  }
  const sharedReceipts = [];
  for (let r = 0; r < (state.sharedReceipts?.length ?? 0); r++) {
    const receipt = state.sharedReceipts![r],
      receivedFiles = [];
    for (let f = 0; f < receipt.files.length; f++) {
      const { original, ...file } = receipt.files[f];
      const path = `pending/${r}/${f}.bin`,
        bytes = new Uint8Array(await original.arrayBuffer());
      expanded += bytes.byteLength;
      if (expanded > MAX_EXPANDED_BYTES) throw new Error("The data exceeds 2 GB.");
      files[path] = [bytes, { level: 0 }];
      if (
        state.sourceUndo?.fileId === file.id &&
        state.sourceUndo.capture?.fingerprint !== undefined &&
        state.sourceUndo.capture.fingerprint !==
          (state.sourceUndo.capture.compressedFrom?.sha256 ?? (await digest(bytes)))
      )
        throw new Error("The removed screenshot fingerprint doesn't match its original.");
      receivedFiles.push({
        ...file,
        original: {
          path,
          mimeType: original.type,
          size: original.size,
          sha256: await digest(bytes),
        },
      });
    }
    sharedReceipts.push({ ...receipt, files: receivedFiles });
  }
  const snapshot = {
    ...state,
    mogis,
    ...(state.sharedReceipts === undefined ? {} : { sharedReceipts }),
  };
  if (!snapshot.sharedReceipts?.length) delete snapshot.sharedReceipts;
  const manifest = {
    format: "mkw-on-rails",
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    state: snapshot,
  };
  serializable(manifest);
  const json = strToU8(JSON.stringify(manifest));
  if (json.byteLength > MAX_MANIFEST_BYTES) throw new Error("The manifest exceeds the 256 MB backup limit.");
  files[MANIFEST] = [json, { level: 6 }];
  const zipped = zipSync(files, { level: 0 });
  if (zipped.byteLength > MAX_ARCHIVE_BYTES)
    throw new Error("The ZIP exceeds 1 GB. Couldn't export it on this device.");
  return new Blob([new Uint8Array(zipped)], { type: "application/zip" });
}
export async function inspectBackup(file: Blob): Promise<{
  state: TrackerState;
}> {
  if (!file.size || file.size > MAX_ARCHIVE_BYTES) throw new Error("Choose a backup ZIP up to 1 GB.");
  let entries: ReturnType<typeof unzipSync>;
  try {
    let expanded = 0;
    const names = new Set<string>();
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        if (
          names.has(entry.name) ||
          !(entry.name === MANIFEST || /^(images|photos|pending)\/[0-9]+\/[0-9]+\.bin$/.test(entry.name))
        )
          throw new Error("Unexpected or duplicate file structure.");
        names.add(entry.name);
        expanded += entry.originalSize;
        if (
          names.size > MAX_BACKUP_ITEMS ||
          expanded > MAX_EXPANDED_BYTES ||
          (entry.name === MANIFEST && entry.originalSize > MAX_MANIFEST_BYTES)
        )
          throw new Error("The expanded content exceeds the backup limits.");
        return true;
      },
    });
  } catch (cause) {
    throw new Error(cause instanceof Error ? `Invalid ZIP: ${cause.message}` : "Invalid ZIP.");
  }
  if (!entries[MANIFEST]) throw new Error("The ZIP is missing manifest.json.");
  let manifest: Record<string, unknown>;
  try {
    manifest = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entries[MANIFEST])), "Manifest");
    serializable(manifest);
  } catch {
    throw new Error("The backup manifest is invalid.");
  }
  if (manifest.format !== "mkw-on-rails" || manifest.backupVersion !== BACKUP_VERSION)
    throw new Error("Unsupported backup format or version. Update the app before restoring.");
  if (typeof manifest.exportedAt !== "string" || !Number.isFinite(Date.parse(manifest.exportedAt)))
    throw new Error("Invalid export date.");
  const state = object(manifest.state, "Backup state");
  if (!Array.isArray(state.mogis)) throw new Error("The mogi list is missing.");
  const used = new Set([MANIFEST]);
  for (const value of state.mogis) {
    const mogi = object(value, "Mogi");
    if (mogi.captures === undefined) continue;
    if (!Array.isArray(mogi.captures)) throw new Error("Invalid screenshot list.");
    for (const value of mogi.captures) {
      const capture = object(value, "Screenshot");
      if (capture.original === null) continue;
      const image = object(capture.original, "Original screenshot");
      if (typeof image.path !== "string" || !/^images\/[0-9]+\/[0-9]+\.bin$/.test(image.path) || used.has(image.path))
        throw new Error("Invalid or duplicate screenshot reference.");
      const bytes = entries[image.path];
      const sha256 = bytes ? await digest(new Uint8Array(bytes)) : null;
      if (
        !bytes ||
        bytes.byteLength === 0 ||
        bytes.byteLength !== image.size ||
        typeof image.sha256 !== "string" ||
        sha256 !== image.sha256 ||
        (capture.fingerprint !== undefined &&
          capture.fingerprint !==
            (capture.compressedFrom === undefined
              ? sha256
              : object(capture.compressedFrom, "Compressed screenshot source").sha256))
      )
        throw new Error("Original screenshot is missing, incomplete or changed.");
      if (typeof image.mimeType !== "string" || image.mimeType.length > 200)
        throw new Error("Invalid screenshot type.");
      const original = new Blob([new Uint8Array(bytes)], {
        type: image.mimeType,
      });
      validateCompressedImage(capture, original);
      if (capture.compressedFrom !== undefined && (await pendingImageMime(original)) !== "image/webp")
        throw new Error("A compressed screenshot must be WebP.");
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(original);
      } catch {
        throw new Error("Couldn't decode an original screenshot.");
      }
      const dimensionsMatch = bitmap.width === capture.width && bitmap.height === capture.height;
      bitmap.close();
      if (!dimensionsMatch) throw new Error("Screenshot dimensions don't match the data.");
      capture.original = original;
      used.add(image.path);
    }
  }
  if (state.sharedReceipts !== undefined) {
    if (!Array.isArray(state.sharedReceipts)) throw new Error("Invalid pending batches.");
    for (const value of state.sharedReceipts) {
      const receipt = object(value, "Pending batch");
      if (!Array.isArray(receipt.files)) throw new Error("Invalid pending files.");
      for (const value of receipt.files) {
        const file = object(value, "Pending file"),
          image = object(file.original, "Pending original");
        if (
          typeof image.path !== "string" ||
          !/^pending\/[0-9]+\/[0-9]+\.bin$/.test(image.path) ||
          used.has(image.path)
        )
          throw new Error("Invalid pending screenshot reference.");
        const bytes = entries[image.path];
        if (
          !bytes ||
          !bytes.length ||
          bytes.length !== image.size ||
          bytes.length > maxImageBytes ||
          (await digest(new Uint8Array(bytes))) !== image.sha256 ||
          image.mimeType !== file.mimeType ||
          typeof image.mimeType !== "string"
        )
          throw new Error("Pending screenshot is missing, incomplete or changed.");
        const original = new Blob([new Uint8Array(bytes)], {
          type: image.mimeType,
        });
        if ((await pendingImageMime(original)) !== image.mimeType)
          throw new Error("Pending screenshot type doesn't match the file.");
        try {
          await assertPendingImageDimensions(original);
        } catch {
          throw new Error("Couldn't decode a pending screenshot, or its dimensions aren't supported.");
        }
        file.original = original;
        used.add(image.path);
      }
    }
  }
  if (Object.keys(entries).some((path) => !used.has(path)))
    throw new Error("The ZIP contains screenshots that don't belong to the declared data.");
  validateTracker(state);
  if (state.sourceUndo?.capture) {
    const source = state.sourceUndo.capture,
      file = state.sharedReceipts
        ?.flatMap((receipt) => receipt.files)
        .find((file) => file.id === state.sourceUndo?.fileId);
    if (file) {
      if (
        source.fingerprint !== undefined &&
        source.fingerprint !==
          (source.compressedFrom?.sha256 ?? (await digest(new Uint8Array(await file.original.arrayBuffer()))))
      )
        throw new Error("The removed screenshot fingerprint doesn't match its original.");
      const image = await createImageBitmap(file.original);
      const dimensions = image.width === source.width && image.height === source.height;
      image.close();
      if (!dimensions) throw new Error("Removed screenshot dimensions don't match the original.");
    }
  }
  return {
    state: await normalizeReconstructions(state, { revalidateBoundaryProofs: true }),
  };
}
