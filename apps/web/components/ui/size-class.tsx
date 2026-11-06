"use client";

import { useSyncExternalStore } from "react";

/** Size classes; 1280px only decides whether the sidebar can stay docked. */
export type SizeClass = "compact" | "regular";
const REGULAR = "(min-width: 768px)";
const SIDEBAR = "(min-width: 1280px)";

/** The size class right now, for choosing a surface when it opens. On the server it is compact. */
export function currentSizeClass(): SizeClass {
  if (typeof window === "undefined") return "compact";
  return window.matchMedia(REGULAR).matches ? "regular" : "compact";
}

const subscribe = (change: () => void) => {
  const queries = [REGULAR].map((query) => window.matchMedia(query));
  queries.forEach((query) => query.addEventListener("change", change));
  return () => queries.forEach((query) => query.removeEventListener("change", change));
};

/** The live size class, for script that must follow resizing; first paint still comes from CSS. */
export const useSizeClass = () => useSyncExternalStore(subscribe, currentSizeClass, () => "compact" as SizeClass);

/** Navigation visibility rule, independent of the size classes. */
export const sidebarCanAnchor = () => typeof window !== "undefined" && window.matchMedia(SIDEBAR).matches;
const subscribeSidebar = (change: () => void) => {
  const query = window.matchMedia(SIDEBAR);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
export const useSidebarAnchored = () => useSyncExternalStore(subscribeSidebar, sidebarCanAnchor, () => false);
