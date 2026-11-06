import { placementPoints } from "./points.ts";

/** Native scales derived from the agreed adjustments, not OCR observations. */
export function nativePlacementPoints(represented: number): readonly number[] {
  if (represented === 12) return placementPoints;
  if (represented === 11) return [12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  if (represented === 10) return [11, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  return [];
}
