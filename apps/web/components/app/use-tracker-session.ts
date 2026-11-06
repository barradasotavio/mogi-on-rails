"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { restoredState } from "@/lib/mogi/edits";
import { type ActionRecovery, type ReviewContext, staleActionRecovery } from "@/lib/mogi/recovery";
import { trackerRenderState } from "@/lib/mogi/render-state";
import { createTrackerSession, type StorageFailure, type Transition, type WriteMode } from "@/lib/mogi/session";
import { ConcurrentTrackerWriteError, trackerStore, UnsupportedTrackerVersionError } from "@/lib/mogi/storage";
import { emptyState, type TrackerState } from "@/lib/mogi/types";
import { settled } from "@/lib/settled";
import { requestPersistentStorage } from "@/lib/storage/usage";

import type { ActionErrors } from "./use-action-error";

export interface FailedWrite {
  cause: StorageFailure;
  retry: () => void;
}
export interface PendingRecovery {
  recovery: ActionRecovery;
  context?: ReviewContext;
}

/**
 * The tracker's state on this device: loading, the write queue (`lib/mogi/session.ts`) and how each
 * failed write surfaces — a storage alert with Try Again, the concurrent-write alert, a stale-data
 * recovery, or the action's own error sentence.
 */
export function useTrackerSession({ actionOrigin, showActionError, clearActionError }: ActionErrors) {
  const [session] = useState(() => createTrackerSession(trackerStore));
  const [view, setView] = useState(() => trackerRenderState(emptyState));
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const writeCount = useRef(0);
  const [concurrentWrite, setConcurrentWrite] = useState(false);
  const [recovery, setRecovery] = useState<PendingRecovery | null>(null);
  const [failedWrite, setFailedWrite] = useState<FailedWrite | null>(null);
  // The removal that Undo can still reverse: only right after it, until the next write or navigation.
  const [undoOffer, setUndoOffer] = useState<string | null>(null);

  const reportError = useCallback(
    (cause: string | Error, context?: ReviewContext, origin?: string | null) => {
      const message = cause instanceof Error ? cause.message : cause;
      const recovery = staleActionRecovery(message);
      if (recovery) {
        setConcurrentWrite(false);
        setRecovery({ recovery, context });
      } else if (cause instanceof ConcurrentTrackerWriteError) setConcurrentWrite(true);
      else showActionError(message, origin);
    },
    [showActionError],
  );
  // Stable, so a write that only toggles busy does not render MogiOverview again.
  const showConcurrentWrite = useCallback(() => setConcurrentWrite(true), []);

  const persist = useCallback(
    async function persist(input: Transition, context?: ReviewContext, mode: WriteMode = "snapshot"): Promise<boolean> {
      writeCount.current++;
      // The control that started this write keeps its failure, even when it ends after other clicks.
      const origin = actionOrigin();
      setBusy(true);
      setConcurrentWrite(false);
      clearActionError();
      return settled(
        async () => {
          const outcome = await session.write((latest) => {
            setConcurrentWrite(false);
            return typeof input === "function" ? input(latest) : input;
          }, mode);
          if (outcome.status === "saved") {
            setUndoOffer(outcome.offeredUndo);
            setView((previous) => trackerRenderState(outcome.state, previous));
            setFailedWrite(null);
            return true;
          }
          // "Try Again" repeats this same write: the input runs again over the latest state.
          if (outcome.status === "storage-failure")
            setFailedWrite({ cause: outcome.failure, retry: () => void persist(input, context, mode) });
          else reportError(outcome.cause, context, origin);
          return false;
        },
        () => {
          writeCount.current--;
          if (!writeCount.current) setBusy(false);
        },
      );
    },
    [session, actionOrigin, clearActionError, reportError],
  );

  /** A background write (image compression): it never locks controls or reports a failure. */
  const writeQuietly = useCallback(
    async (transition: (latest: TrackerState) => Promise<TrackerState | null>) => {
      const next = await session.writeQuietly(transition);
      if (next) setView((previous) => (next === previous.state ? previous : trackerRenderState(next, previous)));
      return next !== null;
    },
    [session],
  );

  /** Replaces everything with a backup; it also recovers a snapshot this device couldn't read. */
  const restore = useCallback(
    async (next: TrackerState) => {
      const success = await persist(
        restoredState(next, session.current()),
        undefined,
        ready ? "snapshot" : "replaceUnreadable",
      );
      if (success) {
        setLoadError(null);
        setReady(true);
      }
      return success;
    },
    [session, persist, ready],
  );

  // Every open asks the browser to keep the mogis; only Settings › Storage shows the outcome.
  useEffect(() => {
    void requestPersistentStorage();
  }, []);
  useEffect(() => {
    let cancelled = false;
    session
      .load()
      .then((loaded) => {
        if (!cancelled) {
          setView((previous) => trackerRenderState(loaded, previous));
          setReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof UnsupportedTrackerVersionError
              ? error.message
              : "Your data is still on this device. Reload to try again, or restore a backup.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  return {
    state: view.state,
    resultMogis: view.resultMogis,
    /** The latest committed state, ahead of the render. */
    current: session.current,
    /** Resolves once every queued write has finished. */
    idle: session.idle,
    ready,
    loadError,
    busy,
    persist,
    writeQuietly,
    restore,
    reportError,
    failedWrite,
    dismissFailedWrite: useCallback(() => setFailedWrite(null), []),
    concurrentWrite,
    showConcurrentWrite,
    clearConcurrentWrite: useCallback(() => setConcurrentWrite(false), []),
    recovery,
    dismissRecovery: useCallback(() => setRecovery(null), []),
    undoOffer,
    withdrawUndoOffer: useCallback(() => setUndoOffer(null), []),
  };
}

export type TrackerSessionHandle = ReturnType<typeof useTrackerSession>;
