import type { Mogi } from "../types.ts";
import { rosterSlots } from "./participation.ts";

export interface TeamTag {
  teamId: string;
  /** Position of the team in the bot list, from 1. */
  number: number;
  /** Shown tag: the chosen one, or the inferred one when no other team inferred the same. */
  tag: string | null;
  /** Tag the in-game names suggest, before any collision with other teams. */
  inferred: string | null;
  /** The user chose the tag (even an empty one); the choice always wins. */
  chosen: boolean;
}

/** Effective label, never reusing team names stored in old data. */
export function teamLabel(mogi: Mogi, teamId: string): string {
  const team = inferTeamTags(mogi).find((team) => team.teamId === teamId);
  return team ? team.tag || `Team ${team.number}` : "";
}

/**
 * Candidates are the alphanumeric starts of each in-game name, up to 4 characters. The one most members
 * use wins; on a tie, the one someone separated from the name with a space ("VS Kamek"), then the longest.
 * Needs a majority or, in a team split in half, a space after the tag.
 */
function inferTag(igns: string[]): string | null {
  const head = (ign: string) => ign.match(/^[\p{L}\p{N}]+/u)?.[0] ?? "";
  const candidates = new Set(
    igns.flatMap((ign) => Array.from({ length: Math.min(4, head(ign).length) }, (_, n) => head(ign).slice(0, n + 1))),
  );
  const best = [...candidates]
    .map((tag) => ({
      tag,
      support: igns.filter((ign) => ign.startsWith(tag)).length,
      spaced: igns.some((ign) => ign.startsWith(`${tag} `)),
    }))
    .sort((a, b) => b.support - a.support || Number(b.spaced) - Number(a.spaced) || b.tag.length - a.tag.length)[0];
  if (!best) return null;
  return best.support > igns.length / 2 || (best.support * 2 === igns.length && best.spaced) ? best.tag : null;
}

/**
 * Tag of each team, in bot list order. The team comes from the list; the tag is only how it shows,
 * inferred from the in-game names of the original players (substitutes don't count). A chosen tag always
 * wins; an inferred one only when no other team shows the same, so two "D" teams keep their number.
 */
export function inferTeamTags(mogi: Mogi): TeamTag[] {
  if (mogi.format === "FFA") return [];
  const slots = rosterSlots(mogi);
  const teams = (mogi.teams ?? []).map((team, index) => {
    const inferred = inferTag(slots.filter((person) => person.teamId === team.id).map((person) => person.ign));
    const chosen = team.tag !== undefined;
    return { teamId: team.id, number: index + 1, inferred, chosen, tag: chosen ? team.tag!.trim() || null : inferred };
  });
  return teams.map((team) =>
    team.chosen || teams.filter((other) => other.tag === team.tag).length === 1 ? team : { ...team, tag: null },
  );
}
