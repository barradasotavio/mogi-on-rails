"use client";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** A partly typed number must never trigger automatic acceptance. */
export function RaceNumberQuestion({
  number,
  known,
  busy,
  onAnswer,
}: {
  number: number;
  known: boolean;
  busy: boolean;
  onAnswer: (number: number | null) => void;
}) {
  const id = useId();
  const [answer, setAnswer] = useState(known ? String(number) : "");
  const valid = /^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= 99;
  return (
    <div className="space-y-2">
      <Field>
        <FieldLabel htmlFor={id}>Which race is this?</FieldLabel>
        <Input
          id={id}
          aria-describedby={!known ? `${id}-description` : undefined}
          type="number"
          min="1"
          max="99"
          value={answer}
          disabled={busy}
          onChange={(event) => setAnswer(event.target.value)}
        />
        {!known && (
          <FieldDescription id={`${id}-description`}>
            The screenshot stays saved without a confirmed race number.
          </FieldDescription>
        )}
      </Field>
      <Button
        disabled={busy || !valid || (known && Number(answer) === number)}
        onClick={() => onAnswer(Number(answer))}
      >
        Use Number
      </Button>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setAnswer("");
          onAnswer(null);
        }}
      >
        Not Sure of the Number
      </Button>
    </div>
  );
}
