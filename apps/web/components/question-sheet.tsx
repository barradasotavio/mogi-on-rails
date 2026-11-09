"use client";

import { captureRowBounds, type NameQuestion } from "@mkw/engine";
import { useEffect, useRef, useState } from "react";

import { CaptureViewer, CaptureViewerTrigger } from "@/components/ui/capture-viewer";
import { ChoiceChips, ListRadioGroup } from "@/components/ui/choice";
import { GlassButton } from "@/components/ui/glass-button";
import { Input } from "@/components/ui/input";
import { ListGroup } from "@/components/ui/list";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { captureLabel, chronological } from "@/lib/mogi/capture-label";
import { reviewFile } from "@/lib/mogi/capture-review";
import { positionShots } from "@/lib/mogi/position-shots";
import { type MogiQuestion, type MogiQuestionAnswer, mogiQuestions } from "@/lib/mogi/questions";
import type { Capture, Mogi, SharedFile } from "@/lib/mogi/types";
import { settled } from "@/lib/settled";

const SUB = "__substitute";

function nameOccurrenceNote(question: NameQuestion) {
  if (!question.occurrences.length) return null;
  const numbers = [
    ...new Set(
      question.occurrences.flatMap((entry) =>
        entry.number === undefined || entry.number === question.number ? [] : [entry.number],
      ),
    ),
  ].sort((a, b) => a - b);
  if (
    question.number !== undefined &&
    question.occurrences.every((entry) => entry.number !== undefined) &&
    numbers.length
  ) {
    const races =
      numbers.length === 1 ? String(numbers[0]) : `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
    return `Also in ${numbers.length === 1 ? "race" : "races"} ${races}`;
  }
  return `Also in ${question.occurrences.length} other ${question.occurrences.length === 1 ? "screenshot" : "screenshots"}`;
}

export function QuestionSheet({
  mogi,
  pendingFiles,
  open,
  onOpenChange,
  busy,
  onAnswer,
  onCloseAutoFocus,
  initialQuestionId,
}: {
  mogi: Mogi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  pendingFiles: SharedFile[];
  onAnswer: (question: MogiQuestion, answer: MogiQuestionAnswer) => Promise<boolean>;
  onCloseAutoFocus: (event: Event) => void;
  initialQuestionId?: string;
}) {
  const questions = mogiQuestions(mogi);
  const [saving, setSaving] = useState(false);
  const locked = busy || saving;
  const [session, setSession] = useState({
    open: false,
    answered: 0,
    total: questions.length,
    deferred: [] as string[],
  });
  if (session.open !== open)
    setSession({ open, answered: open ? 0 : session.answered, total: questions.length, deferred: [] });
  const total = Math.max(1, session.total, session.answered + questions.length);
  if (open && !locked && total !== session.total) setSession({ ...session, total });
  // The session counts answers and keeps the deferred ids; the engine recomputes the queue on every fact.
  const priority = (question: MogiQuestion) =>
    session.deferred.includes(question.id)
      ? session.deferred.indexOf(question.id)
      : question.kind === "image"
        ? -3
        : question.id === initialQuestionId
          ? -2
          : -1;
  const ordered = [...questions].sort((a, b) => priority(a) - priority(b));
  const current = ordered[0];
  const [presentation, setPresentation] = useState({ question: current, mogi, pendingFiles, index: 1, total });
  if (
    !locked &&
    current &&
    (JSON.stringify(current) !== JSON.stringify(presentation.question) ||
      presentation.index !== session.answered + 1 ||
      presentation.total !== total)
  )
    setPresentation({ question: current, mogi, pendingFiles, index: session.answered + 1, total });
  const shown = presentation.question;
  const toast = useToast();
  useEffect(() => {
    if (open && !locked && !questions.length) onOpenChange(false);
  }, [open, locked, questions.length, onOpenChange]);
  if (!shown) return null;
  const item =
    shown.kind === "image"
      ? presentation.mogi.captureReview?.items.find((item) => item.id === shown.itemId)
      : undefined;
  const file = item && reviewFile(item, presentation.mogi, presentation.pendingFiles);
  const capture: Capture | undefined =
    item?.recognition && file
      ? { ...item.recognition, original: file.original, reviewedAt: "", reviewedPlacements: [] }
      : presentation.mogi.captures?.find((capture) => capture.id === shown.captureId);
  // A question comparing two captures shows both, in chronological order, each with its moment.
  const comparedIds = shown.kind === "image" ? [] : (shown.captureIds ?? []);
  const compared =
    shown.crop && comparedIds.length === 2
      ? comparedIds
          .map((id) => presentation.mogi.captures?.find((capture) => capture.id === id))
          .filter((capture) => !!capture)
      : [];
  const shots: Shot[] =
    compared.length === 2
      ? chronological(presentation.mogi, compared).map((capture) => ({
          capture,
          label: captureLabel(presentation.mogi, capture),
          row:
            capture.id === shown.captureId || shown.kind !== "name"
              ? shown.row
              : (shown.occurrences.find((entry) => entry.captureId === capture.id)?.row ?? shown.row),
        }))
      : capture && shown.crop
        ? [{ capture, row: shown.row }]
        : shown.kind === "position"
          ? positionShots(presentation.mogi, shown)
          : [];
  return (
    <QuestionPage
      question={shown}
      index={presentation.index}
      shots={shots}
      busy={locked}
      open={open && (!!current || locked)}
      title={`Question ${presentation.index} of ${Math.max(presentation.index, presentation.total)}`}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      onAnswer={async (answer) => {
        if (locked) return false;
        setSaving(true);
        return settled(
          async () => {
            const accepted = await onAnswer(shown, answer);
            if (accepted) setSession((value) => ({ ...value, answered: value.answered + 1 }));
            return accepted;
          },
          () => {
            setSaving(false);
          },
        );
      }}
      onSkip={() => {
        if (questions.every((question) => question.id === shown.id || session.deferred.includes(question.id))) {
          onOpenChange(false);
          toast("Question left for later");
          return;
        }
        setSession((value) => ({ ...value, deferred: [...value.deferred.filter((id) => id !== shown.id), shown.id] }));
      }}
    />
  );
}

interface Shot {
  capture: Capture;
  /** The row to crop to; without one, the whole screenshot. */
  row?: number;
  label?: string;
}

function QuestionPage({
  question,
  index,
  shots,
  open,
  title,
  onOpenChange,
  onCloseAutoFocus,
  onAnswer,
  onSkip,
  busy,
}: {
  question: MogiQuestion;
  /** The question's place in this session; a question that returns after an answer is a new page. */
  index: number;
  shots: Shot[];
  open: boolean;
  title: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
  onAnswer: (answer: MogiQuestionAnswer) => Promise<boolean>;
  onSkip: () => void;
}) {
  const [choice, setChoice] = useState(String(question.suggestion ?? ""));
  const [otherRace, setOtherRace] = useState(false);
  const [subName, setSubName] = useState("");
  const [replaced, setReplaced] = useState<string | null>(null);
  // A contradicted total returns as the same question with a new index, so the field starts empty again.
  const pageKey = `${question.id}:${index}`;
  const [page, setPage] = useState(pageKey);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) setWasOpen(open);
  const available =
    question.kind === "points" ||
    (choice === SUB && question.kind === "name" && !!question.number) ||
    (question.kind === "race" ? [...question.options, ...(question.otherRaces ?? [])] : question.options).some(
      (option) =>
        String("id" in option ? option.id : option.value) === choice && !("disabled" in option && option.disabled),
    );
  // Reopening the same question starts from the current suggestion, without reusing an earlier draft.
  const entering = page !== pageKey || (open && !wasOpen);
  // If another answer took the displayed choice, the user chooses again before confirming.
  if (entering || (choice && !available)) {
    setPage(pageKey);
    setChoice(entering ? String(question.suggestion ?? "") : "");
    setSubName("");
    setReplaced(null);
    setOtherRace(false);
  }
  const ready =
    question.kind === "points"
      ? /^\d+$/.test(choice) && Number(choice) <= 9999
      : choice === SUB
        ? !!question.number && !!subName.trim() && !!replaced
        : !!choice;
  const whole = question.kind === "image" || question.kind === "race" || question.kind === "sequence";
  const heading =
    question.kind === "image"
      ? "Is this screenshot from this mogi?"
      : question.kind === "name"
        ? `Who is “${question.reading}”?`
        : question.kind === "race"
          ? otherRace
            ? "Which race is this?"
            : question.reading
          : question.kind === "sequence"
            ? question.reading
            : question.kind === "credit"
              ? `Who gets credit for ${question.reading}?`
              : question.kind === "points"
                ? `What's the total for “${question.reading}” on this screenshot?`
                : question.kind === "team"
                  ? `Which team is “${question.reading}” on?`
                  : `Where did “${question.reading}” finish?`;
  function confirm() {
    if (question.kind === "name")
      return onAnswer({
        kind: "name",
        answer:
          choice === SUB
            ? { substitute: { loungeName: subName.trim(), replacedParticipantId: replaced! } }
            : { participantId: choice },
      });
    if (
      question.kind === "image" ||
      question.kind === "team" ||
      question.kind === "sequence" ||
      question.kind === "credit"
    )
      return onAnswer({ kind: question.kind, value: choice });
    if (question.kind === "position")
      return onAnswer({ kind: "position", value: choice === "absent" ? "absent" : Number(choice) });
    if (question.kind === "race")
      return onAnswer({ kind: "race", value: choice === "reopening" ? "reopening" : Number(choice) });
    return onAnswer({ kind: question.kind, value: Number(choice) });
  }
  return (
    <Sheet
      kind="modal"
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      page={question.id}
      onCloseAutoFocus={onCloseAutoFocus}
      footer={
        <div className="flex flex-col gap-2">
          <GlassButton shape="pill" tint className="w-full" disabled={busy || !ready} onClick={() => void confirm()}>
            Confirm
          </GlassButton>
          <GlassButton shape="pill" className="w-full" disabled={busy} onClick={onSkip}>
            Not Sure
          </GlassButton>
        </div>
      }
    >
      <div className="flex flex-col gap-6 pb-8">
        {shots.length > 0 && (
          <CaptureViewer
            images={shots.map((shot) => ({
              original: shot.capture.original,
              alt: shot.label ?? "Screenshot",
              label: shot.label,
            }))}
          >
            <div className="flex flex-col gap-3">
              {shots.map((shot, index) => (
                <figure key={shot.capture.id} className="flex flex-col gap-1.5">
                  {/* Two screenshots with the same caption share the first one's. */}
                  {shot.label && shot.label !== shots[index - 1]?.label && (
                    <figcaption className="text-sm text-muted-foreground">{shot.label}</figcaption>
                  )}
                  <CaptureViewerTrigger index={index} label={shot.label ? `Enlarge ${shot.label}` : undefined}>
                    <CaptureRowCrop
                      capture={shot.capture}
                      row={shot.row ?? 0}
                      whole={whole || shot.row === undefined}
                    />
                  </CaptureViewerTrigger>
                </figure>
              ))}
            </div>
          </CaptureViewer>
        )}
        <div>
          <p className="text-lg font-semibold">{heading}</p>
          {question.kind === "image" && (
            <p className="text-sm text-muted-foreground">It looks like {question.otherMogi}.</p>
          )}
          {question.kind === "name" && question.occurrences.length > 0 && (
            <p className="text-sm text-muted-foreground">{nameOccurrenceNote(question)}</p>
          )}
        </div>
        {question.kind === "points" ? (
          <ListGroup title="Points">
            <Input
              variant="filled"
              aria-label="Points"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={choice}
              disabled={busy}
              onChange={(event) => setChoice(event.target.value)}
            />
          </ListGroup>
        ) : (
          <ListRadioGroup
            aria-label={heading}
            value={choice}
            onValueChange={(value) => {
              if (question.kind === "race" && value === "another") {
                setOtherRace(true);
                setChoice(String(question.otherRaces?.[0]?.value ?? ""));
              } else setChoice(value);
            }}
            options={[
              ...(question.kind === "race" && otherRace ? (question.otherRaces ?? []) : question.options).map(
                (option) => ({
                  value: String("id" in option ? option.id : option.value),
                  label: "loungeName" in option ? option.loungeName : option.label,
                  disabled: busy || ("disabled" in option && option.disabled === true),
                  description:
                    question.kind === "credit" && "value" in option && option.value === question.suggestion
                      ? question.reason
                      : undefined,
                  trail:
                    ("id" in option ? option.id : option.value) === question.suggestion ? (
                      <span className="text-xs">Suggested</span>
                    ) : undefined,
                }),
              ),
              ...(question.kind === "name"
                ? [{ value: SUB, label: "Someone who subbed in", disabled: busy || !question.number }]
                : []),
            ]}
          />
        )}
        {question.kind === "name" && choice === SUB && (
          <div className="flex flex-col gap-6 motion-safe:animate-in motion-safe:fade-in duration-300">
            <ListGroup title="Sub's Lounge name">
              <Input
                variant="filled"
                aria-label="Sub's Lounge name"
                placeholder="As shown on the Lounge"
                maxLength={80}
                value={subName}
                disabled={busy}
                onChange={(event) => setSubName(event.target.value)}
              />
            </ListGroup>
            <ListGroup
              title="Subbed in for"
              note={`The sub counts from race ${question.number}; earlier races stay with the player who left.`}
            >
              <ChoiceChips
                aria-label="Subbed in for"
                value={replaced}
                onValueChange={setReplaced}
                options={question.options.map((person) => ({
                  value: person.id,
                  label: person.loungeName,
                  disabled: busy,
                }))}
              />
            </ListGroup>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function CaptureRowCrop({ capture, row, whole }: { capture: Capture; row: number; whole: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bounds = captureRowBounds(capture, row, 3);
  const { x, y } = bounds;
  const width = whole ? 960 : bounds.width,
    height = whole ? 540 : bounds.height;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    if (!capture.original) return;
    void createImageBitmap(capture.original)
      .then((image) => {
        if (active)
          canvas.current
            ?.getContext("2d")
            ?.drawImage(
              image,
              whole ? 0 : (x * image.width) / 1920,
              whole ? 0 : (y * image.height) / 1080,
              whole ? image.width : (width * image.width) / 1920,
              whole ? image.height : (height * image.height) / 1080,
              0,
              0,
              width,
              height,
            );
        image.close();
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [capture.original, x, y, width, height, whole]);
  if (!capture.original)
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
        Screenshot deleted to free space.
      </div>
    );
  return (
    <canvas
      ref={canvas}
      width={width}
      height={height}
      role="img"
      aria-label={whole ? "Screenshot" : `Screenshot row ${row}`}
      className="w-full rounded-lg bg-black"
    >
      {failed ? "The screenshot could not be opened." : `Screenshot row ${row}`}
    </canvas>
  );
}
