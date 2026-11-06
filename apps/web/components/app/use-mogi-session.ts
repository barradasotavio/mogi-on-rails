"use client";

import { raceNumber, type SequenceAnswer } from "@mkw/engine";
import { useEffect, useState } from "react";

import { currentSizeClass } from "@/components/ui/size-class";
import { useToast } from "@/components/ui/toast";
import { duplicateImagesMessage } from "@/lib/images/gallery";
import type { ImageReceiptTime } from "@/lib/images/photo-moment";
import { reviewDraftProblem } from "@/lib/mogi/capture-review";
import * as edits from "@/lib/mogi/edits";
import { answerCurrentQuestion } from "@/lib/mogi/question-answers";
import type { MogiQuestion, MogiQuestionAnswer } from "@/lib/mogi/questions";
import { raceDraftProblem, raceReviewSignature } from "@/lib/mogi/race-review";
import type { ActionRecovery, ReviewContext } from "@/lib/mogi/recovery";
import { deleteSourceMogi, removeSource, undoSource } from "@/lib/mogi/source-lifecycle";
import type { Capture, CaptureReview, Mogi, Participant, Race, RaceReviewFields } from "@/lib/mogi/types";
import { settled } from "@/lib/settled";

import type { useMogiRoute } from "./use-mogi-route";
import type { TrackerSessionHandle } from "./use-tracker-session";

type Route = ReturnType<typeof useMogiRoute>;
export interface ReviewRequest {
  version: number;
  mogiId?: string;
  surface?: "players" | "settings" | "questions";
  captureId?: string;
  raceId?: string;
}

/**
 * The open mogi's session: its edits bound to the tracker session's write queue, the race editor that
 * is open, the Images sheet, Undo of the last source removal (also Ctrl+Z), and the recovery that
 * reopens the surface a stale edit came from.
 */
