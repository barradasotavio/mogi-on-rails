import { nativePlacementPoints } from "../scoring/native-points.ts";
import { sourcePairSignature } from "../sequence/source-pair-signature.ts";
import type { Capture, Mogi } from "../types.ts";

/** Candidates are not readings: only the complete vector can corroborate them. */
export function numericCandidates(text: string): number[] {
  const compact = text.replace(/\s/g, "");
  const candidates = new Set<number>();
  for (let i = 0; i < compact.length; i++) {
    const candidate = compact.slice(0, i) + compact.slice(i + 1);
    if (/^\+?\d+$/.test(candidate)) candidates.add(Number(candidate));
  }
  return [...candidates];
}

/** A noisy addition counts only when it matches the single place on the scale. */
export function representedPlayers(source: Pick<Capture, "interpretation" | "rows">): number {
  return source.interpretation?.represented ?? source.rows.length;
}

export function nativePriorScale(source: Capture): readonly number[] | undefined {
  if (source.interpretation?.screen !== "finishOrderAdding") return;
  const scale = nativePlacementPoints(representedPlayers(source));
  if (!scale.length || !source.numericRows || source.numericRows.length < scale.length) return;
  let observed = 0;
  for (let i = 0; i < scale.length; i++) {
    const reading = source.numericRows.find((row) => row.row === i + 1)?.addition;
    if (!reading) return;
    if (!reading.uncertain && reading.value === scale[i]) observed++;
    else if (reading.value !== null && !reading.uncertain && !numericCandidates(reading.text).includes(scale[i]))
      return;
  }
  return observed >= 6 ? scale : undefined;
}

/** At least one readable shared total, with no decrease, establishes continuity. */
export function sharedTotalsContinue(from: Capture, to: Capture): boolean {
  const values = (source: Capture) => {
    const prior = nativePriorScale(source);
    return new Map(
      (source.nameAssociations ?? []).flatMap((answer, index) => {
        if (!answer.participantId || index >= representedPlayers(source)) return [];
        const row = source.numericRows?.find((row) => row.row === index + 1)?.right;
        const value =
          source.numericAnswers?.find((answer) => answer.row === index + 1)?.value ??
          (row && !row.uncertain ? row.value : null);
        return value == null ? [] : [[answer.participantId, value + (prior?.[index] ?? 0)] as const];
      }),
    );
  };
  const left = values(from);
  const shared = [...values(to)].filter(([id]) => left.has(id));
  return shared.length > 0 && shared.every(([id, value]) => value >= left.get(id)!);
}

// Only a complete native scale, a consistent vote or an answer show the size; blank rows alone could be unread names.
const ROOM_SIZE_PROOFS: readonly string[] = ["scale", "vote", "user"];
// A proof carries over only from the same or an adjacent race, where the room cannot have changed unseen.
const MAX_PROOF_DISTANCE = 1;

/**
 * Cross-capture room-size proof: `other` proves the room size `source` suggests by its blank rows when it shows
 * the same size by `scale`, `vote` or `user`, in the same room session at the same or an adjacent race,
 * and the totals between them continue (no reopening).
 */
export function provesRoomSize(
  mogi: Mogi,
  source: Capture,
  other: Capture,
  plan = mogi.sequence?.roomAnalysis,
): boolean {
  const size = source.interpretation?.represented;
  const entry = plan?.captures.find((entry) => entry.captureId === source.id);
  const number = (capture: Capture) => {
    const fact = mogi.sequence?.numbers.find((fact) => fact.captureId === capture.id);
    const race = mogi.races.find(
      (race) => race.id === capture.context?.raceId || race.captureIds?.includes(capture.id),
    );
    return fact?.physicalNumber ?? fact?.number ?? race?.physicalNumber ?? race?.number;
  };
  if (
    other.id === source.id ||
    other.interpretation?.represented !== size ||
    !ROOM_SIZE_PROOFS.includes(other.interpretation?.representedBy ?? "")
  )
    return false;
  const neighbor = plan?.captures.find((entry) => entry.captureId === other.id);
  if (entry && neighbor && neighbor.sessionId !== entry.sessionId) return false;
  const local = entry?.j !== undefined && neighbor?.j !== undefined;
  const left = local ? entry.j : number(source),
    right = local ? neighbor.j : number(other);
  if (left == null || right == null || Math.abs(left - right) > MAX_PROOF_DISTANCE) return false;
  if (entry && neighbor) return true;
  // Partial votes prove size without necessarily providing a complete numerical boundary.
  const from = left <= right ? source : other,
    to = from === source ? other : source;
  const link = mogi.sequence?.links.find(
    (link) =>
      (link.fromCaptureId === from.id &&
        link.toCaptureId === to.id &&
        link.signature === sourcePairSignature(from, to)) ||
      (link.fromCaptureId === to.id &&
        link.toCaptureId === from.id &&
        link.signature === sourcePairSignature(to, from)),
  );
  if (link?.continuity === "reset") return false;
  return (
    link?.continuity === "continuous-12" ||
    sharedTotalsContinue(from, to) ||
    (left === right && sharedTotalsContinue(to, from))
  );
}

/** A smaller extent inferred only from blank rows still needs independent support: see `provesRoomSize`. */
export function roomSizeNeedsAnswer(mogi: Mogi, source: Capture, plan = mogi.sequence?.roomAnalysis): boolean {
  const size = source.interpretation?.represented;
  if (source.interpretation?.representedBy !== "rows" || size === undefined || size === 12) return false;
  return !(mogi.captures ?? []).some((other) => provesRoomSize(mogi, source, other, plan));
}
