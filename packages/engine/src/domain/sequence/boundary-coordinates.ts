import { capturePhaseOffset as offset, contextPhase } from "../capture/capture-context.ts";
import type { CaptureSequence, SequenceLink } from "../types.ts";
import { boundaryStep, cumulativeResultStep, priorTotalsStep, totals } from "./boundary-step.ts";
import { initialSegmentsContinue, roomReopeningBetween } from "./participant-continuity.ts";
import type { RoomAnalysis } from "./room/room-sequence.ts";
import type { Capture, Mogi } from "./sequence-input-signature.ts";
import { sourcePairSignature as sequenceLinkSignature } from "./source-pair-signature.ts";

export interface BoundaryEdge {
  to: number;
  step: number;
  stable: string[];
  unknown: string[];
  reset: string[];
}
export type BoundaryCoordinate = { component: number; boundary: number };

/** Place every source on its connected component's boundary axis; two paths that disagree on a source's
 * boundary contradict each other, and reconciliation reports a conflict instead of choosing one. */
export function boundaryCoordinates(edges: Pick<BoundaryEdge, "to" | "step">[][]): {
  coordinates: Map<number, BoundaryCoordinate>;
  contradictory: boolean;
} {
  const coordinates = new Map<number, BoundaryCoordinate>();
  let contradictory = false;
  for (let index = 0; index < edges.length; index++)
    if (!coordinates.has(index)) {
      coordinates.set(index, { component: index, boundary: 0 });
      const queue = [index];
      while (queue.length) {
        const at = queue.shift()!,
          current = coordinates.get(at)!;
        for (const edge of edges[at]) {
          const next = { component: index, boundary: current.boundary + edge.step },
            previous = coordinates.get(edge.to);
          if (!previous) {
            coordinates.set(edge.to, next);
            queue.push(edge.to);
          } else if (previous.component === index && previous.boundary !== next.boundary) contradictory = true;
        }
      }
    }
  return { coordinates, contradictory };
}

/** Complementary sources of the same phase and vector form one occurrence: sources share a group only when they sit
 * in the same component at the same position, so different sessions stay apart even with equal sum or vector. */
export function complementarySourceGroups(captures: Capture[], coordinates: Map<number, BoundaryCoordinate>) {
  const groups = new Map<string, { component: number; position: number; captures: Capture[] }>();
  captures.forEach((capture, index) => {
    const value = coordinates.get(index)!,
      position = value.boundary + offset(capture),
      key = `${value.component}:${position}`;
    const group = groups.get(key) ?? { component: value.component, position, captures: [] };
    group.captures.push(capture);
    groups.set(key, group);
  });
  return groups;
}

/** Relate every pair of numbered sources by their boundary step and who stayed stable, restarted or is unknown
 * across it; sources linked to the same race that contradict the step make a conflict. */
