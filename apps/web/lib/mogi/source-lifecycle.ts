import {
  acceptedCaptureEvidence,
  participantsForOccurrence,
  reconcileCaptureEvidence,
  screenProperties,
} from "@mkw/engine";

import { sourceUndoIsExportable } from "../backup/validation.ts";
import { isCompressed, originalFingerprint } from "../images/compressed.ts";
import { fingerprint } from "../images/fingerprint.ts";
import { retainedReviewItem } from "./capture-review.ts";
import { raceDraftProblem, raceReviewSignature } from "./race-review.ts";
import type { Capture, Mogi, TrackerState } from "./types.ts";

function releaseUndo(state: TrackerState): TrackerState {
  const id = state.sourceUndo?.fileId;
  return {
    ...state,
    sourceUndo: undefined,
    sharedReceipts: state.sharedReceipts
      ?.map((receipt) => ({ ...receipt, files: receipt.files.filter((file) => file.id !== id) }))
      .filter((receipt) => receipt.files.length || receipt.rejections.length),
  };
}
/**
 * Keep the removal Undo only while a backup accepts it. Reconciliation drops a projected race once no
 * screenshot targets it, so removing the screenshot that projected it leaves the Undo citing that race;
 * undoing projects it again, so those references are forgotten. Any other stale reference releases it.
 */
