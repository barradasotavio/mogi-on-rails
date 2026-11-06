import type { Capture } from "../types.ts";

/** Keep source fields and tuple order identical for signed facts and coverage. */
export function sourcePairSignature(from: Capture, to: Capture): string {
  const source = (capture: Capture) => [
    capture.id,
    capture.fingerprint,
    capture.rows,
    capture.interpretation,
    capture.nameAssociations,
    capture.numericAnswers,
    capture.groupTotalAnswers,
    capture.numericRows,
  ];
  return JSON.stringify([source(from), source(to)]);
}
