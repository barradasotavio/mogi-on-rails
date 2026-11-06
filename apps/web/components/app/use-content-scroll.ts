"use client";

import { type UIEvent, useLayoutEffect, useRef } from "react";

import { visibleMogiTitle } from "@/components/ui/toolbar";

import { focusSidebarToggle } from "./use-sidebar";

/**
 * Each screen keeps its scroll position for the session and, on arrival, focuses its title — or, on the
 * list, the row of the mogi just left, the sidebar toggle, or the list heading.
 */
export function useContentScroll({
  ready,
  mogiId,
  view,
  retainedId,
}: {
  ready: boolean;
  mogiId: string | null;
  view: string | null;
  retainedId: string | null;
}) {
  const content = useRef<HTMLElement | null>(null);
  const listHeading = useRef<HTMLHeadingElement | null>(null);
  const scrollKey = `mkw-scroll:${mogiId ?? view ?? "list"}`;
  useLayoutEffect(() => {
    const main = content.current;
    if (!ready || !main) return;
    try {
      main.scrollTop = Number(sessionStorage.getItem(scrollKey)) || 0;
    } catch {
      /* Scroll restoration is optional when session storage is unavailable. */
    }
    const target =
      mogiId || view
        ? visibleMogiTitle()
        : Array.from(document.querySelectorAll<HTMLElement>("[data-mogi-id]")).find(
            (row) => row.dataset.mogiId === retainedId && row.getClientRects().length > 0,
          );
    if (target || mogiId || view) target?.focus({ preventScroll: true });
    else if (!focusSidebarToggle()) listHeading.current?.focus({ preventScroll: true });
  }, [ready, mogiId, view, retainedId, scrollKey]);
  function onScroll(event: UIEvent<HTMLElement>) {
    try {
      sessionStorage.setItem(scrollKey, String(event.currentTarget.scrollTop));
    } catch {
      /* Navigation works without session storage. */
    }
  }
  return { content, listHeading, onScroll };
}
