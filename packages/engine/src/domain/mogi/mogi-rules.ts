import type { MogiFormat } from "../types.ts";

/** Team sizes in the Lounge's normal queue. */
export const teamSizes = Object.freeze({ FFA: 1, "2v2": 2, "3v3": 3 } satisfies Record<MogiFormat, number>);

/** The twelve planned race numbers, without sharing a mutable list between projections. */
export function raceNumbers(): number[] {
  return Array.from({ length: 12 }, (_, index) => index + 1);
}
