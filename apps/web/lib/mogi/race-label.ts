import { raceNumber } from "@mkw/engine";

import type { Mogi, Race, Substitution } from "./types";

/** Display projection only; scoring and chronology retain their numeric coordinates. */
export function raceLabel(mogi: Mogi, race: Race): string {
  return race.status === "discarded" ? "Discarded" : `Race ${raceNumber(mogi, race)}`;
}

export function substitutionEntryLabel(mogi: Mogi, entry: Substitution): string {
  const race =
    mogi.races.find((race) => race.id === entry.fromRaceId) ??
    mogi.races.find((race) =>
      entry.fromPhysicalNumber !== undefined
        ? race.physicalNumber === entry.fromPhysicalNumber
        : race.status !== "discarded" && race.number === entry.fromRace,
    );
  if (race) return race.status === "discarded" ? "discarded race" : `race ${raceNumber(mogi, race)}`;
  // Future entries may not have an established occurrence yet.
  const physical = entry.fromPhysicalNumber;
  const number =
    physical === undefined
      ? entry.fromRace
      : physical -
        mogi.races.filter(
          (race) => race.status === "discarded" && race.physicalNumber !== undefined && race.physicalNumber < physical,
        ).length;
  return `race ${number}`;
}
