"use client";

import type { MogiOverviewActivity } from "@mkw/engine";
import { Flag, Plus, Settings, TriangleAlert } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { useAppearance } from "@/components/app/appearance";
import { ImageOffers } from "@/components/app/image-offers";
import { yourLoungeNames } from "@/components/app/lounge-name";
import { MogiList } from "@/components/app/mogi-list";
import { MogiSidebar } from "@/components/app/mogi-sidebar";
import { OpeningScreen } from "@/components/app/opening-screen";
import { RaceEditing } from "@/components/app/race-editing";
import { sessionAlert } from "@/components/app/session-alert";
import { SettingsSheet } from "@/components/app/settings-sheet";
import { useActionError } from "@/components/app/use-action-error";
import { useBackgroundCompression } from "@/components/app/use-background-compression";
import { useContentScroll } from "@/components/app/use-content-scroll";
import { useMogiRoute } from "@/components/app/use-mogi-route";
import { useMogiSession } from "@/components/app/use-mogi-session";
import { useSheets } from "@/components/app/use-sheets";
import { useSidebar } from "@/components/app/use-sidebar";
import { useTrackerSession } from "@/components/app/use-tracker-session";
import { useWatchedFolders } from "@/components/app/watched-folders";
import { CaptureIntake, type CaptureIntakeHandle } from "@/components/captures/capture-intake";
import { SourceActions } from "@/components/captures/source-actions";
import { InstructionsScreen } from "@/components/instructions-screen";
import { MogiDetail } from "@/components/mogi-detail";
import { MogiSetup } from "@/components/mogi-setup";
import { useOfflinePanel } from "@/components/offline-panel";
import { ReleaseNotesScreen } from "@/components/release-notes-screen";
import { TracksScreen } from "@/components/tracks-screen";
import { ActionErrorProvider } from "@/components/ui/action-error";
import { BlockingAlert } from "@/components/ui/blocking-alert";
import { ContentUnavailable } from "@/components/ui/content-unavailable";
import { FloatingBar } from "@/components/ui/floating-bar";
import { GlassButton } from "@/components/ui/glass-button";
import { DockedSidebar, SidebarOverlay } from "@/components/ui/sidebar-overlay";
import { currentSizeClass } from "@/components/ui/size-class";
import { SidebarToggle, Toolbar } from "@/components/ui/toolbar";
import { updateIdle } from "@/components/ui/update-activity";
import { promptInstall, useInstallContext } from "@/lib/install";
import { pendingCaptureReview } from "@/lib/mogi/capture-review";
import { createMogi, rememberMogi } from "@/lib/mogi/edits";
import type { RouteView } from "@/lib/mogi/route";
import type { Mogi, TrackerState } from "@/lib/mogi/types";
import { saveUpdateResume } from "@/lib/offline/resume";
import { requestPersistentStorage } from "@/lib/storage/usage";

/**
 * The app: the mogi list, the open mogi and the other screens, with the sidebar, Settings, New Mogi and
 * the blocking alert. Rules live in the sessions (`useTrackerSession`, `useMogiSession`); this composes them.
 */
