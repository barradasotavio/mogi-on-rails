import {
  analyzeOrder,
  applyCaptureContext,
  applyReconstruction,
  applyReviewedRace,
  applySequenceAnswer,
  changeIgn,
  materializePendingGaps,
  mogiOverview,
  orderGaps,
  orderingInputSignature,
  raceNumber,
  racePhysicalNumber,
  reconstructOne,
  requireParticipationReview,
  screenProperties,
  type SequenceAnswer,
  withdrawManualResult,
} from "@mkw/engine";

import { galleryReceipt, knownOriginals } from "../images/gallery.ts";
import type { ImageReceiptTime } from "../images/photo-moment.ts";
import { mergeCaptureReview, reviewDraftProblem } from "./capture-review.ts";
import { deleteMogiImages } from "./free-space.ts";
import { ingestCaptureReview } from "./ingestion.ts";
import { raceDraftProblem, raceReviewSignature, withRaceDraft } from "./race-review.ts";
import { deleteSourceMogi } from "./source-lifecycle.ts";
import type { Capture, CaptureReview, Mogi, Participant, Race, RaceReviewFields, TrackerState } from "./types.ts";

/**
 * The mogi edits: each one is a transition of the latest tracker state, run by the tracker session's
 * write queue. A transition throws a stale-data notice (see `recovery.ts`) when what the user saw changed.
 */

function eachMogi(latest: TrackerState, mogiId: string, edit: (mogi: Mogi) => Mogi): TrackerState {
  return { ...latest, mogis: latest.mogis.map((item) => (item.id === mogiId ? edit(item) : item)) };
}
async function eachMogiAsync(
  latest: TrackerState,
  mogiId: string,
  edit: (mogi: Mogi) => Promise<Mogi>,
): Promise<TrackerState> {
  return { ...latest, mogis: await Promise.all(latest.mogis.map((item) => (item.id === mogiId ? edit(item) : item))) };
}
/** Drops one shared file from the receipts once its image was accepted into a mogi. */
function withoutSharedFile(latest: TrackerState, sharedFileId?: string): Partial<TrackerState> {
  return sharedFileId
    ? {
        sharedReceipts: latest.sharedReceipts
          ?.map((receipt) => ({
            ...receipt,
            files: receipt.files.filter((file) => file.id !== sharedFileId),
          }))
          .filter((receipt) => receipt.files.length > 0),
      }
    : {};
}
type RaceSignature = Awaited<ReturnType<typeof raceReviewSignature>>;
const rawReading = (value: Pick<Capture, "rows" | "numericRows" | "interpretation">) =>
  JSON.stringify([
    value.rows.map(({ text, confidence }) => [text, confidence]),
    value.numericRows,
    value.interpretation,
  ]);

export function createMogi(latest: TrackerState, mogi: Mogi): TrackerState {
  return { ...latest, mogis: [...latest.mogis, mogi], activeMogiId: mogi.id };
}

export function rememberMogi(latest: TrackerState, id: string): TrackerState {
  return { ...latest, activeMogiId: id };
}

/** A restored backup replaces the state; every source revision moves past the current one, so open reviews restart. */
export function restoredState(next: TrackerState, current: TrackerState): TrackerState {
  return {
    ...next,
    mogis: next.mogis.map((mogi) => ({
      ...mogi,
      sourceRevision:
        Math.max(mogi.sourceRevision ?? 0, current.mogis.find((entry) => entry.id === mogi.id)?.sourceRevision ?? 0) +
        1,
    })),
  };
}

/** Accepts the order analysis when it is unique and matches the races as numbered. */
async function withDeterminedManualOrder(current: Mogi, cancelled: () => boolean = () => false): Promise<Mogi> {
  if (current.sequence || current.orderReview?.inputSignature === orderingInputSignature(current)) return current;
  const analysis = await analyzeOrder(current, cancelled);
  if (cancelled() || analysis.status !== "unique" || analysis.orders.length !== 1) return current;
  const established = [...current.races]
    .sort((a, b) => racePhysicalNumber(current, a) - racePhysicalNumber(current, b))
    .filter((race) => analysis.raceIds.includes(race.id))
    .map((race) => race.id);
  const order = analysis.orders[0];
  if (order.some((id, index) => id !== established[index])) return current;
  return {
    ...current,
    orderReview: {
      acceptedAt: new Date().toISOString(),
      inputSignature: analysis.inputSignature,
      raceIds: order,
      basis: "unique",
      gaps: orderGaps(order, analysis.transitions),
      unresolvedRaceIds: analysis.unresolvedRaceIds,
    },
  };
}

