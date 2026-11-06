import { capturePhaseOffset as offset } from "../capture/capture-context.ts";
import {
  lostInferredNumberReview,
  native12OriginScope,
  sequenceConflictReview,
} from "../reconstruction/origin-scope.ts";
import type { CaptureSequence, SequenceGap } from "../types.ts";
import { totals } from "./boundary-step.ts";
import type { OccurrenceNode } from "./occurrences.ts";
import type { Mogi } from "./sequence-input-signature.ts";
import { sourcePairSignature as sequenceLinkSignature } from "./source-pair-signature.ts";

export function reviewInferredNumbers<T extends Mogi>(
  mogi: T,
  nodes: OccurrenceNode[],
  gaps: SequenceGap[],
  old: CaptureSequence | undefined,
  priorProjected: Set<string>,
  conflict: string | undefined,
): T {
  // Inferred result numbers are withdrawn when their supporting relation disappears;
  // observed finish order/identity data and manually supplied facts are retained.
  const lostNumberReview = lostInferredNumberReview;
  const originRanges = declaredOriginRanges(mogi, nodes, old);
  const originSupports = (race: (typeof mogi.races)[number]) =>
    originRanges.some(
      (right) => (race.physicalNumber ?? race.number ?? 0) >= 1 && (race.physicalNumber ?? race.number ?? 0) <= right,
    );
  // A numbered occurrence of the race itself supports its number again, as does a declared origin.
  const numberedOccurrence = (race: (typeof mogi.races)[number]) =>
    nodes.some((node) => node.occurrence.id === race.id && node.occurrence.number !== undefined);
  mogi = {
    ...mogi,
    races: mogi.races.map((race) =>
      !conflict &&
      (((originSupports(race) || numberedOccurrence(race)) && race.participationReview === lostInferredNumberReview) ||
        // A conflict that is gone leaves nothing to check on a race it emptied: the evidence counts it again.
        (race.participationReview === sequenceConflictReview && race.status === "pending" && !race.placements.length))
        ? { ...race, participationReview: undefined }
        : race,
    ),
  };
  if (!conflict)
    mogi = {
      ...mogi,
      races: mogi.races.map((race) =>
        priorProjected.has(race.id) &&
        race.status !== "discarded" &&
        race.placements.length &&
        !originSupports(race) &&
        !numberedOccurrence(race) &&
        !gaps.some((gap) => {
          const from = nodes.find((node) => node.occurrence.id === gap.fromId)?.occurrence.number,
            to = nodes.find((node) => node.occurrence.id === gap.toId)?.occurrence.number;
          return (
            gap.order === "forward" &&
            gap.count !== undefined &&
            gap.validCount === gap.count &&
            from !== undefined &&
            to !== undefined &&
            race.number !== undefined &&
            race.number > from &&
            race.number < to
          );
        })
          ? { ...race, status: "pending", participationReview: lostNumberReview }
          : race,
      ),
    };
  return mogi;
}

/** Race ranges a declared zero origin still covers: its totals fit and every race inside it is known. */
function declaredOriginRanges(mogi: Mogi, nodes: OccurrenceNode[], old: CaptureSequence | undefined): number[] {
  const originRanges = nodes.flatMap((node) =>
    node.captures.flatMap((capture) => {
      const right = node.occurrence.number === undefined ? 0 : node.occurrence.number - offset(capture),
        values = totals(capture);
      if (
        right < 1 ||
        right > 12 ||
        values.size !== 12 ||
        ![...values.values()].every((value) => value >= right && value <= right * 15) ||
        [...values.values()].reduce((sum, value) => sum + value, 0) !== 82 * right ||
        !old?.origins?.some(
          (fact) =>
            fact.captureId === capture.id &&
            fact.answer === "zero-valid-12" &&
            fact.signature === sequenceLinkSignature(capture, capture),
        )
      )
        return [];
      const inside = mogi.races.filter(
        (race) => (race.physicalNumber ?? race.number ?? 0) >= 1 && (race.physicalNumber ?? race.number ?? 0) <= right,
      );
      if (
        inside.length !== right ||
        new Set(inside.map((race) => race.physicalNumber ?? race.number)).size !== right ||
        !native12OriginScope(mogi, inside, values.keys(), true)
      )
        return [];
      return [right];
    }),
  );
  return originRanges;
}
