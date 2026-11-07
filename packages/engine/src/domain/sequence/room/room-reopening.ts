import { readGameCumulatives } from "../../numeric-readings/numeric-deduction.ts";
import { MIN_SHARED_PLAYERS, vectorDistance } from "../../numeric-readings/per-person-vector.ts";
import type { Capture, Mogi } from "../../types.ts";
import { sourcePairSignature } from "../source-pair-signature.ts";
import { distance, type RoomBoundary, roomBoundary } from "./room-boundary.ts";

// A room reopens only when strictly more than half the shared totals decrease.
const REOPENING_MAJORITY = 0.5;

/** race.reopen-first / race.reopen-later: a strict majority decrease starts a new room. */
export function reopeningByTotals(anchor: Map<string, number>, current: Map<string, number>): boolean {
  const shared = [...current].filter(([id]) => anchor.has(id));
  return (
    shared.length >= MIN_SHARED_PLAYERS &&
    shared.filter(([id, value]) => value < anchor.get(id)!).length > shared.length * REOPENING_MAJORITY
  );
}

/** race.vector-continuity: when the anchor sums races entered by hand, a capture whose totals reach it in native races
 * was taken before those races, in the same room; its lower totals are no reopening. */
export function precedesAnchor(anchor: Map<string, number>, boundary: RoomBoundary): boolean {
  return (vectorDistance(boundary.values, anchor, boundary.keys.length) ?? 0) > 0;
}

/** race.reopen-first / race.reopen-later: a current signed reset overrides equal vectors. */
export function answeredReopening(mogi: Mogi, first: Capture, second: Capture): boolean {
  return (
    mogi.sequence?.links.some((link) => {
      const from = link.fromCaptureId === first.id ? first : link.fromCaptureId === second.id ? second : undefined;
      const to = link.toCaptureId === first.id ? first : link.toCaptureId === second.id ? second : undefined;
      return from && to && link.signature === sourcePairSignature(from, to) && link.continuity === "reset";
    }) ?? false
  );
}
/** order.photo-time: a later drop opens an epoch unless a single-race continuation proves the order; repeated vectors still separate. */
export function epochByPhotoTime(
  previous: Pick<RoomBoundary, "values" | "time"> | undefined,
  current: Pick<RoomBoundary, "values" | "time">,
  epoch: number,
  earlier: RoomBoundary[] = [],
): number {
  if (
    previous?.time === undefined ||
    current.time === undefined ||
    current.time <= previous.time ||
    !reopeningByTotals(previous.values, current.values)
  )
    return epoch;
  const steps = earlier.map((boundary) => distance(current.values, boundary));
  return steps.includes(1) && !steps.includes(0) ? epoch : epoch + 1;
}

/** Read zeros, uncertain ones included (a screen mid-animation), corroborate a local room start against a totals drop;
 * its mogi number stays open. */
export function zeroRoomBoundary(
  mogi: Mogi,
  source: Capture,
  known: (RoomBoundary | undefined)[],
): RoomBoundary | undefined {
  const candidate = roomBoundary(mogi, source, readGameCumulatives(mogi, source, true));
  if (!candidate) return;
  const drops = known.some(
    (previous) =>
      previous &&
      (previous.time === undefined || candidate.time === undefined || previous.time <= candidate.time) &&
      reopeningByTotals(previous.values, candidate.values) &&
      candidate.keys.some((key, row) => {
        const right = source.numericRows?.find((reading) => reading.row === row + 1)?.right;
        return right?.value === 0 && previous.values.has(key) && candidate.values.get(key)! < previous.values.get(key)!;
      }),
  );
  if (drops) return { ...candidate, needsNumber: true };
}
