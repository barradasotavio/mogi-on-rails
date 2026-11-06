/** Minimal structured result accepted by placement scoring. */
export interface PlacementResult {
  placements: string[];
  absentParticipantIds?: string[];
}
export const placementPoints = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;
export function pointsFor(race: PlacementResult, participantId: string): number {
  if (race.absentParticipantIds?.includes(participantId)) return 1;
  const position = race.placements.indexOf(participantId);
  return position < 0 ? 0 : (placementPoints[position] ?? 0);
}
