"use client";
import type { SequenceAnswer as SequenceAction } from "@mkw/engine";
import { analyzeCaptures, captureNeedsClarification, mogiQuestions, sequenceInputSignature } from "@mkw/engine";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import type { Capture, Mogi } from "@/lib/mogi/types";

import { CaptureImage } from "./capture-image";
import { CaptureInterpretationSummary } from "./capture-interpretation";
import { RaceNumberQuestion } from "./race-number-question";
import { SourceActions } from "./source-actions";
export function SequencePanel({
  mogi,
  busy,
  onAnswer,
  onQuestions,
  onConsult,
  onRemove,
}: {
  mogi: Mogi;
  busy: boolean;
  onAnswer: (action: SequenceAction, signature: string) => Promise<boolean>;
  onQuestions: () => void;
  onConsult: (capture: Capture, trigger: HTMLButtonElement) => void;
  onRemove: (id: string) => Promise<boolean>;
}) {
  const analysis = analyzeCaptures(mogi),
    sequence = analysis.sequence?.accepted,
    questions = analysis.questions ?? [];
  const captures = mogi.captures ?? [];
  const pendingQuestionIds = new Set(mogiQuestions(mogi).map((question) => question.id));
  if (!captures.length) return null;
  const signature = sequenceInputSignature(mogi);
  function needsAttention(capture: Capture) {
    return (
      captureNeedsClarification(mogi, capture) ||
      !!capture.contextDraft ||
      (mogi.raceDraft?.purpose === "capture" && mogi.raceDraft.sourceCaptureId === capture.id) ||
      !!mogi.captureReview?.items.some((item) => item.status !== "saved" && item.source.captureId === capture.id)
    );
  }
  const pending = captures.filter(needsAttention),
    history = captures.filter((capture) => !needsAttention(capture));
  const renderCapture = (capture: Capture) => {
    const index = captures.indexOf(capture);

    const occurrence = sequence?.occurrences.find((entry) => entry.captureIds.includes(capture.id));
    const attached = mogi.races.find((race) => race.captureIds?.includes(capture.id));
    const discarded = mogi.races.some(
      (race) => (race.id === occurrence?.id || race.id === attached?.id) && race.status === "discarded",
    );
    const number = occurrence?.number ?? attached?.number,
      before = capture.context?.phase === "before";
    const originQuestion = questions.find(
        (question) => question.kind === "origin" && question.captureId === capture.id,
      ),
      numberQuestion = questions.find((question) => question.kind === "number" && question.captureId === capture.id);
    return (
      <Card role="group" aria-label={`Screenshot ${index + 1} sequence`} key={capture.id} size="sm">
        <CardContent>
          <div className="min-w-0 space-y-3">
            <p className="break-all text-sm font-medium">{capture.fileName}</p>
            <CaptureImage original={capture.original} />
            <CaptureInterpretationSummary capture={capture} />
            <p className="text-sm">
              Screenshot {index + 1} ·{" "}
              {discarded
                ? "Discarded"
                : number
                  ? `Race ${number}${before ? " · not yet started" : " · after the race"}`
                  : "Number not yet known"}
            </p>
            {!number && !discarded && (
              <p className="text-sm text-muted-foreground">
                The totals do not prove where the mogi started.{" "}
                {before
                  ? "Enter the number of the race about to start."
                  : "Enter the number of the race that just finished."}
              </p>
            )}
            {originQuestion && (
              <Disclosure title={<> {number ? "Fix Starting Totals" : "Clarify Starting Totals"} </>}>
                <div className="space-y-2 py-3">
                  <p className="text-sm">Did these totals start at zero, with no reopening or discarded race?</p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void onAnswer({ kind: "origin", captureId: capture.id, value: "zero-valid-12" }, signature);
                    }}
                  >
                    Yes, They Started at Zero
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      void onAnswer({ kind: "origin", captureId: capture.id, value: "unknown" }, signature);
                    }}
                  >
                    Not Sure How the Totals Started
                  </Button>
                </div>
              </Disclosure>
            )}
            {numberQuestion?.mode === "pending" && (
              <Button disabled={busy} onClick={onQuestions}>
                Answer Questions
              </Button>
            )}
            {numberQuestion?.mode === "correction" && (
              <Disclosure title={<> Fix Screenshot {index + 1} Number </>}>
                <RaceNumberQuestion
                  key={`${capture.id}:${number}`}
                  number={numberQuestion.number ?? 1}
                  known
                  busy={busy}
                  onAnswer={(value) => {
                    void onAnswer({ kind: "number", captureId: capture.id, value }, signature);
                  }}
                />
              </Disclosure>
            )}
            <Button
              variant="outline"
              disabled={busy}
              aria-label={`View screenshot ${index + 1}`}
              onClick={(event) => onConsult(capture, event.currentTarget)}
            >
              View Screenshot
            </Button>
            <SourceActions label={`screenshot ${index + 1}`} busy={busy} onRemove={() => onRemove(capture.id)} />
          </div>
        </CardContent>
      </Card>
    );
  };
  return (
    <section aria-label="Screenshot sequence">
      <Card>
        <CardContent>
          <div className="min-w-0 space-y-3 break-words">
            {pending.length > 0 && <h2 className="font-semibold">Screenshots and questions</h2>}
            {sequence?.conflict && (
              <Alert variant="destructive">
                <AlertDescription>{sequence.conflict}</AlertDescription>
              </Alert>
            )}
            {pending.map(renderCapture)}
            {!!history.length && (
              <Disclosure title={<> View Saved Race Screenshots ({history.length}) </>}>
                <section aria-label="Saved race screenshots" className="space-y-3">
                  {history.map(renderCapture)}
                </section>
              </Disclosure>
            )}
            {!!sequence?.gaps.length && (
              <section aria-label="Gaps between screenshots" className="space-y-3">
                {sequence.gaps.map((gap) => {
                  const waiting = questions.some(
                    (question) => question.gapId === gap.id && pendingQuestionIds.has(question.id),
                  );
                  const link = mogi.sequence?.links.find(
                    (link) =>
                      gap.sourceCaptureIds.includes(link.fromCaptureId) &&
                      gap.sourceCaptureIds.includes(link.toCaptureId),
                  );
                  return (
                    <Card key={gap.id} size="sm">
                      <CardContent>
                        <div className="space-y-3">
                          <p className="text-sm">
                            Between{" "}
                            {gap.sourceCaptureIds
                              .map(
                                (id) => captures.find((capture) => capture.id === id)?.fileName ?? "removed screenshot",
                              )
                              .join(" and ")}{" "}
                            ·{" "}
                            {gap.count === undefined
                              ? "The gap size, order and continuity are still unknown."
                              : `${gap.count} race${gap.count === 1 ? "" : "s"} without a result`}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {gap.sourceCaptureIds.map((id) => {
                              const capture = captures.find((capture) => capture.id === id);
                              return capture ? (
                                <Button
                                  key={id}
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={(event) => onConsult(capture, event.currentTarget)}
                                >
                                  View Boundary {capture.fileName}
                                </Button>
                              ) : null;
                            })}
                          </div>
                          {waiting ? (
                            <Button disabled={busy} onClick={onQuestions}>
                              Answer Questions
                            </Button>
                          ) : (
                            <p className="text-sm">
                              {gap.validCount === undefined
                                ? "This interval still needs another screenshot."
                                : `${gap.validCount} race(s) counted in this interval.`}
                            </p>
                          )}
                          {!waiting && link?.continuity !== undefined && (
                            <Disclosure title="Edit Continuity">
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  void onAnswer(
                                    { kind: "continuity", gapId: gap.id, value: "continuous-12" },
                                    signature,
                                  );
                                }}
                              >
                                Yes, Points Carried Over
                              </Button>
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  void onAnswer({ kind: "continuity", gapId: gap.id, value: "reset" }, signature);
                                }}
                              >
                                No, the Room Reopened
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={() => {
                                  void onAnswer({ kind: "continuity", gapId: gap.id, value: "unknown" }, signature);
                                }}
                              >
                                Continuity Is Unknown
                              </Button>
                            </Disclosure>
                          )}
                          {!waiting && link?.validity !== undefined && (
                            <Disclosure title="Edit Counted Races">
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  void onAnswer({ kind: "validity", gapId: gap.id, value: "counted" }, signature);
                                }}
                              >
                                All Counted
                              </Button>
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  void onAnswer({ kind: "validity", gapId: gap.id, value: "discarded" }, signature);
                                }}
                              >
                                None Counted
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={busy}
                                onClick={() => {
                                  void onAnswer({ kind: "validity", gapId: gap.id, value: "unknown" }, signature);
                                }}
                              >
                                Not Known
                              </Button>
                            </Disclosure>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </section>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