/**
 * Saves the mogi's settings as edited from `baseline`. A change of race validity re-runs the reconstructions
 * the manual order determined.
 */
export async function updateMogi(
  latest: TrackerState,
  updated: Mogi,
  baseline: Mogi | undefined,
): Promise<TrackerState> {
  return eachMogiAsync(latest, updated.id, async (current) => {
    if (!baseline || JSON.stringify(current) !== JSON.stringify(baseline))
      throw new Error("The data changed. Reopen this action before making corrections.");
    let next = requireParticipationReview(current, updated);
    const validityChanged = current.races.some(
      (race) =>
        (race.status === "discarded") !== (next.races.find((entry) => entry.id === race.id)?.status === "discarded"),
    );
    const determined = current.races.filter(
      (race) =>
        race.origin === "reconstructed" &&
        race.reconstruction?.status === "unique" &&
        !race.reconstruction.boundaryAnalysis,
    );
    if (validityChanged && !next.sequence && determined.length) {
      next = await withDeterminedManualOrder(next);
      for (const previous of determined) {
        const target = next.races.find((race) => race.id === previous.id);
        if (target) next = applyReconstruction(next, target, await reconstructOne(next, target));
      }
    }
    return next;
  });
}

/** The race whose result the settings edit changed, for the recovery that reopens it. */
export function changedRaceId(updated: Mogi, baseline: Mogi | undefined): string | undefined {
  return updated.races.find(
    (race) => JSON.stringify(race) !== JSON.stringify(baseline?.races.find((entry) => entry.id === race.id)),
  )?.id;
}

export function changeParticipantIgn(
  latest: TrackerState,
  mogiId: string,
  expected: Participant,
  ign: string,
): TrackerState {
  return eachMogi(latest, mogiId, (item) => {
    const person = item.participants.find((entry) => entry.id === expected.id);
    if (!person || person.ign !== expected.ign || person.ignOrigin !== expected.ignOrigin)
      throw new Error("The IGN changed. Reopen the editor to continue.");
    return changeIgn(item, person.id, ign);
  });
}

/** Stores the pending batch's answers, then ingests what they already settle. */
export function saveCaptureReview(
  latest: TrackerState,
  mogiId: string,
  review: CaptureReview,
  revision: number,
): TrackerState {
  return ingestCaptureReview(
    eachMogi(latest, mogiId, (item) => {
      if ((item.sourceRevision ?? 0) !== revision)
        throw new Error("The screenshots changed. Resume the current batch.");
      const merged = mergeCaptureReview(item, review, latest);
      return { ...item, captureReview: merged.items.every((entry) => entry.status === "saved") ? undefined : merged };
    }),
    mogiId,
  );
}

export interface RaceSave {
  race: Race;
  capture?: Capture;
  sharedFileId?: string;
  reviewItemId?: string;
  /** Keep a manual result as it is: the image only joins the race as evidence. */
  preserveIndependentResult?: boolean;
}

