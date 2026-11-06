"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type ActionErrorReport, actionScopeMounted, actionScopeOf } from "@/components/ui/action-error";
import { useToast } from "@/components/ui/toast";

/**
 * A failed action's one sentence, right under the control that triggered it, until the next attempt.
 * An action without a mounted scope (a background action) shows a toast instead.
 */
export function useActionError() {
  const toast = useToast();
  const [actionError, setActionError] = useState<ActionErrorReport | null>(null);
  const interaction = useRef<{ target: Element; at: number } | null>(null);
  const actionErrorKey = useRef(0);
  useEffect(() => {
    function remember(event: Event) {
      if (!(event.target instanceof Element)) return;
      interaction.current = { target: event.target, at: event.timeStamp };
      // Using a control again is the next attempt: the previous sentence goes away.
      if (event.target.closest("button, a, input, select, textarea, [role='radio'], [role='option']"))
        setActionError(null);
    }
    for (const type of ["click", "change", "submit"]) document.addEventListener(type, remember, true);
    return () => {
      for (const type of ["click", "change", "submit"]) document.removeEventListener(type, remember, true);
    };
  }, []);
  /** The scope of the control just used; an action started without one (a background action) has none. */
  const actionOrigin = useCallback(() => {
    const last = interaction.current;
    return last && performance.now() - last.at < 1500 ? actionScopeOf(last.target) : null;
  }, []);
  const showActionError = useCallback(
    (message: string, origin: string | null = actionOrigin()) => {
      // A new key remounts the sentence, so a repeated refusal is announced again.
      if (origin && actionScopeMounted(origin))
        setActionError({ message, scope: origin, key: ++actionErrorKey.current });
      else {
        setActionError(null);
        toast(message);
      }
    },
    [actionOrigin, toast],
  );
  const clearActionError = useCallback(() => setActionError(null), []);
  return { actionError, actionOrigin, showActionError, clearActionError };
}

export type ActionErrors = ReturnType<typeof useActionError>;
