"use client";

import { FolderOpen, HardDrive, SunMoon, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useBackupPanel } from "@/components/backup-panel";
import { mogiTitle } from "@/components/mogi-overview";
import { StorageMogi } from "@/components/storage-mogi";
import { StoragePanel } from "@/components/storage-panel";
import { List, ListRow } from "@/components/ui/list";
import { Sheet } from "@/components/ui/sheet";
import { backupDate } from "@/lib/backup/automatic";
import { deleteFinishedMogi, deleteImages } from "@/lib/mogi/edits";
import type { Transition } from "@/lib/mogi/session";
import type { TrackerState } from "@/lib/mogi/types";
import { settingsTitles } from "@/lib/offline/resume";

import { AppearanceSettings, type useAppearance } from "./appearance";
import { LoungeNameSettings, withLoungeNames, yourLoungeNames } from "./lounge-name";
import type { SheetsHandle } from "./use-sheets";
import { foldersTrail, type useWatchedFolders, WatchedFoldersSettings } from "./watched-folders";

const settingsRows = [
  { page: "loungeName", Icon: UserRound },
  { page: "appearance", Icon: SunMoon },
  { page: "watchedFolders", Icon: FolderOpen },
  { page: "storage", Icon: HardDrive },
] as const;

/** The Settings row's trail: the one name, or how many, so the row's title never truncates. */
const namesTrail = (names: string[]) => (names.length > 1 ? `${names.length} names` : names[0]);

/** Settings: Lounge name, appearance, watched folders, storage with backups, and the offline section. */
export function SettingsSheet({
  sheets,
  state,
  busy,
  appearance,
  watched,
  offline,
  persist,
  onRestore,
  onMogiDeleted,
}: {
  sheets: SheetsHandle;
  state: TrackerState;
  busy: boolean;
  appearance: ReturnType<typeof useAppearance>;
  watched: ReturnType<typeof useWatchedFolders>;
  /** The offline and update section under the rows. */
  offline: ReactNode;
  persist: (input: Transition) => Promise<boolean>;
  onRestore: (next: TrackerState) => Promise<boolean>;
  /** Storage deleted this mogi. */
  onMogiDeleted: (id: string) => void;
}) {
  const { settingsPages, automaticBackup, setAutomaticBackup } = sheets;
  const [storageMogiId, setStorageMogiId] = useState<string | null>(null);
  const storageMogi = state.mogis.find((entry) => entry.id === storageMogiId);
  const backupPanel = useBackupPanel({
    state,
    saving: busy,
    active: sheets.sheet === "settings" && ["storage", "backupDetail", "restore"].includes(settingsPages.page),
    page: settingsPages.page,
    automaticBackup,
    onOpenBackup: (entry) => {
      setAutomaticBackup(entry);
      settingsPages.push("backupDetail");
    },
    onPreview: () => settingsPages.push("restore"),
    // The restored data is the confirmation: Settings closes to show it, with no toast.
    onRestored: sheets.close,
    onRestore,
  });
  return (
    <Sheet
      kind="menu"
      height="fit"
      blocksUpdates={false}
      open={sheets.sheet === "settings"}
      onOpenChange={(open) => {
        if (!open) sheets.close();
      }}
      title={
        settingsPages.page === "storageMogi" && storageMogi
          ? mogiTitle(storageMogi)
          : settingsPages.page === "backupDetail" && automaticBackup
            ? backupDate(automaticBackup.createdAt)
            : settingsTitles[settingsPages.page]
      }
      page={settingsPages.page}
      onBack={settingsPages.depth > 1 ? settingsPages.back : undefined}
      onCloseAutoFocus={sheets.restoreFocus}
    >
      {/* Pages render while closed, so the sheet keeps its content as it slides out. */}
      {settingsPages.page === "root" && (
        <div className="section-stack">
          <List>
            {settingsRows
              .filter(({ page }) => page !== "watchedFolders" || watched.supported)
              .map(({ page, Icon }) => (
                <ListRow
                  key={page}
                  trail={
                    page === "loungeName"
                      ? namesTrail(yourLoungeNames(state))
                      : page === "watchedFolders"
                        ? foldersTrail(watched.folders)
                        : undefined
                  }
                  accessory="chevron"
                  onSelect={() => settingsPages.push(page)}
                >
                  <span className="flex items-center gap-3">
                    <Icon aria-hidden="true" />
                    {settingsTitles[page]}
                  </span>
                </ListRow>
              ))}
          </List>
          {offline}
        </div>
      )}
      {settingsPages.page === "loungeName" && (
        <LoungeNameSettings
          mogis={state.mogis}
          saved={yourLoungeNames(state)}
          busy={busy}
          onSave={(names) => persist((latest) => withLoungeNames(latest, names))}
        />
      )}
      {settingsPages.page === "appearance" && <AppearanceSettings preference={appearance} />}
      {settingsPages.page === "watchedFolders" && (
        <WatchedFoldersSettings
          folders={watched.folders}
          onChange={watched.setFolders}
          autoAdd={watched.autoAdd}
          onAutoAddChange={watched.setAutoAdd}
        />
      )}
      {settingsPages.page === "storage" && (
        <StoragePanel
          mogis={state.mogis}
          onOpenMogi={(id) => {
            setStorageMogiId(id);
            settingsPages.push("storageMogi");
          }}
          backup={backupPanel.storage}
        />
      )}
      {settingsPages.page === "storageMogi" && storageMogi && (
        <StorageMogi
          mogi={storageMogi}
          busy={busy}
          onDeleteImages={() => persist((latest) => deleteImages(latest, storageMogi.id))}
          onDelete={async () => {
            const success = await persist((latest) => deleteFinishedMogi(latest, storageMogi.id));
            if (success) {
              onMogiDeleted(storageMogi.id);
              settingsPages.back();
            }
            return success;
          }}
        />
      )}
      {backupPanel.panel}
    </Sheet>
  );
}
