import { captureNameAssociations } from "../questions/mogi-questions.ts";
import type { BoundaryCoordinate, BoundaryEdge } from "./boundary-coordinates.ts";
import { stableParticipantPath } from "./participant-continuity.ts";
import type { Capture } from "./sequence-input-signature.ts";

/** Relate every pair of sources on one boundary axis by their completed steps and per-person continuity. */
export function captureRelations(
  captures: Capture[],
  edges: BoundaryEdge[][],
  coordinates: Map<number, BoundaryCoordinate>,
) {
  const relations = captures.flatMap((from, index) => {
    // Intersect per-person continuity along the proven path; a restart does not
    // become a stable anchor again just because the later cumulative grew.
    const seen = new Set<number>([index]);
    const queue = [
      {
        at: index,
        stable: captureNameAssociations(from).flatMap((answer) => (answer.participantId ? [answer.participantId] : [])),
        unknown: [] as string[],
        reset: [] as string[],
      },
    ];
    const paths = new Map<number, (typeof queue)[number]>();
    // One search per source keeps the same first path for every destination.
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      paths.set(current.at, current);
      for (const edge of edges[current.at])
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          queue.push({
            at: edge.to,
            stable: current.stable.filter((id) => edge.stable.includes(id)),
            unknown: [...new Set([...current.unknown, ...edge.unknown])],
            reset: [...new Set([...current.reset, ...edge.reset])],
          });
        }
    }
    return captures.flatMap((to, other) => {
      if (other <= index) return [];
      const a = coordinates.get(index)!,
        b = coordinates.get(other)!,
        path = paths.get(other);
      if (a.component !== b.component || !path) return [];
      const older = a.boundary <= b.boundary ? from : to,
        newer = older === from ? to : from;
      return [
        {
          fromCaptureId: older.id,
          toCaptureId: newer.id,
          completedSteps: Math.abs(b.boundary - a.boundary),
          stableParticipantIds: stableParticipantPath(
            path,
            edges[index].find((edge) => edge.to === other),
          ),
          resetParticipantIds: path.reset,
          unknownParticipantIds: path.unknown.filter((id) => !path.reset.includes(id)),
        },
      ];
    });
  });
  return relations;
}
