"use client";

import { useEffect, useRef, useState } from "react";

import { usePageStack } from "@/components/ui/sheet";
import type { AutomaticBackup } from "@/lib/backup/automatic";
import { readUpdateResume, type SettingsPage } from "@/lib/offline/resume";

import type { SidebarHandle } from "./use-sidebar";

export type AppSheet = "settings" | "create";

/**
 * Settings and New Mogi: one sheet at a time, Settings reopening on its page after an update reload.
 * Focus returns to the control that opened the sheet while its mogi is still the one shown.
 */
export function useSheets(
  sidebar: SidebarHandle,
  {
    mogiId,
    isCurrent,
    onOpen,
  }: {
    mogiId: string | null;
    isCurrent: (id: string | null) => boolean;
    /** Opening a sheet clears the concurrent-write notice. */
    onOpen: () => void;
  },
) {
  const [resume] = useState(readUpdateResume);
  const [sheet, setSheet] = useState<AppSheet | null>(resume ? "settings" : null);
  const [automaticBackup, setAutomaticBackup] = useState<AutomaticBackup | null>(resume?.backup ?? null);
  const settingsPages = usePageStack<SettingsPage>("root", resume?.page ?? "root");
  const trigger = useRef<HTMLElement | null>(null);
  const origin = useRef<string | null>(null);
  function open(next: AppSheet, page: SettingsPage = "root") {
    trigger.current = sidebar.handOff();
    origin.current = mogiId;
    onOpen();
    settingsPages.reset();
    if (page !== "root") settingsPages.push(page);
    setSheet(next);
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    if (isCurrent(origin.current)) trigger.current?.focus();
  }
  useEffect(() => {
    const close = () => setSheet(null);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);
  return { sheet, open, close: () => setSheet(null), restoreFocus, settingsPages, automaticBackup, setAutomaticBackup };
}

export type SheetsHandle = ReturnType<typeof useSheets>;
