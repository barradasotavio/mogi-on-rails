import type { CaptureInterpretation, CaptureNumericRow, NumericReading } from "./capture/observations.ts";
import type { Track } from "./tracks/tracks.ts";

export interface Participant {
  id: string;
  loungeName: string;
  ign: string;
  /** Absent for legacy data whose IGN origin is unknown. */
  ignOrigin?: "fallback" | "explicit" | "learned";
  teamId?: string;
  /** Original participation slot; absent for the initial twelve people. */
  slotId?: string;
}

export interface Race {
  id: string;
  /** Track abbreviation the user chose; when absent, the pre-race reading applies. */
  track?: Track["short"];
  origin: "manual" | "observed" | "reconstructed";
  assistedGroupId?: string;
  reconstruction?: Reconstruction;
  reconstructionHistory?: Reconstruction[];
  /** Inactive accepted results withdrawn with their sole observed source. */
  sourceRemovalHistory?: {
    removedAt: string;
    captureId: string;
    result: Omit<
      Race,
      "sourceRemovalHistory" | "participationHistory" | "reconstructionHistory" | "gameEvidenceHistory"
    >;
  }[];
  captureIds?: string[];
  number?: number;
  /** Stable physical coordinate, independent of the valid Lounge number. */
  physicalNumber?: number;
  status?: "confirmed" | "pending" | "discarded";
  placements: string[];
  participationReview?: string;
  participationHistory?: {
    changedAt: string;
    reason: string;
    result: Omit<Race, "participationHistory">;
  }[];
  /** Unordered participants not represented by themselves or a CPU. */
  absentParticipantIds?: string[];
  gameEvidence?: GameEvidence;
  gameEvidenceHistory?: { changedAt: string; evidence: GameEvidence }[];
  nativePoints?: Record<string, number>;
  /** "manual" is legacy and read-only: current races are re-modeled on load (`withModeledNativePoints`). */
  nativePointOrigins?: Record<string, "modeled" | "manual">;
}

/** Source row identity is its ordinal in the immutable Capture.rows array. */
export interface NameAssociation {
  participantId: string | null;
  /** Automatic association, reviewable from the player list. */
  origin?: "deduced";
  /** The user unlinked this spelling; inference waits for a new answer. */
  unlinked?: boolean;
  /** Accepted spelling, distinct from the immutable OCR text. */
  ign?: string;
}

/** A human value does not replace the immutable OCR reading. */
export interface NumericAnswer {
  row: number;
  field: "right";
  value: number;
}
export interface GroupTotalAnswer {
  group: number;
  value: number;
}
export type MogiFormat = "FFA" | "2v2" | "3v3";

export interface Team {
  id: string;
  name: string;
  /** Tag the user chose; empty means "no tag". When absent, the one deduced from the in-game names applies. */
  tag?: string;
}

export interface Substitution {
  id: string;
  slotId: string;
  outgoingParticipantId: string;
  incomingParticipantId: string;
  fromRace: number;
  fromRaceId?: string;
  fromPhysicalNumber?: number;
  previousFromRaces?: number[];
}

export interface Mogi {
  id: string;
  name: string;
  format: MogiFormat;
  teams?: Team[];
  submissionTier?: string;
  originalList?: string;
  participants: Participant[];
  races: Race[];
  createdAt: string;
  captures?: Capture[];
  substitutions?: Substitution[];
  creditedParticipantIds?: Record<string, string>;
  assistance?: Assistance;
  orderReview?: OrderReview;
  sequence?: CaptureSequence;
  coverage?: ProvenCoverage;
  deletedCaptureIds?: string[];
}

