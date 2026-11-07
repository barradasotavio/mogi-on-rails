import type { Mogi, Race } from "../types.ts";
import { placementPoints } from "./points.ts";

/** Native scales derived from the agreed adjustments, not OCR observations. */
export function nativePlacementPoints(represented: number): readonly number[] {
  if (represented === 12) return placementPoints;
  if (represented === 11) return [12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  if (represented === 10) return [11, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  return [];
}

/** A stored native value counts only as the scale's value for that place; absent players have none. */
function modeledRace(race: Race): Race {
  const scale = nativePlacementPoints(race.placements.length);
  const stored = Object.entries(race.nativePoints ?? {});
  if (
    stored.every(([id, value]) => value === scale[race.placements.indexOf(id)]) &&
    Object.values(race.nativePointOrigins ?? {}).every((origin) => origin === "modeled") &&
    Object.keys(race.nativePointOrigins ?? {}).every((id) => race.nativePoints?.[id] !== undefined)
  )
    return race;
  if (!race.placements.length || !scale.length)
    return { ...race, nativePoints: undefined, nativePointOrigins: undefined };
  return {
    ...race,
    nativePoints: Object.fromEntries(race.placements.map((id, position) => [id, scale[position]])),
    nativePointOrigins: Object.fromEntries(race.placements.map((id) => [id, "modeled" as const])),
  };
}

/**
 * Native points are never entered by hand: a race's stored native values that diverge from the
 * scale for its placements (legacy "manual" values included) are re-modeled; history stays as recorded.
 */
export function withModeledNativePoints<T extends Mogi>(mogi: T): T {
  const races = mogi.races.map(modeledRace);
  return races.every((race, index) => race === mogi.races[index]) ? mogi : { ...mogi, races };
}
