import type { RoomBoundary } from "./room-boundary.ts";
import type { RoomAnalysis } from "./room-sequence.ts";

/** race.answered: answered numbers resolve equal-distance continuations before photo time. */
export function answeredNumberTieBreak(
  first: Pick<RoomBoundary, "answeredNumber">,
  second: Pick<RoomBoundary, "answeredNumber">,
): number {
  return (first.answeredNumber ?? Infinity) - (second.answeredNumber ?? Infinity) || 0;
}

/** order.photo-time: nonoverlapping moments must agree with the numerical order inside each room. */
export function photoTimeTieBreak(groups: RoomBoundary[][]): RoomBoundary[][] | undefined {
  if (!groups.every((group) => group.some((boundary) => boundary.time !== undefined))) return;
  const ordered = [...groups].sort(
    (from, to) =>
      Math.min(...from.map((boundary) => boundary.time ?? Infinity)) -
      Math.min(...to.map((boundary) => boundary.time ?? Infinity)),
  );
  for (const group of ordered) {
    const known = group.filter((boundary) => boundary.time !== undefined && boundary.localRace !== undefined);
    if (
      known.some(
        (boundary, index) =>
          index > 0 &&
          boundary.time! < known[index - 1].time! &&
          boundary.localRace! - boundary.offset > known[index - 1].localRace! - known[index - 1].offset,
      )
    )
      return;
  }
  if (
    ordered.some(
      (group, index) =>
        index > 0 &&
        Math.max(...ordered[index - 1].map((boundary) => boundary.time ?? -Infinity)) >=
          Math.min(...group.map((boundary) => boundary.time ?? Infinity)),
    )
  )
    return;
  return ordered;
}
/** No RuleCode while pending: one order question covers all unresolved room sessions. */
export function orderQuestion(groups: RoomBoundary[][], hasAnsweredNumber: boolean): RoomAnalysis["order"] {
  if (groups.length <= 1 || hasAnsweredNumber || photoTimeTieBreak(groups)) return;
  return {
    sessionIds: groups.map((group) => `room:${group[0].source.id}`),
    captureIds: groups.map((group) => group[0].source.id),
  };
}

export function rememberPhotoOrder(photoOrder: Map<RoomBoundary[], RoomBoundary>, ordered: RoomBoundary[][]) {
  ordered.forEach((group, index) => {
    if (index > 0)
      photoOrder.set(
        group,
        ordered[index - 1]
          .filter((boundary) => boundary.time !== undefined)
          .reduce((latest, boundary) => (boundary.time! > latest.time! ? boundary : latest)),
      );
  });
}
