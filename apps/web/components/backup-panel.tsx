"use client";
import { useEffect, useRef, useState } from "react";

import { AutomaticBackups } from "@/components/automatic-backups";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { useUpdateBlock } from "@/components/ui/update-activity";
import { createBackup, inspectBackup } from "@/lib/backup/archive";
import { type AutomaticBackup, backupSize, readAutomaticBackup } from "@/lib/backup/automatic";
import type { TrackerState } from "@/lib/mogi/types";
import type { SettingsPage } from "@/lib/offline/resume";
import { settled } from "@/lib/settled";

// The controller lives in the tracker: switching sheet pages doesn't lose the preview.
const backupPages: SettingsPage[] = ["backupDetail", "restore"];

export function useBackupPanel({
  state,
  onRestore,
  saving,
  automaticBackup,
  onOpenBackup,
  active,
  page,
  onPreview,
  onRestored,
}: {
  state: TrackerState;
  onRestore: (next: TrackerState) => Promise<boolean>;
  saving: boolean;
  automaticBackup: AutomaticBackup | null;
  onOpenBackup: (entry: AutomaticBackup) => void;
  active: boolean;
  page: SettingsPage;
  onPreview: () => void;
  onRestored: () => void;
}) {
  const [preview, setPreview] = useState<TrackerState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState<{ page: SettingsPage; message: string } | null>(null);
  useUpdateBlock(working || (active && page === "restore" && preview !== null));
  const generation = useRef(0);
  const filePicker = useRef<HTMLInputElement>(null);
  const replaceAction = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  /** Hands the ZIP to the browser's save; the save or share sheet is the confirmation. */
  function download(file: File) {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    // Some browsers read the URL after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  async function downloadAutomatic() {
    if (!automaticBackup) return;
    setWorking(true);
    setError(null);
    return settled(
      async () => {
        try {
          const zip = await readAutomaticBackup(automaticBackup.id);
          download(
            new File([zip], `mkw-before-update-${automaticBackup.createdAt.replace(/[:.]/g, "-")}.zip`, {
              type: "application/zip",
            }),
          );
        } catch {
          setError({ page, message: "Couldn't open this backup. Try again." });
        }
      },
      () => {
        setWorking(false);
      },
    );
  }
  async function exportCurrent() {
    const current = ++generation.current;
    setInspecting(false);
    setWorking(true);
    setError(null);
    return settled(
      async () => {
        try {
          const blob = await createBackup(state);
          if (current !== generation.current) return;
          download(
            new File([blob], `mogi-on-rails-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`, {
              type: "application/zip",
            }),
          );
        } catch (cause) {
          setError({ page, message: cause instanceof Error ? cause.message : "Couldn't export the backup." });
        }
      },
      () => {
        setWorking(false);
      },
    );
  }
  async function select(file: Blob | undefined) {
    if (!file) return;
    const current = ++generation.current;
    setInspecting(true);
    setWorking(true);
    setError(null);
    setPreview(null);
    setConfirming(false);
    return settled(
      async () => {
        try {
          const restored = await inspectBackup(file);
          if (current === generation.current) {
            setPreview(restored.state);
            onPreview();
          }
        } catch (cause) {
          if (current === generation.current)
            setError({ page, message: cause instanceof Error ? cause.message : "Couldn't open the backup." });
        }
      },
      () => {
        if (current === generation.current) {
          setWorking(false);
          setInspecting(false);
        }
      },
    );
  }
  async function previewAutomatic() {
    if (!automaticBackup) return;
    setWorking(true);
    setError(null);
    return settled(
      async () => {
        try {
          await select(await readAutomaticBackup(automaticBackup.id));
        } catch {
          setError({ page, message: "Couldn't open this backup. Try again." });
        }
      },
      () => {
        setWorking(false);
      },
    );
  }
  async function restore() {
    if (!preview || working || saving) return;
    setWorking(true);
    setError(null);
    return settled(
      async () => {
        try {
          if (await onRestore(preview)) {
            setPreview(null);
            // The restored data is the confirmation.
            onRestored();
          } else
            setError({
              page,
              message:
                "Couldn't restore the backup. Free up space or allow storage, then try again. Your previous data is safe.",
            });
        } catch {
          setError({ page, message: "Couldn't restore the backup. Your previous data is safe." });
        }
      },
      () => {
        setWorking(false);
        setConfirming(false);
      },
    );
  }
  const races = preview?.mogis.reduce((total, mogi) => total + mogi.races.length, 0) ?? 0;
  const images =
    preview?.mogis.reduce(
      (total, mogi) => total + (mogi.captures?.filter((capture) => capture.original !== null).length ?? 0),
      0,
    ) ?? 0;
  const pendingImages = preview?.sharedReceipts?.reduce((total, receipt) => total + receipt.files.length, 0) ?? 0;
  const disabled = working || saving;
  const failure = error?.page === page && (
    <Alert variant="destructive">
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
  const activity = working && !saving && (
    <ListGroup>
      <List aria-label="File activity">
        <ListRow>
          <span role="status">Preparing the file on this device…</span>
        </ListRow>
        {inspecting && (
          <ListRow
            action="primary"
            onSelect={() => {
              generation.current++;
              setWorking(false);
              setInspecting(false);
              setPreview(null);
            }}
          >
            Cancel Inspection
          </ListRow>
        )}
      </List>
    </ListGroup>
  );
  // Settings › Storage holds Save Backup, Restore from File and the automatic backups, with their outcome.
  const storage = (
    <>
      {page === "storage" && failure}
      <ListGroup
        title="Backup"
        note="A ZIP with every mogi and its screenshots. Restoring one replaces everything on this device."
      >
        <List aria-label="Backup">
          <ListRow action="primary" disabled={disabled} onSelect={() => void exportCurrent()}>
            Save Backup
          </ListRow>
          <ListRow action="primary" disabled={disabled} onSelect={() => filePicker.current?.click()}>
            Restore from File…
          </ListRow>
        </List>
      </ListGroup>
      <Input
        ref={filePicker}
        hidden
        aria-label="Restore from file"
        type="file"
        accept=".zip,application/zip"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void select(file);
        }}
      />
      {page === "storage" && activity}
      <AutomaticBackups
        onSelect={(entry) => {
          setError(null);
          onOpenBackup(entry);
        }}
      />
    </>
  );
  // The page decides what shows, not `active`: content stays while the sheet animates out.
  if (!backupPages.includes(page)) return { panel: null, storage };
  const panel = (
    <div className="section-stack">
      {failure}
      {page === "backupDetail" && automaticBackup && (
        <>
          <ListGroup>
            <List aria-label="Backup details">
              <ListRow trail={automaticBackup.mogiCount}>Mogis</ListRow>
              <ListRow trail={backupSize(automaticBackup.size)}>Size</ListRow>
              <ListRow trail={automaticBackup.build.slice(0, 7)}>App version</ListRow>
            </List>
          </ListGroup>
          <ListGroup>
            <List aria-label="Backup actions">
              <ListRow action="primary" disabled={disabled} onSelect={() => void downloadAutomatic()}>
                Download ZIP
              </ListRow>
              <ListRow action="primary" disabled={disabled} onSelect={() => void previewAutomatic()}>
                Restore…
              </ListRow>
            </List>
          </ListGroup>
        </>
      )}
      {page === "restore" && preview && (
        <>
          <ListGroup
            note={
              pendingImages
                ? `${pendingImages} ${pendingImages === 1 ? "screenshot awaiting" : "screenshots awaiting"} review in this backup.`
                : undefined
            }
          >
            <List aria-label="Summary">
              <ListRow trail={preview.mogis.length}>Mogis</ListRow>
              <ListRow trail={races}>Races</ListRow>
              <ListRow trail={images}>Screenshots</ListRow>
            </List>
          </ListGroup>
          <ListGroup title="Mogis">
            <List aria-label="Mogis">
              {preview.mogis.map((mogi) => (
                <ListRow
                  key={mogi.id}
                  description={`${mogi.format} · ${mogi.races.length} ${mogi.races.length === 1 ? "race" : "races"}`}
                >
                  {mogi.name}
                </ListRow>
              ))}
            </List>
          </ListGroup>
          <ListGroup>
            <List aria-label="Restore actions">
              <ListRow action="primary" disabled={disabled} onSelect={() => void exportCurrent()}>
                Save Backup First
              </ListRow>
              <ListRow
                action="destructive"
                disabled={disabled}
                onSelect={() => setConfirming(true)}
                buttonProps={{ ref: replaceAction }}
              >
                Replace All Data
              </ListRow>
            </List>
          </ListGroup>
          <ConfirmationDialog
            open={confirming}
            onOpenChange={setConfirming}
            title="Replace All Data on This Device?"
            description={`Your current mogis will be replaced by the ${preview.mogis.length} in this backup.`}
            confirmLabel="Replace"
            busy={disabled}
            onConfirm={restore}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              replaceAction.current?.focus();
            }}
          />
        </>
      )}
      {activity}
    </div>
  );
  return { panel, storage };
}
