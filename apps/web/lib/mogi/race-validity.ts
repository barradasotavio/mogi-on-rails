import { physicalNumberForValid } from "@mkw/engine";

import type { Mogi, Race } from "./types";

/** Coordinates preserve the established timeline, not unknown game history. */
export function establishPhysicalNumbers(mogi: Mogi): Mogi {
  const races = mogi.races.map((race, index) => ({
    ...race,
    physicalNumber: race.physicalNumber ?? physicalNumberForValid(mogi, race.number ?? index + 1),
  }));
  return {
    ...mogi,
    races,
    substitutions: mogi.substitutions?.map((entry) => {
      const race = races.find((race) =>
        entry.fromPhysicalNumber === undefined
          ? race.number === entry.fromRace
          : race.physicalNumber === entry.fromPhysicalNumber,
      );
      return {
        ...entry,
        fromRaceId: entry.fromRaceId ?? race?.id,
        fromPhysicalNumber: entry.fromPhysicalNumber ?? race?.physicalNumber ?? entry.fromRace,
      };
    }),
    sequence: mogi.sequence
      ? {
          ...mogi.sequence,
          numbers: mogi.sequence.numbers.map((fact) => {
            const occurrence = mogi.sequence?.occurrences.find((entry) => entry.captureIds.includes(fact.captureId));
            return {
              ...fact,
              physicalNumber:
                fact.physicalNumber ??
                (fact.number === null ? undefined : (occurrence?.physicalNumber ?? occurrence?.number ?? fact.number)),
            };
          }),
        }
      : undefined,
  };
}

export function changeRaceValidity(mogi: Mogi, raceId: string, discarded: boolean): Mogi {
  const prepared = establishPhysicalNumbers(mogi);
  if (!prepared.races.some((race) => race.id === raceId)) throw new Error("This race changed. Reopen it.");
  if (!discarded && prepared.races.filter((race) => race.status !== "discarded").length >= 12)
    throw new Error("12 races already count. Discard another one first.");
  const races = prepared.races.map((race): Race =>
    race.id !== raceId
      ? race
      : {
          ...race,
          status: discarded
            ? "discarded"
            : race.participationReview ||
                !race.placements.length ||
                (race.reconstruction && race.reconstruction.status !== "unique")
              ? "pending"
              : "confirmed",
        },
  );
  const excluded = races.filter((race) => race.status === "discarded").map((race) => race.physicalNumber!);
  return {
    ...prepared,
    races: races.map((race) => ({
      ...race,
      number:
        race.status === "discarded"
          ? undefined
          : race.physicalNumber! - excluded.filter((number) => number < race.physicalNumber!).length,
    })),
  };
}
