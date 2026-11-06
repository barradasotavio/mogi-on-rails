"use client";

import { useEffect, useRef } from "react";

import { mergeCompressedImages } from "@/lib/mogi/compression";
import { compressionJob } from "@/lib/mogi/compression-job";
import type { TrackerState } from "@/lib/mogi/types";

import type { TrackerSessionHandle } from "./use-tracker-session";

/**
 * Compresses stored originals in the background, one image at a time, while `allowed` holds
 * (loaded, and no reading in progress). Each state change wakes the job.
 */
export function useBackgroundCompression(
  session: Pick<TrackerSessionHandle, "current" | "writeQuietly">,
  state: TrackerState,
  allowed: boolean,
) {
  const compressionAllowed = useRef(false);
  const job = useRef<ReturnType<typeof compressionJob> | null>(null);
  const { current, writeQuietly } = session;
  useEffect(() => {
    const created = compressionJob({
      state: current,
      canRun: () => compressionAllowed.current,
      write: (results) =>
        writeQuietly(async (latest) => (compressionAllowed.current ? mergeCompressedImages(latest, results) : null)),
    });
    job.current = created;
    return () => {
      compressionAllowed.current = false;
      created.dispose();
    };
  }, [current, writeQuietly]);
  useEffect(() => {
    compressionAllowed.current = allowed;
    if (compressionAllowed.current) job.current?.wake();
  }, [state, allowed]);
}
