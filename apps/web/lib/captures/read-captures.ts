import { participantsForRace } from "@mkw/engine";

import { isCompressed, originalFingerprint } from "../images/compressed.ts";
import { fingerprint as sha256 } from "../images/fingerprint.ts";
import type { Capture, Mogi } from "../mogi/types.ts";
import { fail, settled } from "../settled.ts";
import { identicalDuplicateNotice } from "./intake-review.ts";
import { recognizeCapture } from "./recognize.ts";

/** One image waiting to be read: a new file, or a review item that points at a stored capture. */
export interface CaptureReadItem {
  id: string;
  file: File;
  number: number;
  sourceCaptureId?: string;
  capture?: Capture;
  photoMoment?: Capture["photoMoment"];
  receivedAt?: number;
  pastedAt?: number;
}

/** What changed on an item. Progress-only updates (no status, or `processing`) are transient; the rest is the item's outcome. */
export type CaptureReadUpdate =
  | { status?: "processing"; progress: string }
  | { status: "cancelled" | "failed"; progress: ""; error?: string }
  | { status: "ready"; progress: ""; capture: Capture; duplicate?: string; association?: string };

export interface ReadCapturesOptions {
  /** Called once per change, in queue order. */
  report: (id: string, update: CaptureReadUpdate) => void;
  /**
   * The current stop signal, consulted between steps: aborting it stops the reading in flight and marks the rest of the
   * queue cancelled; handing out a fresh signal while the queue drains resumes it.
   */
  signal: () => AbortSignal;
  recognize?: typeof recognizeCapture;
  fingerprint?: (blob: Blob) => Promise<string>;
}

const LIMIT = 25 * 1024 * 1024;

/**
 * Drains `queue` in order, including items appended while it reads. Compressed images keep their stored reading;
 * an image whose SHA-256 matches a capture of the mogi, or one read earlier in this run, reuses that reading instead
 * of recognizing again, and is flagged as identical; equal name readings are flagged as similar.
 */
export async function readCaptures(
  queue: CaptureReadItem[],
  mogi: Mogi,
  { report, signal, recognize = recognizeCapture, fingerprint = sha256 }: ReadCapturesOptions,
) {
  const processed: Capture[] = [];
  const cancel = (id: string) => report(id, { status: "cancelled", progress: "" });
  while (queue.length) {
    const item = queue.shift()!;
    if (signal().aborted) {
      cancel(item.id);
      continue;
    }
    const source = mogi.captures?.find((capture) => capture.id === item.sourceCaptureId);
    if ((source && isCompressed(source)) || (item.capture && isCompressed(item.capture))) {
      report(item.id, { status: "ready", capture: (source ?? item.capture)!, progress: "" });
      continue;
    }
    report(item.id, { status: "processing", progress: "Opening screenshot…" });
    let stop: (() => void) | undefined;
    let stopping: AbortSignal | undefined;
    await settled(
      async () => {
        try {
          if (item.file.size > LIMIT) fail("This file is over 25 MB. Choose the original Switch screenshot.");
          const hash = await fingerprint(item.file);
          if (signal().aborted) return cancel(item.id);
          const known = [...(mogi.captures ?? []), ...processed];
          let exact: Capture | undefined;
          for (const capture of known)
            if ((await originalFingerprint(capture)) === hash) {
              exact = capture;
              break;
            }
          let capture: Capture;
          if (exact) {
            capture = {
              ...exact,
              compressedFrom: undefined,
              id: crypto.randomUUID(),
              fileName: item.file.name,
              original: item.file,
              fingerprint: hash,
              reviewedPlacements: [],
              reviewedAt: "",
            };
          } else {
            const task = recognize(item.file, participantsForRace(mogi, item.number), (message) =>
              report(item.id, { progress: message }),
            );
            stopping = signal();
            const stopped = new Promise<never>((_resolve, reject) => {
              stop = () => {
                task.cancel();
                reject(new DOMException("Cancelado", "AbortError"));
              };
              stopping!.addEventListener("abort", stop);
            });
            const recognized = await Promise.race([task.result, stopped]);
            if (signal().aborted) return cancel(item.id);
            capture = {
              id: crypto.randomUUID(),
              fileName: item.file.name,
              original: item.file,
              ...recognized,
              fingerprint: hash,
              reviewedPlacements: [],
              reviewedAt: "",
              stage: "finish-order-confirmed",
            };
          }
          capture = {
            ...capture,
            lastModified: item.file.lastModified,
            photoMoment: item.photoMoment,
            receivedAt: item.receivedAt,
            pastedAt: item.pastedAt,
          };
          const similar = known.find(
            (other) => other.rows.map((row) => row.text).join("|") === capture.rows.map((row) => row.text).join("|"),
          );
          processed.push(capture);
          report(item.id, {
            status: "ready",
            progress: "",
            capture,
            duplicate: exact
              ? identicalDuplicateNotice
              : similar
                ? "Similar results: check whether these screenshots are from the same race."
                : undefined,
            association: exact ? "" : "new",
          });
        } catch (cause) {
          report(item.id, {
            status: signal().aborted ? "cancelled" : "failed",
            progress: "",
            error: cause instanceof Error ? cause.message : "Recognition failed. Try another screenshot.",
          });
        }
      },
      () => {
        if (stop) stopping?.removeEventListener("abort", stop);
      },
    );
  }
}
