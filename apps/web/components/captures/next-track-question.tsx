"use client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CaptureInterpretation } from "@/lib/mogi/types";

export function NextTrackQuestion({
  reading,
  value,
  busy,
  onAnswer,
}: {
  reading: NonNullable<CaptureInterpretation["nextTrack"]>;
  value?: string;
  busy: boolean;
  onAnswer: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(reading.uncertain && value === undefined);
  const [draft, setDraft] = useState(value ?? reading.text);
  return (
    <Card role="region" aria-label="Next track">
      <CardContent>
        <p>The next track's name is optional and doesn't change the points.</p>
        {!open && (
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
            Check Next Track
          </Button>
        )}
        {open && (
          <div className="space-y-2">
            <Field>
              <FieldLabel htmlFor="next-track-answer">Next track</FieldLabel>
              <Input
                id="next-track-answer"
                value={draft}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
              />
            </Field>
            <Button
              disabled={busy || !draft.trim() || draft.length > 120}
              onClick={() => {
                onAnswer(draft.trim());
                setOpen(false);
              }}
            >
              Use Track Name
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                onAnswer(undefined);
                setDraft("");
                setOpen(false);
              }}
            >
              Not Sure of the Track
            </Button>
          </div>
        )}
        <Disclosure title="Show Readings">
          <ul>
            {(reading.alternatives ?? [reading]).map((part, index) => (
              <li key={index}>
                {part.text || "not read"} ({part.confidence}%)
              </li>
            ))}
          </ul>
        </Disclosure>
      </CardContent>
    </Card>
  );
}