export function boundaryEdges(
  input: Mogi,
  captures: Capture[],
  roomAnalysis: RoomAnalysis,
  numbers: CaptureSequence["numbers"],
  links: SequenceLink[],
  automaticNumber: (capture: Capture) => number | undefined,
  conflict: string | undefined,
) {
  const edges: BoundaryEdge[][] = captures.map(() => []);
  const captureTotals = new Map(captures.map((capture) => [capture, totals(capture)]));
  for (let from = 0; from < captures.length; from++)
    for (let to = from + 1; to < captures.length; to++) {
      const a = captures[from],
        b = captures[to];
      const link = links.find(
        (link) =>
          link.fromCaptureId === a.id && link.toCaptureId === b.id && link.signature === sequenceLinkSignature(a, b),
      );
      const reverse = links.find(
        (link) =>
          link.fromCaptureId === b.id && link.toCaptureId === a.id && link.signature === sequenceLinkSignature(b, a),
      );
      const roomA = roomAnalysis.captures.find((c) => c.captureId === a.id),
        roomB = roomAnalysis.captures.find((c) => c.captureId === b.id);
      const roomStep =
        roomA && roomB
          ? roomA.number !== undefined && roomB.number !== undefined
            ? roomB.number - offset(b) - (roomA.number - offset(a))
            : roomA.sessionId === roomB.sessionId && roomA.j !== undefined && roomB.j !== undefined
              ? roomB.j - offset(b) - (roomA.j - offset(a))
              : undefined
          : undefined;
      const numericStep =
        roomStep ??
        (roomA && roomB && roomA.sessionId !== roomB.sessionId
          ? undefined
          : boundaryStep(input, a, b, link ?? reverse));
      const raceFor = (capture: Capture) =>
        capture.context?.raceId ?? input.races.find((race) => race.captureIds?.includes(capture.id))?.id;
      const sharedRace = raceFor(a) && raceFor(a) === raceFor(b);
      const associatedStep = sharedRace ? offset(a) - offset(b) : undefined;
      if (associatedStep !== undefined && numericStep !== undefined && associatedStep !== numericStep)
        conflict =
          "The screenshots linked to the same race contradict its time boundary. Check the link or the totals.";
      const aNumber = numbers.find((fact) => fact.captureId === a.id)?.number ?? automaticNumber(a),
        bNumber = numbers.find((fact) => fact.captureId === b.id)?.number ?? automaticNumber(b);
      const sameAnchor =
        aNumber !== undefined &&
        aNumber === bNumber &&
        (contextPhase(a) !== contextPhase(b) || !numbers.some((fact) => [a.id, b.id].includes(fact.captureId))) &&
        !(link ?? reverse)?.continuity;
      const step = associatedStep ?? (sameAnchor ? offset(a) - offset(b) : numericStep);
      if (step !== undefined) {
        const older = step >= 0 ? a : b,
          newer = step >= 0 ? b : a,
          left = captureTotals.get(older)!,
          right = captureTotals.get(newer)!,
          facts = (link ?? reverse)?.people;
        const roomReset =
          roomA &&
          roomB &&
          (roomA.sessionId === roomB.sessionId || roomReopeningBetween(roomAnalysis, roomA.sessionId, roomB.sessionId))
            ? roomA.segments
                .filter((s) => roomB.segments.some((t) => t.participantId === s.participantId && t.id !== s.id))
                .map((s) => s.participantId)
                .filter((id) => input.participants.some((p) => p.id === id))
            : [];
        const reset = [
          ...new Set([
            ...(facts?.filter((fact) => fact.answer === "reset").map((fact) => fact.participantId) ?? []),
            ...roomReset,
          ]),
        ];
        const unknown = [...left.keys()].filter(
          (id) => right.has(id) && !reset.includes(id) && right.get(id)! < left.get(id)!,
        );
        const roomStable =
          roomA &&
          roomB &&
          roomStep !== undefined &&
          !roomReopeningBetween(roomAnalysis, roomA.sessionId, roomB.sessionId)
            ? roomA.segments
                .filter(
                  (s) =>
                    s.anchor &&
                    roomB.segments.some(
                      (t) =>
                        t.participantId === s.participantId &&
                        t.anchor &&
                        (t.id === s.id || initialSegmentsContinue(s.id, t.id, older, newer)),
                    ),
                )
                .map((s) => s.participantId)
                .filter((id) => input.participants.some((p) => p.id === id))
            : undefined;
        const nativeProof =
          !roomStable &&
          (cumulativeResultStep(input, older, newer, link ?? reverse) ||
            priorTotalsStep(input, older, newer, link ?? reverse));
        const stable =
          roomStable ??
          (numericStep !== step
            ? []
            : nativeProof
              ? older.nameAssociations!.flatMap((answer) =>
                  answer.participantId &&
                  newer.nameAssociations?.some((other) => other.participantId === answer.participantId)
                    ? [answer.participantId]
                    : [],
                )
              : [...left.keys()].filter((id) => right.has(id) && !reset.includes(id) && !unknown.includes(id)));
        edges[from].push({ to, step, stable, unknown, reset });
        edges[to].push({ to: from, step: -step, stable, unknown, reset });
      }
    }
  return { edges, conflict };
}