export function useMogiSession(
  session: TrackerSessionHandle,
  {
    mogi,
    route,
    showActionError,
    closeSheet,
    sheetOpen,
  }: {
    mogi: Mogi | undefined;
    route: Route;
    showActionError: (message: string) => void;
    /** Closes Settings and New Mogi; a recovery reopens the mogi on top. */
    closeSheet: () => void;
    /** Settings or New Mogi is open: Ctrl+Z belongs to them. */
    sheetOpen: boolean;
  },
) {
  const toast = useToast();
  const { persist, busy, reportError, current } = session;
  const [editingRace, setEditingRace] = useState<Race | null>(null);
  const [contextTarget, setContextTarget] = useState("");
  const [editingNameCaptureId, setEditingNameCaptureId] = useState<string | null>(null);
  const [imagesOpen, setImagesOpen] = useState(false);
  // Edit Result's draft persists silently: its own writes never lock the editor or announce anything.
  const [draftWrites, setDraftWrites] = useState(0);
  const [reviewRequest, setReviewRequest] = useState<ReviewRequest>({ version: 0 });
  const persistReview = (context: ReviewContext) => (input: Parameters<typeof persist>[0]) => persist(input, context);

  // Leaving the mogi, for another one or the list, gives up the reversal.
  const [undoRoute, setUndoRoute] = useState(route.mogiId);
  if (undoRoute !== route.mogiId) {
    setUndoRoute(route.mogiId);
    session.withdrawUndoOffer();
  }
  const undoOffer = session.undoOffer;
  const undoId =
    undoOffer && session.state.sourceUndo?.id === undoOffer && session.state.sourceUndo.mogiId === route.mogiId
      ? undoOffer
      : null;
  const undo = undoId ? () => void persist((latest) => undoSource(latest, undoId)) : undefined;
  useEffect(() => {
    if (!undo) return;
    function undoKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey)
        return;
      if (
        busy ||
        sheetOpen ||
        document.querySelector(
          '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"])',
        )
      )
        return;
      if (document.activeElement?.closest("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      undo?.();
    }
    document.addEventListener("keydown", undoKey);
    return () => document.removeEventListener("keydown", undoKey);
  }, [undo, busy, sheetOpen]);

  useEffect(() => {
    const closeEditor = () => setEditingRace(null);
    window.addEventListener("popstate", closeEditor);
    return () => window.removeEventListener("popstate", closeEditor);
  }, []);

  const latestEditingRace = mogi?.races.find((race) => race.id === editingRace?.id);
  const editorRace = editingRace && {
    ...editingRace,
    ...latestEditingRace,
    placements: latestEditingRace?.placements.length ? latestEditingRace.placements : editingRace.placements,
  };
  const editingNameCapture = mogi?.captures?.find((capture) => capture.id === editingNameCaptureId);

  /** Reopens the current version of what a stale edit came from, once every queued write has finished. */
  function recover({ target }: ActionRecovery, context?: ReviewContext) {
    void Promise.resolve(session.idle()).then(async () => {
      const id = context?.mogiId ?? route.retainedId;
      const latest = current().mogis.find((item) => item.id === id);
      if (!latest) {
        route.navigate({ type: "pop" }, current());
        return;
      }
      const captureId = context?.captureId ?? editingNameCaptureId ?? undefined;
      const raceId = context?.raceId ?? editingRace?.id;
      if (target === "draft" && !(await persist((state) => edits.discardRaceDraft(state, latest.id)))) return;
      closeSheet();
      setEditingRace(null);
      setEditingNameCaptureId(null);
      setImagesOpen(false);
      route.navigate({ type: "open", id: latest.id }, current());
      const capture = latest.captures?.find((item) => item.id === captureId);
      const race = latest.races.find((item) => item.id === raceId);
      setReviewRequest((previous) => ({
        version: previous.version + 1,
        mogiId: latest.id,
        ...(target === "images" && capture
          ? { captureId: capture.id }
          : (target === "race" || target === "draft" || target === "settings") && race
            ? { raceId: race.id }
            : {
                surface:
                  target === "players"
                    ? "players"
                    : target === "questions"
                      ? "questions"
                      : target === "images"
                        ? undefined
                        : "settings",
              }),
      }));
      if (target === "images" && !capture) setImagesOpen(true);
    });
  }

  async function updateMogi(updated: Mogi) {
    const missingOriginal = updated.captureReview?.items.some(
      (item) => item.source.captureId && !updated.captures?.some((capture) => capture.id === item.source.captureId),
    );
    if (missingOriginal) {
      showActionError("Resume or discard the review before removing a screenshot used by the batch.");
      return false;
    }
    const baseline = mogi;
    return persistReview({ mogiId: updated.id, raceId: edits.changedRaceId(updated, baseline) })((latest) =>
      edits.updateMogi(latest, updated, baseline),
    );
  }
  async function changeIgn(expected: Participant, ign: string) {
    if (!mogi) return false;
    const mogiId = mogi.id;
    return persistReview({ mogiId })((latest) => edits.changeParticipantIgn(latest, mogiId, expected, ign));
  }
  async function resumeCaptureReview() {
    if (!mogi) return;
    const id = mogi.id;
    const problems = await Promise.all((mogi.captureReview?.items ?? []).map((item) => reviewDraftProblem(mogi, item)));
    if (!route.isCurrent(id)) return;
    const problem = problems.find(Boolean);
    if (problem) showActionError(problem);
    setImagesOpen(true);
  }
  async function saveCaptureReview(review: CaptureReview, revision: number) {
    if (!mogi) return false;
    const mogiId = mogi.id;
    return persistReview({ mogiId })((latest) => edits.saveCaptureReview(latest, mogiId, review, revision));
  }
  async function saveRace(
    race: Race,
    capture?: Capture,
    sharedFileId?: string,
    reviewItemId?: string,
    preserveIndependentResult = false,
  ) {
    if (!mogi) return false;
    const mogiId = mogi.id;
    const success = await persistReview({ mogiId, raceId: race.id, captureId: capture?.id })((latest) =>
      edits.saveRace(latest, mogiId, { race, capture, sharedFileId, reviewItemId, preserveIndependentResult }),
    );
    if (success) setEditingRace(null);
    return success;
  }
  async function saveContext(
    capture: Capture,
    fields: RaceReviewFields,
    raceId?: string,
    sharedFileId?: string,
    reviewItemId?: string,
  ) {
    if (!mogi) return false;
    const mogiId = mogi.id;
    return persistReview({ mogiId, raceId, captureId: capture.id })((latest) =>
      edits.saveContext(latest, mogiId, { capture, fields, raceId, sharedFileId, reviewItemId }),
    );
  }
  async function answerSequence(action: SequenceAnswer, signature: string) {
    if (!mogi) return false;
    const mogiId = mogi.id;
    return persistReview({ mogiId })((latest) => edits.answerSequence(latest, mogiId, action, signature));
  }
  async function answerQuestion(question: MogiQuestion, answer: MogiQuestionAnswer) {
    if (!mogi) return false;
    const mogiId = mogi.id;
    let answered = false;
    const saved = await persistReview({ mogiId, raceId: question.raceId, captureId: question.captureId })(
      async (latest) => {
        const next = await answerCurrentQuestion(latest, mogiId, question, answer);
        answered = next !== latest;
        return next;
      },
    );
    return saved && answered;
  }
  async function writeDraft(work: () => Promise<boolean>): Promise<boolean> {
    setDraftWrites((count) => count + 1);
    return settled(work, () => {
      setDraftWrites((count) => count - 1);
    });
  }
  async function saveContextDraft(capture: Capture, fields: RaceReviewFields) {
    if (!mogi) return false;
    const mogiId = mogi.id;
    return persistReview({ mogiId, captureId: capture.id })((latest) =>
      edits.saveContextDraft(latest, mogiId, capture, fields),
    );
  }
  async function saveRaceDraft(race: Race, fields: RaceReviewFields) {
    if (!mogi) return false;
    const mogiId = mogi.id;
    const expected = await raceReviewSignature(mogi.races.find((candidate) => candidate.id === race.id));
    return persistReview({ mogiId, raceId: race.id })((latest) =>
      edits.saveRaceDraft(latest, mogiId, race, fields, expected),
    );
  }
  async function saveNameDraft(race: Race, capture: Capture, fields: RaceReviewFields) {
    if (!mogi) return false;
    const mogiId = mogi.id;
    const expected =
      mogi.raceDraft?.raceId === race.id
        ? mogi.raceDraft.baseSignature
        : await raceReviewSignature(mogi.races.find((entry) => entry.id === race.id));
    return persistReview({ mogiId, raceId: race.id, captureId: capture.id })((latest) =>
      edits.saveNameDraft(latest, mogiId, race, capture, fields, expected),
    );
  }
  /** Withdraws a manual result so the race counts again from what its screenshots prove. */
  const revertToScreenshots = (race: Race) =>
    persistReview({ mogiId: mogi?.id ?? "", raceId: race.id })((latest) =>
      edits.revertToScreenshots(latest, mogi?.id, race.id),
    );
  const discardRaceDraft = () => persist((latest) => edits.discardRaceDraft(latest, mogi?.id));
  async function resumeRaceDraft() {
    if (!mogi?.raceDraft) return;
    const draft = mogi.raceDraft;
    const existing = mogi.races.find((race) => race.id === draft.raceId);
    const problem = await raceDraftProblem(mogi, draft);
    if (problem === "participation-changed") {
      reportError("The participation changed. Discard the draft to review the race with the current players.", {
        mogiId: mogi.id,
        raceId: draft.raceId,
      });
      return;
    }
    if (problem === "race-changed") {
      reportError("The race changed. Discard the draft to check the current data.", {
        mogiId: mogi.id,
        raceId: draft.raceId,
      });
      return;
    }
    if (!route.isCurrent(mogi.id)) return;
    setEditingNameCaptureId(
      draft.purpose === "capture" && draft.sourceCaptureId && draft.fields.nameAssociations
        ? draft.sourceCaptureId
        : null,
    );
    if (!existing) return;
    setEditingRace(existing);
  }
  /** A ghost race opens Edit Result empty; its placeholder is saved first, so drafts and Save Result find it. */
  async function enterResult(number: number) {
    if (!mogi) return;
    setEditingNameCaptureId(null);
    const existing = mogi.races.find((race) => race.status !== "discarded" && raceNumber(mogi, race) === number);
    if (mogi.raceDraft) {
      if (mogi.raceDraft.raceId === existing?.id) void resumeRaceDraft();
      else showActionError("Resume or discard the pending edit before editing another race.");
      return;
    }
    if (existing) {
      setEditingRace(existing);
      return;
    }
    const mogiId = mogi.id;
    const race: Race = { id: crypto.randomUUID(), number, status: "pending", origin: "manual", placements: [] };
    const saved = await persist((latest) => edits.addPendingRace(latest, mogiId, race, number), { mogiId });
    if (saved) setEditingRace(race);
  }
  function editRace(race: Race) {
    if (!mogi) return;
    setEditingNameCaptureId(null);
    if (mogi.raceDraft) {
      if (mogi.raceDraft.raceId === race.id || !mogi.races.some((item) => item.id === race.id)) void resumeRaceDraft();
      else showActionError("Resume or discard the pending edit before editing another race.");
      return;
    }
    setEditingRace(race);
  }
  function editContext(capture: Capture) {
    if (!mogi) return;
    setContextTarget(capture.context?.raceId ?? "");
    const existing =
      mogi.races.find((race) => race.id === capture.context?.raceId) ??
      mogi.races.find((race) => race.captureIds?.includes(capture.id));
    setEditingNameCaptureId(capture.id);
    setEditingRace(
      existing ?? {
        id: `context:${capture.id}`,
        origin: "observed",
        number: 1,
        placements: mogi.participants.filter((person) => !person.slotId).map((person) => person.id),
      },
    );
  }
  function correctNames(race: Race, captureId: string) {
    if (!mogi) return;
    if (mogi.raceDraft) {
      if (mogi.raceDraft.raceId === race.id) void resumeRaceDraft();
      else showActionError("Resume or discard the pending edit before correcting another screenshot.");
      return;
    }
    setEditingNameCaptureId(captureId);
    setEditingRace(race);
  }
  /** Stages files for the open mogi's batch; duplicates of stored images are announced and skipped. */
  async function stage(files: File[], time: ImageReceiptTime) {
    if (!mogi) return false;
    let staged: Awaited<ReturnType<typeof edits.stageImages>>["staged"] | undefined;
    const success = await persist(async (latest) => {
      const target = latest.mogis.find((entry) => entry.id === mogi.id);
      if (!target || !route.isCurrent(target.id)) throw new Error("Open a mogi in progress to add screenshots.");
      const next = await edits.stageImages(latest, target.id, files, time);
      staged = next.staged;
      return next.state;
    });
    if (success && staged?.duplicates.length) toast(duplicateImagesMessage(staged.duplicates));
    return success && staged ? { files: staged.receipt.files, rejections: staged.receipt.rejections } : false;
  }
  const removePendingSource = (itemId: string) => persist((latest) => removeSource(latest, mogi!.id, { itemId }));
  const removeCaptureSource = (captureId: string) =>
    persistReview({ mogiId: mogi!.id, captureId })((latest) => removeSource(latest, mogi!.id, { captureId }));
  async function deleteMogi() {
    if (!mogi) return false;
    const success = await persist((latest) => deleteSourceMogi(latest, mogi.id));
    if (success) {
      setEditingRace(null);
      route.navigate({ type: "delete", sizeClass: currentSizeClass() }, current());
    }
    return success;
  }

  return {
    editor: {
      race: editingRace,
      /** The edited race with the latest saved fields, keeping the placements typed so far while it has none. */
      editorRace,
      nameCapture: editingNameCapture,
      contextTarget,
      setContextTarget,
      draftWrites,
      writeDraft,
      close: () => {
        setEditingRace(null);
        setEditingNameCaptureId(null);
      },
      /** Closes the race editor only; the name review's capture stays chosen for the next one. */
      closeRace: () => setEditingRace(null),
    },
    imagesOpen,
    setImagesOpen,
    reviewRequest,
    undo,
    recover,
    updateMogi,
    changeIgn,
    resumeCaptureReview,
    saveCaptureReview,
    saveRace,
    saveContext,
    answerSequence,
    answerQuestion,
    saveContextDraft,
    saveRaceDraft,
    saveNameDraft,
    revertToScreenshots,
    discardRaceDraft,
    resumeRaceDraft,
    enterResult,
    editRace,
    editContext,
    correctNames,
    stage,
    removePendingSource,
    removeCaptureSource,
    deleteMogi,
  };
}

export type MogiSessionHandle = ReturnType<typeof useMogiSession>;
