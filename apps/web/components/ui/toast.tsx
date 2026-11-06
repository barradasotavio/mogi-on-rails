"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { currentSizeClass } from "@/components/ui/size-class";
import { toastDuration } from "@/lib/toast";

/** Only a shortcut to something reachable elsewhere; a decision is an alert or a sheet, never a toast. */
export interface ToastAction {
  label: "Undo" | "Open";
  onClick: () => void;
}
const ToastContext = createContext<(message: string, action?: ToastAction) => void>(() => {});

/** Transient feedback that never asks for a decision. */
export const useToast = () => useContext(ToastContext);

const exitDuration = 200;
const swipeDistance = 40;
type Pause = "hover" | "focus" | "drag" | "hidden";

/**
 * One polite live region for the app: a small capsule of regular glass, centered, one line where it fits,
 * above the bottom controls on compact and at the top on regular. The timer pauses on hover, focus and a hidden page; a swipe in the entry direction or
 * Escape dismisses it. Each message replaces the previous one. It animates out before it unmounts; reduced
 * motion keeps only the fade.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; action?: ToastAction; id: number; open: boolean } | null>(null);
  const timer = useRef(0);
  const exit = useRef(0);
  const remaining = useRef(0);
  const started = useRef(0);
  const active = useRef(false);
  const pauses = useRef(new Set<Pause>());
  const drag = useRef<{ pointer: number; y: number; direction: 1 | -1 } | null>(null);

  const close = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    clearTimeout(timer.current);
    setToast((current) => current && { ...current, open: false });
    exit.current = window.setTimeout(() => setToast((current) => (current?.open ? current : null)), exitDuration);
  }, []);
  const run = useCallback(() => {
    clearTimeout(timer.current);
    if (!active.current || pauses.current.size) return;
    started.current = Date.now();
    timer.current = window.setTimeout(close, remaining.current);
  }, [close]);
  const pause = useCallback((reason: Pause) => {
    if (pauses.current.has(reason)) return;
    if (active.current && !pauses.current.size) {
      remaining.current -= Date.now() - started.current;
      clearTimeout(timer.current);
    }
    pauses.current.add(reason);
  }, []);
  const resume = useCallback(
    (reason: Pause) => {
      if (pauses.current.delete(reason)) run();
    },
    [run],
  );

  useEffect(() => {
    const sync = () => (document.visibilityState === "hidden" ? pause("hidden") : resume("hidden"));
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      clearTimeout(timer.current);
      clearTimeout(exit.current);
    };
  }, [pause, resume]);

  const show = useCallback(
    (message: string, action?: ToastAction) => {
      clearTimeout(exit.current);
      // The new capsule mounts in place of the old one: only the page's own state carries over.
      for (const reason of ["hover", "focus", "drag"] as const) pauses.current.delete(reason);
      drag.current = null;
      remaining.current = toastDuration(message);
      active.current = true;
      setToast((current) => ({ message, action, id: (current?.id ?? 0) + 1, open: true }));
      run();
    },
    [run],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="toast-offset pointer-events-none fixed inset-x-0 z-60 flex justify-center px-4"
      >
        {toast && (
          // The capsule takes focus so Escape can dismiss it, as a native toast region does.
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            key={toast.id}
            data-toast
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            data-state={toast.open ? "open" : "closed"}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close();
              }
            }}
            onFocus={() => pause("focus")}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) resume("focus");
            }}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") pause("hover");
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") resume("hover");
            }}
            onPointerDown={(event) => {
              if (!toast.open || (event.target as Element).closest("button")) return;
              drag.current = {
                pointer: event.pointerId,
                y: event.clientY,
                direction: currentSizeClass() === "compact" ? 1 : -1,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              pause("drag");
            }}
            onPointerMove={(event) => {
              const swipe = drag.current;
              if (!swipe || swipe.pointer !== event.pointerId) return;
              // Only the entry direction moves; the other way stays put.
              const offset = Math.max(0, (event.clientY - swipe.y) * swipe.direction);
              event.currentTarget.style.transform = `translateY(${offset * swipe.direction}px)`;
            }}
            onPointerUp={(event) => {
              const swipe = drag.current;
              if (!swipe || swipe.pointer !== event.pointerId) return;
              drag.current = null;
              if ((event.clientY - swipe.y) * swipe.direction > swipeDistance) {
                close();
                return;
              }
              event.currentTarget.style.transform = "";
              resume("drag");
            }}
            onPointerCancel={(event) => {
              drag.current = null;
              event.currentTarget.style.transform = "";
              resume("drag");
            }}
            className="glass pointer-events-auto flex min-h-9 max-w-md touch-none select-none items-center justify-center gap-2 rounded-full px-4 py-1.5 text-center text-sm font-medium text-foreground outline-none duration-200 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:fill-mode-forwards motion-safe:data-[state=open]:slide-in-from-bottom-2 motion-safe:data-[state=closed]:slide-out-to-bottom-2 md:motion-safe:data-[state=open]:slide-in-from-top-2 md:motion-safe:data-[state=closed]:slide-out-to-top-2"
          >
            <span>{toast.message}</span>
            {toast.action && (
              <Button
                variant="ghost"
                onClick={() => {
                  const action = toast.action!;
                  close();
                  action.onClick();
                }}
              >
                {toast.action.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
