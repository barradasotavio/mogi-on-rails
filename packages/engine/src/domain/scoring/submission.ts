import { teamSizes } from "../mogi/mogi-rules.ts";
import { rosterSlots } from "../participation/participation.ts";
import type { Mogi } from "../types.ts";
import { individualStandings, type ResultBlockers, resultCoverage } from "./scoring.ts";

export type LoungeSubmission = { available: true; text: string } | { available: false; blockers: ResultBlockers };

/** The LT's normal-queue format (MIT; see THIRD_PARTY_NOTICES.md). */
export function loungeSubmission(mogi: Mogi): LoungeSubmission {
  const coverage = resultCoverage(mogi);
  const tier = mogi.submissionTier?.trim();
  if (!coverage.final || !tier)
    return { available: false, blockers: { ...coverage.blockers, ...(!tier ? { missingTier: true as const } : {}) } };
  const scores = individualStandings(mogi);
  const size = teamSizes[mogi.format];
  return {
    available: true,
    text:
      `!submit ${size} ${tier}\n` +
      rosterSlots(mogi)
        .map((slot, index) => {
          const score = scores.find((row) => row.id === slot.id)!;
          return `${score.loungeName} ${score.points}${size > 1 && (index + 1) % size === 0 ? "\n" : ""}`;
        })
        .join("\n")
        .trim(),
  };
}
