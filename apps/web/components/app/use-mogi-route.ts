"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { currentSizeClass } from "@/components/ui/size-class";
import { useToast } from "@/components/ui/toast";
import { withBase } from "@/lib/base-path";
import { decideMogiRoute, type RouteAction, type RouteView } from "@/lib/mogi/route";
import type { TrackerState } from "@/lib/mogi/types";

export function useMogiRoute(state: TrackerState, ready: boolean, remember: (id: string) => void) {
  const toast = useToast();
  const initialized = useRef(false);
  const [mogiId, setMogiId] = useState<string | null>(null);
  const [view, setView] = useState<RouteView | null>(null);
  // Keeps the detail mounted; only the URL decides whether it is visible.
  const [retainedId, setRetainedId] = useState<string | null>(null);
  const navigate = useCallback(
    (action: RouteAction, snapshot: TrackerState = state) => {
      const decision = decideMogiRoute(
        {
          url: window.location.href,
          pushed: window.history.state?.mogiRoute?.pushed === true,
          state: snapshot,
        },
        action,
      );
      if (decision.toast) toast(decision.toast);
      for (const operation of decision.operations) {
        if (operation.type === "back") {
          window.history.back();
          return;
        }
        const historyState = { ...window.history.state, mogiRoute: { pushed: operation.pushed } };
        if (operation.type === "push") window.history.pushState(historyState, "", withBase(operation.url));
        else window.history.replaceState(historyState, "", withBase(operation.url));
      }
      setMogiId(decision.mogiId);
      setView(decision.view ?? null);
      if (decision.mogiId) {
        setRetainedId(decision.mogiId);
        if (snapshot.activeMogiId !== decision.mogiId) remember(decision.mogiId);
      }
    },
    [state, remember, toast],
  );

  useEffect(() => {
    if (!ready) return;
    const pop = () => navigate({ type: "pop" });
    if (!initialized.current) {
      initialized.current = true;
      navigate({ type: "load", sizeClass: currentSizeClass() });
    }
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [ready, navigate]);

  const isCurrent = (id: string | null) => new URL(window.location.href).searchParams.get("mogi") === id;
  return { mogiId, view, retainedId, navigate, isCurrent };
}
