import { participantsForOccurrence, participantsForRace, participationSlot } from "../participation/participation.ts";
import type { Capture, Mogi, NameAssociation, Participant } from "../types.ts";

/** Called only inside the transaction accepting a source/result, including automatic acceptance. */
export function acceptNameAssociations<T extends Mogi>(
  mogi: T,
  capture: Capture,
  number: number,
  targetId?: string,
): T {
  const answers = capture.nameAssociations;
  if (!answers) return mogi; // Legacy captures retain their accepted result without invented provenance.
  const target = mogi.races.find((race) => race.id === targetId);
  const eligible = new Set(
    (target ? participantsForOccurrence(mogi, target) : participantsForRace(mogi, number)).map((person) => person.id),
  );
  const seen = new Set<string>();
  if (answers.length !== capture.rows.length) throw new Error("This screenshot's rows changed. Open the names again.");
  for (const answer of answers) {
    if (!answer.participantId || !eligible.has(answer.participantId) || seen.has(answer.participantId))
      throw new Error("Check the pending names and who played this race.");
    seen.add(answer.participantId);
    // A blank spelling (an unread row placed by exclusion) teaches nothing; it never blocks the save.
    if (answer.ign !== undefined && answer.ign.length > 80) throw new Error("Check the accepted IGN spelling.");
  }
  return {
    ...mogi,
    participants: mogi.participants.map((person) =>
      learnedIgn(
        person,
        answers.find((entry) => entry.participantId === person.id),
      ),
    ),
  };
}

/**
 * IGN learning: only a `fallback` IGN learns the accepted spelling, and only on a successful save (this runs
 * inside `acceptNameAssociations`). Explicit, learned and legacy (absent origin) IGNs are protected.
 */
export function learnedIgn(person: Participant, answer?: NameAssociation): Participant {
  return person.ignOrigin === "fallback" && answer?.ign?.trim()
    ? { ...person, ign: answer.ign.trim(), ignOrigin: "learned" as const }
    : person;
}

/**
 * Keeps a screenshot's links inside the people it can show. A link to someone outside moves to whoever holds
 * that participation there; with no such holder, or when the holder is already linked, it is asked again.
 */
export function linksWithinSpan(mogi: Mogi, associations: NameAssociation[], people: Participant[]): NameAssociation[] {
  const next = associations.map((answer): NameAssociation => {
    if (!answer.participantId || people.some((person) => person.id === answer.participantId)) return answer;
    const linked = mogi.participants.find((person) => person.id === answer.participantId);
    const holder = linked && people.find((person) => participationSlot(person) === participationSlot(linked));
    return holder ? { ...answer, participantId: holder.id } : { participantId: null };
  });
  return next.map((answer, index) =>
    answer !== associations[index] &&
    answer.participantId &&
    next.some((other, row) => row !== index && other.participantId === answer.participantId)
      ? { participantId: null }
      : answer,
  );
}
