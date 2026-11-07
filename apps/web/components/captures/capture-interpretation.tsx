import { captureNumericQuestions, screenProperties } from "@mkw/engine";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import type { Capture } from "@/lib/mogi/types";

import { TeamCaptureSummary } from "./team-evidence";

/** A label with its trailing value. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className="text-end text-muted-foreground">{children}</dd>
    </div>
  );
}

export function CaptureInterpretationSummary({ capture }: { capture: Capture }) {
  const reading = capture.interpretation;
  if (!reading) return null;
  const pending = captureNumericQuestions(capture).length;
  return (
    <Card role="region" aria-label="Screenshot reading">
      <CardContent>
        <p className="font-semibold">{screenProperties(reading.screen).name}</p>
        <dl>
          <Row label="Game totals">
            {screenProperties(reading.screen).moment === "before"
              ? "Before the race"
              : screenProperties(reading.screen).cumulative === "final"
                ? "Final"
                : "Not yet final"}
          </Row>
          {capture.rows.length < 12 && <Row label="Rows">{capture.rows.length} of 12</Row>}
          {(capture.nextTrackAnswer || reading.nextTrack) && (
            <Row label="Next track">
              {capture.nextTrackAnswer ??
                `${reading.nextTrack?.text || "Not read"}${reading.nextTrack?.uncertain ? " · uncertain" : ""}`}
            </Row>
          )}
          {capture.context && (
            <Row label="Pending names">
              {capture.nameAssociations?.filter((answer) => !answer.participantId).length ??
                capture.rows.filter((row) => row.uncertain).length}
            </Row>
          )}
          {pending > 0 && <Row label="Game totals not read">{pending}</Row>}
          {capture.numericAnswers?.map((answer) => (
            <Row key={answer.row} label={`Row ${answer.row}`}>
              {answer.value} entered
            </Row>
          ))}
        </dl>
        <TeamCaptureSummary capture={capture} />
        <Disclosure title="Show Readings">
          <ol>
            {capture.numericRows?.map((row) => (
              <li key={row.row}>
                Row {row.row} ·{" "}
                {reading.positions.length > 0 && (
                  <>
                    position {reading.positions[row.row - 1]?.text || "not read"} (
                    {reading.positions[row.row - 1]?.confidence}%
                    {reading.positions[row.row - 1]?.uncertain ? ", uncertain" : ""}):
                  </>
                )}{" "}
                {row.right.text || "not read"} ({row.right.confidence}%)
                {row.addition.text ? ` · ${row.addition.text} (${row.addition.confidence}%)` : ""}
                {row.right.uncertain || (row.addition.value !== null && row.addition.uncertain)
                  ? " · uncertain reading"
                  : ""}
                {row.right.alternatives && (
                  <span>
                    {" "}
                    · alternatives: {row.right.alternatives.map((part) => part.text || "unreadable").join(" / ")}
                  </span>
                )}
              </li>
            ))}
          </ol>
          <p>Standings moves: {reading.movementRows.join(", ") || "none"}</p>
          <p>{reading.reasons.join(" · ")}</p>
        </Disclosure>
      </CardContent>
    </Card>
  );
}
