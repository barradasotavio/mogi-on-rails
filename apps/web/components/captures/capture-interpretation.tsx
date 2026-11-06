import { captureNumericQuestions, screenProperties } from "@mkw/engine";

import { Card, CardContent } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import type { Capture } from "@/lib/mogi/types";

import { TeamCaptureSummary } from "./team-evidence";

export function CaptureInterpretationSummary({ capture }: { capture: Capture }) {
  const reading = capture.interpretation;
  if (!reading) return null;
  const pending = captureNumericQuestions(capture).length;
  return (
    <Card role="region" aria-label="Screenshot reading">
      <CardContent>
        <p className="font-semibold">{screenProperties(reading.screen).name}</p>
        <p>
          {screenProperties(reading.screen).moment === "before"
            ? "Game totals before the race"
            : screenProperties(reading.screen).cumulative === "final"
              ? "Final game totals"
              : "Game totals not yet proven final"}
        </p>
        {capture.rows.length < 12 && (
          <p>Partial screenshot: {capture.rows.length} rows. Missing rows don't make anyone absent.</p>
        )}
        {capture.nextTrackAnswer ? (
          <p>Next track: {capture.nextTrackAnswer} · for the following race</p>
        ) : (
          reading.nextTrack && (
            <p>
              Next track: {reading.nextTrack.text || "not read"}
              {reading.nextTrack.uncertain ? " · uncertain reading" : ""} · for the following race
            </p>
          )
        )}
        {capture.context && (
          <p>
            {capture.nameAssociations?.filter((answer) => !answer.participantId).length ??
              capture.rows.filter((row) => row.uncertain).length}{" "}
            pending names. Saving the screenshot doesn't answer them.
          </p>
        )}
        {pending > 0 && (
          <p>
            {pending} {pending === 1 ? "game total" : "game totals"} not read. Another screenshot or your answer can
            settle {pending === 1 ? "it" : "them"}.
          </p>
        )}
        <TeamCaptureSummary capture={capture} />
        {capture.numericAnswers?.map((answer) => (
          <p key={answer.row}>
            Row {answer.row} · game total entered: {answer.value}
          </p>
        ))}
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
