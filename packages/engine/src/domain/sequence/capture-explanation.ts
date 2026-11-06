import { mogiQuestions } from "../questions/mogi-questions.ts";
import type { Mogi, PhotoMoment } from "../types.ts";
import type { RoomAnalysis } from "./room/room-sequence.ts";
import { reconcileSequence, sequenceInputSignature } from "./sequence.ts";

export type RuleCode =
  | "race.vector-continuity"
  | "race.reopen-first"
  | "race.reopen-later"
  | "race.answered"
  | "race.finish-order"
  | "order.photo-time"
  | "order.answered"
  | "duplicate.same-vector"
  | "points.as-shown"
  | "points.race1-permutation"
  | "points.sum"
  | "points.out-of-range"
  | "points.noise-candidate"
  | "points.restart"
  | "name.as-shown"
  | "name.similar"
  | "name.tag"
  | "name.exclusion"
  | "name.continuity"
  | "name.token"
  | "name.spelling-group"
  | "name.answered"
  | "pending.question";
export interface CaptureExplanationStep {
  kind: "race" | "order" | "duplicate" | "points" | "name" | "pending";
  subject: string;
  value: number | string | null;
  origin: "read" | "deduced" | "answered";
  rule: RuleCode;
  evidence: {
    anchorCaptureId?: string;
    anchorNumber?: number;
    completedSteps?: number;
    localRace?: number;
    sessionStart?: number;
    compared?: number;
    decreased?: number;
    reopeningBasis?: "totals" | "answered";
    photoTime?: number;
    photoTimeSource?: PhotoMoment["source"];
    previousTime?: number;
    row?: number;
    playerId?: string;
    readText?: string;
    discarded?: number;
    readName?: string;
    token?: string;
    tag?: string;
    variants?: string[];
    group?: string[];
    questionId?: string;
  };
}

// Explanation is transient: the existing source facts remain the complete backup format.
const decisions = new WeakMap<RoomAnalysis, CaptureExplanationStep[]>();
export function roomExplanationSteps(analysis: RoomAnalysis): CaptureExplanationStep[] {
  return decisions.get(analysis) ?? [];
}
export function recordRoomExplanation(analysis: RoomAnalysis, steps: CaptureExplanationStep[]): void {
  decisions.set(analysis, steps);
}

/** Decisions from the result projection, rehydrated through reconciliation after loading. */
export function captureExplanation(mogi: Mogi, captureId: string): CaptureExplanationStep[] {
  let analysis = mogi.sequence?.roomAnalysis;
  if (!analysis || !decisions.has(analysis) || mogi.sequence?.inputSignature !== sequenceInputSignature(mogi)) {
    mogi = reconcileSequence(mogi);
    analysis = mogi.sequence?.roomAnalysis;
  }
  mogiQuestions(mogi);
  return analysis ? roomExplanationSteps(analysis).filter((step) => step.subject === captureId) : [];
}
