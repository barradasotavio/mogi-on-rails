import type { AutomaticBackup } from "@/lib/backup/automatic";

export const settingsTitles = {
  root: "Settings",
  loungeName: "Your Lounge Names",
  appearance: "Appearance",
  watchedFolders: "Watched Folders",
  storage: "Storage",
  storageMogi: "Storage",
  backupDetail: "Before Update",
  restore: "Restore",
};
export type SettingsPage = keyof typeof settingsTitles;
const key = "mkw-update-resume";

// Only an update reload saves the page; it changes neither the URL nor history.
export function saveUpdateResume(page: SettingsPage | null, backup: AutomaticBackup | null) {
  try {
    if (page === "storageMogi") page = "storage";
    if (page) sessionStorage.setItem(key, JSON.stringify({ url: location.href, page, backup }));
    else sessionStorage.removeItem(key);
  } catch {
    /* Updating does not depend on the navigation preference. */
  }
}
export function readUpdateResume(): { page: SettingsPage; backup: AutomaticBackup | null } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.url !== location.href || !Object.hasOwn(settingsTitles, saved.page)) return null;
    if (saved.page === "backupDetail" && !Number.isSafeInteger(saved.backup?.id))
      return { page: "storage", backup: null };
    return { page: saved.page, backup: saved.backup ?? null };
  } catch {
    return null;
  }
}