export function settleSourceUndo(state: TrackerState): TrackerState {
  const undo = state.sourceUndo;
  if (!undo) return state;
  const races = new Set(state.mogis.find((mogi) => mogi.id === undo.mogiId)?.races.map((race) => race.id));
  const capture = undo.capture,
    raceId = capture?.context?.raceId;
  const pruned = {
    ...undo,
    races: undo.races.filter((race) => races.has(race.id)),
    capture:
      capture?.context && raceId !== undefined && !races.has(raceId)
        ? { ...capture, context: { phase: capture.context.phase } }
        : capture,
  };
  const unchanged = pruned.races.length === undo.races.length && pruned.capture === undo.capture;
  const next = unchanged ? state : { ...state, sourceUndo: pruned };
  return sourceUndoIsExportable(next) ? next : releaseUndo(state);
}
/** Latest-state only: never changes a physical occurrence's Lounge validity. */
export function detachSource(mogi: Mogi, captureId: string): Mogi {
  const capture = mogi.captures?.find((entry) => entry.id === captureId);
  if (!capture) throw new Error("The screenshot changed. Reopen it.");
  const remaining = mogi.captures!.filter((entry) => entry.id !== captureId);
  const races = mogi.races.map((race) => {
    const associated = race.captureIds?.includes(captureId);
    let gameEvidence = reconcileCaptureEvidence(race.gameEvidence, undefined, captureId);
    if (associated)
      for (const alternate of remaining.filter((entry) => race.captureIds?.includes(entry.id)))
        gameEvidence = reconcileCaptureEvidence(gameEvidence, acceptedCaptureEvidence(alternate, race));
    const alternatives = remaining.filter(
      (entry) =>
        race.captureIds?.includes(entry.id) &&
        entry.stage === "finish-order-confirmed" &&
        JSON.stringify(entry.reviewedPlacements) === JSON.stringify(race.placements),
    );
    const lostResult = associated && race.origin === "observed" && !alternatives.length && race.placements.length > 0;
    const {
      sourceRemovalHistory,
      participationHistory: _participationHistory,
      reconstructionHistory: _reconstructionHistory,
      gameEvidenceHistory: _gameEvidenceHistory,
      ...previousResult
    } = race;
    void _participationHistory;
    void _reconstructionHistory;
    void _gameEvidenceHistory;
    return {
      ...race,
      captureIds: race.captureIds?.filter((id) => id !== captureId),
      gameEvidence,
      ...(lostResult
        ? {
            sourceRemovalHistory: [
              ...(sourceRemovalHistory ?? []),
              { removedAt: new Date().toISOString(), captureId, result: previousResult },
            ],
            status: race.status === "discarded" ? ("discarded" as const) : ("pending" as const),
            placements: [],
            absentParticipantIds: [],
            nativePoints: undefined,
            nativePointOrigins: undefined,
          }
        : {}),
      gameEvidenceHistory:
        race.gameEvidence && JSON.stringify(gameEvidence) !== JSON.stringify(race.gameEvidence)
          ? [...(race.gameEvidenceHistory ?? []), { changedAt: new Date().toISOString(), evidence: race.gameEvidence }]
          : race.gameEvidenceHistory,
    };
  });
  const items = mogi.captureReview?.items.filter((item) => item.source.captureId !== captureId);
  return {
    ...mogi,
    sourceRevision: (mogi.sourceRevision ?? 0) + 1,
    captures: remaining,
    races,
    deletedCaptureIds: [...new Set([...(mogi.deletedCaptureIds ?? []), captureId])],
    raceDraft:
      mogi.raceDraft?.purpose === "capture" && mogi.raceDraft.sourceCaptureId === captureId
        ? undefined
        : mogi.raceDraft,
    captureReview: items?.length
      ? { ...mogi.captureReview!, items, currentItemId: retainedReviewItem(items, mogi.captureReview?.currentItemId) }
      : undefined,
    sequence: mogi.sequence
      ? {
          ...mogi.sequence,
          numbers: mogi.sequence.numbers.filter((entry) => entry.captureId !== captureId),
          links: mogi.sequence.links.filter(
            (entry) => entry.fromCaptureId !== captureId && entry.toCaptureId !== captureId,
          ),
          origins: mogi.sequence.origins?.filter((entry) => entry.captureId !== captureId),
          associations: mogi.sequence.associations?.filter((entry) => entry.captureId !== captureId),
          relations: [],
          occurrences: mogi.sequence.occurrences
            .map((entry) => ({ ...entry, captureIds: entry.captureIds.filter((id) => id !== captureId) }))
            .filter((entry) => entry.captureIds.length),
          gaps: [],
        }
      : undefined,
  };
}
export function removeSource(
  state: TrackerState,
  mogiId: string,
  source: { captureId?: string; itemId?: string },
): TrackerState {
  const mogi = state.mogis.find((entry) => entry.id === mogiId);
  if (!mogi) throw new Error("The screenshot changed. Reopen it.");
  const item = mogi.captureReview?.items.find((entry) => entry.id === source.itemId);
  const captureId = source.captureId ?? item?.source.captureId;
  const capture = mogi.captures?.find((entry) => entry.id === captureId);
  const file = item?.source.fileId
    ? state.sharedReceipts?.flatMap((receipt) => receipt.files).find((entry) => entry.id === item.source.fileId)
    : undefined;
  if (capture && !capture.original) throw new Error("The original screenshot was deleted to free space.");
  if (!capture && !file) throw new Error("The screenshot changed. Resume the current review.");
  const next = releaseUndo(state),
    fileId = file?.id ?? crypto.randomUUID();
  const original = file ?? {
    id: fileId,
    name: capture!.fileName,
    mimeType: capture!.original!.type,
    lastModified: capture!.lastModified ?? 0,
    original: capture!.original!,
    photoMoment: capture!.photoMoment,
    receivedAt: capture!.receivedAt,
    pastedAt: capture!.pastedAt,
  };
  const metadata = capture
    ? (Object.fromEntries(Object.entries(capture).filter(([key]) => key !== "original")) as Omit<Capture, "original">)
    : undefined;
  const undo = {
    id: crypto.randomUUID(),
    mogiId,
    fileId,
    capture: metadata,
    reviewItem: capture ? undefined : item,
    raceDraft:
      mogi.raceDraft?.purpose === "capture" &&
      (mogi.raceDraft.sourceCaptureId === capture?.id || mogi.raceDraft.sourceFileId === file?.id)
        ? mogi.raceDraft
        : undefined,
    races: mogi.races
      .filter((race) => captureId && race.captureIds?.includes(captureId))
      .map((race) => {
        const { sourceRemovalHistory, participationHistory, reconstructionHistory, gameEvidenceHistory, ...result } =
          race;
        void sourceRemovalHistory;
        void participationHistory;
        void reconstructionHistory;
        void gameEvidenceHistory;
        return result;
      }),
    sequence: mogi.sequence
      ? {
          numbers: mogi.sequence.numbers
            .filter((entry) => entry.captureId === captureId)
            .map((entry) => {
              const occurrence = mogi.sequence?.occurrences.find((occurrence) =>
                occurrence.captureIds.includes(entry.captureId),
              );
              return {
                ...entry,
                ...(entry.number === null
                  ? {}
                  : {
                      physicalNumber:
                        entry.physicalNumber ?? occurrence?.physicalNumber ?? occurrence?.number ?? entry.number,
                    }),
              };
            }),
          links: mogi.sequence.links.filter(
            (entry) => entry.fromCaptureId === captureId || entry.toCaptureId === captureId,
          ),
          origins: mogi.sequence.origins?.filter((entry) => entry.captureId === captureId),
        }
      : undefined,
  };
  const items = mogi.captureReview?.items.filter((entry) => entry.id !== item?.id);
  const changed = capture
    ? detachSource(mogi, capture.id)
    : {
        ...mogi,
        sourceRevision: (mogi.sourceRevision ?? 0) + 1,
        raceDraft:
          mogi.raceDraft?.purpose === "capture" && mogi.raceDraft.sourceFileId === file?.id
            ? undefined
            : mogi.raceDraft,
        captureReview: items?.length
          ? {
              ...mogi.captureReview!,
              items,
              currentItemId: retainedReviewItem(items, mogi.captureReview?.currentItemId),
            }
          : undefined,
      };
  return {
    ...next,
    sourceUndo: undo,
    mogis: next.mogis.map((entry) => (entry.id === mogiId ? changed : entry)),
    sharedReceipts: [
      ...(next.sharedReceipts ?? []).map((receipt) => ({
        ...receipt,
        files: receipt.files.filter((entry) => entry.id !== fileId),
      })),
      { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), files: [original], rejections: [] },
    ],
  };
}
/** Restore only this source into the current aggregate; unrelated writes always win. */
export async function undoSource(state: TrackerState, undoId: string): Promise<TrackerState> {
  const undo = state.sourceUndo,
    mogi = state.mogis.find((entry) => entry.id === undo?.mogiId);
  if (!undo || undo.id !== undoId || !mogi) throw new Error("The screenshot changed. Resume the current review.");
  const file = state.sharedReceipts?.flatMap((receipt) => receipt.files).find((entry) => entry.id === undo.fileId);
  if (!file) throw new Error("The original screenshot for this removal is unavailable.");
  if (undo.raceDraft && mogi.raceDraft && JSON.stringify(mogi.raceDraft) !== JSON.stringify(undo.raceDraft))
    throw new Error("Finish the current edit before restoring this screenshot's draft.");
  if (!undo.capture) {
    const item = undo.reviewItem!;
    if (item.draft && (await raceDraftProblem(mogi, item.draft)))
      throw new Error("The draft's race changed. Check the race before undoing this removal.");
    const review = mogi.captureReview ?? {
      version: 1 as const,
      id: crypto.randomUUID(),
      currentItemId: item.id,
      items: [],
    };
    if (review.items.some((entry) => entry.id === item.id))
      throw new Error("This review is already in the current batch.");
    const restored = { ...item, status: item.recognition ? ("ready" as const) : ("waiting" as const) };
    return {
      ...state,
      sourceUndo: undefined,
      mogis: state.mogis.map((entry) =>
        entry.id === mogi.id
          ? {
              ...mogi,
              sourceRevision: (mogi.sourceRevision ?? 0) + 1,
              raceDraft: undo.raceDraft ?? mogi.raceDraft,
              captureReview: {
                ...review,
                items: [...review.items, restored],
                currentItemId: retainedReviewItem([...review.items, restored], review.currentItemId),
              },
            }
          : entry,
      ),
    };
  }
  const hash = await originalFingerprint({ ...undo.capture, original: file.original });
  let canonical: Capture | undefined;
  for (const other of state.mogis)
    for (const capture of other.captures ?? [])
      if ((await originalFingerprint(capture)) === hash) {
        if (other.id !== mogi.id)
          throw new Error("This screenshot is in another mogi. Check the destination before undoing.");
        canonical = capture;
      }
  const duplicateFiles = new Set<string>();
  for (const original of state.sharedReceipts?.flatMap((receipt) => receipt.files) ?? [])
    if (original.id !== undo.fileId && (await fingerprint(original.original)) === hash) {
      const owner = state.mogis.find((entry) =>
        entry.captureReview?.items.some((item) => item.source.fileId === original.id),
      );
      const claim = owner?.captureReview?.items.find((item) => item.source.fileId === original.id);
      if (owner && owner.id !== mogi.id)
        throw new Error("This screenshot is under review in another mogi. Check the destination before undoing.");
      if (claim?.draft) throw new Error("Finish this screenshot's current review before restoring the previous one.");
      duplicateFiles.add(original.id);
    }
  if (canonical) {
    if (undo.raceDraft || undo.capture.contextDraft)
      throw new Error("This screenshot already has a current review. Check the previous draft before undoing.");
    const items = mogi.captureReview?.items.filter(
      (item) => !item.source.fileId || !duplicateFiles.has(item.source.fileId),
    );
    const released = releaseUndo(state);
    // Current accepted source owns its answers and association. A replay is only
    // an acknowledgement: never map old signatures or bind it to an old race.
    return {
      ...released,
      sharedReceipts: released.sharedReceipts?.map((receipt) => ({
        ...receipt,
        files: receipt.files.filter((file) => !duplicateFiles.has(file.id)),
      })),
      mogis: released.mogis.map((entry) =>
        entry.id === mogi.id
          ? {
              ...mogi,
              sourceRevision: (mogi.sourceRevision ?? 0) + 1,
              captureReview: items?.length
                ? {
                    ...mogi.captureReview!,
                    items,
                    currentItemId: retainedReviewItem(items, mogi.captureReview?.currentItemId),
                  }
                : undefined,
            }
          : entry,
      ),
    };
  }
  const capture = { ...undo.capture, original: file.original };
  const sourceId = undo.capture.id;
  const live = new Set([...(mogi.captures ?? []).map((entry) => entry.id), capture.id]);
  const snapshot = undo.sequence;
  const pending = mogi.captureReview?.items.filter(
    (item) => !item.source.fileId || !duplicateFiles.has(item.source.fileId),
  );
  let changed: Mogi = {
    ...mogi,
    captureReview: pending?.length
      ? {
          ...mogi.captureReview!,
          items: pending,
          currentItemId: retainedReviewItem(pending, mogi.captureReview?.currentItemId),
        }
      : undefined,
    sourceRevision: (mogi.sourceRevision ?? 0) + 1,
    raceDraft: undo.raceDraft ?? mogi.raceDraft,
    captures: [...(mogi.captures ?? []), capture],
    deletedCaptureIds: mogi.deletedCaptureIds?.filter((id) => id !== capture.id && id !== sourceId),
    races: mogi.races.map((race) => {
      const previous = undo.races.find((entry) => entry.id === race.id);
      if (!previous) return race;
      const finishOrder =
        capture.stage === "finish-order-confirmed" &&
        (!capture.interpretation || screenProperties(capture.interpretation.screen).order === "finishOrder") &&
        JSON.stringify(capture.reviewedPlacements) === JSON.stringify(previous.placements);
      const restore =
        finishOrder &&
        previous.origin === "observed" &&
        (race.status === "pending" || race.status === "discarded") &&
        !race.placements.length &&
        !race.participationReview;
      return {
        ...race,
        ...(restore
          ? {
              placements: previous.placements,
              absentParticipantIds: previous.absentParticipantIds,
              nativePoints: previous.nativePoints,
              nativePointOrigins: previous.nativePointOrigins,
              status: race.status === "discarded" ? ("discarded" as const) : ("confirmed" as const),
            }
          : {}),
        captureIds: [...new Set([...(race.captureIds ?? []), capture.id])],
      };
    }),
  };
  // Source-local answers can return; derived occurrences/proofs are recomputed.
  if (snapshot && changed.sequence)
    changed = {
      ...changed,
      sequence: {
        ...changed.sequence,
        numbers: [
          ...changed.sequence.numbers.filter((entry) => entry.captureId !== capture.id),
          ...snapshot.numbers.map((entry) => ({ ...entry, captureId: entry.captureId })),
        ],
        origins: [
          ...(changed.sequence.origins ?? []).filter((entry) => entry.captureId !== capture.id),
          ...(snapshot.origins ?? []).map((entry) => ({ ...entry, captureId: entry.captureId })),
        ],
        links: [
          ...changed.sequence.links,
          ...snapshot.links
            .map((entry) => ({ ...entry, fromCaptureId: entry.fromCaptureId, toCaptureId: entry.toCaptureId }))
            .filter((entry) => live.has(entry.fromCaptureId) && live.has(entry.toCaptureId)),
        ],
      },
    };
  changed = {
    ...changed,
    races: changed.races.map((race) =>
      race.captureIds?.includes(capture.id)
        ? { ...race, gameEvidence: reconcileCaptureEvidence(race.gameEvidence, acceptedCaptureEvidence(capture, race)) }
        : race,
    ),
  };
  if (undo.raceDraft) {
    const before = undo.races.find((race) => race.id === undo.raceDraft!.raceId),
      after = changed.races.find((race) => race.id === undo.raceDraft!.raceId);
    const core = (race: typeof before) =>
      race && [
        race.id,
        race.origin,
        race.number,
        race.physicalNumber,
        race.status,
        race.placements,
        race.absentParticipantIds,
        race.nativePoints,
        race.nativePointOrigins,
        race.participationReview,
      ];
    const people = new Set(after ? participantsForOccurrence(changed, after).map((person) => person.id) : []);
    if (
      !before ||
      !after ||
      JSON.stringify(core(before)) !== JSON.stringify(core(after)) ||
      [...undo.raceDraft.fields.placements, ...undo.raceDraft.fields.absentParticipantIds].some((id) => !people.has(id))
    )
      throw new Error("The draft's race changed. Check the race before restoring this screenshot.");
    changed = { ...changed, raceDraft: { ...undo.raceDraft, baseSignature: await raceReviewSignature(after) } };
  }
  const released = releaseUndo(state);
  return {
    ...released,
    sharedReceipts: released.sharedReceipts?.map((receipt) => ({
      ...receipt,
      files: receipt.files.filter((file) => !duplicateFiles.has(file.id)),
    })),
    mogis: released.mogis.map((entry) => (entry.id === mogi.id ? changed : entry)),
  };
}

