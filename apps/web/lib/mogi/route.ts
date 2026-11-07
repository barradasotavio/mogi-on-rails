import { resultCoverage } from "@mkw/engine";

import type { TrackerState } from "./types.ts";

export type RouteOperation = { type: "replace" | "push"; url: string; pushed: boolean } | { type: "back" };
/** A destination beside the mogis that holds no mogi: the Instructions page, Release Notes or the Tracks screen. */
export type RouteView = "instructions" | "release-notes" | "tracks";
const views: RouteView[] = ["instructions", "release-notes", "tracks"];
export type RouteDecision = { mogiId: string | null; view?: RouteView; operations: RouteOperation[]; toast?: string };
export type RouteAction =
  | { type: "load"; sizeClass: "compact" | "regular" }
  | { type: "pop" }
  | { type: "back" }
  | { type: "open"; id: string }
  | { type: "view"; view: RouteView }
  | { type: "delete"; sizeClass: "compact" | "regular" };

/** Decide the route and history without accessing the browser or changing mogis. */
export function decideMogiRoute(
  input: { url: string; pushed: boolean; state: TrackerState },
  action: RouteAction,
): RouteDecision {
  const params = new URL(input.url, "https://mogi.local").searchParams;
  const mogiId = params.get("mogi");
  const view = mogiId === null ? views.find((entry) => entry === params.get("view")) : undefined;
  // Another destination is already in the URL, so opening one replaces it instead of stacking.
  const away = mogiId !== null || !!view;
  if (action.type === "delete")
    return {
      mogiId: null,
      operations:
        action.sizeClass === "compact" && input.pushed && mogiId !== null
          ? // Also clear the forward entry so Forward cannot reopen an orphaned URL.
            [{ type: "replace", url: "/", pushed: false }, { type: "back" }]
          : [{ type: "replace", url: "/", pushed: false }],
      toast: "Mogi deleted",
    };
  const requestedId = action.type === "open" ? action.id : mogiId;
  if (requestedId !== null && !input.state.mogis.some((mogi) => mogi.id === requestedId))
    return {
      mogiId: null,
      operations: [{ type: "replace", url: "/", pushed: false }],
      toast: "Mogi not found",
    };
  if (action.type === "open")
    return {
      mogiId: action.id,
      operations: [
        {
          type: away ? "replace" : "push",
          url: `/?mogi=${encodeURIComponent(action.id)}`,
          pushed: !away || input.pushed,
        },
      ],
    };
  if (action.type === "view")
    return {
      mogiId: null,
      view: action.view,
      operations:
        view === action.view
          ? []
          : [
              {
                type: away ? "replace" : "push",
                url: `/?view=${action.view}`,
                pushed: !away || input.pushed,
              },
            ],
    };
  if (action.type === "back")
    return input.pushed && away
      ? { mogiId, ...(view ? { view } : {}), operations: [{ type: "back" }] }
      : { mogiId: null, operations: away ? [{ type: "replace", url: "/", pushed: false }] : [] };
  if (view) return { mogiId: null, view, operations: [] };
  if (mogiId !== null || action.type === "pop") return { mogiId, operations: [] };
  // With no mogis at all, Instructions is the landing page: over the list on compact, in its place on regular.
  if (!input.state.mogis.length)
    return {
      mogiId: null,
      view: "instructions",
      operations:
        action.sizeClass === "compact"
          ? [
              { type: "replace", url: "/", pushed: false },
              { type: "push", url: "/?view=instructions", pushed: true },
            ]
          : [{ type: "replace", url: "/?view=instructions", pushed: false }],
    };
  if (action.sizeClass === "compact") {
    const last = input.state.mogis.find(
      (mogi) => mogi.id === input.state.activeMogiId && !resultCoverage(mogi).complete,
    );
    return {
      mogiId: last?.id ?? null,
      operations: last
        ? [
            { type: "replace", url: "/", pushed: false },
            { type: "push", url: `/?mogi=${encodeURIComponent(last.id)}`, pushed: true },
          ]
        : [],
    };
  }
  const inProgress = input.state.mogis.filter((mogi) => !resultCoverage(mogi).complete);
  const last =
    inProgress.find((mogi) => mogi.id === input.state.activeMogiId) ??
    inProgress.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    mogiId: last?.id ?? null,
    operations: last ? [{ type: "replace", url: `/?mogi=${encodeURIComponent(last.id)}`, pushed: false }] : [],
  };
}
