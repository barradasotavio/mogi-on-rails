import { normalizeReconstructions } from "@mkw/engine";

import { settleSourceUndo } from "./source-lifecycle.ts";
import { UnsupportedTrackerVersionError } from "./storage-errors.ts";
import { emptyState, type TrackerState } from "./types.ts";

/**
 * How a write reaches the store: the whole snapshot, only the remembered mogi (opening another mogi
 * doesn't clone every image again), or a confirmed restore over a snapshot that could not be read.
 */
export type WriteMode = "snapshot" | "activeMogi" | "replaceUnreadable";

/** Where the tracker state lives: IndexedDB in the app (`trackerStore` in `storage.ts`), memory in tests. */
export interface TrackerStore {
  load(): Promise<TrackerState>;
  save(state: TrackerState, mode: WriteMode): Promise<void>;
}

/** The next state, or how to compute it from the latest committed state when the write's turn comes. */
export type Transition = TrackerState | ((latest: TrackerState) => TrackerState | Promise<TrackerState>);

export type StorageFailure = "quota" | "updated" | "unknown";

export type WriteOutcome =
  /** Saved and committed. `offeredUndo` is the source removal Undo can now reverse, if this write made one. */
  | { status: "saved"; state: TrackerState; offeredUndo: string | null }
  /** The store refused the write; repeating the same transition may succeed. */
  | { status: "storage-failure"; failure: StorageFailure }
  /** The transition refused the change (a product error, such as stale data); nothing was written. */
  | { status: "refused"; cause: Error };

/** The storage cause of a failed write, by the DOMException name; product errors return null. */
export function storageFailure(cause: unknown): StorageFailure | null {
  // The database moved to a newer version (VersionError on open), or another tab closed this connection.
  if (cause instanceof UnsupportedTrackerVersionError) return "updated";
  if (typeof DOMException !== "undefined" && cause instanceof DOMException) {
    if (cause.name === "QuotaExceededError") return "quota";
    if (cause.name === "InvalidStateError" || cause.name === "VersionError") return "updated";
    return "unknown";
  }
  return cause instanceof Error ? null : "unknown";
}

/**
 * The tracker state and its one write queue. Every write runs in order over the latest committed state:
 * transition, reconcile reconstructions, settle the removal Undo, save, and only then commit. A failed write commits nothing.
 */
export function createTrackerSession(store: TrackerStore) {
  let current: TrackerState = emptyState;
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = queue.then(work);
    queue = operation;
    return operation;
  }
  return {
    /** The latest committed state. */
    current: () => current,
    /** Resolves once every write queued so far has finished. */
    idle: (): Promise<unknown> => queue,
    async load(): Promise<TrackerState> {
      // A snapshot saved before Undo was settled on every write may still hold one a backup refuses.
      current = settleSourceUndo(await store.load());
      return current;
    },
    write(transition: Transition, mode: WriteMode = "snapshot"): Promise<WriteOutcome> {
      return enqueue(async (): Promise<WriteOutcome> => {
        try {
          const requested = typeof transition === "function" ? await transition(current) : transition;
          const next = settleSourceUndo(await normalizeReconstructions(requested, { previousState: current }));
          await store.save(next, mode);
          const offeredUndo =
            next.sourceUndo && next.sourceUndo.id !== current.sourceUndo?.id ? next.sourceUndo.id : null;
          current = next;
          return { status: "saved", state: next, offeredUndo };
        } catch (cause) {
          const failure = storageFailure(cause);
          return failure ? { status: "storage-failure", failure } : { status: "refused", cause: cause as Error };
        }
      });
    },
    /**
     * A background write in the same queue: no reconciliation and no failure report. Returns the committed
     * state, the latest state when nothing changed, or null when it didn't save.
     */
    writeQuietly(transition: (latest: TrackerState) => Promise<TrackerState | null>): Promise<TrackerState | null> {
      return enqueue(async () => {
        try {
          const next = await transition(current);
          if (!next || next === current) return next;
          await store.save(next, "snapshot");
          current = next;
          return next;
        } catch {
          return null;
        }
      });
    },
  };
}

export type TrackerSession = ReturnType<typeof createTrackerSession>;
