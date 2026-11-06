"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { IconButton } from "@/components/ui/icon-button";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import {
  addWatchedFolder,
  allowFolder,
  canWatchFolders,
  folderAccess,
  type FolderImage,
  newFolderImages,
  readWatchedFolders,
  removeWatchedFolder,
  type WatchedFolder,
} from "@/lib/images/watched-folders";

/** How often an open mogi in progress checks its folders when the browser can't report changes. */
const checkEvery = 3000;

type Observer = { observe(handle: FileSystemHandle): Promise<void>; disconnect(): void };
declare global {
  interface Window {
    FileSystemObserver?: new (callback: () => void) => Observer;
  }
}

/** The watched folders on this device, and whether this browser can watch any (no row at all where it can't). */
export function useWatchedFolders() {
  const [supported, setSupported] = useState(false);
  const [folders, setFolders] = useState<WatchedFolder[]>([]);
  useEffect(() => {
    if (!canWatchFolders()) return;
    void readWatchedFolders().then(
      (saved) => {
        setFolders(saved);
        setSupported(true);
      },
      () => setSupported(true),
    );
  }, []);
  return { supported, folders, setFolders };
}

/** The Settings row's trail: the one folder, or how many. */
export const foldersTrail = (folders: WatchedFolder[]) =>
  folders.length > 1 ? `${folders.length} folders` : folders[0]?.name;

/**
 * Checks the folders while `since` is set (a mogi in progress is open) and the page is visible: at once, on
 * every change the browser reports, and every few seconds. `found` gets only images never offered before;
 * a check is skipped while a sheet or dialog is open, so nothing interrupts the player.
 */
export function useFolderWatch(
  folders: WatchedFolder[],
  since: number | null,
  found: (images: FolderImage[]) => Promise<void>,
) {
  const latest = useRef(found);
  useEffect(() => {
    latest.current = found;
  });
  useEffect(() => {
    if (since === null || !folders.length) return;
    let checking = false;
    let stopped = false;
    async function check() {
      if (checking || stopped || document.visibilityState !== "visible") return;
      if (
        document.querySelector(
          '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"])',
        )
      )
        return;
      checking = true;
      // A failed check changes nothing; the next one tries again.
      const images = await newFolderImages(folders, since!).catch(() => []);
      if (images.length && !stopped) await latest.current(images).catch(() => {});
      checking = false;
    }
    void check();
    const timer = setInterval(() => void check(), checkEvery);
    const visible = () => void check();
    document.addEventListener("visibilitychange", visible);
    let observer: Observer | undefined;
    if (window.FileSystemObserver) {
      try {
        observer = new window.FileSystemObserver(() => void check());
        for (const folder of folders) observer.observe(folder.handle).catch(() => {});
      } catch {
        observer = undefined;
      }
    }
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      observer?.disconnect();
    };
  }, [folders, since]);
}

/** An abort sooner than this after asking came from the browser, not from someone closing the picker. */
const pickerRefusal = 500;
/** What failed, then the browser's own words when it gave any. */
const refusal = (cause: unknown, what: string) =>
  cause instanceof Error && cause.message ? `${what} ${cause.message}` : what;

/**
 * Settings › Watched Folders:folders whose new screenshots are offered during a mogi, as a paste is.
 * The app only reads them; access is the browser's, asked again here when the browser has dropped it.
 */
export function WatchedFoldersSettings({
  folders,
  onChange,
}: {
  folders: WatchedFolder[];
  onChange: (folders: WatchedFolder[]) => void;
}) {
  const [blocked, setBlocked] = useState<number[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void Promise.all(
      folders.map(async (folder) => [folder.id, await folderAccess(folder).catch(() => "denied")] as const),
    ).then((access) => {
      if (alive) setBlocked(access.filter(([, state]) => state !== "granted").map(([id]) => id));
    });
    return () => {
      alive = false;
    };
  }, [folders]);
  async function add() {
    setError("");
    const asked = Date.now();
    try {
      const handle = await window.showDirectoryPicker!({ id: "watched-folder", mode: "read" });
      onChange(await addWatchedFolder(handle));
    } catch (cause) {
      // Closing the picker is a silent cancel. An app that embeds a browser can refuse with the same AbortError
      // before any picker shows, so an abort faster than anyone could close one is shown as a refusal.
      if (cause instanceof DOMException && cause.name === "AbortError" && Date.now() - asked >= pickerRefusal) return;
      setError(
        refusal(
          cause,
          cause instanceof DOMException && cause.name === "AbortError"
            ? "This browser closed the folder picker on its own. Open the app in Chrome or Edge to add a folder."
            : "Couldn't add this folder.",
        ),
      );
    }
  }
  async function allow() {
    setError("");
    for (const folder of folders.filter((entry) => blocked.includes(entry.id))) {
      const granted = await allowFolder(folder).catch((cause: unknown) => {
        setError(refusal(cause, "Couldn't allow access."));
        return true;
      });
      if (!granted) setError(`The browser didn't allow access to ${folder.name}.`);
    }
    onChange([...folders]);
  }
  function remove(folder: WatchedFolder) {
    setError("");
    void removeWatchedFolder(folder.id).then(onChange, (cause: unknown) =>
      setError(refusal(cause, "Couldn't remove this folder.")),
    );
  }
  return (
    <div className="section-stack">
      {folders.length > 0 && (
        <ListGroup note="New screenshots in these folders are offered while a mogi is in progress.">
          <List aria-label="Watched folders">
            {folders.map((folder) => (
              <ListRow
                key={folder.id}
                description={blocked.includes(folder.id) ? "Access needed" : undefined}
                trail={
                  <IconButton aria-label={`Remove ${folder.name}`} className="-mr-3" onClick={() => remove(folder)}>
                    <X aria-hidden="true" />
                  </IconButton>
                }
              >
                {folder.name}
              </ListRow>
            ))}
          </List>
        </ListGroup>
      )}
      {blocked.length > 0 && (
        <ListGroup note="The browser stopped allowing the app to read these folders.">
          <List>
            <ListRow action="primary" onSelect={() => void allow()}>
              Allow Access
            </ListRow>
          </List>
        </ListGroup>
      )}
      <ListGroup note="Chrome can't watch Downloads, Desktop or Documents themselves, but it can watch a folder inside them.">
        <List>
          <ListRow action="primary" onSelect={() => void add()}>
            Add Folder
          </ListRow>
        </List>
      </ListGroup>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
