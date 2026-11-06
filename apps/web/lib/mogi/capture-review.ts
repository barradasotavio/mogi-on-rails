import { raceDraftProblem } from "./race-review.ts";
import type { CaptureReview, CaptureReviewItem, Mogi, SharedFile, TrackerState } from "./types.ts";

/** Keep the player's live pending selection when unrelated sources change. */
export function retainedReviewItem(items: CaptureReviewItem[], preferred?: string): string {
  const selected =
    items.find((item) => item.id === preferred && item.status !== "saved") ??
    items.find((item) => item.status !== "saved") ??
    items[0];
  if (!selected) throw new Error("No screenshot is left in this review.");
  return selected.id;
}

export function pendingCaptureReview(mogi: Mogi): boolean {
  return !!mogi.captureReview?.items.some((item) => item.status !== "saved");
}

export function reviewFile(item: CaptureReviewItem, mogi: Mogi, files: SharedFile[]): SharedFile | undefined {
  if (item.source.fileId) return files.find((file) => file.id === item.source.fileId);
  const capture = mogi.captures?.find((value) => value.id === item.source.captureId);
  return capture?.original
    ? {
        id: capture.id,
        name: capture.fileName,
        mimeType: capture.original.type,
        lastModified: capture.lastModified ?? 0,
        photoMoment: capture.photoMoment,
        receivedAt: capture.receivedAt,
        pastedAt: capture.pastedAt,
        original: capture.original,
      }
    : undefined;
}

export async function reviewDraftProblem(mogi: Mogi, item: CaptureReviewItem): Promise<string | undefined> {
  if (!item.draft) return;
  const problem = await raceDraftProblem(mogi, item.draft);
  if (problem === "race-changed")
    return "The race changed. Check the current data before continuing with this screenshot.";
  if (problem === "participation-changed")
    return "The players changed. Check the current data before continuing with this screenshot.";
}

/** A late OCR write must not turn a confirmed item back into pending work. */
export function mergeCaptureReview(mogi: Mogi, incoming: CaptureReview, state: TrackerState): CaptureReview {
  const current = mogi.captureReview;
  if (current && current.id !== incoming.id && pendingCaptureReview(mogi))
    throw new Error("Finish the pending review before adding more screenshots.");
  const claimed = new Set(
    state.mogis
      .filter((other) => other.id !== mogi.id)
      .flatMap(
        (other) => other.captureReview?.items.flatMap((item) => (item.source.fileId ? [item.source.fileId] : [])) ?? [],
      ),
  );
  const items = incoming.items.map((item) => {
    if (item.source.fileId && item.source.fileId === state.sourceUndo?.fileId)
      throw new Error("This screenshot is held for Undo.");
    if (item.source.fileId && claimed.has(item.source.fileId))
      throw new Error("These screenshots are already being reviewed in another mogi.");
    const saved =
      current?.id === incoming.id
        ? current.items.find((old) => old.id === item.id && old.status === "saved")
        : undefined;
    if (saved && item.source.fileId) return saved;
    const sourceExists = item.source.fileId
      ? state.sharedReceipts?.some((receipt) => receipt.files.some((file) => file.id === item.source.fileId))
      : mogi.captures?.some((capture) => capture.id === item.source.captureId);
    if (!sourceExists) throw new Error("This review's screenshot changed. Reload before continuing.");
    const prior = current?.id === incoming.id ? current.items.find((old) => old.id === item.id) : undefined;
    return prior?.separation ? { ...item, separation: prior.separation } : item;
  });
  return { ...incoming, items };
}
