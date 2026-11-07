"use client";

import { mogiQuestions, pointsFor, raceNumber, racePhysicalNumber, raceTrack } from "@mkw/engine";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { TrackIcon } from "@/components/track-icon";
import { useTrackPicker } from "@/components/track-picker";
import { ActionScope } from "@/components/ui/action-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { Sheet, type SheetPager } from "@/components/ui/sheet";
import { captureRace } from "@/lib/mogi/capture-label";
import { changeRaceValidity } from "@/lib/mogi/race-validity";
import type { Mogi, Race } from "@/lib/mogi/types";
import { settled } from "@/lib/settled";
import { cn } from "@/vendor/shadcn/lib/utils";

function RaceCapture({ original, number, discarded }: { original: Blob | null; number?: number; discarded: boolean }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!original) return;
    const url = URL.createObjectURL(original);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [original]);
  if (!original)
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
        Screenshot deleted to free space.
      </div>
    );
  return (
    <img
      ref={image}
      alt={`Screenshot of race ${number ?? ""}`}
      className={cn("w-full rounded-lg", discarded && "opacity-60")}
    />
  );
}

export function RaceSheet({
  mogi,
  race,
  open,
  busy,
  editor,
  pager,
  onBack,
  onClose,
  onCloseAutoFocus,
  onEdit,
  onQuestions,
  onScreenshots,
  onUpdate,
  onResumeDraft,
  onDiscardDraft,
  onRevert,
}: {
  mogi: Mogi;
  race: Race | null;
  open: boolean;
  busy: boolean;
  editor?: ReactNode;
  onBack?: () => void;
  /** Paging among the race's siblings; only the race page pages, never Edit Result or the track picker inside it. */
  pager?: SheetPager;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  onEdit: () => void;
  onQuestions: () => void;
  /** Hands the race over to Mogi Settings, opened on its screenshots. */
  onScreenshots: () => void;
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  /** The race's edit in progress: Resume and Discard take the place of Edit Result. */
  onResumeDraft: () => void;
  onDiscardDraft: () => Promise<boolean>;
  /** Withdraws the manual result, absences included, so the screenshots count the race again. */
  onRevert: () => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [reverting, setReverting] = useState(false);
  const editRow = useRef<HTMLButtonElement>(null);
  const [picker, setPicker] = useState({ raceId: race?.id, open, shown: false });
  const trackPicker = useTrackPicker({
    mogi,
    race,
    busy,
    onUpdate,
    onChosen: () => setPicker({ ...picker, shown: false }),
  });
  if (picker.raceId !== race?.id || picker.open !== open) {
    setPicker({ raceId: race?.id, open, shown: false });
    trackPicker.reset();
    setError("");
  }
  const track = race ? raceTrack(mogi, race) : null;
  const choosing = !editor && picker.shown;
  const changed = useRef(false);
  const discarded = race?.status === "discarded";
  const number = race ? raceNumber(mogi, race) : undefined;
  const full = mogi.races.filter((entry) => entry.status !== "discarded").length >= 12;
  const capture = mogi.captures?.find((capture) => race?.captureIds?.includes(capture.id));
  const screenshots = race
    ? (mogi.captures ?? []).filter((entry) => captureRace(mogi, entry)?.id === race.id).length
    : 0;
  const draft = !!race && mogi.raceDraft?.raceId === race.id;
  // A result typed over what the screenshots proved can always go back to them.
  const revertible =
    !!race &&
    !draft &&
    race.origin === "manual" &&
    race.status !== "pending" &&
    (!!capture || !!race.reconstructionHistory?.length);
  const hasQuestions =
    !!race &&
    mogiQuestions(mogi).some(
      (question) =>
        question.raceId === race.id || (question.captureId && race.captureIds?.includes(question.captureId)),
    );
  function backToRace() {
    setPicker({ ...picker, shown: false });
    trackPicker.reset();
  }
  async function changeValidity(discard: boolean) {
    if (!race || saving || busy) return false;
    setSaving(true);
    setError("");
    return settled(
      async () => {
        if (!(await onUpdate(changeRaceValidity(mogi, race.id, discard)))) return false;
        changed.current = true;
        onClose();
        return true;
      },
      () => {
        setSaving(false);
      },
    );
  }
  return (
    <Sheet
      kind="detail"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={editor ? "Edit Result" : choosing ? "Track" : discarded ? "Discarded Race" : `Race ${number ?? ""}`}
      page={editor ? "edit" : choosing ? "track" : `race:${race?.id}`}
      pager={editor || choosing ? undefined : pager}
      subtitle={draft && !editor && !choosing ? "Edit in progress" : undefined}
      search={choosing ? trackPicker.search : undefined}
      onBack={editor ? onBack : choosing ? backToRace : undefined}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {editor ??
        (choosing
          ? trackPicker.content()
          : race && (
              <>
                {capture && (
                  <RaceCapture
                    original={capture.original}
                    number={discarded ? racePhysicalNumber(mogi, race) : number}
                    discarded={discarded}
                  />
                )}
                <ListGroup>
                  <List dividers="row">
                    <ListRow
                      accessory="chevron"
                      disabled={busy || saving}
                      onSelect={() => setPicker({ ...picker, shown: true })}
                      trail={
                        <span className="flex items-center gap-2">
                          {track && <TrackIcon track={track} />}
                          {track?.name ?? "Choose"}
                        </span>
                      }
                    >
                      Track
                    </ListRow>
                    {screenshots > 0 && (
                      <ListRow
                        accessory="chevron"
                        disabled={busy || saving}
                        trail={screenshots}
                        onSelect={onScreenshots}
                      >
                        Screenshots
                      </ListRow>
                    )}
                  </List>
                </ListGroup>
                <ListGroup
                  title="Results"
                  note={
                    discarded
                      ? "Left out of the totals. The results are kept in case the race counts again."
                      : undefined
                  }
                >
                  <List dividers="row" aria-label="Results" tone={discarded ? "muted" : "default"}>
                    {[...race.placements, ...(race.absentParticipantIds ?? [])].map((id, index) => (
                      <ListRow
                        key={id}
                        lead={race.absentParticipantIds?.includes(id) ? "—" : index + 1}
                        trail={`${discarded ? "" : "+"}${pointsFor(race, id)}`}
                      >
                        {mogi.participants.find((person) => person.id === id)?.loungeName ?? id}
                      </ListRow>
                    ))}
                  </List>
                </ListGroup>
                {/* A refused command, such as editing while another race has an edit in progress, is explained right under it. */}
                <ActionScope>
                  <List dividers="row">
                    {hasQuestions && (
                      <ListRow accessory="chevron" disabled={busy || saving} onSelect={onQuestions}>
                        Answer Questions
                      </ListRow>
                    )}
                    {draft ? (
                      <>
                        <ListRow action="primary" disabled={busy || saving} onSelect={onResumeDraft}>
                          Resume Edit
                        </ListRow>
                        <ListRow action="destructive" disabled={busy || saving} onSelect={() => setDiscarding(true)}>
                          Discard Edit
                        </ListRow>
                      </>
                    ) : (
                      <ListRow
                        accessory="chevron"
                        disabled={busy || saving}
                        buttonProps={{ ref: editRow }}
                        onSelect={onEdit}
                      >
                        Edit Result
                      </ListRow>
                    )}
                    {revertible && (
                      <ListRow action="destructive" disabled={busy || saving} onSelect={() => setReverting(true)}>
                        Revert to Screenshots
                      </ListRow>
                    )}
                  </List>
                </ActionScope>
                <ConfirmationDialog
                  open={reverting}
                  onOpenChange={setReverting}
                  title={`Revert Race ${number} to Screenshots?`}
                  description="The result you entered is removed."
                  confirmLabel="Revert"
                  busy={busy || saving}
                  onConfirm={onRevert}
                  onCloseAutoFocus={(event) => {
                    if (editRow.current) {
                      event.preventDefault();
                      editRow.current.focus();
                    }
                  }}
                />
                <ConfirmationDialog
                  open={discarding}
                  onOpenChange={setDiscarding}
                  title="Discard Edit?"
                  description="Saved results are kept."
                  confirmLabel="Discard Edit"
                  busy={busy || saving}
                  onConfirm={onDiscardDraft}
                  // The discarded edit's rows give way to Edit Result, which takes the focus back.
                  onCloseAutoFocus={(event) => {
                    if (editRow.current) {
                      event.preventDefault();
                      editRow.current.focus();
                    }
                  }}
                />
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {discarded ? (
                  <ListGroup note={full ? "12 races already count. Discard another one first." : undefined}>
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={busy || saving || full}
                      onClick={() => {
                        void changeValidity(false)
                          .then((success) => {
                            if (!success) setError("The change could not be saved. Your result was kept. Try again.");
                          })
                          .catch(() => setError("The change could not be saved. Your result was kept. Try again."));
                      }}
                    >
                      Count Again
                    </Button>
                  </ListGroup>
                ) : (
                  <ConfirmationDialog
                    trigger={
                      <Button variant="destructive-ghost" className="w-full" disabled={busy || saving}>
                        Discard Race
                      </Button>
                    }
                    title={`Discard Race ${number}?`}
                    description="Later races move up one number."
                    confirmLabel="Discard"
                    errorMessage="The change could not be saved. Your result was kept. Try again."
                    busy={busy || saving}
                    onOpenChange={(next) => {
                      if (next) changed.current = false;
                    }}
                    onCloseAutoFocus={(event) => {
                      if (changed.current) onCloseAutoFocus(event);
                    }}
                    onConfirm={() => changeValidity(true)}
                  />
                )}
              </>
            ))}
    </Sheet>
  );
}
