"use client";
import type { SequenceAnswer as SequenceAction } from "@mkw/engine";
import {
  captureNeedsClarification,
  type MogiOverviewActivity,
  type MogiRacePosition,
  raceNumber,
  racePhysicalNumber,
  reopenCreditQuestion,
  type Track,
} from "@mkw/engine";
import { ArrowLeft, Ellipsis, ImagePlus, Menu, Settings2, Table2, Undo2, Users } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { MogiPlayers, type PlayerShortcut } from "@/components/mogi-players";
import { MogiSettings } from "@/components/mogi-settings";
import { ResultsExport } from "@/components/results-export";
import { CopyButton } from "@/components/ui/copy-button";
import { FloatingBar } from "@/components/ui/floating-bar";
import { GlassButton, ToolbarGroup } from "@/components/ui/glass-button";
import { List, ListRow } from "@/components/ui/list";
import { MogiScrollBody } from "@/components/ui/mogi-scroll-body";
import { Sheet, type SheetPager } from "@/components/ui/sheet";
import { SidebarToggle, Toolbar, visibleMogiTitle } from "@/components/ui/toolbar";
import { titleCase } from "@/lib/format";
import { type MogiQuestion, type MogiQuestionAnswer, mogiQuestions } from "@/lib/mogi/questions";
import type { Capture, Mogi, Participant, Race, SharedFile } from "@/lib/mogi/types";

import { MogiOverview, MogiTable, raceSiblings, tableImage, tableTitle } from "./mogi-overview";
import { NeedsImagesSheet } from "./needs-images-sheet";
import { QuestionSheet } from "./question-sheet";
import { RaceSheet } from "./race-sheet";
import { freshPager, TrackSheet, useTrackPicker } from "./track-picker";

