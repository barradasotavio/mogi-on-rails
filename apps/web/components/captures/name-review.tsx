"use client";

import { initialRaceReview, reviewedRace, screenProperties } from "@mkw/engine";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { RaceEditor } from "@/components/race-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { useSheetPage } from "@/components/ui/sheet";
import type { Capture, Mogi, NameAssociation, NumericAnswer, Race, RaceReviewFields } from "@/lib/mogi/types";

import { CaptureImage } from "./capture-image";
import { CaptureInterpretationSummary } from "./capture-interpretation";
import { NextTrackQuestion } from "./next-track-question";
import { NumericQuestion } from "./numeric-question";
import { TeamEvidenceReview } from "./team-evidence";

export function NameReview({
  automatic = false,
  preserveResult = false,
  mogi,
  race,
  capture,
  initialFields,
  busy,
  disabled,
  context,
  onChange,
  onSave,
  onSaveContext,
  onCancel,
}: {
  preserveResult?: boolean;
  automatic?: boolean;
  mogi: Mogi;
  race: Race;
  capture: Capture;
  initialFields?: RaceReviewFields;
  busy: boolean;
  disabled: boolean;
  context: ReactNode;
  onChange: (fields: RaceReviewFields) => void | Promise<unknown>;
  onSave: (
    race: Race,
    associations: NameAssociation[],
    numericAnswers?: NumericAnswer[],
    editedResult?: boolean,
  ) => Promise<unknown>;
  onSaveContext?: (fields: RaceReviewFields) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<RaceReviewFields & { nameAssociations: NameAssociation[] }>(() => ({
    ...(initialFields ?? initialRaceReview(race)),
    numericAnswers: initialFields?.numericAnswers ?? capture.numericAnswers,
    nextTrackAnswer: initialFields ? initialFields.nextTrackAnswer : capture.nextTrackAnswer,
    groupTotalAnswers: initialFields?.groupTotalAnswers ?? capture.groupTotalAnswers,
    nameAssociations:
      initialFields?.nameAssociations ??
      capture.nameAssociations ??
      (capture.reviewedAt &&
      capture.reviewedPlacements.length === capture.rows.length &&
      new Set(capture.reviewedPlacements).size === capture.rows.length
        ? capture.reviewedPlacements.map((participantId, index) => ({
            participantId,
            ...(capture.rows[index]?.text.trim() ? { ign: capture.rows[index].text.trim() } : {}),
          }))
        : capture.rows.map((row) => ({
            participantId: row.uncertain ? null : row.suggestedParticipantId,
            ...(row.uncertain || !row.text.trim() ? {} : { ign: row.text.trim() }),
          }))),
  }));
  const [numericRow, setNumericRow] = useState("");
  const [numericOpen, setNumericOpen] = useState(false);
  const [editResult, setEditResult] = useState(false);
  const associations = fields.nameAssociations;
  const eligible = new Set(mogi.participants.map((person) => person.id));
  const pending = associations.filter((item) => !item.participantId || !eligible.has(item.participantId)).length;
  const changed = useRef(0);
  const pendingChange = useRef<Promise<unknown>>(Promise.resolve());
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function change(next: typeof fields) {
    changed.current++;
    setFields(next);
    pendingChange.current = Promise.resolve(onChange(next));
  }
  const finishOrder = screenProperties(capture.interpretation?.screen)?.order === "finishOrder";
  const notFinishOrder =
    !!capture.context ||
    (!!capture.interpretation &&
      !["finishOrder", "unknown"].includes(screenProperties(capture.interpretation.screen).order));
  const validated = reviewedRace(race, fields, mogi.participants);
  const attempted = useRef("");
  const acceptDetermined = useEffectEvent(() => {
    if (!automatic || !finishOrder || disabled || busy || pending || !validated) return;
    const signature = JSON.stringify([race.number, associations, fields.rawOverrides, fields.numericAnswers]);
    if (attempted.current === signature) return;
    attempted.current = signature;
    const revision = changed.current;
    void (async () => {
      await pendingChange.current;
      if (!active.current || changed.current !== revision) return;
      await onSave(validated, associations, fields.numericAnswers);
    })();
  });
  useEffect(() => {
    acceptDetermined();
  }, [automatic, finishOrder, disabled, busy, pending, fields]);
  useSheetPage(editResult ? { page: null } : { page: "review", title: "Review Screenshot", footer: false });
  if (editResult)
    return (
      <RaceEditor
        mogi={mogi}
        race={race}
        initialFields={fields}
        busy={busy}
        confirmationDisabled={disabled || pending > 0}
        reviewContext={context}
        onDraftChange={(next) => change({ ...next, nameAssociations: associations })}
        onSave={(edited) => onSave(edited, associations, fields.numericAnswers, true)}
        onBack={() => setEditResult(false)}
      />
    );
  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <CaptureImage original={capture.original} />
      {context}
      <CaptureInterpretationSummary
        capture={{
          ...capture,
          nameAssociations: associations,
          nextTrackAnswer: fields.nextTrackAnswer,
          numericAnswers: fields.numericAnswers,
          groupTotalAnswers: fields.groupTotalAnswers,
        }}
      />
      {capture.interpretation?.nextTrack && (
        <NextTrackQuestion
          reading={capture.interpretation.nextTrack}
          value={fields.nextTrackAnswer}
          busy={busy}
          onAnswer={(value) => change({ ...fields, nextTrackAnswer: value })}
        />
      )}
      {screenProperties(capture.interpretation?.screen)?.cumulative === "final" &&
        capture.numericRows?.some((row) => row.right.uncertain) && (
          <Card role="region" aria-label="Uncertain numbers">
            <CardContent>
              <p className="text-sm">Confirm only numbers you can read.</p>
              {capture.numericRows
                .filter((row) => row.right.uncertain)
                .map((row) => {
                  const answer = fields.numericAnswers?.find((answer) => answer.row === row.row);
                  return (
                    <div key={row.row} className="space-y-2">
                      <p className="text-sm">
                        Row {row.row} · read as {row.right.text || "unreadable"}
                        {row.right.alternatives
                          ? ` · alternatives: ${row.right.alternatives.map((part) => part.text || "unreadable").join(" / ")}`
                          : ""}
                      </p>
                      <NumericQuestion
                        row={row.row}
                        value={answer?.value}
                        busy={busy}
                        onAnswer={(value) => {
                          const remaining = (fields.numericAnswers ?? []).filter((part) => part.row !== row.row);
                          change({
                            ...fields,
                            numericAnswers:
                              value === null ? remaining : [...remaining, { row: row.row, field: "right", value }],
                          });
                        }}
                      />
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        )}
      {screenProperties(capture.interpretation?.screen)?.cumulative === "final" &&
        capture.numericRows?.some((row) => !row.right.uncertain) && (
          <Card>
            <CardContent>
              <Disclosure title="Correct a Game Total" open={numericOpen} onOpenChange={setNumericOpen}>
                <Field>
                  <FieldLabel htmlFor="name-review-1">Row</FieldLabel>
                  <NativeSelect
                    id="name-review-1"
                    aria-label="Row to correct"
                    value={numericRow}
                    disabled={busy}
                    onChange={(event) => setNumericRow(event.target.value)}
                  >
                    <option value="">Choose the number to correct</option>
                    {capture.numericRows
                      .filter((row) => !row.right.uncertain)
                      .map((row) => (
                        <option key={row.row} value={row.row}>
                          Row {row.row} · {capture.rows[row.row - 1]?.text} ·{" "}
                          {fields.numericAnswers?.find((answer) => answer.row === row.row)?.value ?? row.right.value}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
                {numericRow && (
                  <>
                    <NumericQuestion
                      key={numericRow}
                      row={Number(numericRow)}
                      value={
                        fields.numericAnswers?.find((answer) => answer.row === Number(numericRow))?.value ??
                        capture.numericRows.find((row) => row.row === Number(numericRow))?.right.value ??
                        undefined
                      }
                      busy={busy}
                      onAnswer={(value) =>
                        change({
                          ...fields,
                          numericAnswers:
                            value === null
                              ? (fields.numericAnswers ?? []).filter((answer) => answer.row !== Number(numericRow))
                              : [
                                  ...(fields.numericAnswers ?? []).filter(
                                    (answer) => answer.row !== Number(numericRow),
                                  ),
                                  { row: Number(numericRow), field: "right", value },
                                ],
                        })
                      }
                    />
                  </>
                )}
              </Disclosure>
            </CardContent>
          </Card>
        )}
      <TeamEvidenceReview
        mogi={mogi}
        capture={capture}
        fields={fields}
        busy={busy}
        onChange={(next) => change({ ...next, nameAssociations: next.nameAssociations ?? associations })}
      />
      {pending === 0 && !notFinishOrder && (
        <Card>
          <CardContent>
            {preserveResult && <p className="text-sm">Places edited by hand are kept.</p>}
            {!finishOrder && (
              <>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`finish-order-${capture.id}`}
                    checked={fields.reviewed}
                    disabled={busy}
                    onCheckedChange={(checked) => change({ ...fields, reviewed: checked === true })}
                  />
                  <FieldLabel htmlFor={`finish-order-${capture.id}`}>This screenshot shows the finish order</FieldLabel>
                </Field>
              </>
            )}
            <Button variant="outline" disabled={busy} onClick={() => setEditResult(true)}>
              Edit Full Result
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="flex items-center gap-3">
        {(notFinishOrder || capture.context) && onSaveContext && (
          <Button
            disabled={busy}
            onClick={() => {
              void (async () => {
                await pendingChange.current;
                if (active.current) await onSaveContext(fields);
              })();
            }}
          >
            Save Screenshot
          </Button>
        )}
        {!notFinishOrder && (
          <Button
            disabled={busy || disabled || pending > 0 || (!fields.reviewed && !finishOrder) || !validated}
            onClick={() => {
              if (validated) void onSave(validated, associations, fields.numericAnswers);
            }}
          >
            {preserveResult ? "Save Screenshot Corrections" : "Accept Result"}
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
