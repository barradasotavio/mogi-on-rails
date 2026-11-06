import type { GameValue, GroupTotalAnswer, NameAssociation, NumericAnswer } from "../types.ts";
import type { CaptureInterpretation, CaptureNumericRow, ObservedNameRow } from "./observations.ts";
import { screenProperties } from "./screens.ts";
import { consistentTeamRows } from "./team-evidence.ts";

interface CaptureEvidenceContext {
  captureId: string;
  /** Facts accepted by the application, never inferred from name similarity. */
  accepted: boolean;
  nameAssociations?: NameAssociation[];
  numericAnswers?: NumericAnswer[];
  groupTotalAnswers?: GroupTotalAnswer[];
}
interface CaptureEvidenceSource {
  id: string;
  rows: ObservedNameRow[];
  interpretation?: CaptureInterpretation;
  numericRows?: CaptureNumericRow[];
}
interface CaptureEvidence {
  boundaries: { captureId: string; values: { participantId: string; value: GameValue }[] }[];
}

/** Only accepted identities and settled readings supply cumulative boundaries. */
export function prepareCaptureEvidence(
  observations: readonly CaptureEvidenceSource[],
  contexts: readonly CaptureEvidenceContext[],
): CaptureEvidence {
  const boundaries: CaptureEvidence["boundaries"] = [];
  for (const capture of observations) {
    const context = contexts.find((entry) => entry.captureId === capture.id);
    if (!context?.accepted || screenProperties(capture.interpretation?.screen)?.cumulative !== "final") continue;
    const allowed = screenProperties(capture.interpretation?.screen)?.teamTotals
      ? consistentTeamRows({
          ...capture,
          numericAnswers: context.numericAnswers,
          groupTotalAnswers: context.groupTotalAnswers,
        })
      : undefined;
    const boundary: CaptureEvidence["boundaries"][number] = { captureId: capture.id, values: [] };
    context.nameAssociations?.forEach((association, index) => {
      const row = index + 1;
      const participantId = association.participantId;
      if (!participantId || (allowed && !allowed.includes(row))) return;
      const reading = capture.numericRows?.find((value) => value.row === row)?.right;
      const answer = context.numericAnswers?.find((value) => value.row === row);
      const value = answer?.value ?? (reading && !reading.uncertain ? reading.value : null);
      if (value === null || value === undefined) return;
      boundary.values.push({
        participantId,
        value: {
          value,
          origin: answer ? "manual" : "observed",
          sourceCaptureId: capture.id,
          sourceRow: row,
          sourceField: "right",
        },
      });
    });
    if (boundary.values.length) boundaries.push(boundary);
  }
  return { boundaries };
}
