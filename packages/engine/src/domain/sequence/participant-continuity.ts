import { sharedTotalsContinue } from "../numeric-readings/numeric-candidates.ts";
import type { Capture } from "../types.ts";
import type { RoomAnalysis } from "./room/room-sequence.ts";

type ParticipantPath = { stable: string[]; reset: string[] };

/** Disconnected vector groups do not by themselves prove a room reopening. */
export function roomReopeningBetween(room: RoomAnalysis, firstId: string, secondId: string): boolean {
  const first = room.sessions.findIndex((session) => session.id === firstId);
  const second = room.sessions.findIndex((session) => session.id === secondId);
  return room.sessions
    .slice(Math.min(first, second) + 1, Math.max(first, second) + 1)
    .some((session) => session.reopening);
}

/** Initial segments in disconnected vector groups continue only when the shared per-person totals do. */
export function initialSegmentsContinue(firstId: string, secondId: string, from: Capture, to: Capture): boolean {
  return firstId.includes(":initial:") && secondId.includes(":initial:") && sharedTotalsContinue(from, to);
}

/** A direct checked comparison preserves continuity lost through an unsettled screen; a proven restart still wins. */
export function stableParticipantPath(path: ParticipantPath, direct?: ParticipantPath): string[] {
  return [...new Set([...path.stable, ...(direct?.stable ?? [])])].filter(
    (id) => !path.reset.includes(id) && !direct?.reset.includes(id),
  );
}
