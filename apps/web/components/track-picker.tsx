"use client";

import { contextPhase, raceNumber, raceTrack, type Track, tracks } from "@mkw/engine";
import { useState } from "react";

import { CaptureImage } from "@/components/captures/capture-image";
import { TrackIcon } from "@/components/track-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { List, ListRow } from "@/components/ui/list";
import { SearchField } from "@/components/ui/search-field";
import { Sheet, type SheetPager } from "@/components/ui/sheet";
import { captureLabel } from "@/lib/mogi/capture-label";
import type { Capture, Mogi, Race } from "@/lib/mogi/types";
import { settled } from "@/lib/settled";

const alphabeticalTracks = [...tracks].sort((a, b) => a.name.localeCompare(b.name, "en"));

/** The screenshot that shows the race's track: the pre-race one, as `raceTrack` reads it, or else the race's own. */
function trackScreenshot(mogi: Mogi, race: Race): Capture | undefined {
  const own = (mogi.captures ?? []).filter(
    (capture) => capture.context?.raceId === race.id || race.captureIds?.includes(capture.id),
  );
  return own.find((capture) => (capture.context?.phase ?? contextPhase(capture)) === "before") ?? own[0];
}

/**
 * The track picker, as a page of whichever sheet opens it: the race sheet's Track row, the Table sheet's
 * race column, or the Track sheet over the wide table. `search` goes in the sheet's search slot.
 * The race's screenshot, when it has one, comes first, in the same scroller as the list, and opens the viewer:
 * the picker's page covers the race page, so it carries the image itself.
 * Choosing saves the race's track and calls `onChosen`, which closes the picker.
 */
export function useTrackPicker({
  mogi,
  race,
  busy,
  onUpdate,
  onChosen,
}: {
  /** Only a shown picker builds its list, so a closed one costs nothing when the mogi changes. */
  mogi: Mogi;
  race: Race | null | undefined;
  busy: boolean;
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  onChosen: () => void;
}) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function reset() {
    setQuery("");
    setError("");
  }
  async function choose(track: Track) {
    if (!race || saving || busy) return;
    setSaving(true);
    setError("");
    return settled(
      async () => {
        try {
          if (
            !(await onUpdate({
              ...mogi,
              races: mogi.races.map((entry) => (entry.id === race.id ? { ...entry, track: track.short } : entry)),
            }))
          ) {
            setError("The track could not be saved. Try again.");
            return;
          }
          reset();
          onChosen();
        } catch {
          setError("The track could not be saved. Try again.");
        }
      },
      () => setSaving(false),
    );
  }
  return {
    saving,
    reset,
    search: <SearchField value={query} onValueChange={setQuery} placeholder="Search track or code" />,
    content: () => {
      const current = race ? raceTrack(mogi, race)?.short : undefined;
      const shown = alphabeticalTracks.filter((entry) =>
        `${entry.short} ${entry.name}`.toLowerCase().includes(query.trim().toLowerCase()),
      );
      const shot = race ? trackScreenshot(mogi, race) : undefined;
      return (
        <>
          {race && shot && (
            <CaptureImage
              original={shot.original}
              width={shot.width}
              height={shot.height}
              alt={`Screenshot of race ${raceNumber(mogi, race)}`}
              label={captureLabel(mogi, shot)}
            />
          )}
          {shown.length ? (
            <List dividers="row" aria-label="Tracks">
              {shown.map((entry) => (
                <ListRow
                  key={entry.short}
                  accessory={current === entry.short ? "check" : undefined}
                  disabled={busy || saving}
                  onSelect={() => void choose(entry)}
                  media={<TrackIcon track={entry} size={32} />}
                >
                  <span className="flex items-center gap-3">
                    <span className="truncate">{entry.name}</span>
                    <span className="text-sm text-muted-foreground">{entry.short}</span>
                  </span>
                </ListRow>
              ))}
            </List>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No track matches</p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </>
      );
    },
  };
}

/** Each paging step starts the next race's picker afresh, with no search left over. */
export function freshPager(pager: SheetPager | undefined, reset: () => void): SheetPager | undefined {
  return (
    pager && {
      ...pager,
      previous:
        pager.previous &&
        (() => {
          reset();
          pager.previous!();
        }),
      next:
        pager.next &&
        (() => {
          reset();
          pager.next!();
        }),
    }
  );
}

/**
 * The picker on its own, from the wide table's race column or a Tracks row: choosing a track closes it.
 * Those open it from a list of races, so it pages among the resolved races' pickers.
 */
export function TrackSheet({
  mogi,
  race,
  open,
  busy,
  pager,
  onUpdate,
  onOpenChange,
  onCloseAutoFocus,
}: {
  mogi: Mogi;
  race: Race | null;
  open: boolean;
  busy: boolean;
  pager?: SheetPager;
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const picker = useTrackPicker({ mogi, race, busy, onUpdate, onChosen: () => onOpenChange(false) });
  return (
    <Sheet
      kind="detail"
      open={open}
      onOpenChange={(next) => {
        if (!next) picker.reset();
        onOpenChange(next);
      }}
      onCloseAutoFocus={onCloseAutoFocus}
      title={race ? `Race ${raceNumber(mogi, race)} Track` : "Track"}
      search={picker.search}
      page={`track:${race?.id}`}
      pager={freshPager(pager, picker.reset)}
    >
      {race && picker.content()}
    </Sheet>
  );
}
