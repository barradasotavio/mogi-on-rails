"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

import { List, ListGroup, ListRow } from "@/components/ui/list";
import { type Appearance, appearanceColors, appearancePreference } from "@/lib/appearance";

const changeEvent = "mkw-appearance-change";
const appearanceChoices: { value: Appearance; label: string }[] = [
  { value: appearancePreference.system, label: "System" },
  { value: appearancePreference.light, label: "Light" },
  { value: appearancePreference.dark, label: "Dark" },
];
function readPreference(): Appearance {
  try {
    const value = localStorage.getItem(appearancePreference.key);
    return value === appearancePreference.light || value === appearancePreference.dark
      ? value
      : appearancePreference.system;
  } catch {
    return appearancePreference.system;
  }
}
function subscribePreference(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(changeEvent, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(changeEvent, notify);
  };
}
function subscribeSystem(notify: () => void) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
function systemIsDark() {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}
function defaultPreference(): Appearance {
  return appearancePreference.system;
}
function serverIsDark() {
  return false;
}
export function useAppearance() {
  const preference = useSyncExternalStore(subscribePreference, readPreference, defaultPreference);
  const systemDark = useSyncExternalStore(subscribeSystem, systemIsDark, serverIsDark);
  useEffect(() => {
    // Hydration starts with server snapshots. Read the live choice so that
    // fallback never replaces the theme already applied by the head script.
    const current = readPreference();
    const dark = current === appearancePreference.dark || (current === appearancePreference.system && systemIsDark());
    document.documentElement.classList.toggle(appearancePreference.dark, dark);
    document.documentElement.classList.toggle(appearancePreference.light, !dark);
    const color = dark ? appearanceColors.dark : appearanceColors.light;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", color);
    });
  }, [preference, systemDark]);
  return preference;
}
export function AppearanceSettings({ preference }: { preference: Appearance }) {
  const [error, setError] = useState("");
  function change(value: Appearance) {
    try {
      localStorage.setItem(appearancePreference.key, value);
      window.dispatchEvent(new Event(changeEvent));
      setError("");
    } catch {
      setError("Couldn't save your appearance. Allow storage and try again.");
    }
  }
  return (
    <ListGroup
      note={
        error ? (
          <span id="appearance-error" className="text-destructive">
            {error}
          </span>
        ) : undefined
      }
    >
      <List aria-label="Appearance" aria-describedby={error ? "appearance-error" : undefined}>
        {appearanceChoices.map(({ value, label }) => (
          <ListRow key={value} accessory={preference === value ? "check" : undefined} onSelect={() => change(value)}>
            {label}
          </ListRow>
        ))}
      </List>
    </ListGroup>
  );
}
