import { linksWithinSpan } from "../names/name-associations.ts";
import { captureNameAssociations, questionOccurrence } from "../questions/mogi-questions.ts";
import type { Mogi, Participant, Race } from "../types.ts";

export function participationSlot(participant: Participant): string {
  return participant.slotId ?? participant.id;
}
export function rosterSlots(mogi: Mogi): Participant[] {
  return mogi.participants.filter((person) => participationSlot(person) === person.id);
}
export function participationMembers(mogi: Mogi, slotId: string): Participant[] {
  return mogi.participants.filter((person) => participationSlot(person) === slotId);
}
export function physicalNumberForValid(mogi: Mogi, number: number): number {
  const existing = mogi.races.find((race) => race.number === number && race.status !== "discarded")?.physicalNumber;
  if (existing !== undefined) return existing;
  let physical = number;
  for (const discarded of mogi.races
    .filter((race) => race.status === "discarded" && race.physicalNumber !== undefined)
    .map((race) => race.physicalNumber!)
    .sort((a, b) => a - b))
    if (discarded <= physical) physical++;
  return physical;
}
export function participantsForRace(mogi: Mogi, number: number): Participant[] {
  const physical = physicalNumberForValid(mogi, number);
  return participantsAtPhysical(mogi, physical);
}
export function participantsForOccurrence(mogi: Mogi, race: Race): Participant[] {
  return race.physicalNumber === undefined
    ? participantsForRace(mogi, race.number ?? mogi.races.indexOf(race) + 1)
    : participantsAtPhysical(mogi, race.physicalNumber);
}
export function participantsAtPhysical(mogi: Mogi, number: number): Participant[] {
  return rosterSlots(mogi).map((slot) => {
    const entries = (mogi.substitutions ?? [])
      .filter(
        (item) =>
          item.slotId === slot.id &&
          (mogi.races.find((race) => race.id === item.fromRaceId)?.physicalNumber ??
            item.fromPhysicalNumber ??
            item.fromRace) <= number,
      )
      .sort((a, b) => (a.fromPhysicalNumber ?? a.fromRace) - (b.fromPhysicalNumber ?? b.fromRace));
    const id = entries.at(-1)?.incomingParticipantId ?? slot.id;
    return mogi.participants.find((person) => person.id === id) ?? slot;
  });
}
/** Everyone who holds a participation for at least one race: a substitute from race one replaces the original entirely. */
export function participantsWithSpan(mogi: Mogi): Participant[] {
  const last = Math.max(
    12,
    ...mogi.races.map((race) => race.physicalNumber ?? race.number ?? 0),
    ...(mogi.substitutions ?? []).map((item) => item.fromPhysicalNumber ?? item.fromRace),
  );
  const ids = new Set<string>();
  for (let number = 1; number <= last; number++)
    for (const person of participantsAtPhysical(mogi, number)) ids.add(person.id);
  return mogi.participants.filter((person) => ids.has(person.id));
}
export function pendingCreditSlots(mogi: Mogi): Participant[] {
  return rosterSlots(mogi).filter((slot) => {
    const members = participationMembers(mogi, slot.id);
    return members.length > 1 && !members.some((person) => person.id === mogi.creditedParticipantIds?.[slot.id]);
  });
}
export function creditedParticipant(mogi: Mogi, slot: Participant): Participant {
  return (
    participationMembers(mogi, slot.id).find((person) => person.id === mogi.creditedParticipantIds?.[slot.id]) ?? slot
  );
}
export function registerSubstitution<T extends Mogi>(
  mogi: T,
  input: { slotId: string; loungeName: string; ign: string; fromRace: number },
): T {
  const slot = rosterSlots(mogi).find((person) => person.id === input.slotId);
  if (!slot || !Number.isInteger(input.fromRace) || input.fromRace < 1 || input.fromRace > 999)
    throw new Error("Choose a player and a valid race for the sub to enter.");
  if (!input.loungeName.trim()) throw new Error("Enter the sub's Lounge name.");
  if (
    mogi.participants.some(
      (person) =>
        participationSlot(person) !== slot.id &&
        person.loungeName.toLocaleLowerCase() === input.loungeName.trim().toLocaleLowerCase(),
    )
  )
    throw new Error("That Lounge name already belongs to another player.");
  const physicalEntry = physicalNumberForValid(mogi, input.fromRace);
  const previous = (mogi.substitutions ?? [])
    .filter((item) => item.slotId === slot.id)
    .sort((a, b) => (a.fromPhysicalNumber ?? a.fromRace) - (b.fromPhysicalNumber ?? b.fromRace))
    .at(-1);
  if (previous && physicalEntry <= (previous.fromPhysicalNumber ?? previous.fromRace))
    throw new Error("The sub must enter after this player's previous sub.");
  const outgoing = participantsForRace(mogi, input.fromRace).find((person) => participationSlot(person) === slot.id)!;
  const incoming: Participant = {
    id: crypto.randomUUID(),
    slotId: slot.id,
    teamId: slot.teamId,
    loungeName: input.loungeName.trim(),
    ign: input.ign.trim() || input.loungeName.trim(),
    ignOrigin: input.ign.trim() ? "explicit" : "fallback",
  };
  return requireParticipationReview(mogi, {
    ...mogi,
    participants: [...mogi.participants, incoming],
    substitutions: [
      ...(mogi.substitutions ?? []),
      {
        id: crypto.randomUUID(),
        slotId: slot.id,
        outgoingParticipantId: outgoing.id,
        incomingParticipantId: incoming.id,
        fromRace: input.fromRace,
        ...(mogi.races.some((race) => race.physicalNumber !== undefined)
          ? {
              fromRaceId: mogi.races.find((race) => race.number === input.fromRace)?.id,
              fromPhysicalNumber: physicalEntry,
            }
          : {}),
      },
    ],
  });
}

