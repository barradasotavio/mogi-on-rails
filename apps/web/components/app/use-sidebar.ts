"use client";

import { useEffect, useRef, useState } from "react";

import { sidebarCanAnchor, useSidebarAnchored } from "@/components/ui/size-class";

/** Focuses the sidebar toggle in view: the sidebar's own while it is open, the toolbar's otherwise. */
export function focusSidebarToggle() {
  const toggle = Array.from(document.querySelectorAll<HTMLElement>("[data-show-mogis]")).find(
    (element) => element.getClientRects().length > 0 && !element.closest("[inert]"),
  );
  toggle?.focus({ preventScroll: true });
  return !!toggle;
}

/**
 * The mogis sidebar: docked and remembered where the window is wide enough to anchor it,
 * an overlay otherwise. Focus returns to the toggle that opened it.
 */
export function useSidebar() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => {
    try {
      return typeof window === "undefined" || localStorage.getItem("mkw-sidebar-open") !== "false";
    } catch {
      return true;
    }
  });
  const anchored = useSidebarAnchored();
  // Opening a sheet from the overlay hands focus to the sheet: closing the overlay doesn't take it back.
  const handoff = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);
  function toggle() {
    if (sidebarCanAnchor()) {
      const next = !expanded;
      setExpanded(next);
      try {
        localStorage.setItem("mkw-sidebar-open", String(next));
      } catch {
        /* The choice remains valid for this session. */
      }
      // The toggle jumps between the sidebar and the toolbar; focus follows it.
      if (document.activeElement?.hasAttribute("data-show-mogis")) requestAnimationFrame(focusSidebarToggle);
      return;
    }
    trigger.current = document.activeElement as HTMLElement;
    handoff.current = false;
    setOpen((value) => !value);
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    if (handoff.current) return;
    focusSidebarToggle();
  }
  /** Closes the overlay for a sheet; returns the element focus goes back to when the sheet closes. */
  function handOff(): HTMLElement {
    const target = open ? trigger.current : (document.activeElement as HTMLElement);
    handoff.current = open;
    setOpen(false);
    return target as HTMLElement;
  }
  return { open, setOpen, expanded, anchored, toggle, restoreFocus, handOff };
}

export type SidebarHandle = ReturnType<typeof useSidebar>;
