"use client";
import { type ComponentProps, type FormEvent, useState } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { GlassButton } from "@/components/ui/glass-button";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { newMogi, readLoungeRoster } from "@/lib/mogi/roster";
import type { Mogi } from "@/lib/mogi/types";

export function MogiSetup({
  open,
  onOpenChange,
  onCloseAutoFocus,
  onCreate,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: ComponentProps<typeof Sheet>["onCloseAutoFocus"];
  onCreate: (mogi: Mogi) => Promise<void>;
  busy: boolean;
}) {
  return (
    <Sheet
      kind="modal"
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title="New Mogi"
      footer={
        <GlassButton tint type="submit" form="new-mogi-form" className="w-full" disabled={busy}>
          Create
        </GlassButton>
      }
    >
      {open && <MogiSetupForm onCreate={onCreate} busy={busy} />}
    </Sheet>
  );
}

function MogiSetupForm({ onCreate, busy }: { onCreate: (mogi: Mogi) => Promise<void>; busy: boolean }) {
  const [rosterText, setRosterText] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    let parsed;
    try {
      parsed = readLoungeRoster(rosterText);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Paste the Lounge bot's full list.");
      return;
    }
    setError("");
    await onCreate(newMogi(rosterText, parsed));
  }
  return (
    <form id="new-mogi-form" onSubmit={submit}>
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="lounge-list">Lounge bot list</FieldLabel>
        <Textarea
          id="lounge-list"
          variant="filled"
          maxLength={10000}
          value={rosterText}
          onChange={(e) => setRosterText(e.target.value)}
          placeholder="Paste the full list with groups and tier"
          rows={8}
          aria-describedby={error ? "lounge-list-help lounge-list-error" : "lounge-list-help"}
          aria-invalid={!!error}
          disabled={busy}
        />
        <FieldDescription id="lounge-list-help">
          Paste the bot's full list. The 12 players, format and tier are read when you create the mogi.
        </FieldDescription>
        {error && <FieldError id="lounge-list-error">{error}</FieldError>}
      </Field>
    </form>
  );
}
