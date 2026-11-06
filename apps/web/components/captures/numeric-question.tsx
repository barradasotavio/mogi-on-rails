"use client";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function NumericQuestion({
  row,
  value,
  busy,
  onAnswer,
}: {
  row: number;
  value?: number;
  busy: boolean;
  onAnswer: (value: number | null) => void;
}) {
  const id = useId();
  const [answer, setAnswer] = useState(value === undefined ? "" : String(value));
  const valid = /^\d+$/.test(answer) && Number(answer) <= 9999;
  return (
    <div className="space-y-2">
      <Field>
        <FieldLabel htmlFor={id}>Game total of row {row}</FieldLabel>
        <Input
          id={id}
          type="number"
          min="0"
          max="9999"
          value={answer}
          disabled={busy}
          onChange={(event) => setAnswer(event.target.value)}
        />
      </Field>
      <Button disabled={busy || !valid || Number(answer) === value} onClick={() => onAnswer(Number(answer))}>
        Use Game Total of Row {row}
      </Button>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setAnswer("");
          onAnswer(null);
        }}
      >
        Not Sure of Row {row}
      </Button>
    </div>
  );
}