export function MogiDetail({
  mogi,
  resultMogi = mogi,
  voteTracks,
  pendingFiles,
  editor,
  initialReview,
  onCloseEditor,
  visible = true,
  controlsContainer,
  activity,
  onQuestions,
  onQuestionAnswer,
  onAddImages,
  onBack,
  onUndo,
  onConcurrentWrite,
  onShowMogis,
  mogisShown = false,
  busy,
  onUpdate,
  onRemoveSource,
  onRemovePendingSource,
  onIgnChange,
  onCorrectNames,
  onEditContext,
  onSequenceAnswer,
  onEdit,
  onEnterResult,
  onResumeDraft,
  onDiscardDraft,
  onRevertToScreenshots,
  onDelete,
}: {
  mogi: Mogi;
  resultMogi?: Mogi;
  /** The tracks to vote for, in the default track order. */
  voteTracks?: readonly Track[];
  pendingFiles: SharedFile[];
  editor?: ReactNode;
  initialReview?: { surface?: "players" | "settings" | "questions"; captureId?: string; raceId?: string };
  onCloseEditor: () => void;
  visible?: boolean;
  controlsContainer?: HTMLElement | null;
  activity: MogiOverviewActivity;
  onQuestions: () => void;
  onQuestionAnswer: (question: MogiQuestion, answer: MogiQuestionAnswer) => Promise<boolean>;
  onAddImages: () => void;
  onBack: () => void;
  /** Reverses the removal just made; present only while it can. */
  onUndo?: () => void;
  /** The data changed in another window: the tracker shows its alert. */
  onConcurrentWrite: () => void;
  onShowMogis: () => void;
  /** The floating sidebar is shown: the toolbar's toggle then reads Hide Mogis. */
  mogisShown?: boolean;
  busy: boolean;
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  onRemoveSource: (captureId: string) => Promise<boolean>;
  onRemovePendingSource?: (itemId: string) => Promise<boolean>;
  onIgnChange: (person: Participant, ign: string) => Promise<boolean>;
  onEditContext: (capture: Capture) => void;
  onSequenceAnswer: (action: SequenceAction, signature: string) => Promise<boolean>;
  onCorrectNames: (race: Race, captureId: string) => void;
  onEdit: (race: Race) => void;
  /** A ghost race's result typed by hand, when no image can prove it. */
  onEnterResult: (number: number) => void;
  /** The mogi's race edit in progress, from that race's sheet. */
  onResumeDraft: () => void;
  onDiscardDraft: () => Promise<boolean>;
  /** Withdraws a race's manual result, so its screenshots count it again. */
  onRevertToScreenshots: (race: Race) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const consultationTrigger = useRef<HTMLElement | null>(null);
  const consultationNumber = useRef<number | undefined>(undefined);
  const consultedId = useRef<string | undefined>(undefined);
  const handingOff = useRef(false);
  function restoreConsultationFocus(event: Event) {
    event.preventDefault();
    if (handingOff.current) {
      handingOff.current = false;
      return;
    }
    const trigger = consultationTrigger.current;
    // After paging, closing returns to the tile of the race on screen, wherever the first one was opened from.
    const paged =
      !!consulting && consulting.id !== consultedId.current && mogi.races.some((race) => race.id === consulting.id);
    if (!paged && trigger?.isConnected) {
      trigger.focus();
      if (document.activeElement === trigger) return;
    }
    // The discarded row may leave the list; the tile keeps the return point on the grid.
    const number =
      consulting && (paged || consulting.status !== "discarded")
        ? consulting.status === "discarded"
          ? racePhysicalNumber(mogi, consulting)
          : raceNumber(mogi, consulting)
        : consultationNumber.current;
    document.querySelector<HTMLElement>(`[data-race-number="${number}"]`)?.focus();
  }
  const [selected, setConsulting] = useState<Race | null>(
    mogi.races.find((race) => race.id === initialReview?.raceId) ?? null,
  );
  const [consultingOpen, setConsultingOpen] = useState(!!initialReview?.raceId);
  const consulting = selected ? (mogi.races.find((race) => race.id === selected.id) ?? selected) : null;
  // A Standings row opens Players on that player or team.
  const [playerStart, setPlayerStart] = useState<PlayerShortcut>();
  const [surface, setSurface] = useState<"menu" | "table" | "settings" | "questions" | "players" | null>(
    initialReview?.captureId ? "settings" : (initialReview?.surface ?? null),
  );
  // The header's Copy !submit falls back to Export on Save Text; Mogi Settings opens Export as one of its pages.
  const [exportOpen, setExportOpen] = useState(false);
  const exportTrigger = useRef<HTMLElement | null>(null);
  function openExport() {
    exportTrigger.current = document.activeElement as HTMLElement;
    setExportOpen(true);
  }
  const [initialQuestionId, setInitialQuestionId] = useState<string>();
  const [imageQuestion, setImageQuestion] = useState(false);
  const imageQuestionTrigger = useRef<HTMLElement | null>(null);
  const controlsTrigger = useRef<HTMLElement | null>(null);
  function openSurface(next: typeof surface, player?: PlayerShortcut) {
    setImageQuestion(false);
    controlsTrigger.current = document.activeElement as HTMLElement;
    setPlayerStart(player);
    setSurface(next);
  }
  function consult(race: Race) {
    consultationTrigger.current = document.activeElement as HTMLElement;
    consultedId.current = race.id;
    consultationNumber.current = race.status === "discarded" ? racePhysicalNumber(mogi, race) : raceNumber(mogi, race);
    setConsulting(race);
    setConsultingOpen(true);
  }
  function questions(race?: Race) {
    setInitialQuestionId(undefined);
    if (mogiQuestions(resultMogi).length) {
      openSurface("questions");
      return;
    }
    if (mogi.captureReview?.items.some((item) => item.status !== "saved")) {
      onQuestions();
      return;
    }
    const capture = mogi.captures?.find(
      (source) =>
        (!race ||
          race.captureIds?.includes(source.id) ||
          source.context?.raceId === race.id ||
          mogi.sequence?.associations?.some((entry) => entry.captureId === source.id && entry.raceId === race.id)) &&
        captureNeedsClarification(mogi, source),
    );
    if (capture) {
      const owner = race ?? mogi.races.find((entry) => entry.captureIds?.includes(capture.id));
      if (owner && !capture.context) onCorrectNames(owner, capture.id);
      else onEditContext(capture);
    } else if (race) consult(race);
    else if (mogi.races.some((entry) => entry.status === "pending") && !mogi.captures?.length)
      consult(mogi.races.find((entry) => entry.status === "pending")!);
    else openSurface("settings");
  }
  // From the table, the race replaces the Table sheet; closing it returns focus to the control that opened the table.
  function fromTable(next: () => void) {
    const trigger = controlsTrigger.current;
    setSurface(null);
    next();
    consultationTrigger.current = trigger;
    controlsTrigger.current = trigger;
  }
  const [needsImages, setNeedsImages] = useState<MogiRacePosition | null>(null);
  const needsImagesTrigger = useRef<HTMLElement | null>(null);
  function explainNeedsImages(position: MogiRacePosition) {
    needsImagesTrigger.current = document.activeElement as HTMLElement;
    setNeedsImages(position);
  }
  // The wide table's race column opens the Track sheet; in the Table sheet, the picker is a page.
  const [trackSheet, setTrackSheet] = useState<{ raceId?: string; open: boolean }>({ open: false });
  const trackTrigger = useRef<HTMLElement | null>(null);
  const [tableTrack, setTableTrack] = useState<{ raceId: string; number: number } | null>(null);
  const tableTrackRace = mogi.races.find((race) => race.id === tableTrack?.raceId);
  const tablePicker = useTrackPicker({
    mogi,
    race: tableTrackRace,
    busy,
    onUpdate,
    onChosen: () => setTableTrack(null),
  });
  const returnTo = useRef<number | null>(null);
  // Kept apart from the picker's state, so a save's busy flag doesn't re-render the mogi screen.
  function pickTrack(race: Race) {
    if (surface === "table") {
      const number = raceNumber(mogi, race);
      returnTo.current = number;
      setTableTrack({ raceId: race.id, number });
      return;
    }
    trackTrigger.current = document.activeElement as HTMLElement;
    setTrackSheet({ raceId: race.id, open: true });
  }
  // Back from the picker returns focus to its race column, after the sheet has put it on Back.
  useLayoutEffect(() => {
    // Paging the picker moves the return point to the column of the race on screen.
    if (tableTrack) {
      returnTo.current = tableTrack.number;
      return;
    }
    if (returnTo.current === null) return;
    document.querySelector<HTMLElement>(`[role="dialog"] [data-race-column="${returnTo.current}"]`)?.focus();
    returnTo.current = null;
  }, [tableTrack]);
  // Paging changes race without closing: the race sheet among the races whose tiles open it (the discarded
  // among the discarded), a track picker from a list of races among the resolved races' pickers.
  function pagerOver(races: Race[], current: string | undefined, go: (race: Race) => void): SheetPager | undefined {
    const at = races.findIndex((race) => race.id === current);
    if (at === -1 || races.length < 2) return undefined;
    return {
      previousLabel: "Previous Race",
      nextLabel: "Next Race",
      previous: at > 0 ? () => go(races[at - 1]) : undefined,
      next: at < races.length - 1 ? () => go(races[at + 1]) : undefined,
    };
  }
  const racePager =
    consultingOpen && !editor && consulting
      ? pagerOver(
          consulting.status === "discarded"
            ? mogi.races.filter((race) => race.status === "discarded")
            : raceSiblings(mogi, resultMogi, "race"),
          consulting.id,
          setConsulting,
        )
      : undefined;
  const trackPager = trackSheet.open
    ? pagerOver(raceSiblings(mogi, resultMogi, "track"), trackSheet.raceId, (race) =>
        setTrackSheet({ raceId: race.id, open: true }),
      )
    : undefined;
  const tableTrackPager = tableTrack
    ? freshPager(
        pagerOver(raceSiblings(mogi, resultMogi, "track"), tableTrack.raceId, (race) =>
          setTableTrack({ raceId: race.id, number: raceNumber(mogi, race) }),
        ),
        tablePicker.reset,
      )
    : undefined;
  useEffect(() => {
    const closePanels = () => {
      setConsultingOpen(false);
      setSurface(null);
      setExportOpen(false);
      setNeedsImages(null);
      setTrackSheet((current) => ({ ...current, open: false }));
    };
    window.addEventListener("popstate", closePanels);
    return () => window.removeEventListener("popstate", closePanels);
  }, []);
  return (
    <section className="@container relative">
      {visible &&
        controlsContainer &&
        createPortal(
          <>
            <Toolbar
              aria-label="Mogi actions"
              leading={<SidebarToggle placement="toolbar" expanded={mogisShown} onClick={onShowMogis} />}
              trailing={
                <>
                  {/* Separate items; labels collapse to symbols, then Table, Players and Mogi Settings move into More. */}
                  {onUndo && (
                    <GlassButton shape="circle" aria-label="Undo" title="Undo" disabled={busy} onClick={onUndo}>
                      <Undo2 aria-hidden="true" />
                    </GlassButton>
                  )}
                  <div className="toolbar-overflow flex items-center gap-2">
                    <GlassButton
                      shape="circle"
                      aria-label="Table"
                      title="Table"
                      className="@[55rem]:hidden"
                      onClick={() => openSurface("table")}
                    >
                      <Table2 aria-hidden="true" />
                    </GlassButton>
                    <GlassButton density="toolbar" onClick={() => openSurface("players")}>
                      <Users aria-hidden="true" />
                      <span className="toolbar-label">Players</span>
                    </GlassButton>
                    <GlassButton density="toolbar" onClick={() => openSurface("settings")}>
                      <Settings2 aria-hidden="true" />
                      <span className="toolbar-label">Mogi Settings</span>
                    </GlassButton>
                  </div>
                  <div className="toolbar-more">
                    <GlassButton shape="circle" aria-label="More" title="More" onClick={() => openSurface("menu")}>
                      <Ellipsis aria-hidden="true" />
                    </GlassButton>
                  </div>
                  <GlassButton tint density="toolbar" disabled={busy} onClick={onAddImages}>
                    <ImagePlus aria-hidden="true" />
                    Add Screenshots
                  </GlassButton>
                </>
              }
            />
            <FloatingBar className="mx-auto max-w-xl" aria-label="Mogi actions">
              <ToolbarGroup>
                <GlassButton shape="circle" aria-label="Back" onClick={onBack}>
                  <ArrowLeft aria-hidden="true" />
                </GlassButton>
                <GlassButton shape="circle" aria-label="Menu" onClick={() => openSurface("menu")}>
                  <Menu aria-hidden="true" />
                </GlassButton>
                {onUndo && (
                  <GlassButton shape="circle" aria-label="Undo" disabled={busy} onClick={onUndo}>
                    <Undo2 aria-hidden="true" />
                  </GlassButton>
                )}
              </ToolbarGroup>
              <GlassButton tint shape="circle" aria-label="Add Screenshots" disabled={busy} onClick={onAddImages}>
                <ImagePlus aria-hidden="true" />
              </GlassButton>
            </FloatingBar>
          </>,
          controlsContainer,
        )}
      <p role="status" className="sr-only">
        {onUndo ? "Screenshot removed. Undo available." : ""}
      </p>
      <MogiScrollBody>
        <MogiOverview
          mogi={mogi}
          resultMogi={resultMogi}
          voteTracks={voteTracks}
          activity={activity}
          onRace={consult}
          onTrack={pickTrack}
          onQuestions={questions}
          onNeedsImages={explainNeedsImages}
          onSaveSubmit={openExport}
          onConcurrentWrite={onConcurrentWrite}
          onStanding={(player) => openSurface("players", player)}
        />
      </MogiScrollBody>
      {visible && (
        <>
          <Sheet
            blocksUpdates={false}
            open={surface === "menu"}
            onOpenChange={(open) => {
              if (!open) setSurface(null);
            }}
            kind="menu"
            title="Menu"
            height="fit"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (!surface) controlsTrigger.current?.focus();
            }}
          >
            <List>
              <ListRow onSelect={() => setSurface("table")}>
                <span className="flex items-center gap-3">
                  <Table2 aria-hidden="true" />
                  Table
                </span>
              </ListRow>
              <ListRow
                onSelect={() => {
                  setPlayerStart(undefined);
                  setSurface("players");
                }}
              >
                <span className="flex items-center gap-3">
                  <Users aria-hidden="true" />
                  Players
                </span>
              </ListRow>
              <ListRow onSelect={() => setSurface("settings")}>
                <span className="flex items-center gap-3">
                  <Settings2 aria-hidden="true" />
                  Mogi Settings
                </span>
              </ListRow>
            </List>
          </Sheet>
          <MogiPlayers
            mogi={mogi}
            busy={busy}
            onIgnChange={onIgnChange}
            onUpdate={onUpdate}
            open={surface === "players"}
            start={playerStart}
            onCredit={async (slot) => {
              try {
                if (!(await onUpdate(reopenCreditQuestion(mogi, slot)))) return false;
                setInitialQuestionId(`credit:${slot}`);
                setSurface("questions");
                return true;
              } catch {
                return false;
              }
            }}
            onOpenChange={(open) => {
              if (!open) setSurface(null);
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (!surface) controlsTrigger.current?.focus();
            }}
          />
          <Sheet
            blocksUpdates={false}
            open={surface === "table"}
            onOpenChange={(open) => {
              if (!open) {
                setSurface(null);
                setTableTrack(null);
                tablePicker.reset();
                returnTo.current = null;
              }
            }}
            kind="detail"
            height="fit"
            bleed
            title={tableTrack ? `Race ${tableTrack.number} Track` : titleCase(tableTitle(resultMogi))}
            page={tableTrack ? `track:${tableTrack.raceId}` : "table"}
            pager={tableTrackPager}
            onBack={
              tableTrack
                ? () => {
                    tablePicker.reset();
                    setTableTrack(null);
                  }
                : undefined
            }
            search={tableTrack ? tablePicker.search : undefined}
            footer={
              tableTrack ? undefined : (
                <CopyButton
                  appearance="glass"
                  className="w-full"
                  label="Copy Table"
                  filename="mkw-table.png"
                  content={tableImage(mogi)}
                />
              )
            }
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (surface !== "questions") controlsTrigger.current?.focus();
            }}
          >
            {tableTrack ? (
              <div className="px-4">{tablePicker.content()}</div>
            ) : (
              <>
                <MogiTable
                  mogi={mogi}
                  resultMogi={resultMogi}
                  activity={activity}
                  surface="popover"
                  onRace={(race) => fromTable(() => consult(race))}
                  onTrack={pickTrack}
                  onQuestions={(race) => fromTable(() => questions(race))}
                  onNeedsImages={(position) =>
                    fromTable(() => {
                      needsImagesTrigger.current = controlsTrigger.current;
                      setNeedsImages(position);
                    })
                  }
                />
                <p className="mt-3 px-4 text-sm text-muted-foreground">Tap a race number to choose its track.</p>
              </>
            )}
          </Sheet>
          {/* Mounted from the first use only: a closed sheet still costs a little on every save. */}
          {trackSheet.raceId && (
            <TrackSheet
              mogi={mogi}
              race={mogi.races.find((race) => race.id === trackSheet.raceId) ?? null}
              open={trackSheet.open}
              busy={busy}
              pager={trackPager}
              onUpdate={onUpdate}
              onOpenChange={(open) => setTrackSheet((current) => ({ ...current, open }))}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (trackTrigger.current?.isConnected) trackTrigger.current.focus();
                else document.querySelector<HTMLElement>("[data-mogi-title]")?.focus();
              }}
            />
          )}
          <QuestionSheet
            mogi={resultMogi}
            pendingFiles={pendingFiles}
            open={surface === "questions"}
            initialQuestionId={initialQuestionId}
            onOpenChange={(open) => {
              if (!open) setSurface(imageQuestion ? "settings" : null);
            }}
            busy={busy}
            onAnswer={onQuestionAnswer}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (imageQuestion) {
                if (imageQuestionTrigger.current?.isConnected) imageQuestionTrigger.current.focus();
                else document.querySelector<HTMLElement>('[role="dialog"] button[aria-label="Back"]')?.focus();
              } else if (controlsTrigger.current?.isConnected) controlsTrigger.current.focus();
              else visibleMogiTitle()?.focus();
            }}
          />
          <MogiSettings
            mogi={mogi}
            resultMogi={resultMogi}
            pendingFiles={pendingFiles}
            busy={busy}
            open={surface === "settings" || (imageQuestion && surface === "questions")}
            initialCaptureId={initialReview?.captureId}
            onQuestion={(id) => {
              imageQuestionTrigger.current = document.activeElement as HTMLElement;
              setInitialQuestionId(id);
              setImageQuestion(true);
              setSurface("questions");
            }}
            onOpenChange={(open) => {
              if (!open) setSurface(null);
            }}
            onDelete={onDelete}
            onUpdate={onUpdate}
            onRemoveSource={onRemoveSource}
            onRemovePendingSource={onRemovePendingSource}
            onSequenceAnswer={onSequenceAnswer}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (!surface) controlsTrigger.current?.focus();
            }}
          />
          <NeedsImagesSheet
            position={needsImages}
            onOpenChange={(open) => {
              if (!open) setNeedsImages(null);
            }}
            onAddImages={() => {
              setNeedsImages(null);
              onAddImages();
            }}
            busy={busy}
            onEnterResult={(position) => {
              // Edit Result takes the sheet's place; closing it returns to what opened the sheet.
              consultationTrigger.current = needsImagesTrigger.current ?? controlsTrigger.current;
              consultationNumber.current = position.number;
              setNeedsImages(null);
              onEnterResult(position.number);
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const trigger = needsImagesTrigger.current ?? controlsTrigger.current;
              if (trigger?.isConnected) trigger.focus();
              else visibleMogiTitle()?.focus();
            }}
          />
          <ResultsExport
            mogi={mogi}
            resultMogi={resultMogi}
            onUpdate={onUpdate}
            saving={busy}
            open={exportOpen}
            saveText
            onOpenChange={setExportOpen}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              exportTrigger.current?.focus();
            }}
          />
        </>
      )}
      {/* When giving up the screen, unmount the portals so the exit doesn't hide the new editor from the accessibility tree. */}
      {visible && (
        <>
          <RaceSheet
            mogi={mogi}
            race={consulting}
            open={consultingOpen || !!editor}
            busy={busy}
            editor={editor}
            pager={racePager}
            onUpdate={onUpdate}
            onQuestions={() => {
              const trigger = consultationTrigger.current;
              handingOff.current = true;
              setConsultingOpen(false);
              questions(consulting ?? undefined);
              controlsTrigger.current = trigger;
            }}
            // A screenshot's question hands the race over to the questions, as Answer Questions does.
            onQuestion={(id) => {
              const trigger = consultationTrigger.current;
              handingOff.current = true;
              setConsultingOpen(false);
              openSurface("questions");
              setInitialQuestionId(id);
              controlsTrigger.current = trigger;
            }}
            onRemoveSource={onRemoveSource}
            onSequenceAnswer={onSequenceAnswer}
            onBack={consultingOpen ? onCloseEditor : undefined}
            onClose={() => {
              setConsultingOpen(false);
              onCloseEditor();
            }}
            onCloseAutoFocus={restoreConsultationFocus}
            onEdit={() => {
              if (consulting) onEdit(consulting);
            }}
            onResumeDraft={onResumeDraft}
            onDiscardDraft={onDiscardDraft}
            onRevert={() => (consulting ? onRevertToScreenshots(consulting) : Promise.resolve(false))}
          />
        </>
      )}
    </section>
  );
}
