export const appearancePreference = {
  key: "mkw-appearance",
  system: "system",
  light: "light",
  dark: "dark",
} as const;

// The preset's --background values, also used by the browser chrome.
export const appearanceColors = { light: "#ffffff", dark: "#0a0a0a" } as const;

export type Appearance =
  typeof appearancePreference.system | typeof appearancePreference.light | typeof appearancePreference.dark;