/** Explicit user destination; carry bytes, never roster-specific interpretations or proofs. */
export async function redirectSource(
  state: TrackerState,
  mogiId: string,
  source: { captureId?: string; itemId?: string },
  destinationId: string,
): Promise<TrackerState> {
  const mogi = state.mogis.find((entry) => entry.id === mogiId),
    destination = state.mogis.find((entry) => entry.id === destinationId);
  if (!mogi || !destination || destination.id === mogi.id)
    throw new Error("The screenshot changed. Resume the current review.");
  const item = mogi.captureReview?.items.find((entry) => entry.id === source.itemId);
  const capture = mogi.captures?.find((entry) => entry.id === (source.captureId ?? item?.source.captureId));
  const received = item?.source.fileId
    ? state.sharedReceipts?.flatMap((receipt) => receipt.files).find((file) => file.id === item.source.fileId)
    : undefined;
  if (capture && isCompressed(capture)) throw new Error("The screenshot was replaced. Resume the current one.");
  if (capture && !capture.original) throw new Error("The original screenshot was deleted to free space.");
  if ((!capture && !received) || received?.id === state.sourceUndo?.fileId)
    throw new Error("The screenshot was replaced. Resume the current one.");
  const file = received ?? {
    id: crypto.randomUUID(),
    name: capture!.fileName,
    mimeType: capture!.original!.type,
    lastModified: capture!.lastModified ?? 0,
    original: capture!.original!,
    photoMoment: capture!.photoMoment,
    receivedAt: capture!.receivedAt,
    pastedAt: capture!.pastedAt,
  };
  const hash = await fingerprint(file.original);
  let duplicate = false;
  for (const accepted of destination.captures ?? [])
    if ((await originalFingerprint(accepted)) === hash) duplicate = true;
  for (const pending of destination.captureReview?.items ?? []) {
    const original = state.sharedReceipts
      ?.flatMap((receipt) => receipt.files)
      .find((file) => file.id === pending.source.fileId);
    if (original && (await fingerprint(original.original)) === hash) duplicate = true;
  }
  const remaining = mogi.captureReview?.items.filter((entry) => entry.id !== item?.id);
  const detached = capture
    ? detachSource(mogi, capture.id)
    : {
        ...mogi,
        sourceRevision: (mogi.sourceRevision ?? 0) + 1,
        captureReview: remaining?.length
          ? {
              ...mogi.captureReview!,
              items: remaining,
              currentItemId: retainedReviewItem(remaining, mogi.captureReview?.currentItemId),
            }
          : undefined,
      };
  const id = crypto.randomUUID(),
    review = destination.captureReview ?? {
      version: 1 as const,
      id: crypto.randomUUID(),
      currentItemId: id,
      items: [],
    };
  if (!duplicate && review.items.length >= 32)
    throw new Error("Resume the destination batch before sending more screenshots.");
  const target = duplicate
    ? destination
    : {
        ...destination,
        sourceRevision: (destination.sourceRevision ?? 0) + 1,
        captureReview: {
          ...review,
          items: [
            ...review.items,
            {
              id,
              source: { fileId: file.id },
              number: 1,
              numberKnown: false,
              association: "new",
              status: "waiting" as const,
            },
          ],
          currentItemId: retainedReviewItem(
            [
              ...review.items,
              { id, source: { fileId: file.id }, number: 1, numberKnown: false, association: "new", status: "waiting" },
            ],
            review.currentItemId,
          ),
        },
      };
  const receipts = state.sharedReceipts?.map((receipt) => ({
    ...receipt,
    files: receipt.files.filter((entry) => entry.id !== file.id),
  }));
  return {
    ...state,
    mogis: state.mogis.map((entry) => (entry.id === mogiId ? detached : entry.id === destinationId ? target : entry)),
    sharedReceipts: duplicate
      ? receipts
      : [
          ...(receipts ?? []),
          { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), files: [file], rejections: [] },
        ],
  };
}
export function deleteSourceMogi(state: TrackerState, id: string): TrackerState {
  const next = state.sourceUndo?.mogiId === id ? releaseUndo(state) : state;
  return {
    ...next,
    mogis: next.mogis.filter((mogi) => mogi.id !== id),
    activeMogiId: next.activeMogiId === id ? null : next.activeMogiId,
  };
}