/** Saves a race result, from Edit Result or from an image's review; accepting a batch item marks it saved. */
export async function saveRace(
  latest: TrackerState,
  mogiId: string,
  { race, capture, sharedFileId, reviewItemId, preserveIndependentResult = false }: RaceSave,
): Promise<TrackerState> {
  return {
    ...(await eachMogiAsync(latest, mogiId, async (item) => {
      const reviewItem = item.captureReview?.items.find((entry) => entry.id === reviewItemId);
      if (reviewItem?.separation) throw new Error("This screenshot is separate. Choose its destination mogi.");
      if (reviewItemId && !reviewItem) throw new Error("The review changed. Reopen the batch to continue.");
      if (reviewItem && capture?.interpretation) {
        if (
          reviewItem.status !== "ready" ||
          reviewItem.recognition?.id !== capture.id ||
          (sharedFileId &&
            (reviewItem.source.fileId !== sharedFileId ||
              !latest.sharedReceipts?.some((receipt) => receipt.files.some((file) => file.id === sharedFileId))))
        )
          throw new Error("This review's screenshot changed or was already accepted. Reopen it.");
        if (reviewItem.association === "new" && (reviewItem.numberKnown === false || reviewItem.number !== race.number))
          throw new Error("The race number changed or is still unknown.");
        if (!reviewItem.recognition || rawReading(reviewItem.recognition) !== rawReading(capture))
          throw new Error("The screenshot reading changed. Resume the analysis before accepting.");
      }
      if (reviewItem) {
        const problem = await reviewDraftProblem(item, reviewItem);
        if (problem) throw new Error(problem);
      }
      if (capture && item.raceDraft?.raceId === race.id) {
        const problem = await raceDraftProblem(item, item.raceDraft);
        if (problem) throw new Error("The race or participation changed. Reopen the name review.");
      }
      const existing = item.races.find((entry) => entry.id === race.id);
      if (!capture && !existing) throw new Error("The race changed. Reopen it before editing.");
      const result = preserveIndependentResult && existing?.origin === "manual" ? existing : race;
      const updated = {
        ...applyReviewedRace(item, result, capture),
        raceDraft: item.raceDraft?.raceId === race.id ? undefined : item.raceDraft,
      };
      if (reviewItem && capture && item.captureReview) {
        const signature = await raceReviewSignature(updated.races.find((value) => value.id === race.id));
        const entries = item.captureReview.items.map((entry) =>
          entry.id !== reviewItemId
            ? entry
            : {
                ...entry,
                association: race.id,
                status: "saved" as const,
                source: { captureId: capture.id },
                draft: entry.draft
                  ? {
                      version: 1 as const,
                      purpose: "capture" as const,
                      raceId: race.id,
                      number: race.number ?? entry.number,
                      sourceCaptureId: capture.id,
                      baseSignature: signature,
                      fields: entry.draft.fields,
                      updatedAt: entry.draft.updatedAt,
                    }
                  : undefined,
              },
        );
        updated.captureReview = entries.every((entry) => entry.status === "saved")
          ? undefined
          : {
              ...item.captureReview,
              items: entries,
              currentItemId: entries.find((entry) => entry.status !== "saved")?.id ?? reviewItem.id,
            };
      }
      return updated;
    })),
    ...withoutSharedFile(latest, sharedFileId),
  };
}

export interface ContextSave {
  capture: Capture;
  fields: RaceReviewFields;
  raceId?: string;
  sharedFileId?: string;
  reviewItemId?: string;
}

