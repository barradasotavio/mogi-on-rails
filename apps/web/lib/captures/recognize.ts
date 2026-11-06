/// <reference types="vite/client" />
import { matchRows, type RawRecognition, recognizeImage } from "@mkw/engine/browser";

import type { CaptureRow, Participant } from "@/lib/mogi/types";

import { fingerprint } from "../images/fingerprint.ts";
export interface Recognition extends Omit<RawRecognition, "rows"> {
  rows: CaptureRow[];
  possibleAbsentParticipantIds: string[];
}
/** The product adds its known roster without changing the raw observations. */
export function recognizeCapture(file: Blob, participants: Participant[], progress: (message: string) => void) {
  let session = undefined as ReturnType<typeof recognizeImage> | undefined;
  // Development only, and only when a test set it: saved readings of real fixtures, by SHA-256, instead of OCR.
  // The production build drops this branch.
  if (import.meta.env.DEV) {
    const fixed = (globalThis as { mkwFixedRecognitions?: Record<string, RawRecognition> }).mkwFixedRecognitions;
    if (fixed)
      session = {
        cancel: () => {},
        result: (async () => {
          const hash = await fingerprint(file);
          if (!fixed[hash]) throw new Error(`No fixed recognition for this screenshot (${hash}).`);
          return structuredClone(fixed[hash]);
        })(),
      };
  }
  session ??= recognizeImage(file, progress);
  return {
    cancel: session.cancel,
    result: session.result.then((reading): Recognition => {
      const rows = matchRows(reading.rows, participants);
      return {
        ...reading,
        rows,
        possibleAbsentParticipantIds: ["twoColumns", "twoColumnsByTeam", "teamStandings", "finalStandings"].includes(
          reading.interpretation.screen,
        )
          ? []
          : reading.unreadableRowNumbers.map((number) => rows[number - 1].suggestedParticipantId),
      };
    }),
  };
}
