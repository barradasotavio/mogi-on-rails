import type {
  Capture as DomainCapture,
  CaptureSequence,
  Mogi as DomainMogi,
  PhotoMoment,
  Race,
  RaceReviewFields,
} from "@mkw/engine";

import type { CompressedImage } from "../images/compressed.ts";
export type {
  Assistance,
  AssistanceAnalysis,
  AssistanceEquation,
  AssistedResult,
  CaptureInterpretation,
  CaptureNumericRow,
  CaptureRow,
  CaptureSequence,
  GameEvidence,
  GameReading,
  GameValue,
  GroupTotalAnswer,
  IntervalContribution,
  MogiFormat,
  NameAssociation,
  NumericAnswer,
  NumericReading,
  OrderAnchor,
  OrderGap,
  OrderReview,
  Participant,
  PositionFact,
  ProvenCoverage,
  Race,
  Reconstruction,
  ReconstructionHypothesis,
  SequenceGap,
  SequenceLink,
  SequenceOccurrence,
  Substitution,
  Team,
} from "@mkw/engine";

/** Product files and saved review state extend the engine facts without changing persistence. */
export interface Capture extends DomainCapture, CompressedImage {
  receivedAt?: number;
  pastedAt?: number;
  fileName: string;
  /** Null after freeing space; the capture evidence and answers remain. */
  original: Blob | null;
  contextDraft?: RaceReviewFields;
}
export interface Mogi extends DomainMogi {
  captures?: Capture[];
  raceDraft?: RaceDraft;
  captureReview?: CaptureReview;
  /** Invalidates outstanding source work when ownership changes. */
  sourceRevision?: number;
}

export type { RaceReviewFields } from "@mkw/engine";
export type RaceDraft = {
  version: 1;
  raceId: string;
  number: number;
  baseSignature: string | null;
  fields: RaceReviewFields;
  updatedAt: string;
} & (
  | { purpose: "manual"; sourceFileId?: never }
  | { purpose: "capture"; sourceFileId: string; sourceCaptureId?: never }
  | { purpose: "capture"; sourceCaptureId: string; sourceFileId?: never }
);

/** Review work references the durable original; OCR suggestions are not results. */
export interface CaptureReviewItem {
  id: string;
  source: { fileId: string; captureId?: never } | { captureId: string; fileId?: never };
  number: number;
  /** False means the internal draft number is provisional and cannot be accepted. */
  numberKnown?: boolean;
  association: string;
  discarded?: boolean;
  draft?: RaceDraft;
  status: "waiting" | "ready" | "failed" | "cancelled" | "saved";
  recognition?: Omit<Capture, "original" | "reviewedPlacements" | "reviewedAt">;
  duplicate?: string;
  /** Title of the other mogi; the image awaits the destination decision before ingestion. */
  separation?: string;
  error?: string;
}
export interface CaptureReview {
  version: 1;
  id: string;
  currentItemId: string;
  items: CaptureReviewItem[];
}

export interface SharedFile {
  receivedAt?: number;
  pastedAt?: number;
  photoMoment?: PhotoMoment;
  id: string;
  name: string;
  mimeType: string;
  lastModified: number;
  original: Blob;
}
export interface SharedReceipt {
  source?: "gallery";
  id: string;
  receivedAt: string;
  files: SharedFile[];
  rejections: string[];
}

/** One undoable source removal. Original bytes use the existing receipt ownership path. */
export interface SourceUndo {
  id: string;
  mogiId: string;
  fileId: string;
  capture?: Omit<Capture, "original">;
  reviewItem?: CaptureReviewItem;
  raceDraft?: RaceDraft;
  races: Race[];
  sequence?: Pick<CaptureSequence, "numbers" | "links" | "origins">;
}
export interface TrackerState {
  sourceUndo?: SourceUndo;
  version: 1;
  sharedReceipts?: SharedReceipt[];
  mogis: Mogi[];
  activeMogiId: string | null;
  /** Settings › Your Lounge Names: every name Tracks counts as you. Absent means none is set yet. */
  loungeNames?: string[];
  /** The single name saved before `loungeNames`; read as one name and dropped on the next save of the names. */
  loungeName?: string;
}

export const emptyState: TrackerState = {
  version: 1,
  mogis: [],
  activeMogiId: null,
};
