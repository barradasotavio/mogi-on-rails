"use client";

import { answerNameQuestion, mogiQuestions, unlinkSynonym } from "@mkw/engine";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import type { Mogi } from "@/lib/mogi/types";
import { settled } from "@/lib/settled";

/** Shared with Players, including its existing Unlink action. */
export function NameReading({
  reading,
  suggested,
  busy,
  onUnlink,
}: {
  reading: string;
  suggested: boolean;
  busy: boolean;
  onUnlink: () => void;
}) {
  return (
    <ListRow
      description={suggested ? "Suggested" : "Confirmed by you"}
      trail={
        <Button
          variant="destructive-ghost"
          className="h-11"
          disabled={busy}
          aria-label={`Unlink ${reading}`}
          onClick={onUnlink}
        >
          Unlink
        </Button>
      }
    >
      Read as {reading}
    </ListRow>
  );
}

export function NameCorrection({
  mogi,
  captureId,
  row,
  busy,
  onUpdate,
  onDone,
}: {
  mogi: Mogi;
  captureId: string;
  row: number;
  busy: boolean;
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  onDone: () => void;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const capture = mogi.captures?.find((c) => c.id === captureId);
  const association = capture?.nameAssociations?.[row - 1];
  const person = mogi.participants.find((p) => p.id === association?.participantId);
  if (!capture || !person) return null;
  const reading = capture.rows[row - 1].text;
  const unlinked = unlinkSynonym(mogi, person.id, reading, true);
  const question = mogiQuestions(unlinked).find(
    (q) =>
      q.kind === "name" &&
      [q, ...q.occurrences].some((location) => location.captureId === captureId && location.row === row),
  );
  async function save(participantId?: string) {
    setError("");
    setSaving(true);
    return settled(
      async () => {
        try {
          const updated =
            participantId && question ? answerNameQuestion(unlinked, question.id, { participantId }) : unlinked;
          if (await onUpdate(updated)) onDone();
          else setError("Couldn't save this name. Try again.");
        } catch {
          setError("Couldn't save this name. Try again.");
        }
      },
      () => {
        setSaving(false);
      },
    );
  }
  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <List>
        <NameReading
          reading={reading}
          suggested={association?.origin === "deduced" || !capture.rows[row - 1].uncertain}
          busy={busy || saving}
          onUnlink={() => void save()}
        />
      </List>
      {question?.kind === "name" && (
        <ListGroup title="Choose another player">
          <List aria-label="Choose another player">
            {question.options
              .filter((option) => option.id !== person.id)
              .map((option) => (
                <ListRow key={option.id} disabled={busy || saving} onSelect={() => void save(option.id)}>
                  {option.loungeName}
                </ListRow>
              ))}
          </List>
        </ListGroup>
      )}
    </>
  );
}