export interface CaptureRow {
  bounds?: NumericReading["location"];
  location?: NumericReading["location"];
  alternatives?: { text: string; confidence: number }[];
  text: string;
  confidence: number;
  suggestedParticipantId: string;
  uncertain: boolean;
}
export interface PhotoMoment {
  at: number;
  source: "exif" | "switch-name" | "pasted" | "file-date";
}
export interface Capture {
  photoMoment?: PhotoMoment;
  /** Raw file date retained for import fallback; sequence rules use photoMoment. */
  lastModified?: number;
  id: string;
  fingerprint?: string;
  width: number;
  height: number;
  rows: CaptureRow[];
  context?: { phase: "before" | "after" | "event-final"; raceId?: string };
  nextTrackAnswer?: string;
  groupTotalAnswers?: GroupTotalAnswer[];
  nameAssociations?: NameAssociation[];
  reviewedPlacements: string[];
  reviewedAt: string;
  /** Legacy marker is not a detector result. */
  stage: "finish-order-confirmed" | "context";
  interpretation?: CaptureInterpretation;
  numericAnswers?: NumericAnswer[];
  /** Recomputed projection; never replaces the pixels or a human answer. */
  numericDeductions?: { row: number; field: "right"; value: number; origin: "deduced" }[];
  numericRows?: CaptureNumericRow[];
  numericStageSuggestion?: "points-only" | "animation" | "unverified";
  possibleAbsentParticipantIds?: string[];
  unreadableRowNumbers?: number[];
}

export interface GameValue {
  value: number;
  origin: "observed" | "manual" | "deduced";
  sourceCaptureId?: string;
  sourceRow?: number;
  sourceField?: "right" | "addition";
}
export interface GameReading {
  current?: GameValue;
  cumulative?: GameValue;
  segment: string;
  useAsAnchor: boolean;
}
export interface GameEvidence {
  stage: "unknown" | "points-only" | "animation" | "pre-addition" | "post-race";
  session: string;
  verified: boolean;
  readings: Record<string, GameReading>;
  rowAssociations?: Record<string, string[]>;
}

export interface OrderAnchor {
  participantId: string;
  olderTotal: number;
  newerTotal: number;
  current: number;
  intermediateGain: number;
}
export interface OrderGap {
  fromRaceId: string;
  toRaceId: string;
  anchors: OrderAnchor[];
}
export interface OrderReview {
  acceptedAt: string;
  inputSignature: string;
  raceIds: string[];
  basis: "unique" | "manual";
  gaps: OrderGap[];
  unresolvedRaceIds: string[];
}

export interface Reconstruction {
  boundaryAnalysis?: AssistanceAnalysis;
  status: "unique" | "ambiguous" | "conflict" | "insufficient" | "incomplete" | "stale";
  inputSignature: string;
  createdAt: string;
  targetNumber: number;
  message: string;
  fromRaceId?: string;
  toRaceId?: string;
  session?: string;
  sourceCaptureIds: string[];
  orderBasis?: "unique" | "manual";
  knownRaces: {
    raceId: string;
    number: number;
    represented: number;
    discarded: boolean;
    nativePoints: Record<string, number>;
  }[];
  anchors: {
    participantId: string;
    older: GameValue;
    newer: GameValue;
    current: GameValue;
    known: number;
    gain: number;
    segment: string;
  }[];
  represented?: number;
  placements: string[];
  absentParticipantIds: string[];
}