/** Saves the answers of a context screen (standings without a finish order) and its race association. */
export function saveContext(
  latest: TrackerState,
  mogiId: string,
  { capture, fields, raceId, sharedFileId, reviewItemId }: ContextSave,
): TrackerState {
  return {
    ...eachMogi(latest, mogiId, (item) => {
      const review = item.captureReview?.items.find((entry) => entry.id === reviewItemId);
      if (review?.separation) throw new Error("This screenshot is separate. Choose its destination mogi.");
      const current = item.captures?.find((entry) => entry.id === capture.id);
      const answers = (entry: RaceReviewFields | undefined) =>
        JSON.stringify([
          entry?.nameAssociations,
          entry?.numericAnswers,
          entry?.groupTotalAnswers,
          entry?.nextTrackAnswer,
        ]);
      if (reviewItemId) {
        if (
          !review ||
          review.status !== "ready" ||
          review.recognition?.id !== capture.id ||
          !review.recognition ||
          rawReading(review.recognition) !== rawReading(capture)
        )
          throw new Error("This screenshot's review changed or was already accepted. Reopen the screenshot.");
        if (
          sharedFileId
            ? review.source.fileId !== sharedFileId ||
              !latest.sharedReceipts?.some((receipt) => receipt.files.some((file) => file.id === sharedFileId)) ||
              latest.mogis.some(
                (other) =>
                  other.id !== mogiId &&
                  other.captureReview?.items.some((entry) => entry.source.fileId === sharedFileId),
              )
            : review.source.captureId !== capture.id
        )
          throw new Error("This screenshot's file changed. Resume the current review.");
        if (["new", ""].includes(review.association) ? !!raceId : review.association !== raceId)
          throw new Error("This screenshot's race changed. Resume the current review.");
        if (review.draft && answers(review.draft.fields) !== answers(fields))
          throw new Error("This screenshot's answers changed. Resume the current review.");
      } else if (
        !current ||
        current.reviewedAt !== capture.reviewedAt ||
        rawReading(current) !== rawReading(capture) ||
        JSON.stringify(current.contextDraft) !== JSON.stringify(capture.contextDraft) ||
        (current.contextDraft && answers(current.contextDraft) !== answers(fields))
      )
        throw new Error("This screenshot or its answers changed. Reopen the screenshot.");
      const derived = !!item.sequence?.associations?.some(
        (entry) => entry.captureId === capture.id && entry.raceId === raceId && current?.context?.raceId === raceId,
      );
      const updated = applyCaptureContext(item, capture, fields, raceId, derived);
      if (review && item.captureReview) {
        const items = item.captureReview.items.map((entry) =>
          entry.id === reviewItemId
            ? { ...entry, status: "saved" as const, source: { captureId: capture.id }, draft: undefined }
            : entry,
        );
        updated.captureReview = items.every((entry) => entry.status === "saved")
          ? undefined
          : { ...item.captureReview, items, currentItemId: items.find((entry) => entry.status !== "saved")!.id };
      }
      return updated;
    }),
    ...(sharedFileId
      ? {
          sharedReceipts: latest.sharedReceipts
            ?.map((receipt) => ({ ...receipt, files: receipt.files.filter((file) => file.id !== sharedFileId) }))
            .filter((receipt) => receipt.files.length),
        }
      : {}),
  };
}

/** Keeps a context screen's partial answers; complete answers apply the context. */
export function saveContextDraft(
  latest: TrackerState,
  mogiId: string,
  capture: Capture,
  fields: RaceReviewFields,
): TrackerState {
  return eachMogi(latest, mogiId, (item) => {
    const current = item.captures?.find((entry) => entry.id === capture.id);
    if (
      !current?.context ||
      !capture.context ||
      current.reviewedAt !== capture.reviewedAt ||
      JSON.stringify(current.contextDraft) !== JSON.stringify(capture.contextDraft)
    )
      throw new Error("The screenshot changed. Reopen it before making corrections.");
    const complete =
      fields.nameAssociations?.length === current.rows.length &&
      fields.nameAssociations.every((answer) => answer.participantId) &&
      (screenProperties(current.interpretation?.screen)?.cumulative !== "final" ||
        screenProperties(current.interpretation?.screen)?.order === "finishOrder" ||
        current.numericRows?.every(
          (row) => !row.right.uncertain || fields.numericAnswers?.some((answer) => answer.row === row.row),
        ));
    return complete
      ? applyCaptureContext(
          item,
          current,
          fields,
          current.context?.raceId,
          !!item.sequence?.associations?.some(
            (entry) => entry.captureId === current.id && entry.raceId === current.context?.raceId,
          ),
        )
      : {
          ...item,
          captures: item.captures?.map((entry) =>
            entry.id === capture.id ? { ...entry, contextDraft: fields } : entry,
          ),
        };
  });
}

export function answerSequence(
  latest: TrackerState,
  mogiId: string,
  action: SequenceAnswer,
  signature: string,
): TrackerState {
  return eachMogi(latest, mogiId, (item) => applySequenceAnswer(item, action, signature));
}

