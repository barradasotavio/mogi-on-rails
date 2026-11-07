import notes from "../release-notes.json" with { type: "json" };

export type ReleaseChange = { kind: "new" | "fix"; text: string };
export type ReleaseDate = { date: string; changes: ReleaseChange[] };

/** The Release Notes page's entries, newest date first; bundled, so they read offline. */
export const releaseNotes = notes as ReleaseDate[];

const longDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "2026-11-07" → "November 7, 2026", read in UTC so no time zone moves the day. */
export function releaseDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return longDate.format(Date.UTC(year, month - 1, day));
}
