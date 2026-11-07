"use client";

import { type MogiOverviewActivity, prepareRaceForReview, raceNumber, screenProperties } from "@mkw/engine";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { MetadataBadge, MetadataGroup } from "@/components/ui/metadata";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet } from "@/components/ui/sheet";
import {
  intakeActivity,
  intakeDraft,
  type IntakeItem,
  newIntakeItems,
  nextPendingItem,
  persistIntake,
  restoreIntake,
  syncAcceptedItems,
} from "@/lib/captures/intake";
import { identicalDuplicate, newRaceProblem, prepareIntakeReview, withoutRace } from "@/lib/captures/intake-review";
import { readCaptures } from "@/lib/captures/read-captures";
import { receivedImageTime } from "@/lib/images/gallery";
import type { ImageReceiptTime } from "@/lib/images/photo-moment";
import { raceLabel } from "@/lib/mogi/race-label";
import { raceReviewSignature } from "@/lib/mogi/race-review";
import type { Capture, CaptureReview, Mogi, Race, RaceReviewFields, SharedFile } from "@/lib/mogi/types";
import { settled } from "@/lib/settled";

import { NameReview } from "./name-review";
import { RaceNumberQuestion } from "./race-number-question";
export type CaptureIntakeHandle = { addCaptureFiles: (files: File[], pastedAt?: number) => void };
export function CaptureIntake({
  mogi,
  onSave,
  onSaveContext,
  onCancel,
  busy,
  onStage,
  pendingFiles,
  onReviewChange,
  rejections = [],
  open,
  onOpenChange,
  pickerRef,
  intakeRef,
  renderPendingActions,
  onActivity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActivity?: (activity: MogiOverviewActivity) => void;
  pickerRef?: RefObject<HTMLInputElement | null>;
  intakeRef?: RefObject<CaptureIntakeHandle | null>;
  renderPendingActions?: (itemId: string, fileName: string) => ReactNode;
  mogi: Mogi;
  onSave: (
    race: Race,
    capture: Capture,
    sharedFileId?: string,
    reviewItemId?: string,
    preserveIndependentResult?: boolean,
  ) => Promise<unknown>;
  onSaveContext: (
    capture: Capture,
    fields: RaceReviewFields,
    raceId?: string,
    sharedFileId?: string,
    reviewItemId?: string,
  ) => Promise<boolean>;
  onCancel: () => void;
  busy: boolean;
  rejections?: string[];
  onStage: (files: File[], time: ImageReceiptTime) => Promise<{ files: SharedFile[]; rejections: string[] } | false>;
  pendingFiles: SharedFile[];
  onReviewChange: (review: CaptureReview) => Promise<boolean>;
}) {
  const [selectionRejections, setSelectionRejections] = useState<string[]>([]);
  const [reviewId] = useState(() => mogi.captureReview?.id ?? crypto.randomUUID());
  const [items, setItems] = useState<IntakeItem[]>(() => restoreIntake(mogi, pendingFiles));
  const itemsRef = useRef(items);
  const cursor = useRef(mogi.captureReview?.currentItemId ?? null);
  const pendingWrites = useRef<Promise<boolean>>(Promise.resolve(true));
  const [working, setWorking] = useState(false);
  const [stagingCount, setStagingCount] = useState(0);
  const [readingIds, setReadingIds] = useState<string[]>([]);
  const recognitionQueue = useRef<IntakeItem[]>([]);
  const recognizing = useRef(false);
  const [reviewing, setReviewing] = useState<string | null>(mogi.captureReview?.currentItemId ?? null);
  const [editingDraft, setEditingDraft] = useState(false);
  const [preparingDraft, setPreparingDraft] = useState(0);
  const [error, setError] = useState("");
  const [reviewWriting, setReviewWriting] = useState(false);
  const [reviewWriteFailed, setReviewWriteFailed] = useState(false);
  // Stop Reading, Done and unmount abort it; the next reading starts with a fresh one.
  const stop = useRef(new AbortController());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current.abort();
    };
  }, []);
  function store(next: IntakeItem[], current: string | null): Promise<boolean> {
    if (!current || !next.length) return Promise.resolve(true);
    const review = persistIntake(reviewId, current, next);
    setReviewWriting(true);
    const write = pendingWrites.current.then(() => onReviewChange(review));
    pendingWrites.current = write;
    void write.then((success) => {
      if (alive.current && pendingWrites.current === write) {
        setReviewWriting(false);
        setReviewWriteFailed(!success);
        setError(success ? "" : "Couldn't save your answers. Try again before leaving.");
      }
    });
    return write;
  }
  function replaceItems(next: IntakeItem[], save = true) {
    itemsRef.current = next;
    if (alive.current) setItems(next);
    if (save) void store(next, cursor.current);
  }
  function patch(id: string, fields: Partial<IntakeItem>, save = true) {
    if (!alive.current) return;
    replaceItems(
      itemsRef.current.map((item) => (item.id === id ? { ...item, ...fields } : item)),
      save,
    );
  }
  function navigate(id: string) {
    cursor.current = id;
    setReviewing(id);
    void store(itemsRef.current, id);
  }
  function resume() {
    if (stop.current.signal.aborted) stop.current = new AbortController();
  }
  async function leave() {
    if (!(await pendingWrites.current)) return;
    stop.current.abort();
    onCancel();
  }
  async function select(files: SharedFile[]) {
    if (!files.length) return;
    resume();
    setError("");
    setWorking(true);
    const batch = newIntakeItems(mogi, files);
    const readingInProgress = recognizing.current;
    setReadingIds((previous) =>
      readingInProgress ? [...new Set([...previous, ...batch.map((item) => item.id)])] : batch.map((item) => item.id),
    );
    cursor.current = batch[0].id;
    replaceItems([...itemsRef.current, ...batch], false);
    if (!(await store(itemsRef.current, batch[0].id))) {
      setWorking(false);
      return;
    }
    await recognize(batch);
  }
  async function recognize(batch: IntakeItem[]) {
    const readingInProgress = recognizing.current;
    setReadingIds((previous) =>
      readingInProgress ? [...new Set([...previous, ...batch.map((item) => item.id)])] : batch.map((item) => item.id),
    );
    recognitionQueue.current.push(...batch);
    if (recognizing.current) return;
    recognizing.current = true;
    resume();
    setWorking(true);
    await readCaptures(recognitionQueue.current, mogi, {
      signal: () => stop.current.signal,
      report: (id, update) => patch(id, update, update.status !== undefined && update.status !== "processing"),
    });
    recognizing.current = false;
    if (alive.current) setWorking(false);
  }
  const resumeRecognition = useEffectEvent(() => {
    const pending = itemsRef.current.filter((item) => !item.capture && item.status !== "saved");
    if (pending.length) void recognize(pending);
  });
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) resumeRecognition();
    });
    return () => {
      disposed = true;
    };
  }, []);
  const syncAccepted = useEffectEvent(() => {
    const next = syncAcceptedItems(itemsRef.current, mogi);
    if (next !== itemsRef.current) replaceItems(next, false);
  });
  useEffect(() => {
    syncAccepted();
  }, [mogi.captures]);
  async function updateFields(item: IntakeItem, race: Race, fields: RaceReviewFields) {
    setPreparingDraft((count) => count + 1);
    return settled(
      async () => {
        const existing = mogi.races.find((candidate) => candidate.id === race.id);
        const baseSignature = item.draft?.baseSignature ?? (await raceReviewSignature(existing));
        if (!alive.current) return;
        patch(item.id, {
          status: item.status === "saved" ? "ready" : item.status,
          draft: intakeDraft(item, race, baseSignature, fields),
        });
        await pendingWrites.current;
      },
      () => {
        if (alive.current) setPreparingDraft((count) => count - 1);
      },
    );
  }
  function changeAssociation(item: IntakeItem, fields: Partial<IntakeItem>) {
    patch(item.id, { ...fields, status: item.status === "saved" ? "ready" : item.status, draft: undefined });
  }
  function navigation(item: IntakeItem) {
    const index = items.findIndex((candidate) => candidate.id === item.id);
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <IconButton
            aria-label="Previous Screenshot"
            disabled={busy || index === 0}
            onClick={() => navigate(items[index - 1].id)}
          >
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <p role="status" className="font-semibold">
            Screenshot {index + 1} of {items.length}
          </p>
          <IconButton
            aria-label="Next Screenshot"
            disabled={busy || index === items.length - 1}
            onClick={() => navigate(items[index + 1].id)}
          >
            <ChevronRight aria-hidden="true" />
          </IconButton>
        </div>
        {item.status !== "saved" && renderPendingActions?.(item.id, item.file.name)}
      </div>
    );
  }
  async function acceptCapture(item: IntakeItem, race: Race, capture: Capture, preserveIndependentResult = false) {
    setError("");
    if (item.association === "new" && item.numberKnown === false) return false;
    if (!(await pendingWrites.current) && !(await store(itemsRef.current, cursor.current))) return false;
    const success = await onSave(race, capture, item.sharedFileId, item.id, preserveIndependentResult);
    if (success === false) return false;
    patch(
      item.id,
      { status: "saved", association: race.id, sourceCaptureId: capture.id, sharedFileId: undefined, draft: undefined },
      false,
    );
    const next = nextPendingItem(itemsRef.current, item.id);
    if (next) {
      cursor.current = next.id;
      setReviewing(next.id);
    } else onCancel();
    return true;
  }
  function association(item: IntakeItem) {
    const index = items.findIndex((candidate) => candidate.id === item.id);
    return (
      <div className="space-y-3">
        {item.duplicate && <p className="text-sm text-muted-foreground">{item.duplicate}</p>}
        <Field>
          <FieldLabel htmlFor={`capture-association-${item.id}`}>Race for screenshot {index + 1}</FieldLabel>
          <NativeSelect
            id={`capture-association-${item.id}`}
            value={item.association}
            disabled={busy}
            onChange={(event) => {
              const race = mogi.races.find((race) => race.id === event.target.value);
              changeAssociation(item, {
                association: event.target.value,
                ...(race ? { number: raceNumber(mogi, race), numberKnown: true } : { numberKnown: false }),
              });
            }}
          >
            <option value="">Choose the race</option>
            {!identicalDuplicate(item) && (
              <option value="new">{withoutRace(item.capture) ? "No race yet" : "New race"}</option>
            )}
            {mogi.races.map((race) => (
              <option key={race.id} value={race.id}>
                {raceLabel(mogi, race)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {screenProperties(item.capture?.interpretation?.screen)?.order === "unknown" &&
          mogi.races.some((race) => race.id === item.association && race.status !== "pending") && (
            <Button
              disabled={busy}
              onClick={() => {
                const existing = mogi.races.find((race) => race.id === item.association)!;
                const capture = item.capture!;
                void acceptCapture(
                  item,
                  { ...existing, captureIds: [...new Set([...(existing.captureIds ?? []), capture.id])] },
                  {
                    ...capture,
                    nameAssociations: undefined,
                    reviewedAt: new Date().toISOString(),
                    reviewedPlacements: existing.placements,
                  },
                );
              }}
            >
              Save Screenshot to This Race
            </Button>
          )}
        {item.association === "new" && !withoutRace(item.capture) && (
          <>
            <RaceNumberQuestion
              number={item.number}
              known={item.numberKnown !== false}
              busy={busy}
              onAnswer={(answer) =>
                changeAssociation(item, { number: answer ?? item.number, numberKnown: answer !== null })
              }
            />
            <Field orientation="horizontal">
              <Checkbox
                id={`discarded-${item.id}`}
                checked={item.discarded ?? false}
                disabled={busy}
                onCheckedChange={(checked) => patch(item.id, { discarded: checked === true })}
              />
              <FieldLabel htmlFor={`discarded-${item.id}`}>Save screenshot {index + 1} as a discarded race</FieldLabel>
            </Field>
          </>
        )}
      </div>
    );
  }
  const reportActivity = useEffectEvent(() => {
    onActivity?.(intakeActivity(items, { working, readingIds, stagingCount }));
  });
  useEffect(() => {
    reportActivity();
  }, [items, working, readingIds, stagingCount]);
  const visibleRejections = [
    ...(rejections.length ? rejections : selectionRejections),
    ...items.flatMap((item) => (item.status === "failed" && item.error ? [item.error] : [])),
  ];
  const rejectionNotice = visibleRejections.length > 0 && (
    <Alert>
      <AlertDescription>
        {visibleRejections.map((message, index) => (
          <p key={index} className="break-words">
            {message}
          </p>
        ))}
      </AlertDescription>
    </Alert>
  );
  const reviewError = error && (
    <div className="space-y-2">
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
      {reviewWriteFailed && (
        <Button
          variant="outline"
          disabled={busy || reviewWriting || preparingDraft > 0}
          onClick={() => void store(itemsRef.current, cursor.current)}
        >
          Try Saving Answers Again
        </Button>
      )}
    </div>
  );
  function addCaptureFiles(files: File[], pastedAt?: number) {
    const time = receivedImageTime(pastedAt);
    if (!files.length) return;
    setStagingCount(files.length);
    if (!recognizing.current) setReadingIds([]);
    setWorking(true);
    void onStage(files, time).then((staged) => {
      if (!alive.current) return;
      setStagingCount(0);
      if (staged !== false) {
        setSelectionRejections(staged.rejections);
        if (staged.files.length) void select(staged.files);
        else setWorking(recognizing.current);
      } else setWorking(recognizing.current);
    });
  }
  useImperativeHandle(intakeRef, () => ({ addCaptureFiles }));
  const picker = (
    <input
      ref={pickerRef}
      aria-label="Select screenshots"
      type="file"
      multiple
      accept="image/png,image/jpeg,image/webp"
      hidden
      disabled={busy}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        addCaptureFiles(files);
      }}
    />
  );
  const selected = items.find((item) => item.id === reviewing);
  if (open && editingDraft && selected?.capture && selected.draft) {
    const { existing, number, participants, canonical, capture, race } = prepareIntakeReview(
      mogi,
      selected,
      selected.capture,
    );
    return (
      <Sheet
        kind="detail"
        title="Saved Result Edit"
        open={open}
        onOpenChange={onOpenChange}
        onBack={() => setEditingDraft(false)}
      >
        {rejectionNotice}
        {navigation(selected)}
        <MetadataGroup>
          <MetadataBadge label="File">{selected.file.name}</MetadataBadge>
        </MetadataGroup>
        <NameReview
          key={`${selected.id}:${selected.number}:${selected.association}`}
          mogi={{
            ...mogi,
            participants,
            captures: [capture, ...(mogi.captures ?? [])],
          }}
          preserveResult={!!canonical && existing?.origin === "manual"}
          race={prepareRaceForReview(mogi, race)}
          capture={capture}
          busy={busy}
          disabled={
            (selected.association === "new" && selected.numberKnown === false) ||
            !selected.association ||
            (identicalDuplicate(selected) && selected.association === "new")
          }
          context={
            <div role="group" aria-label="Screenshot answers" aria-busy={reviewWriting || preparingDraft > 0}>
              {association(selected)}
              {reviewWriting && (
                <p role="status" className="text-sm text-muted-foreground">
                  Saving answers…
                </p>
              )}
              {reviewError}
              {!!mogi.substitutions?.length && (
                <p className="text-sm text-muted-foreground">
                  Players in race {number} at the time: {participants.map((person) => person.loungeName).join(", ")}.
                  Check the numbering and who is who.
                </p>
              )}
              {race.participationReview && (
                <Alert>
                  <AlertDescription>{race.participationReview}</AlertDescription>
                </Alert>
              )}
            </div>
          }
          initialFields={selected.draft?.fields}
          onChange={(fields) => updateFields(selected, race, fields)}
          onSaveContext={async (fields) => {
            if (!(await pendingWrites.current) && !(await store(itemsRef.current, cursor.current))) return;
            const success = await onSaveContext(capture, fields, existing?.id, selected.sharedFileId, selected.id);
            if (!success) return;
            patch(
              selected.id,
              { status: "saved", sourceCaptureId: capture.id, sharedFileId: undefined, draft: undefined },
              false,
            );
            const next = nextPendingItem(itemsRef.current, selected.id);
            if (next) {
              cursor.current = next.id;
              setReviewing(next.id);
            } else onCancel();
          }}
          onSave={async (reviewed, nameAssociations, numericAnswers, editedResult) => {
            setError("");
            const problem = newRaceProblem(mogi, selected, existing);
            if (problem !== null) {
              setError(problem);
              return;
            }
            await acceptCapture(
              selected,
              reviewed,
              {
                ...capture,
                nameAssociations,
                numericAnswers,
                reviewedPlacements: reviewed.placements,
                reviewedAt: new Date().toISOString(),
              },
              !!canonical && !editedResult,
            );
          }}
          onCancel={() => void leave()}
        />
      </Sheet>
    );
  }
  return (
    <section className="space-y-3" aria-label="Mogi screenshots">
      {picker}
      {rejectionNotice}
      {reviewError}
      <Sheet kind="detail" title="Screenshots" open={open} onOpenChange={onOpenChange}>
        {items
          .filter((item) => item.status !== "saved")
          .map((item) => (
            <div key={item.id} className="space-y-3">
              <p className="break-all font-semibold">{item.file.name}</p>
              <p role="status">
                {item.progress ||
                  {
                    waiting: "Waiting",
                    processing: "Reading",
                    ready: "Waiting for review",
                    failed: "Reading failed",
                    cancelled: "Reading stopped",
                    saved: "Saved",
                  }[item.status]}
              </p>
              {item.draft && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    navigate(item.id);
                    setEditingDraft(true);
                  }}
                >
                  Resume Saved Result Edit
                </Button>
              )}
              {item.error && (
                <Alert variant="destructive">
                  <AlertDescription>{item.error}</AlertDescription>
                </Alert>
              )}
              {renderPendingActions?.(item.id, item.file.name)}
            </div>
          ))}
        {!items.some((item) => item.status !== "saved") && <p>All screenshots read</p>}
        {!working && items.some((item) => !item.capture && item.status !== "saved") && (
          <Button
            disabled={busy}
            onClick={() => void recognize(itemsRef.current.filter((item) => !item.capture && item.status !== "saved"))}
          >
            Continue Reading
          </Button>
        )}
        {working && (
          <Button variant="outline" onClick={() => stop.current.abort()}>
            Stop Reading
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => void leave()}>
          Done
        </Button>
      </Sheet>
    </section>
  );
}