/** Keeps Edit Result's draft, valid while the race still has the signature it was opened with. */
export function saveRaceDraft(
  latest: TrackerState,
  mogiId: string,
  race: Race,
  fields: RaceReviewFields,
  expected: RaceSignature,
): Promise<TrackerState> {
  return eachMogiAsync(latest, mogiId, (item) => withRaceDraft(item, race, fields, expected));
}

/** Keeps the name review's draft of a stored screenshot of the race. */
export function saveNameDraft(
  latest: TrackerState,
  mogiId: string,
  race: Race,
  capture: Capture,
  fields: RaceReviewFields,
  expected: RaceSignature,
): Promise<TrackerState> {
  return eachMogiAsync(latest, mogiId, async (item) => {
    const existing = item.races.find((entry) => entry.id === race.id);
    const currentCapture = item.captures?.find((entry) => entry.id === capture.id);
    if (!existing?.captureIds?.includes(capture.id) || !currentCapture)
      throw new Error("The screenshot changed. Reopen the race.");
    if (
      currentCapture.context ||
      capture.context ||
      currentCapture.reviewedAt !== capture.reviewedAt ||
      JSON.stringify([currentCapture.nameAssociations, currentCapture.numericAnswers]) !==
        JSON.stringify([capture.nameAssociations, capture.numericAnswers])
    )
      throw new Error("The screenshot changed. Reopen the review to continue with the current answers.");
    if (
      fields.placements.length + fields.absentParticipantIds.length !== 12 ||
      new Set([...fields.placements, ...fields.absentParticipantIds]).size !== 12
    )
      throw new Error("This screenshot's result changed. Reopen the review to continue.");
    if ((await raceReviewSignature(existing)) !== expected)
      throw new Error("The race changed. Reopen the name review.");
    return {
      ...item,
      raceDraft: {
        version: 1 as const,
        purpose: "capture" as const,
        sourceCaptureId: capture.id,
        raceId: race.id,
        number: race.number ?? raceNumber(item, race),
        baseSignature: expected,
        fields,
        updatedAt: new Date().toISOString(),
      },
    };
  });
}

export function discardRaceDraft(latest: TrackerState, mogiId: string | undefined): TrackerState {
  return {
    ...latest,
    mogis: latest.mogis.map((item) => (item.id === mogiId ? { ...item, raceDraft: undefined } : item)),
  };
}

/** Withdraws a manual result so the race counts again from what its screenshots prove. */
export function revertToScreenshots(latest: TrackerState, mogiId: string | undefined, raceId: string): TrackerState {
  return {
    ...latest,
    mogis: latest.mogis.map((item) => (item.id === mogiId ? withdrawManualResult(item, raceId) : item)),
  };
}

/** Saves the placeholder of a race that took place with no result, with the pending races before it. */
export function addPendingRace(latest: TrackerState, mogiId: string, race: Race, number: number): TrackerState {
  return eachMogi(latest, mogiId, (item) => {
    if (item.races.some((entry) => entry.status !== "discarded" && raceNumber(item, entry) === number))
      throw new Error("The race changed. Reopen it before editing.");
    return { ...item, races: materializePendingGaps(item, [...item.races, race], number) };
  });
}

/** Stages images in the shared receipts, before they join the mogi's batch. */
export async function stageImages(latest: TrackerState, mogiId: string, files: File[], time: ImageReceiptTime) {
  const staged = await galleryReceipt(files, knownOriginals(latest, mogiId), time);
  const state = {
    ...latest,
    sharedReceipts: staged.receipt.files.length
      ? [...(latest.sharedReceipts ?? []), staged.receipt]
      : latest.sharedReceipts,
  };
  return { state, staged };
}

export function deleteImages(latest: TrackerState, mogiId: string): TrackerState {
  return eachMogi(latest, mogiId, deleteMogiImages);
}

/** Storage deletes only finished mogis. */
export function deleteFinishedMogi(latest: TrackerState, mogiId: string): TrackerState {
  const current = latest.mogis.find((entry) => entry.id === mogiId);
  if (!current || !mogiOverview(current).finished) throw new Error("Only a finished mogi can be deleted from Storage.");
  return deleteSourceMogi(latest, current.id);
}
