import { raceNumbers, teamSizes } from "../mogi/mogi-rules.ts";
import { participantsForRace, participationMembers, rosterSlots } from "../participation/participation.ts";
import { coverageProjection } from "../reconstruction/coverage.ts";
import type { Mogi } from "../types.ts";
import { individualStandings, teamStandings } from "./scoring.ts";

// Lounge rule 6.4: four counted races in a winning position earn a substitute the credit.
const MIN_WINNING_RACES = 4;

export interface CreditSuggestion {
  participantId: string;
  reason: string;
}

/** Reopens only this answer, keeping the correction in the single question queue. */
export function reopenCreditQuestion<T extends Mogi>(mogi: T, slot: string): T {
  if (participationMembers(mogi, slot).length < 2 || !creditSuggestion(mogi, slot))
    throw new Error("This credit question is not available yet.");
  const creditedParticipantIds = { ...mogi.creditedParticipantIds };
  delete creditedParticipantIds[slot];
  return { ...mogi, creditedParticipantIds };
}

/** Suggests without writing: the credit decision belongs to the user. */
export function creditSuggestion(mogi: Mogi, slot: string): CreditSuggestion | null {
  const last = mogi.substitutions
    ?.filter((entry) => entry.slotId === slot)
    .sort((a, b) => (a.fromPhysicalNumber ?? a.fromRace) - (b.fromPhysicalNumber ?? b.fromRace))
    .at(-1);
  if (participationMembers(mogi, slot).length < 2 || !last) return null;
  if (!coverageProjection(mogi).complete) return null;
  if (mogi.format !== "FFA") {
    const size = teamSizes[mogi.format];
    const slots = rosterSlots(mogi);
    if (
      mogi.teams?.length !== 12 / size ||
      slots.some((person) => !mogi.teams!.some((team) => team.id === person.teamId)) ||
      mogi.teams.some((team) => slots.filter((person) => person.teamId === team.id).length !== size)
    )
      return null;
  }
  const person = individualStandings(mogi).find((person) => person.id === slot);
  const rank =
    mogi.format === "FFA" ? person?.rank : teamStandings(mogi).find((team) => team.id === person?.teamId)?.rank;
  if (rank === null || rank === undefined) return null;
  // The top half of the competitors wins; a tie at the boundary counts as winning.
  const winning = 12 / teamSizes[mogi.format] / 2;
  // Only counted races enter the rule; discards don't lengthen the span.
  const played = raceNumbers().filter((number) =>
    participantsForRace(mogi, number).some((person) => person.id === last.incomingParticipantId),
  );
  if (played.length === 12) return { participantId: last.incomingParticipantId, reason: "Subbed in from race 1" };
  const races = played.length;
  if (rank <= winning && races >= MIN_WINNING_RACES)
    return { participantId: last.incomingParticipantId, reason: `Played ${races} races in a winning position` };
  return { participantId: slot, reason: "Original player keeps the credit" };
}
