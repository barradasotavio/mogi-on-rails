"use client";

import { observedGroupTotal, observedMemberTotal, screenProperties, teamCaptureQuestions } from "@mkw/engine";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Capture, Mogi, RaceReviewFields } from "@/lib/mogi/types";

import { NumericQuestion } from "./numeric-question";

export function TeamCaptureSummary({ capture }: { capture: Capture }) {
  const before =
    screenProperties(capture.interpretation?.screen)?.gameTeamGroups &&
    screenProperties(capture.interpretation?.screen)?.moment === "before";
  if (!before && !screenProperties(capture.interpretation?.screen)?.teamTotals) return null;
  return (
    <section aria-label={before ? "Groups before the race" : "Teams on the screenshot"} className="space-y-3 text-sm">
      <p>{before ? "Groups before the race · no finish order" : "Groups and game totals · no finish order"}</p>
      {capture.interpretation?.groups?.map((group, index) => (
        <div key={index} className="space-y-1">
          <p className="font-semibold">
            {group.label ?? `Group ${index + 1}`}
            {!before && (
              <>
                {" "}
                · total {observedGroupTotal(capture, index + 1) ?? group.total?.text ?? "not read"}
                {group.total?.uncertain && !capture.groupTotalAnswers?.some((answer) => answer.group === index + 1)
                  ? " · uncertain reading"
                  : ""}
              </>
            )}
          </p>
          {!before && (
            <Disclosure title="Show Readings">
              <p className="text-muted-foreground">
                {group.total?.alternatives
                  ?.map((part) => `${part.text || "unreadable"} (${part.confidence}%)`)
                  .join(" / ")}
              </p>
            </Disclosure>
          )}
          <ul>
            {group.rows.map((row) => {
              const reading = capture.numericRows?.find((reading) => reading.row === row)?.right;
              const answer = capture.numericAnswers?.find((answer) => answer.row === row);
              return (
                <li key={row}>
                  {capture.rows[row - 1]?.text || "Name not read"} · {answer?.value ?? reading?.text ?? "not read"}
                  {!answer && reading?.uncertain ? " · uncertain reading" : ""}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p>
        {before
          ? "The game's colors don't change the Lounge teams or points."
          : "The game's colors and totals don't change the Lounge teams or points."}
      </p>
    </section>
  );
}

function GroupTotalQuestion({
  group,
  value,
  busy,
  onAnswer,
}: {
  group: number;
  value?: number;
  busy: boolean;
  onAnswer: (value: number | null) => void;
}) {
  const [answer, setAnswer] = useState(value === undefined ? "" : String(value));
  const valid = /^\d+$/.test(answer) && Number(answer) <= 9999;
  return (
    <div className="space-y-2">
      <Field>
        <FieldLabel htmlFor={`group-total-${group}`}>Group {group} total</FieldLabel>
        <Input
          id={`group-total-${group}`}
          type="number"
          min="0"
          max="9999"
          value={answer}
          disabled={busy}
          onChange={(event) => setAnswer(event.target.value)}
        />
      </Field>
      <Button disabled={busy || !valid} onClick={() => onAnswer(Number(answer))}>
        Use Group {group} Total
      </Button>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setAnswer("");
          onAnswer(null);
        }}
      >
        Not Sure of Group {group} Total
      </Button>
    </div>
  );
}

export function TeamEvidenceReview({
  mogi,
  capture,
  fields,
  busy,
  onChange,
}: {
  mogi: Mogi;
  capture: Capture;
  fields: RaceReviewFields;
  busy: boolean;
  onChange: (fields: RaceReviewFields) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [editingMember, setEditingMember] = useState<number | null>(null);
  if (!screenProperties(capture.interpretation?.screen)?.teamTotals) return null;
  const current = {
    ...capture,
    nameAssociations: fields.nameAssociations,
    numericAnswers: fields.numericAnswers,
    groupTotalAnswers: fields.groupTotalAnswers,
  };
  const questions = teamCaptureQuestions(mogi, current);
  return (
    <Card role="region" aria-label="Team totals">
      <CardContent>
        {questions.map((question) => (
          <Alert
            key={`${question.group}:${question.kind}`}
            role={question.kind === "sum" || question.kind === "team" ? "alert" : "status"}
          >
            <AlertDescription>{question.message}</AlertDescription>
          </Alert>
        ))}
        {!questions.length && <p>The group totals match the players' game totals and the Lounge teams.</p>}
        {capture.interpretation?.groups?.map((group, index) => (
          <Collapsible
            key={index}
            open={editing === index + 1}
            onOpenChange={(open) => {
              setEditing(open ? index + 1 : null);
              setEditingMember(null);
            }}
          >
            <CollapsibleTrigger asChild>
              <Button variant="ghost" disabled={busy}>
                Check Group {index + 1} Total
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent forceMount hidden={editing !== index + 1}>
              <div className="space-y-3 py-3">
                <GroupTotalQuestion
                  group={index + 1}
                  value={observedGroupTotal(current, index + 1)}
                  busy={busy}
                  onAnswer={(value) => {
                    const remaining = (fields.groupTotalAnswers ?? []).filter((answer) => answer.group !== index + 1);
                    onChange({
                      ...fields,
                      groupTotalAnswers: value === null ? remaining : [...remaining, { group: index + 1, value }],
                    });
                    setEditing(null);
                    setEditingMember(null);
                  }}
                />
                <p>If the total is readable, check a player's game total.</p>
                {group.rows
                  .filter((row) => !capture.numericRows?.find((reading) => reading.row === row)?.right.uncertain)
                  .map((row) => (
                    <Collapsible
                      key={row}
                      open={editingMember === row}
                      onOpenChange={(open) => setEditingMember(open ? row : null)}
                    >
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          aria-label={`Check Game Total · ${capture.rows[row - 1]?.text || `Row ${row}`}, row ${row}`}
                        >
                          Check Game Total · {capture.rows[row - 1]?.text || `Row ${row}`}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent forceMount hidden={editingMember !== row}>
                        <NumericQuestion
                          row={row}
                          value={observedMemberTotal(current, row)}
                          busy={busy}
                          onAnswer={(value) => {
                            const remaining = (fields.numericAnswers ?? []).filter((answer) => answer.row !== row);
                            onChange({
                              ...fields,
                              numericAnswers:
                                value === null ? remaining : [...remaining, { row, field: "right", value }],
                            });
                            setEditingMember(null);
                          }}
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </CardContent>
    </Card>
  );
}
