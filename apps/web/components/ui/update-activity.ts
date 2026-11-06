"use client";
import { useLayoutEffect } from "react";

const blockers = new Set<symbol>();
// Surface work is checked at activation time so opening or closing it needs no tracker render.
export const updatesBlocked = () => blockers.size > 0;

// Reload only after opening and tracker work finish, preserving unsaved edits and readings.
export function updateIdle(activity: {
  ready: boolean;
  openingComplete: boolean;
  busy: boolean;
  draftWrites: number;
  reading: boolean;
  imagesOpen: boolean;
  editingRace: boolean;
  editingName: boolean;
  sheet: "settings" | "create" | null;
  screen: string;
}): boolean {
  return (
    activity.ready &&
    activity.openingComplete &&
    !activity.busy &&
    !activity.draftWrites &&
    !activity.reading &&
    !activity.imagesOpen &&
    !activity.editingRace &&
    !activity.editingName &&
    activity.sheet !== "create" &&
    ["dashboard", "tracks", "instructions", "list"].includes(activity.screen)
  );
}

// Activity belongs to the surface, even when the tracker did not open it.
export function useUpdateBlock(blocked: boolean) {
  useLayoutEffect(() => {
    if (!blocked) return;
    const id = Symbol();
    blockers.add(id);
    return () => {
      blockers.delete(id);
    };
  }, [blocked]);
}
