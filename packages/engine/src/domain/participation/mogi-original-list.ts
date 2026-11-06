import type { Mogi } from "../types.ts";
import { rosterSlots } from "./participation.ts";

/** Keeps the pasted text; old backups use only the original participations. */
export function mogiOriginalList(mogi: Mogi): string {
  if (mogi.originalList !== undefined) return mogi.originalList;
  const slots = rosterSlots(mogi);
  const groups =
    mogi.format === "FFA"
      ? slots.map((person) => [person])
      : [...new Set(slots.map((person) => person.teamId))].map((teamId) =>
          slots.filter((person) => person.teamId === teamId),
        );
  return [
    `Tier ${mogi.submissionTier ?? "—"}`,
    mogi.format,
    ...groups.map((people, index) => `${index + 1}. ${people.map((person) => person.loungeName).join(", ")}`),
  ].join("\n");
}