export interface PositionFact {
  id: string;
  raceId: string;
  participantId: string;
  position: number | "absent";
  origin: "user";
  createdAt: string;
  updatedAt: string;
}
export interface AssistedResult {
  raceId: string;
  placements: string[];
  absentParticipantIds: string[];
  represented: number;
}
export interface ReconstructionHypothesis {
  results: AssistedResult[];
}
export interface AssistanceEquation {
  boundary?: true;
  boundaryChecks?: { sourceCaptureIds: string[]; signature: string }[];
  originFact?: { kind: "confirmed-origin"; captureId: string; signature: string; answer: "zero-valid-12" };
  knownRaceIds?: string[];
  fromCaptureId?: string;
  toCaptureId?: string;
  participantId: string;
  targetIndices: number[];
  gain: number;
  known: number;
  fromRaceId?: string;
  toRaceId?: string;
  fromNumber: number;
  toNumber: number;
  older: GameValue;
  newer: GameValue;
  current?: GameValue;
  session: string;
  segment: string;
}
export interface AssistanceAnalysis {
  facts: PositionFact[];
  status: "unique" | "ambiguous" | "conflict" | "insufficient" | "incomplete" | "stale";
  inputSignature: string;
  sourceSignature: string;
  orderVerified: boolean;
  createdAt: string;
  targetRaceIds: string[];
  hypotheses: ReconstructionHypothesis[];
  complete: boolean;
  message: string;
  equations: AssistanceEquation[];
  sourceCaptureIds: string[];
  knownRaces: {
    raceId: string;
    number: number;
    represented: number;
    discarded: boolean;
    placements: string[];
    absentParticipantIds: string[];
    nativePoints: Record<string, number>;
    nativePointOrigins: Record<string, "modeled" | "manual">;
  }[];
  stats: {
    nodes: number;
    contexts: number;
    tuples: number;
    elapsedMs: number;
    cancelled: boolean;
  };
}
export interface Assistance {
  id: string;
  targetRaceIds: string[];
  facts: PositionFact[];
  factHistory: {
    action: "add" | "edit" | "remove";
    at: string;
    fact: PositionFact;
  }[];
  skipped?: { signature: string; keys: string[] };
  analysis?: AssistanceAnalysis;
  confirmed?: {
    at: string;
    kind: "user" | "unique";
    inputSignature: string;
    hypothesis: ReconstructionHypothesis;
  };
  history: {
    analysis: AssistanceAnalysis;
    confirmed?: Assistance["confirmed"];
  }[];
}

/** Physical identity and valid numbering are independent; unknown counts stay intervals. */
export interface SequenceOccurrence {
  id: string;
  aliases: string[];
  captureIds: string[];
  number?: number;
  physicalNumber?: number;
  raceId?: string;
}
export interface SequenceLink {
  fromCaptureId: string;
  toCaptureId: string;
  signature: string;
  continuity?: "continuous-12" | "reset" | "unknown";
  validity?: "counted" | "discarded" | "unknown";
  people?: { participantId: string; answer: "stable" | "reset" | "unknown" }[];
}
export interface SequenceGap {
  order: "forward" | "unknown";
  id: string;
  fromId: string;
  toId: string;
  sourceCaptureIds: string[];
  count?: number;
  validCount?: number;
}
export interface CaptureSequence {
  roomAnalysis?: import("./sequence/room/room-sequence.ts").RoomAnalysis;
  /** Retractable projections, never input facts for the next analysis. */
  associations?: { captureId: string; raceId: string }[];
  projectedRaceIds?: string[];
  version: 1;
  origins?: { captureId: string; signature: string; answer: "zero-valid-12" | "unknown" }[];
  relations: {
    fromCaptureId: string;
    toCaptureId: string;
    completedSteps: number;
    stableParticipantIds: string[];
    resetParticipantIds: string[];
    unknownParticipantIds: string[];
  }[];
  numbers: {
    captureId: string;
    physicalNumber?: number;
    number: number | null;
    phase: "before" | "after" | "event-final";
  }[];
  links: SequenceLink[];
  occurrences: SequenceOccurrence[];
  gaps: SequenceGap[];
  inputSignature: string;
  conflict?: string;
}

/** Adjusted contribution with independent source provenance; never a race result. */
export interface IntervalContribution {
  physicalSteps?: number;
  discardedRaceIds?: string[];
  id: string;
  sourceCaptureIds: string[];
  fromOccurrenceId: string;
  toOccurrenceId: string;
  validRaceNumbers: number[];
  values: { participantId: string; slotId: string; raw: number; adjusted: number }[];
  signature: string;
  adjustment: "native-12";
}
export interface ProvenCoverage {
  version: 1;
  intervals: IntervalContribution[];
  history: { contribution: IntervalContribution; reason: string }[];
}

/** Structured values supplied when accepting a result or source context. */
export interface RaceReviewFields {
  nextTrackAnswer?: string;
  groupTotalAnswers?: GroupTotalAnswer[];
  numericAnswers?: NumericAnswer[];
  nameAssociations?: NameAssociation[];
  placements: string[];
  absentParticipantIds: string[];
  reviewed: boolean;
}
