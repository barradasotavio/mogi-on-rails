import type { Mogi } from "@/lib/mogi/types";

const units = ["KB", "MB", "GB"] as const;

/** Bytes for people: KB, MB or GB with one decimal ("442.9 KB", "1.2 GB"). */
export function formatBytes(bytes: number) {
  let value = Math.max(0, bytes) / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** A mogi's footprint: every image Blob it holds plus a rough size of its record. */
export function mogiStorageSize(mogi: Mogi) {
  let images = 0;
  const record = JSON.stringify(mogi, (_key, value: unknown) => {
    if (value instanceof Blob) {
      images += value.size;
      return undefined;
    }
    return value;
  });
  return images + new TextEncoder().encode(record).length;
}

/** Usage and quota from the browser, or null when the estimate isn't available. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator.storage?.estimate !== "function") return null;
    const { usage, quota } = await navigator.storage.estimate();
    return typeof usage === "number" && typeof quota === "number" && quota > 0 ? { usage, quota } : null;
  } catch {
    return null;
  }
}

/** Whether the browser keeps this site's data under storage pressure. */
export async function storagePersisted() {
  try {
    return typeof navigator.storage?.persisted === "function" && (await navigator.storage.persisted());
  } catch {
    return false;
  }
}

/** Asks once per open, silently; the outcome shows only in Settings › Storage. */
export async function requestPersistentStorage() {
  try {
    if (typeof navigator.storage?.persist !== "function" || (await storagePersisted())) return;
    await navigator.storage.persist();
  } catch {
    /* The request is best effort; nothing to report. */
  }
}
