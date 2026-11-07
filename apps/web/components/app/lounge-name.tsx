"use client";

import { defaultLoungeName } from "@mkw/engine";
import { X } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import type { Mogi, TrackerState } from "@/lib/mogi/types";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Your Lounge names as saved; a state from before several names reads its single `loungeName`. */
export function yourLoungeNames(state: Pick<TrackerState, "loungeNames" | "loungeName">): string[] {
  return state.loungeNames ?? (state.loungeName?.trim() ? [state.loungeName.trim()] : []);
}

/** The state with these names, written only as `loungeNames`. */
export function withLoungeNames(state: TrackerState, names: string[]): TrackerState {
  const next = { ...state, loungeNames: names.length ? names : undefined };
  delete next.loungeName;
  if (!next.loungeNames) delete next.loungeNames;
  return next;
}

/**
 * Settings › Your Lounge Names: every name Tracks counts as you, since a Lounge name can change. Nothing is set
 * until the player says so; the Lounge name in every mogi is only offered as a suggestion.
 */
export function LoungeNameSettings({
  mogis,
  saved,
  busy,
  onSave,
}: {
  mogis: Mogi[];
  saved: string[];
  busy: boolean;
  onSave: (names: string[]) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const suggestion = defaultLoungeName(mogis);
  const add = (value: string) => {
    const next = value.trim();
    if (!next || saved.some((entry) => same(entry, next))) {
      setName("");
      return;
    }
    void onSave([...saved, next]).then((success) => {
      if (success) setName("");
    });
  };
  return (
    <div className="section-stack">
      {saved.length > 0 && (
        <ListGroup>
          <List aria-label="Your Lounge names">
            {saved.map((entry) => (
              <ListRow
                key={entry}
                trail={
                  <IconButton
                    aria-label={`Remove ${entry}`}
                    disabled={busy}
                    className="-mr-3"
                    onClick={() => void onSave(saved.filter((other) => other !== entry))}
                  >
                    <X aria-hidden="true" />
                  </IconButton>
                }
              >
                {entry}
              </ListRow>
            ))}
          </List>
        </ListGroup>
      )}
      {suggestion && !saved.some((entry) => same(entry, suggestion)) && (
        <ListGroup>
          <List aria-label="Suggestion">
            <ListRow action="primary" disabled={busy} onSelect={() => add(suggestion)}>
              Use {suggestion}
            </ListRow>
          </List>
        </ListGroup>
      )}
      <ListGroup note={saved.length ? "Lounge name changed? Add the new one and keep the old." : undefined}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add(name);
          }}
        >
          <Input
            variant="filled"
            aria-label="Add a Lounge name"
            placeholder={saved.length ? "Add another name" : "As shown on the Lounge"}
            maxLength={80}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => add(name)}
          />
        </form>
      </ListGroup>
    </div>
  );
}
