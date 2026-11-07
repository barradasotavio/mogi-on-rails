import { individualStandings, resultCoverage, teamStandings } from "../scoring/scoring.ts";
import type { Mogi } from "../types.ts";

/** More names than this reads as a list, not a headline. */
const MAX_TIED_NAMES = 3;
/** Longest joined names that still fit one line ("Player 1, Player 2 and Player 3" is 31). */
const MAX_TIED_NAMES_LENGTH = 32;

/** Names every leader tied for first, or counts them when the names would not fit. */
export function tiedLeaders(names: string[], unit: "teams" | "players"): string {
  const joined = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
  return names.length <= MAX_TIED_NAMES && joined.length <= MAX_TIED_NAMES_LENGTH
    ? `${joined} are tied`
    : `${names.length} ${unit} are tied`;
}

/** Summarizes the proven result for the mogi list, with the same conclusion export uses. */
export function mogiSummary(mogi: Mogi): { final: boolean; text: string } {
  const coverage = resultCoverage(mogi);
  if (!coverage.through) return { final: false, text: "No races yet" };
  const standings =
    mogi.format === "FFA"
      ? individualStandings(mogi).map((person) => ({ ...person, name: person.loungeName }))
      : teamStandings(mogi);
  const leader = standings[0];
  const name = leader.name;
  const leaders = standings.filter((entry) => entry.points === leader.points);
  if (leader.points !== null && leaders.length > 1) {
    const tied = tiedLeaders(
      leaders.map((entry) => entry.name),
      mogi.format === "FFA" ? "players" : "teams",
    );
    return {
      final: coverage.final,
      text: coverage.final
        ? `${tied} · ${leader.points}`
        : `Race ${coverage.through} of 12 · ${tied} at ${leader.points}`,
    };
  }
  return {
    final: coverage.final,
    text: coverage.final
      ? `${name} won · ${leader.points}`
      : `Race ${coverage.through} of 12 · ${name} leads with ${leader.points}`,
  };
}
