import { individualStandings, resultCoverage, teamStandings } from "../scoring/scoring.ts";
import type { Mogi } from "../types.ts";

/** Summarizes the proven result for the mogi list, with the same conclusion export uses. */
export function mogiSummary(mogi: Mogi): { final: boolean; text: string } {
  const coverage = resultCoverage(mogi);
  if (!coverage.through) return { final: false, text: "12 players · no races yet" };
  const leader =
    mogi.format === "FFA"
      ? individualStandings(mogi).map((person) => ({ ...person, name: person.loungeName }))[0]
      : teamStandings(mogi)[0];
  const name = leader.name;
  return {
    final: coverage.final,
    text: coverage.final
      ? `${name} won · ${leader.points}`
      : `Race ${coverage.through} of 12 · ${name} leads with ${leader.points}`,
  };
}