export function Tracker() {
  const appearance = useAppearance();
  const installContext = useInstallContext();
  const watched = useWatchedFolders();
  const actionErrors = useActionError();
  const session = useTrackerSession(actionErrors);
  const { state, resultMogis, ready, loadError, busy, persist } = session;
  const galleryPicker = useRef<HTMLInputElement | null>(null);
  const captureIntake = useRef<CaptureIntakeHandle | null>(null);
  const [intakeActivity, setIntakeActivity] = useState<MogiOverviewActivity>({});
  const [openingComplete, setOpeningComplete] = useState(false);
  const finishOpening = useCallback(() => setOpeningComplete(true), []);
  const [mogiControls, setMogiControls] = useState<HTMLDivElement | null>(null);
  useBackgroundCompression(session, state, ready && !intakeActivity.reading);

  const remember = useCallback(
    (id: string) => {
      void persist((latest) => rememberMogi(latest, id), undefined, "activeMogi");
    },
    [persist],
  );
  const route = useMogiRoute(state, ready, remember);
  const screen = route.mogiId ? "dashboard" : (route.view ?? "list");
  const mogi = state.mogis.find((item) => item.id === route.retainedId);
  const resultMogi = resultMogis.find((item) => item.id === route.retainedId);
  const sidebar = useSidebar();
  const sheets = useSheets(sidebar, {
    mogiId: route.mogiId,
    isCurrent: route.isCurrent,
    onOpen: session.clearConcurrentWrite,
  });
  const mogiSession = useMogiSession(session, {
    mogi,
    route,
    showActionError: actionErrors.showActionError,
    closeSheet: sheets.close,
    sheetOpen: !!sheets.sheet,
  });
  const { editor } = mogiSession;
  const { content, listHeading, onScroll } = useContentScroll({
    ready,
    mogiId: route.mogiId,
    view: route.view,
    retainedId: route.retainedId,
  });

  const offline = useOfflinePanel({
    idle: updateIdle({
      ready,
      openingComplete,
      busy,
      draftWrites: editor.draftWrites,
      reading: !!intakeActivity.reading,
      imagesOpen: mogiSession.imagesOpen,
      editingRace: !!editor.race,
      editingName: !!editor.nameCapture,
      sheet: sheets.sheet,
      screen,
    }),
    state,
    beforeReload: () =>
      saveUpdateResume(sheets.sheet === "settings" ? sheets.settingsPages.page : null, sheets.automaticBackup),
  });
  async function create(mogi: Mogi) {
    const success = await persist((latest) => createMogi(latest, mogi));
    if (success) {
      route.navigate({ type: "open", id: mogi.id }, session.current());
      sheets.close();
      void requestPersistentStorage();
    }
  }
  async function restore(next: TrackerState) {
    const success = await session.restore(next);
    if (success) {
      editor.closeRace();
      route.navigate({ type: "pop" }, session.current());
    }
    return success;
  }
  function selectMogi(id: string) {
    route.navigate({ type: "open", id });
    sidebar.setOpen(false);
  }
  function showView(view: RouteView) {
    route.navigate({ type: "view", view });
    sidebar.setOpen(false);
  }
  // Docked, the sidebar holds its own toggle; floating, the toolbar's stays in place.
  const mogiSidebar = (docked: boolean) => (
    <MogiSidebar
      mogis={resultMogis}
      activeId={route.mogiId}
      onSelect={selectMogi}
      view={route.view}
      onView={showView}
      onNew={() => sheets.open("create")}
      onSettings={() => sheets.open("settings")}
      onToggle={docked ? sidebar.toggle : undefined}
    />
  );
  const mogiList = (
    <MogiList mogis={resultMogis} activeId={state.activeMogiId} onSelect={selectMogi} onView={showView} />
  );
  const emptyMogis = (
    <ContentUnavailable
      icon={<Flag />}
      title="No Mogis Yet"
      description="Paste a bot list to start."
      actions={
        <>
          <GlassButton tint disabled={busy} onClick={() => sheets.open("create")}>
            New Mogi
          </GlassButton>
          <GlassButton disabled={busy} onClick={() => sheets.open("settings", "storage")}>
            Restore from Backup
          </GlassButton>
        </>
      }
    />
  );
  const alert = sessionAlert(session, {
    onManageStorage: () => sheets.open("settings", "storage"),
    onRecover: ({ recovery, context }) => mogiSession.recover(recovery, context),
  });
  return (
    <ActionErrorProvider value={actionErrors.actionError}>
      {/* Only once ready: the server can't read the stored choice, and hydration keeps the server's attribute. */}
      <div
        data-sidebar={ready && sidebar.expanded ? "open" : "closed"}
        className="app-shell w-full overflow-hidden bg-background text-foreground"
      >
        {!openingComplete && <OpeningScreen done={ready || !!loadError} onExited={finishOpening} />}
        <div aria-hidden="true" className="titlebar-strip" />
        <div className="mx-auto flex h-full">
          {ready && (
            <DockedSidebar open={sidebar.expanded}>
              <fieldset disabled={busy} className="min-w-0">
                {mogiSidebar(true)}
              </fieldset>
            </DockedSidebar>
          )}
          <div className="toolbar-scope relative h-full min-w-0 flex-1">
            <main
              ref={content}
              className={
                loadError
                  ? "flex h-full min-w-0 flex-col overflow-y-auto"
                  : screen === "dashboard" ||
                      screen === "tracks" ||
                      screen === "instructions" ||
                      screen === "release-notes"
                    ? "app-content mogi-content edge-mask mogi-edge-mask min-w-0"
                    : screen === "list"
                      ? "app-content app-list-content min-w-0 px-4 pb-28 pt-5 sm:px-6 md:px-0 md:py-0"
                      : "app-content min-w-0 px-4 pb-6 pt-5 sm:px-6 lg:px-0"
              }
              onDragOver={(event) => {
                if (
                  screen === "dashboard" &&
                  mogi &&
                  currentSizeClass() !== "compact" &&
                  event.dataTransfer.types.includes("Files")
                )
                  event.preventDefault();
              }}
              onDrop={(event) => {
                if (screen !== "dashboard" || !mogi || currentSizeClass() === "compact") return;
                event.preventDefault();
                captureIntake.current?.addCaptureFiles(Array.from(event.dataTransfer.files));
              }}
              onScroll={onScroll}
            >
              {loadError && (
                <ContentUnavailable
                  icon={<TriangleAlert />}
                  title="Couldn't Open Your Mogis"
                  description={loadError}
                  actions={
                    <>
                      <GlassButton tint onClick={() => window.location.reload()}>
                        Reload
                      </GlassButton>
                      <GlassButton disabled={busy} onClick={() => sheets.open("settings", "storage")}>
                        Restore from Backup
                      </GlassButton>
                      <GlassButton disabled={busy} onClick={() => sheets.open("settings", "storage")}>
                        Manage Storage
                      </GlassButton>
                    </>
                  }
                />
              )}
              {ready && (
                <section
                  hidden={screen !== "list"}
                  className={state.mogis.length ? "mb-6 md:hidden" : "flex min-h-full flex-col md:hidden"}
                >
                  <h1 ref={listHeading} tabIndex={-1} className="mb-8 text-3xl font-bold tracking-tight outline-none">
                    Mogis
                  </h1>
                  {/* The destinations stay above the empty state, so Instructions is always one tap away. */}
                  <fieldset disabled={busy} className="min-w-0">
                    {mogiList}
                  </fieldset>
                  {!state.mogis.length && emptyMogis}
                </section>
              )}
              {ready && screen === "list" && (
                <div className="relative hidden h-full flex-col items-center justify-center pt-(--toolbar-height) md:flex">
                  {state.mogis.length ? (
                    <p className="px-8 text-center text-muted-foreground">
                      Choose a mogi, or paste a bot list in New Mogi.
                    </p>
                  ) : (
                    emptyMogis
                  )}
                </div>
              )}
              {ready && mogi && (
                <div hidden={screen !== "dashboard"}>
                  <CaptureIntake
                    key={`${mogi.id}:${mogi.sourceRevision ?? 0}:${mogiSession.reviewRequest.version}`}
                    open={mogiSession.imagesOpen}
                    onOpenChange={mogiSession.setImagesOpen}
                    onActivity={setIntakeActivity}
                    pickerRef={galleryPicker}
                    intakeRef={captureIntake}
                    renderPendingActions={(itemId, fileName) => (
                      <section role="group" aria-label={`Pending screenshot ${fileName}`} className="space-y-2">
                        <SourceActions
                          label={`pending screenshot ${fileName}`}
                          busy={busy}
                          onRemove={() => mogiSession.removePendingSource(itemId)}
                        />
                      </section>
                    )}

                    mogi={pendingCaptureReview(mogi) ? mogi : { ...mogi, captureReview: undefined }}
                    onSave={mogiSession.saveRace}
                    onSaveContext={mogiSession.saveContext}
                    pendingFiles={state.sharedReceipts?.flatMap((receipt) => receipt.files) ?? []}
                    rejections={(state.sharedReceipts ?? [])
                      .filter((receipt) =>
                        mogi.captureReview?.items.some((item) =>
                          receipt.files.some((file) => file.id === item.source.fileId),
                        ),
                      )
                      .flatMap((receipt) => receipt.rejections)}
                    onReviewChange={(review) => mogiSession.saveCaptureReview(review, mogi.sourceRevision ?? 0)}
                    onStage={mogiSession.stage}
                    onCancel={() => {
                      mogiSession.setImagesOpen(false);
                    }}
                    busy={busy}
                  />
                </div>
              )}
              {ready && mogi && (
                <div hidden={screen !== "dashboard"}>
                  {mogi && (
                    <MogiDetail
                      controlsContainer={mogiControls}
                      key={`${mogi.id}:${mogiSession.reviewRequest.version}`}
                      initialReview={
                        mogiSession.reviewRequest.mogiId === mogi.id ? mogiSession.reviewRequest : undefined
                      }
                      mogi={mogi}
                      resultMogi={resultMogi}
                      pendingFiles={state.sharedReceipts?.flatMap((receipt) => receipt.files) ?? []}
                      visible={screen === "dashboard"}
                      editor={
                        editor.race && editor.editorRace ? (
                          <RaceEditing
                            mogi={mogi}
                            session={mogiSession}
                            busy={busy}
                            draftError={!!actionErrors.actionError || !!session.failedWrite}
                          />
                        ) : undefined
                      }
                      onCloseEditor={editor.close}
                      activity={intakeActivity}
                      onQuestions={mogiSession.resumeCaptureReview}
                      onQuestionAnswer={mogiSession.answerQuestion}
                      onAddImages={() => galleryPicker.current?.click()}
                      onBack={() => route.navigate({ type: "back" })}
                      onUndo={mogiSession.undo}
                      onConcurrentWrite={session.showConcurrentWrite}
                      onShowMogis={sidebar.toggle}
                      mogisShown={sidebar.open}
                      busy={busy}
                      onUpdate={mogiSession.updateMogi}
                      onRemovePendingSource={mogiSession.removePendingSource}
                      onRemoveSource={mogiSession.removeCaptureSource}
                      onSequenceAnswer={mogiSession.answerSequence}
                      onEditContext={mogiSession.editContext}
                      onIgnChange={mogiSession.changeIgn}
                      onCorrectNames={mogiSession.correctNames}
                      onDelete={mogiSession.deleteMogi}
                      onEnterResult={(number) => void mogiSession.enterResult(number)}
                      onResumeDraft={() => void mogiSession.resumeRaceDraft()}
                      onDiscardDraft={mogiSession.discardRaceDraft}
                      onRevertToScreenshots={mogiSession.revertToScreenshots}
                      onEdit={mogiSession.editRace}
                    />
                  )}
                </div>
              )}
              {ready && screen === "instructions" && (
                <InstructionsScreen
                  busy={busy}
                  visible
                  controlsContainer={mogiControls}
                  mogisShown={sidebar.open}
                  newInToolbar={!sidebar.anchored || !sidebar.expanded}
                  onShowMogis={sidebar.toggle}
                  onBack={() => route.navigate({ type: "back" })}
                  onNew={() => sheets.open("create")}
                  canInstall={installContext === "prompt"}
                  onInstall={() => void promptInstall()}
                />
              )}
              {ready && screen === "release-notes" && (
                <ReleaseNotesScreen
                  visible
                  controlsContainer={mogiControls}
                  mogisShown={sidebar.open}
                  onShowMogis={sidebar.toggle}
                  onBack={() => route.navigate({ type: "back" })}
                />
              )}
              {ready && screen === "tracks" && (
                <TracksScreen
                  mogis={state.mogis}
                  loungeNames={yourLoungeNames(state)}
                  visible
                  controlsContainer={mogiControls}
                  mogisShown={sidebar.open}
                  onShowMogis={sidebar.toggle}
                  onBack={() => route.navigate({ type: "back" })}
                  onChooseName={() => sheets.open("settings", "loungeName")}
                />
              )}
            </main>
            {ready && !loadError && screen === "list" && (
              <Toolbar
                aria-label="App navigation"
                leading={<SidebarToggle placement="toolbar" expanded={sidebar.open} onClick={sidebar.toggle} />}
                trailing={
                  (!sidebar.anchored || !sidebar.expanded) && (
                    <GlassButton tint density="toolbar" disabled={busy} onClick={() => sheets.open("create")}>
                      <Plus aria-hidden="true" />
                      New Mogi
                    </GlassButton>
                  )
                }
              />
            )}
            <div ref={setMogiControls} className="@container pointer-events-none absolute inset-0" />
          </div>
        </div>
        {!loadError && screen === "list" && (
          <FloatingBar className="mx-auto max-w-xl" aria-label="App navigation">
            <GlassButton
              shape="circle"
              aria-label="Settings"
              disabled={!ready || busy}
              onClick={() => sheets.open("settings")}
            >
              <Settings aria-hidden="true" />
            </GlassButton>
            <GlassButton tint disabled={!ready || busy} onClick={() => sheets.open("create")}>
              <Plus aria-hidden="true" />
              New Mogi
            </GlassButton>
          </FloatingBar>
        )}
        <SidebarOverlay open={sidebar.open} onOpenChange={sidebar.setOpen} onCloseAutoFocus={sidebar.restoreFocus}>
          <fieldset disabled={busy} className="min-w-0">
            {mogiSidebar(false)}
          </fieldset>
        </SidebarOverlay>
        <SettingsSheet
          sheets={sheets}
          state={state}
          busy={busy}
          appearance={appearance}
          watched={watched}
          offline={offline.settings}
          persist={persist}
          onRestore={restore}
          onMogiDeleted={(id) => {
            if (route.mogiId !== id) return;
            editor.closeRace();
            route.navigate({ type: "delete", sizeClass: currentSizeClass() }, session.current());
          }}
        />
        <ImageOffers
          mogi={mogi}
          shown={screen === "dashboard"}
          sheetOpen={!!sheets.sheet}
          busy={busy}
          watched={watched}
          current={session.current}
          onAdd={(files, pastedAt) => captureIntake.current?.addCaptureFiles(files, pastedAt)}
        />
        <MogiSetup
          open={sheets.sheet === "create"}
          onOpenChange={(open) => {
            if (!open) sheets.close();
          }}
          onCreate={create}
          busy={busy}
          onCloseAutoFocus={sheets.restoreFocus}
        />
        <BlockingAlert alert={alert} busy={busy} />
      </div>
    </ActionErrorProvider>
  );
}