/**
 * A link to someone outside a screenshot's participation span moves to that participation's holder there, or is
 * asked again. Unchanged captures keep their identity, so memoized views don't recompute.
 */
export function withLinksInSpan<T extends Mogi>(mogi: T): T {
  const relinked = mogi.captures?.map((capture) => {
    const associations = captureNameAssociations(capture);
    const next = linksWithinSpan(mogi, associations, questionOccurrence(mogi, capture).people);
    return next.every((answer, index) => answer === associations[index])
      ? capture
      : { ...capture, nameAssociations: next };
  });
  return relinked?.some((capture, index) => capture !== mogi.captures![index]) ? { ...mogi, captures: relinked } : mogi;
}

export function requireParticipationReview<T extends Mogi>(before: Mogi, after: T): T {
  // Credit answers one specific history; changes to another participation keep it.
  const chain = (mogi: Mogi, slot: string) =>
    (mogi.substitutions ?? [])
      .filter((entry) => entry.slotId === slot)
      .map((entry) => [
        entry.id,
        entry.outgoingParticipantId,
        entry.incomingParticipantId,
        entry.fromRace,
        entry.fromRaceId,
        entry.fromPhysicalNumber,
      ]);
  const creditedParticipantIds =
    after.creditedParticipantIds &&
    Object.fromEntries(
      Object.entries(after.creditedParticipantIds).filter(
        ([slot]) => JSON.stringify(chain(before, slot)) === JSON.stringify(chain(after, slot)),
      ),
    );
  return {
    ...withLinksInSpan(after),
    ...(creditedParticipantIds ? { creditedParticipantIds } : {}),
    races: after.races.map((race, index) => {
      if (race.participationReview)
        return {
          ...race,
          status: race.status === "discarded" ? "discarded" : "pending",
        };
      const previous = before.races.find((item) => item.id === race.id);
      if (!previous || previous.placements.length === 0) return race;
      const oldNumber = previous.number ?? before.races.findIndex((item) => item.id === previous.id) + 1;
      const number = race.number ?? index + 1;
      const oldIds = (
        previous.physicalNumber !== undefined
          ? participantsForOccurrence(before, previous)
          : participantsForRace(before, oldNumber)
      )
        .map((person) => person.id)
        .join();
      const newIds = (
        race.physicalNumber !== undefined ? participantsForOccurrence(after, race) : participantsForRace(after, number)
      )
        .map((person) => person.id)
        .join();
      if (oldIds === newIds) return race;
      const { participationHistory, ...result } = previous;
      const reason = "Who played this race changed. Review the players before confirming again.";
      return {
        ...race,
        status: race.status === "discarded" ? "discarded" : "pending",
        participationReview: reason,
        participationHistory: [
          ...(participationHistory ?? []),
          { changedAt: new Date().toISOString(), reason, result },
        ],
      };
    }),
  };
}

export function correctSubstitutionBoundary<T extends Mogi>(mogi: T, substitutionId: string, fromRace: number): T {
  const change = mogi.substitutions?.find((item) => item.id === substitutionId);
  if (!change || !Number.isInteger(fromRace) || fromRace < 1 || fromRace > 999)
    throw new Error("Choose a valid race for the sub to enter.");
  const physicalEntry = physicalNumberForValid(mogi, fromRace);
  const chain = (mogi.substitutions ?? [])
    .filter((item) => item.slotId === change.slotId)
    .sort((a, b) => (a.fromPhysicalNumber ?? a.fromRace) - (b.fromPhysicalNumber ?? b.fromRace));
  const index = chain.findIndex((item) => item.id === change.id);
  if (
    (chain[index - 1] && physicalEntry <= (chain[index - 1].fromPhysicalNumber ?? chain[index - 1].fromRace)) ||
    (chain[index + 1] && physicalEntry >= (chain[index + 1].fromPhysicalNumber ?? chain[index + 1].fromRace))
  )
    throw new Error("Keep the entry after this player's previous sub and before the next one.");
  if (physicalEntry === (change.fromPhysicalNumber ?? change.fromRace)) return mogi;
  return requireParticipationReview(mogi, {
    ...mogi,
    substitutions: (mogi.substitutions ?? []).map((item) =>
      item.id === change.id
        ? {
            ...item,
            fromRace,
            ...(mogi.races.some((race) => race.physicalNumber !== undefined)
              ? {
                  fromRaceId: mogi.races.find((race) => race.number === fromRace)?.id,
                  fromPhysicalNumber: physicalEntry,
                }
              : {}),
            previousFromRaces: [...(item.previousFromRaces ?? []), item.fromRace],
          }
        : item,
    ),
  });
}

/** Show a proposal without modifying the saved result or original capture evidence. */
export function prepareRaceForReview(mogi: Mogi, race: Race): Race {
  if (!race.participationReview) return race;
  const active = participantsForOccurrence(mogi, race);
  const currentIdentity = (id: string) => {
    const previous = mogi.participants.find((person) => person.id === id);
    return previous
      ? (active.find((person) => participationSlot(person) === participationSlot(previous))?.id ?? id)
      : id;
  };
  return {
    ...race,
    placements: race.placements.map(currentIdentity),
    absentParticipantIds: race.absentParticipantIds?.map(currentIdentity),
  };
}
