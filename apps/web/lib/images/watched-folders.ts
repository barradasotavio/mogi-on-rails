/**
 * Watched Folders: folders on this computer whose new screenshots the app offers during a mogi. The folder
 * handles, and whether new screenshots skip the confirmation, stay in their own database on this device; they
 * never join the tracker state or the backup, because a handle only means something to the browser that
 * granted it. Access is read-only.
 */

type Permission = "granted" | "denied" | "prompt";
/** The File System Access parts this module uses; TypeScript's DOM types leave them out. */
type ReadableDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission(options: { mode: "read" }): Promise<Permission>;
  requestPermission(options: { mode: "read" }): Promise<Permission>;
};
declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: "read" }) => Promise<FileSystemDirectoryHandle>;
  }
}

export interface WatchedFolder {
  id: number;
  handle: FileSystemDirectoryHandle;
  name: string;
  /** Files already offered, by `offerKey`: Cancel stores nothing and they are not offered again. */
  offered: string[];
}
export interface FolderImage {
  folderId: number;
  key: string;
  file: File;
}

/** Only Chrome and Edge on a computer let a page pick a folder. */
export const canWatchFolders = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

const imageName = /\.(png|jpe?g|webp)$/i;
const offerKey = (file: File) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
/** Offered in this session, before the database catches up, so a check in between doesn't offer them twice. */
const offeredNow = new Set<string>();
/** Each file's last sight, by folder and name: a file is offered only once two checks see it unchanged. */
const lastSeen = new Map<string, string>();
/** At most what intake takes at once; the rest comes in the next check. */
const offerLimit = 32;

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mkw-watched-folders", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("folders"))
        db.createObjectStore("folders", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  storeName: "folders" | "settings" = "folders",
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const readWatchedFolders = () => transact<WatchedFolder[]>("readonly", (store) => store.getAll());

/** Adds a folder unless the same one is already watched; returns the list as saved. */
export async function addWatchedFolder(handle: FileSystemDirectoryHandle): Promise<WatchedFolder[]> {
  const folders = await readWatchedFolders();
  for (const folder of folders) if (await folder.handle.isSameEntry(handle)) return folders;
  await transact("readwrite", (store) => store.add({ handle, name: handle.name, offered: [] }));
  return readWatchedFolders();
}
export async function removeWatchedFolder(id: number): Promise<WatchedFolder[]> {
  await transact("readwrite", (store) => store.delete(id));
  return readWatchedFolders();
}

/** Whether new screenshots go straight to the mogi, without the confirmation sheet: one choice for every folder. */
export const readAutoAdd = async () =>
  (await transact<unknown>("readonly", (store) => store.get("autoAdd"), "settings")) === true;
export async function saveAutoAdd(on: boolean) {
  await transact("readwrite", (store) => store.put(on, "autoAdd"), "settings");
}

export async function folderAccess(folder: WatchedFolder): Promise<Permission> {
  return (folder.handle as ReadableDirectory).queryPermission({ mode: "read" });
}
/** Asks the browser again for a folder it stopped allowing; needs the user's tap. */
export async function allowFolder(folder: WatchedFolder): Promise<boolean> {
  return (await (folder.handle as ReadableDirectory).requestPermission({ mode: "read" })) === "granted";
}

/**
 * Images in the allowed folders that were not offered before and whose file date is at or after `since`.
 * Every other file is ignored after its name and date; nothing is read, moved or changed.
 */
export async function newFolderImages(folders: WatchedFolder[], since: number): Promise<FolderImage[]> {
  const found: FolderImage[] = [];
  let changing = false;
  for (const folder of folders) {
    if ((await folderAccess(folder).catch(() => "denied")) !== "granted") continue;
    const offered = new Set(folder.offered);
    try {
      for await (const entry of (folder.handle as ReadableDirectory).values()) {
        if (entry.kind !== "file" || !imageName.test(entry.name)) continue;
        const file = await (entry as FileSystemFileHandle).getFile();
        const key = offerKey(file);
        if (file.lastModified < since || offered.has(key) || offeredNow.has(`${folder.id}\u0000${key}`)) continue;
        // A file still being written (a sync or a move in progress) holds the offer until it stops changing,
        // so images that arrive together are offered together.
        const place = `${folder.id}\u0000${file.name}`;
        if (file.size === 0 || lastSeen.get(place) !== key) changing = true;
        lastSeen.set(place, key);
        found.push({ folderId: folder.id, key, file });
      }
    } catch {
      // A folder moved or deleted on disk is skipped until it comes back.
    }
  }
  if (changing) return [];
  return found.sort((a, b) => a.file.lastModified - b.file.lastModified).slice(0, offerLimit);
}

/** Remembers that these images were offered, whatever the player chose. */
export async function markOffered(images: FolderImage[]) {
  for (const image of images) offeredNow.add(`${image.folderId}\u0000${image.key}`);
  const folders = await readWatchedFolders();
  for (const folder of folders) {
    const keys = images.filter((image) => image.folderId === folder.id).map((image) => image.key);
    if (keys.length)
      await transact("readwrite", (store) =>
        store.put({ ...folder, offered: [...new Set([...folder.offered, ...keys])] }),
      );
  }
}
