import type { TrackerState } from "@/lib/mogi/types";

import { createBackup } from "./archive";

// Keep recent recovery points without letting automatic ZIPs grow storage indefinitely.
export const AUTOMATIC_BACKUPS_KEPT = 3;

export interface AutomaticBackup {
  id: number;
  createdAt: string;
  build: string;
  mogiCount: number;
  size: number;
}
interface StoredBackup extends AutomaticBackup {
  zip: Blob;
}

// A separate database leaves the tracker's native version and writer protocol unchanged.
function openBackups(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("mkw-automatic-backups", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("automatic backups", { keyPath: "id", autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAutomaticBackup(state: TrackerState, build: string): Promise<void> {
  const zip = await createBackup(state);
  const db = await openBackups();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("automatic backups", "readwrite");
      const store = transaction.objectStore("automatic backups");
      store.add({ zip, createdAt: new Date().toISOString(), build, mogiCount: state.mogis.length, size: zip.size });
      // Increasing keys give stable order even for two writes in the same millisecond.
      const keys = store.getAllKeys();
      keys.onsuccess = () => keys.result.slice(0, -AUTOMATIC_BACKUPS_KEPT).forEach((id) => store.delete(id));
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function listAutomaticBackups(): Promise<AutomaticBackup[]> {
  const entries = await readBackups();
  return entries
    .reverse()
    .map(({ id, createdAt, build, mogiCount, size }) => ({ id, createdAt, build, mogiCount, size }));
}
async function readBackups(): Promise<StoredBackup[]> {
  const db = await openBackups();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("automatic backups", "readonly");
      const request = transaction.objectStore("automatic backups").getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
export async function readAutomaticBackup(id: number): Promise<Blob> {
  const entry = (await readBackups()).find((entry) => entry.id === id);
  if (!entry) throw new Error("This backup is no longer on this device.");
  return entry.zip;
}

export function backupDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(date));
}
export function backupSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`;
}
