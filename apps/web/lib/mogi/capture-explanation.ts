import { captureExplanation, type CaptureExplanationStep, type RuleCode } from "@mkw/engine";

import { ordinal } from "../format.ts";
import type { Mogi } from "./types";

type DisplayStep = CaptureExplanationStep & {
  referenceImage?: number;
  subjectImage?: number;
  playerName?: string;
  format?: Mogi["format"];
};
/** `reason` is empty when the origin already says it, as for a reading or an answer. */
type Phrase = { decision: string; reason: string };
const reference = (step: DisplayStep) =>
  step.referenceImage === undefined ? "another screenshot" : `screenshot ${step.referenceImage}`;
const total = (step: DisplayStep) => `${step.playerName ?? `Row ${step.evidence.row}`} · ${step.value ?? "?"}`;
const named = (step: DisplayStep) => `${step.evidence.readName || `Row ${step.evidence.row}`} is ${step.playerName}`;

export const rulePhrases: Record<RuleCode, (step: DisplayStep) => Phrase> = {
  "race.vector-continuity": (step) => ({
    decision: `Race ${step.value}`,
    reason:
      step.evidence.completedSteps === 0
        ? step.evidence.anchorNumber
          ? `the totals still match race ${step.evidence.anchorNumber}`
          : "no race has finished yet"
        : step.evidence.anchorNumber
          ? step.evidence.completedSteps === 1
            ? `the totals grew by one finish since race ${step.evidence.anchorNumber}`
            : `the totals fit ${step.evidence.completedSteps} finishes since race ${step.evidence.anchorNumber}`
          : `the totals add up to ${step.evidence.completedSteps === 1 ? "one race" : `${step.evidence.completedSteps} races`}, with no earlier room`,
  }),
  "race.reopen-first": (step) => ({
    decision: `Race ${step.value} · first in a new room`,
    reason: step.evidence.reopeningBasis === "answered" ? "" : "most totals went down",
  }),
  "race.reopen-later": (step) => ({
    decision: `Race ${step.value}`,
    reason: `race ${step.evidence.localRace} in the reopened room`,
  }),
  "race.answered": (step) => ({
    decision: step.value === null ? "Race not assigned" : `Race ${step.value}`,
    reason: "",
  }),
  "race.finish-order": (step) => ({ decision: `Race ${step.value}`, reason: "its finish order matches that race" }),
  "order.photo-time": (step) => ({
    decision: `After ${reference(step)}`,
    reason: `${reference(step)} ${{ exif: "taken", "switch-name": "saved", pasted: "pasted", "file-date": "file dated" }[step.evidence.photoTimeSource ?? "file-date"]} before ${step.subjectImage === undefined ? "this screenshot" : `screenshot ${step.subjectImage}`}`,
  }),
  "order.answered": (step) => ({ decision: `After ${reference(step)}`, reason: "" }),
  "duplicate.same-vector": (step) => ({ decision: `Same totals as ${reference(step)}`, reason: "counted once" }),
  "points.as-shown": (step) => ({ decision: `${step.value} of ${step.evidence.compared} totals`, reason: "" }),
  "points.race1-permutation": (step) => ({
    decision: total(step),
    reason: `${ordinal(step.evidence.row!)} place in race 1`,
  }),
  "points.sum": (step) => ({ decision: total(step), reason: "the totals have to add up" }),
  "points.out-of-range": (step) => ({
    decision: total(step),
    reason: `read ${step.evidence.readText}, too high for this race`,
  }),
  "points.noise-candidate": (step) => ({
    decision: total(step),
    reason: `read ${step.evidence.readText}, the extra digit was noise`,
  }),
  "points.restart": (step) => ({ decision: total(step), reason: "they restarted from zero" }),
  "name.as-shown": (step) => ({ decision: `${step.value} of ${step.evidence.compared} names`, reason: "" }),
  "name.similar": (step) => ({ decision: named(step), reason: "the names are close" }),
  "name.tag": (step) => ({ decision: named(step), reason: "same tag as the team" }),
  "name.exclusion": (step) => ({
    decision: named(step),
    reason: step.format === "FFA" ? "the only player left" : "the only player left on the team",
  }),
  "name.continuity": (step) => ({ decision: named(step), reason: `their total continues from ${reference(step)}` }),
  "name.token": (step) => ({
    decision: named(step),
    reason: `"${step.evidence.token}" only matches ${step.playerName}`,
  }),
  "name.spelling-group": (step) => ({
    decision: named(step),
    reason: `same name read ${(step.evidence.variants?.length ?? 0) + 1} ways`,
  }),
  "name.answered": (step) => ({ decision: named(step), reason: "" }),
  "pending.question": (step) => ({
    decision: "Not counted yet",
    reason: `${step.value} ${step.value === 1 ? "question" : "questions"}`,
  }),
};

const origins: Record<CaptureExplanationStep["origin"], string> = {
  read: "Read",
  deduced: "Deduced",
  answered: "Your answer",
};

export function captureExplanationLines(mogi: Mogi, captureId: string) {
  return captureExplanation(mogi, captureId).map((step) => {
    const index = mogi.captures?.findIndex((c) => c.id === step.evidence.anchorCaptureId) ?? -1;
    const subject = mogi.captures?.findIndex((c) => c.id === captureId) ?? -1;
    return {
      ...rulePhrases[step.rule]({
        ...step,
        referenceImage: index < 0 ? undefined : index + 1,
        subjectImage: subject < 0 ? undefined : subject + 1,
        format: mogi.format,
        playerName: mogi.participants.find((p) => p.id === (step.kind === "name" ? step.value : step.evidence.playerId))
          ?.loungeName,
      }),
      kind: step.kind,
      rule: step.rule,
      origin: step.kind === "pending" ? undefined : origins[step.origin],
      row: step.evidence.row,
      participantId: step.kind === "name" ? String(step.value) : undefined,
      questionId: step.evidence.questionId,
    };
  });
}
