import { useSyncExternalStore } from "react";

/** Whether the app runs installed (`standalone`), the browser offers its own prompt, or neither. */
export type InstallContext = "standalone" | "prompt" | "browser";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    mkwInstallPrompt?: InstallPromptEvent;
  }
  interface Navigator {
    standalone?: boolean;
  }
}

/**
 * Inline in the document head: Chrome may fire `beforeinstallprompt` before the app's scripts run.
 * It keeps the event so Instructions' Install App can open the native prompt later, instead of the browser's own banner.
 */
export const installPromptScript = `addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); window.mkwInstallPrompt = event; });`;

const listeners = new Set<() => void>();
let accepted = false;
function notify() {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  // The head script stores the event first; this listener only tells subscribers.
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    window.mkwInstallPrompt = event as InstallPromptEvent;
    notify();
  });
  addEventListener("appinstalled", () => {
    accepted = true;
    window.mkwInstallPrompt = undefined;
    notify();
  });
}

/** The system whose install steps Instructions shows first. */
export type InstallPlatform = "ios" | "android" | "mac-safari" | "desktop";

export function installPlatform(): InstallPlatform {
  const agent = navigator.userAgent;
  // iPadOS reports a Mac; touch tells them apart. Every iOS browser adds to the Home Screen through Share.
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(agent)) return "android";
  if (
    /Macintosh/.test(agent) &&
    /Version\/[\d.]+.* Safari\//.test(agent) &&
    !/Chrome|Chromium|Edg|Firefox|OPR/.test(agent)
  )
    return "mac-safari";
  return "desktop";
}

export function installContext(): InstallContext {
  if (accepted || matchMedia("(display-mode: standalone)").matches || navigator.standalone === true)
    return "standalone";
  return window.mkwInstallPrompt ? "prompt" : "browser";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const standalone = matchMedia("(display-mode: standalone)");
  standalone.addEventListener?.("change", listener);
  return () => {
    listeners.delete(listener);
    standalone.removeEventListener?.("change", listener);
  };
}

/** The current context; before hydration it is `standalone`, so nothing about installing flashes in. */
export function useInstallContext() {
  return useSyncExternalStore(subscribe, installContext, () => "standalone" as const);
}

/** Opens the browser's own prompt. The event works once: afterwards Install App hides and the steps remain. */
export async function promptInstall() {
  const event = window.mkwInstallPrompt;
  if (!event) return;
  try {
    await event.prompt();
    if ((await event.userChoice).outcome === "accepted") accepted = true;
  } finally {
    window.mkwInstallPrompt = undefined;
    notify();
  }
}
