import { normalizeReconstructions } from "@mkw/engine";

import type { TrackerStore } from "./session";
import { ConcurrentTrackerWriteError, UnsupportedTrackerVersionError } from "./storage-errors";
import { emptyState, type TrackerState } from "./types";

export { ConcurrentTrackerWriteError, UnsupportedTrackerVersionError };
// Local revision is transport metadata, excluded from the public/backup snapshot.
let loadedRevision: unknown;
function assertSupported(state: TrackerState) {
  if (state.version !== 1) throw new UnsupportedTrackerVersionError();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("Storage isn't available in this browser."));
      return;
    }
    // Database version 4 blocks incompatible writers; the tracker snapshot stays version 1.
    const request = indexedDB.open("mkw-on-rails", 4);
    let abandoned = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("tracker")) request.result.createObjectStore("tracker");
    };
    request.onsuccess = () => {
      if (abandoned) request.result.close();
      else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
    request.onerror = () =>
      reject(request.error?.name === "VersionError" ? new UnsupportedTrackerVersionError() : request.error);
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("Close other app tabs and try again."));
    };
  });
}

/** Own the original bytes before a loaded native Blob is reused by another write. */
async function materializeOriginals(state: TrackerState): Promise<TrackerState> {
  const originals = new Map<Blob, Blob>();
  async function materialize(original: Blob) {
    const existing = originals.get(original);
    if (existing) return existing;
    const copy = new Blob([await original.arrayBuffer()], { type: original.type });
    originals.set(original, copy);
    return copy;
  }
  const mogis: TrackerState["mogis"] = [];
  for (const mogi of state.mogis) {
    if (!mogi.captures?.length) {
      mogis.push(mogi);
      continue;
    }
    const captures = [];
    for (const capture of mogi.captures ?? [])
      captures.push({
        ...capture,
        original: capture.original instanceof Blob ? await materialize(capture.original) : capture.original,
      });
    mogis.push({ ...mogi, captures });
  }
  const sharedReceipts: NonNullable<TrackerState["sharedReceipts"]> = [];
  for (const receipt of state.sharedReceipts ?? []) {
    const files = [];
    for (const file of receipt.files) files.push({ ...file, original: await materialize(file.original) });
    sharedReceipts.push({ ...receipt, files });
  }
  return { ...state, mogis, ...(state.sharedReceipts ? { sharedReceipts } : {}) };
}

export async function loadTracker(): Promise<TrackerState> {
  const db = await openDatabase();
  try {
    return await new Promise<TrackerState>((resolve, reject) => {
      const transaction = db.transaction("tracker", "readonly");
      const request = transaction.objectStore("tracker").get("state");
      const revision = transaction.objectStore("tracker").get("revision");
      const active = transaction.objectStore("tracker").get("activeMogiId");
      transaction.oncomplete = () => {
        const saved: TrackerState = request.result ?? emptyState;
        const state = active.result === undefined ? saved : { ...saved, activeMogiId: active.result as string | null };
        const snapshotRevision = revision.result;
        try {
          assertSupported(state);
        } catch (error) {
          reject(error);
          return;
        }
        void materializeOriginals(state)
          .then((loaded) => normalizeReconstructions(loaded, { revalidateBoundaryProofs: true }))
          .then((loaded) => {
            loadedRevision = snapshotRevision;
            resolve(loaded);
          }, reject);
      };
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function assertTrackerCurrent(): Promise<void> {
  const expected = loadedRevision;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("tracker", "readonly");
      const request = transaction.objectStore("tracker").get("revision");
      transaction.oncomplete = () =>
        request.result === expected ? resolve() : reject(new ConcurrentTrackerWriteError());
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function saveTracker(state: TrackerState): Promise<void> {
  return writeTracker(state, false);
}

/** Opening another mogi only remembers it: the snapshot, with every image and proof, isn't cloned again. */
export async function saveActiveMogi(state: TrackerState): Promise<void> {
  return writeTracker(state, false, false);
}

/** Explicitly confirmed recovery can replace a snapshot that could not be read. */
export async function replaceUnreadableTracker(state: TrackerState): Promise<void> {
  return writeTracker(state, true);
}

/** The IndexedDB adapter of the tracker session's store. */
export const trackerStore: TrackerStore = {
  load: loadTracker,
  save: (state, mode) =>
    mode === "activeMogi"
      ? saveActiveMogi(state)
      : mode === "replaceUnreadable"
        ? replaceUnreadableTracker(state)
        : saveTracker(state),
};

async function writeTracker(state: TrackerState, replaceUnreadable: boolean, snapshot = true): Promise<void> {
  assertSupported(state);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const expected = loadedRevision,
        nextRevision = crypto.randomUUID();
      const transaction = db.transaction("tracker", "readwrite");
      const store = transaction.objectStore("tracker");
      const current = store.get("revision");
      let conflict: Error | undefined;
      current.onsuccess = () => {
        if (!replaceUnreadable && current.result !== expected) {
          conflict = new ConcurrentTrackerWriteError();
          transaction.abort();
          return;
        }
        try {
          if (snapshot) store.put(state, "state");
          // Read over the snapshot's own field, so remembering the open mogi stays a small write.
          store.put(state.activeMogiId, "activeMogiId");
          store.put(nextRevision, "revision");
        } catch (cause) {
          conflict = cause instanceof Error ? cause : new DOMException("Couldn't save.", "UnknownError");
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        loadedRevision = nextRevision;
        resolve();
      };
      transaction.onabort = () =>
        reject(conflict ?? transaction.error ?? new DOMException("Couldn't save.", "UnknownError"));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
