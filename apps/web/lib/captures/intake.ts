import { type MogiOverviewActivity, nextRaceNumber } from "@mkw/engine";

import { reviewFile } from "../mogi/capture-review.ts";
import type {
  Capture,
  CaptureReview,
  CaptureReviewItem,
  Mogi,
  Race,
  RaceDraft,
  RaceReviewFields,
  SharedFile,
} from "../mogi/types.ts";

/** One image of the intake: its file, its reading once there is one, and the player's answers about it. */
export type IntakeItem = {
  photoMoment?: Capture["photoMoment"];
  receivedAt?: number;
  pastedAt?: number;
  id: string;
  sharedFileId?: string;
  sourceCaptureId?: string;
  file: File;
  number: number;
  numberKnown?: boolean;
  association: string;
  discarded?: boolean;
  draft?: RaceDraft;
  status: "waiting" | "processing" | "ready" | "failed" | "cancelled" | "saved";
  progress: string;
  capture?: Capture;
  duplicate?: string;
  error?: string;
};

function image(source: SharedFile): File {
  return new File([source.original], source.name, { type: source.mimeType, lastModified: source.lastModified });
}

/** The mogi's saved review as intake items; an item whose image is no longer available is dropped. */
export function restoreIntake(mogi: Mogi, pendingFiles: SharedFile[]): IntakeItem[] {
  return (mogi.captureReview?.items ?? []).flatMap((item) => {
    const file = reviewFile(item, mogi, pendingFiles);
    if (!file) return [];
    return [
      {
        ...item,
        photoMoment: file.photoMoment,
        receivedAt: file.receivedAt,
        pastedAt: file.pastedAt,
        sharedFileId: item.source.fileId,
        sourceCaptureId: item.source.captureId,
        file: image(file),
        progress: "",
        capture: item.recognition
          ? { ...item.recognition, original: file.original, reviewedAt: "", reviewedPlacements: [] }
          : undefined,
      },
    ];
  });
}

/**
 * The review as persisted: a reading in progress is saved as waiting, to be read again on return, and the reading
 * keeps neither the original file nor review answers.
 */
export function persistIntake(id: string, currentItemId: string, items: IntakeItem[]): CaptureReview {
  return {
    version: 1,
    id,
    currentItemId,
    items: items.map((item): CaptureReviewItem => {
      const recognition =
        item.capture &&
        (Object.fromEntries(
          Object.entries(item.capture).filter(
            ([key]) => !["original", "reviewedAt", "reviewedPlacements"].includes(key),
          ),
        ) as CaptureReviewItem["recognition"]);
      return {
        id: item.id,
        source: item.sourceCaptureId ? { captureId: item.sourceCaptureId } : { fileId: item.sharedFileId! },
        number: item.number,
        numberKnown: item.numberKnown,
        association: item.association,
        discarded: item.discarded,
        draft: item.draft,
        status: item.status === "processing" ? "waiting" : item.status,
        recognition,
        duplicate: item.duplicate,
        error: item.error,
      };
    }),
  };
}

/** New images go after the mogi's last race, in order, as new races whose numbers the player still has to confirm. */
export function newIntakeItems(mogi: Mogi, files: SharedFile[]): IntakeItem[] {
  return files.map((source, n) => ({
    photoMoment: source.photoMoment,
    receivedAt: source.receivedAt,
    pastedAt: source.pastedAt,
    id: crypto.randomUUID(),
    sharedFileId: source.id,
    file: image(source),
    number: nextRaceNumber(mogi) + n,
    numberKnown: false,
    association: "new",
    status: "waiting",
    progress: "",
  }));
}

/** Items whose capture the mogi now holds are saved and point at that capture. Returns `items` itself when none changed. */
export function syncAcceptedItems(items: IntakeItem[], mogi: Mogi): IntakeItem[] {
  const next = items.map((item) => {
    const capture = mogi.captures?.find((source) => source.id === item.capture?.id);
    return item.status !== "saved" && capture && item.sharedFileId
      ? { ...item, status: "saved" as const, sourceCaptureId: capture.id, sharedFileId: undefined, draft: undefined }
      : item;
  });
  return next.some((item, index) => item !== items[index]) ? next : items;
}

/** The image to review after `id` is accepted: the first other one not saved yet. */
export function nextPendingItem(items: IntakeItem[], id: string): IntakeItem | undefined {
  return items.find((item) => item.id !== id && item.status !== "saved");
}

/** The intake's reading progress and open questions, for the mogi header. */
export function intakeActivity(
  items: IntakeItem[],
  { working, readingIds, stagingCount }: { working: boolean; readingIds: string[]; stagingCount: number },
): MogiOverviewActivity {
  const pending = items.filter((item) => item.status !== "saved");
  const waiting = pending.filter((item) => item.status === "waiting" || item.status === "processing");
  const batch = items.filter((item) => readingIds.includes(item.id));
  return {
    reading:
      working || waiting.length
        ? {
            current: Math.min(
              batch.length || stagingCount || 1,
              batch.filter((item) => item.capture || item.status === "failed" || item.status === "cancelled").length +
                1,
            ),
            total: batch.length + stagingCount || 1,
            numbers: waiting.map((item) => item.number),
          }
        : null,
    questions: pending
      .filter((item) => item.status !== "waiting" && item.status !== "processing")
      .map((item) => ({ number: item.number, count: 1 })),
  };
}

/** The saved result edit of `item` for `race`, pointing at the item's stored capture or, before acceptance, its file. */
export function intakeDraft(
  item: IntakeItem,
  race: Race,
  baseSignature: string | null,
  fields: RaceReviewFields,
): RaceDraft {
  return {
    version: 1,
    purpose: "capture",
    ...(item.sourceCaptureId ? { sourceCaptureId: item.sourceCaptureId } : { sourceFileId: item.sharedFileId! }),
    raceId: race.id,
    number: race.number ?? item.number,
    baseSignature,
    fields,
    updatedAt: new Date().toISOString(),
  };
}
