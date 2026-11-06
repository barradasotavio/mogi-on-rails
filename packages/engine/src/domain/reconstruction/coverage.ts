import { boundaryCompletedSteps, captureBoundaries } from "../capture/capture-boundary.ts";
import { momentOffset } from "../capture/screens.ts";
import { participantsForRace, participationSlot, rosterSlots } from "../participation/participation.ts";
import { placementPoints, pointsFor } from "../scoring/points.ts";
import { initialRoomSources, numberedRoomSpan } from "../sequence/room/room-sequence.ts";
import { sourcePairSignature as sourceSignature } from "../sequence/source-pair-signature.ts";
import type { IntervalContribution, Mogi, Race } from "../types.ts";
import { native12OriginScope } from "./origin-scope.ts";
import { sha256Hex } from "./sha256.ts";

// A Lounge mogi counts twelve races.
const MAX_COUNTED_RACES = 12;
// Only twelve complete histories determine adjusted contributions without a finish order.
const FULL_ROOM_PLAYERS = 12;
// The native twelve-player table sums to eighty-two points per race.
const FULL_ROOM_POINTS = 82;
// First place awards at most fifteen points in one race.
const MAX_POINTS_PER_RACE = 15;
// Last place and a confirmed absence both award at least one point per race.
const MIN_POINTS_PER_RACE = 1;
// A hex SHA-256 digest; longer signatures were saved as raw inputs, tens of kilobytes each.
const SIGNATURE_LENGTH = 64;

export type CoverageConflict =
  | { kind: "detail-total-mismatch"; raceNumbers: number[] }
  | { kind: "overlapping-intervals" }
  | { kind: "incompatible-totals" };

type Boundary = ReturnType<typeof captureBoundaries>[number];
type IntervalValue = IntervalContribution["values"][number];
type UnsignedContribution = Omit<IntervalContribution, "signature">;
/** Totals read only the contribution; hashing its inputs is left to the stored proof, which alone needs the signature. */
interface ProvenInterval {
  contribution: UnsignedContribution;
  signature(): string;
}

/** Races covered between two boundaries, in valid or physical numbering; with no earlier boundary the span starts at race one. */
export function intervalSpan(
  from: Boundary | undefined,
  to: Boundary,
  coordinate: "number" | "physicalNumber" = "number",
): { start?: number; end?: number } {
  const end = to[coordinate] === undefined ? undefined : to[coordinate] - momentOffset(to.phase);
  const start = from
    ? from[coordinate] === undefined
      ? undefined
      : from[coordinate] + (1 - momentOffset(from.phase))
    : 1;
  return { start, end };
}

/** Both boundaries show twelve complete histories that the sequence kept stable. */
export function completeHistories(from: Boundary | undefined, to: Boundary, stable: string[]): boolean {
  return (
    stable.length === FULL_ROOM_PLAYERS &&
    to.values.size === FULL_ROOM_PLAYERS &&
    (!from || from.values.size === FULL_ROOM_PLAYERS)
  );
}

/** The valid span lies within the counted races and within the physical steps between the boundaries. */
export function spanFitsSteps(
  span: { start?: number; end?: number },
  steps: number,
): span is { start: number; end: number } {
  const { start, end } = span;
  return (
    !!steps &&
    start !== undefined &&
    end !== undefined &&
    end - start + 1 <= steps &&
    start >= 1 &&
    end <= MAX_COUNTED_RACES
  );
}

/** Discarded races inside the physical span; their native points are in the game cumulatives but not in the Lounge total. */
export function discardedRacesInSpan(mogi: Mogi, from: Boundary | undefined, to: Boundary): Race[] {
  const { start, end } = intervalSpan(from, to, "physicalNumber");
  return start === undefined || end === undefined
    ? []
    : mogi.races.filter(
        (race) =>
          race.status === "discarded" &&
          race.physicalNumber !== undefined &&
          race.physicalNumber >= start &&
          race.physicalNumber <= end,
      );
}

/** A discarded race subtracts exactly its native contribution only when that native result is known, settled and uncontradicted. */
export function subtractableDiscardedRace(mogi: Mogi, race: Race): boolean {
  const settledReconstruction =
    race.origin !== "reconstructed" ||
    race.reconstruction?.status === "unique" ||
    (race.assistedGroupId === mogi.assistance?.id &&
      mogi.assistance?.confirmed?.kind === "unique" &&
      !!mogi.assistance.analysis?.complete);
  const nativeScale = race.placements.every(
    (id, index) => race.nativePoints?.[id] === undefined || race.nativePoints[id] === placementPoints[index],
  );
  const factsAgree = (mogi.assistance?.facts ?? []).every(
    (fact) =>
      fact.raceId !== race.id ||
      (fact.position !== "absent" && race.placements.indexOf(fact.participantId) + 1 === fact.position),
  );
  return (
    !race.participationReview &&
    race.placements.length === FULL_ROOM_PLAYERS &&
    settledReconstruction &&
    nativeScale &&
    factsAgree
  );
}

/** The same twelve people play every race of the span; a substitution boundary is a different numeric person, so a fallback IGN never carries across it. */
export function stableParticipants(
  mogi: Mogi,
  numbers: number[],
  stable: string[],
  from: Boundary | undefined,
  to: Boundary,
): string[] | undefined {
  const ids = participantsForRace(mogi, numbers[0]).map((person) => person.id);
  if (
    ids.length !== FULL_ROOM_PLAYERS ||
    numbers.some((number) => participantsForRace(mogi, number).some((person) => !ids.includes(person.id))) ||
    ids.some((id) => !stable.includes(id) || !to.values.has(id) || (from && !from.values.has(id)))
  )
    return;
  return ids;
}

/** With demonstrated count and continuity, 82 per physical race establishes a native room of twelve. Lower totals determine neither the Lounge adjustment nor an absence from an OCR crop. */
export function nativeTwelveGains(gains: number[], steps: number): boolean {
  return (
    gains.every((gain) => gain >= steps * MIN_POINTS_PER_RACE && gain <= steps * MAX_POINTS_PER_RACE) &&
    gains.reduce((sum, gain) => sum + gain, 0) === FULL_ROOM_POINTS * steps
  );
}

function intervalValues(
  mogi: Mogi,
  ids: string[],
  from: Boundary | undefined,
  to: Boundary,
  discarded: Race[],
): IntervalValue[] {
  return ids.map((id) => {
    const raw = to.values.get(id)!.value - (from?.values.get(id)?.value ?? 0);
    const discardedPoints = discarded.reduce(
      (sum, race) => sum + (race.nativePoints?.[id] ?? placementPoints[race.placements.indexOf(id)] ?? 0),
      0,
    );
    return {
      participantId: id,
      slotId: participationSlot(mogi.participants.find((person) => person.id === id)!),
      raw,
      adjusted: raw - discardedPoints,
    };
  });
}

/** Every input the proof depends on; a change to any of them withdraws the interval. */
function intervalSignature(
  mogi: Mogi,
  boundaries: Boundary[],
  from: Boundary | undefined,
  to: Boundary,
  numbers: number[],
  values: IntervalValue[],
  discarded: Race[],
): string {
  const fromSource = from && mogi.captures?.find((capture) => capture.id === from.captureId),
    toSource = mogi.captures?.find((capture) => capture.id === to.captureId);
  const scopedLink =
    fromSource &&
    toSource &&
    mogi.sequence?.links.find(
      (link) =>
        link.fromCaptureId === fromSource.id &&
        link.toCaptureId === toSource.id &&
        link.signature === sourceSignature(fromSource, toSource),
    );
  const sourceCaptureIds = from ? [from.captureId, to.captureId] : [to.captureId];
  return sha256Hex(
    JSON.stringify([
      sourceCaptureIds.map((id) => {
        const source = mogi.captures?.find((capture) => capture.id === id);
        return [
          id,
          source?.fingerprint,
          source?.interpretation,
          [...(boundaries.find((entry) => entry.captureId === id)?.values ?? [])],
          boundaries.find((entry) => entry.captureId === id)?.check,
        ];
      }),
      numbers,
      values,
      discarded.map((race) => [race.id, race.physicalNumber, race.placements, race.nativePoints]),
      scopedLink,
      mogi.sequence?.origins?.filter((fact) => sourceCaptureIds.includes(fact.captureId)),
      mogi.substitutions,
    ]),
  );
}

/** One proven interval between two boundaries `steps` physical races apart, or nothing when any precondition fails. */
export function provenInterval(
  mogi: Mogi,
  boundaries: Boundary[],
  from: Boundary | undefined,
  to: Boundary,
  steps: number,
  stable: string[],
): ProvenInterval | undefined {
  const span = intervalSpan(from, to);
  if (!spanFitsSteps(span, steps) || !completeHistories(from, to, stable)) return;
  const discarded = discardedRacesInSpan(mogi, from, to);
  if (
    span.end < span.start ||
    steps - (span.end - span.start + 1) !== discarded.length ||
    !discarded.every((race) => subtractableDiscardedRace(mogi, race))
  )
    return;
  const numbers = Array.from({ length: span.end - span.start + 1 }, (_, n) => span.start + n);
  const ids = stableParticipants(mogi, numbers, stable, from, to);
  if (!ids) return;
  const values = intervalValues(mogi, ids, from, to, discarded);
  if (
    !nativeTwelveGains(
      values.map((value) => value.raw),
      steps,
    )
  )
    return;
  const sourceCaptureIds = from ? [from.captureId, to.captureId] : [to.captureId];
  return {
    contribution: {
      id: `interval:${from?.captureId ?? "zero"}:${to.captureId}`,
      sourceCaptureIds,
      fromOccurrenceId: from?.occurrenceId ?? `zero:${to.captureId}`,
      toOccurrenceId: to.occurrenceId,
      validRaceNumbers: numbers,
      ...(discarded.length ? { physicalSteps: steps, discardedRaceIds: discarded.map((race) => race.id) } : {}),
      values,
      adjustment: "native-12",
    },
    signature: () => intervalSignature(mogi, boundaries, from, to, numbers, values, discarded),
  };
}

/** Proven intervals come from three starting boundaries: a continuous relation between captures, the first room with no earlier room (`initialRoomSources`) and a declared zero origin. */
export function provenIntervals(mogi: Mogi): readonly ProvenInterval[] {
  let intervals = provenByMogi.get(mogi);
  if (!intervals) provenByMogi.set(mogi, (intervals = findProvenIntervals(mogi)));
  return intervals;
}

// A mogi is replaced, never changed in place, so its proofs are found once; standings, totals and the table each ask again.
const provenByMogi = new WeakMap<Mogi, readonly ProvenInterval[]>();

function findProvenIntervals(mogi: Mogi): ProvenInterval[] {
  if (!mogi.sequence || mogi.sequence.conflict) return [];
  const boundaries = captureBoundaries(mogi),
    contributions: ProvenInterval[] = [];
  const add = (from: Boundary | undefined, to: Boundary, steps: number, stable: string[]) => {
    const interval = provenInterval(mogi, boundaries, from, to, steps, stable);
    if (interval) contributions.push(interval);
  };
  for (const relation of mogi.sequence.relations) {
    if (!numberedRoomSpan(mogi, relation.fromCaptureId, relation.toCaptureId, relation.completedSteps)) continue;
    const from = boundaries.find((entry) => entry.captureId === relation.fromCaptureId),
      to = boundaries.find((entry) => entry.captureId === relation.toCaptureId);
    if (from && to)
      add(from, to, boundaryCompletedSteps(from, to, relation.completedSteps), relation.stableParticipantIds);
  }
  for (const captureId of initialRoomSources(mogi)) {
    const to = boundaries.find((entry) => entry.captureId === captureId);
    if (to?.number === undefined) continue;
    const steps = (to.physicalNumber ?? to.number) - momentOffset(to.phase);
    const races = mogi.races.filter((race) => (race.physicalNumber ?? race.number ?? 0) <= steps);
    if (native12OriginScope(mogi, races, to.values.keys())) add(undefined, to, steps, [...to.values.keys()]);
  }
  for (const origin of mogi.sequence.origins ?? []) {
    const to = boundaries.find((entry) => entry.captureId === origin.captureId),
      source = mogi.captures?.find((capture) => capture.id === origin.captureId);
    // The sequence already checked the source-bound signature before deriving its number.
    if (
      to &&
      source &&
      origin.answer === "zero-valid-12" &&
      origin.signature === sourceSignature(source, source) &&
      to.number !== undefined &&
      native12OriginScope(
        mogi,
        mogi.races.filter(
          (race) =>
            (race.physicalNumber ?? race.number ?? 0) >= 1 &&
            (race.physicalNumber ?? race.number ?? 0) <= (to.physicalNumber ?? to.number!) - momentOffset(to.phase),
        ),
        to.values.keys(),
      )
    )
      add(undefined, to, (to.physicalNumber ?? to.number) - momentOffset(to.phase), [...to.values.keys()]);
  }
  return contributions;
}

/** Independent detail contradicts an interval before all its inner races are known when the remaining races can no longer reach the proven total within one to fifteen points each.
 * The manual detail stays; only this proof is suspended. */
export function detailContradictsInterval(mogi: Mogi, interval: UnsignedContribution): boolean {
  const numberFor = (race: Mogi["races"][number]) => race.number ?? mogi.races.indexOf(race) + 1;
  const covered = mogi.races.filter(
    (race) => race.status !== "discarded" && interval.validRaceNumbers.includes(numberFor(race)),
  );
  const details = covered.filter((race) => (race.status ?? "confirmed") === "confirmed" && !race.participationReview);
  const coveredIds = new Set(covered.map((race) => race.id));
  // Only current user facts count; analysis snapshots, skipped answers and history
  // cannot keep a withdrawn restriction alive or create an extra contribution.
  const facts = (mogi.assistance?.facts ?? []).filter(
    (fact) =>
      coveredIds.has(fact.raceId) && interval.values.some((value) => value.participantId === fact.participantId),
  );
  if (
    details.some((race) => race.placements.length !== FULL_ROOM_PLAYERS) ||
    facts.some((fact) => fact.position === "absent")
  )
    return true;
  return interval.values.some((value) => {
    const known = new Map(details.map((race) => [race.id, pointsFor(race, value.participantId)]));
    for (const fact of facts.filter((fact) => fact.participantId === value.participantId)) {
      const points = fact.position === "absent" ? 1 : placementPoints[fact.position - 1];
      if (known.has(fact.raceId) && known.get(fact.raceId) !== points) return true;
      known.set(fact.raceId, points);
    }
    const missing = interval.validRaceNumbers.length - known.size;
    const points = [...known.values()].reduce((sum, value) => sum + value, 0);
    return (
      points + missing * MIN_POINTS_PER_RACE > value.adjusted || points + missing * MAX_POINTS_PER_RACE < value.adjusted
    );
  });
}
export function normalizeCoverage<T extends Mogi>(mogi: T): T {
  const intervals = provenIntervals(mogi)
    .filter(({ contribution }) => !detailContradictsInterval(mogi, contribution))
    .map(({ contribution: { adjustment, ...contribution }, signature }) => ({
      ...contribution,
      signature: signature(),
      adjustment,
    }));
  if (!intervals.length && !mogi.coverage) return mogi;
  // Every stored proof is kept, so its signature must stay small: the whole state is saved as one value.
  const compact = (contribution: IntervalContribution) =>
    contribution.signature.length > SIGNATURE_LENGTH
      ? { ...contribution, signature: sha256Hex(contribution.signature) }
      : contribution;
  const history: NonNullable<Mogi["coverage"]>["history"] = [];
  for (const entry of mogi.coverage?.history ?? []) {
    const contribution = compact(entry.contribution);
    if (
      !history.some(
        (kept) => kept.contribution.id === contribution.id && kept.contribution.signature === contribution.signature,
      )
    )
      history.push(contribution === entry.contribution ? entry : { ...entry, contribution });
  }
  for (const old of (mogi.coverage?.intervals ?? []).map(compact))
    if (
      !intervals.some((next) => next.id === old.id && next.signature === old.signature) &&
      !history.some((entry) => entry.contribution.id === old.id && entry.contribution.signature === old.signature)
    )
      history.push({
        contribution: old,
        reason: "The screenshots or scope of this total changed; the previous conclusion is out of the standings.",
      });
  return { ...mogi, coverage: { version: 1, intervals, history } };
}
/** Last race covered without a gap from race one, in any order. */
export function coveragePrefix(numbers: number[]): number {
  const included = new Set(numbers);
  let number = 0;
  while (included.has(number + 1)) number++;
  return number;
}

/** Selects disjoint contributions: a known inner result never adds again to its interval. */
export function coverageProjection(mogi: Mogi, options: { contiguous?: boolean; through?: number } = {}) {
  const key = `${!!options.contiguous}:${options.through ?? Infinity}`;
  let projections = projectionsByMogi.get(mogi);
  if (!projections) projectionsByMogi.set(mogi, (projections = new Map()));
  let projection = projections.get(key);
  if (!projection) projections.set(key, (projection = projectCoverage(mogi, options)));
  return projection;
}

// Like proven intervals, a projection belongs to one unchanged mogi; each panel of the open mogi asks for it.
const projectionsByMogi = new WeakMap<Mogi, Map<string, ReturnType<typeof projectCoverage>>>();

function projectCoverage(mogi: Mogi, options: { contiguous?: boolean; through?: number }) {
  const limit = options.through ?? Infinity;
  const intervals = provenIntervals(mogi)
      .map(({ contribution }) => contribution)
      .filter((interval) => interval.validRaceNumbers.every((number) => number <= limit)),
    chosen: UnsignedContribution[] = [];
  const conflicts: CoverageConflict[] = [];
  const races = mogi.races.filter(
    (race) =>
      (race.status ?? "confirmed") === "confirmed" &&
      !race.participationReview &&
      (race.number ?? mogi.races.indexOf(race) + 1) <= limit,
  );
  for (const interval of [...intervals].sort(
    (a, b) => b.validRaceNumbers.length - a.validRaceNumbers.length || a.id.localeCompare(b.id),
  )) {
    if (detailContradictsInterval(mogi, interval)) {
      conflicts.push({ kind: "detail-total-mismatch", raceNumbers: [...interval.validRaceNumbers] });
      continue;
    }
    const overlapping = chosen.filter((other) =>
      other.validRaceNumbers.some((n) => interval.validRaceNumbers.includes(n)),
    );
    if (overlapping.length) {
      const container = overlapping.find((other) =>
        interval.validRaceNumbers.every((n) => other.validRaceNumbers.includes(n)),
      );
      if (!container) conflicts.push({ kind: "overlapping-intervals" });
      else if (
        container.validRaceNumbers.length === interval.validRaceNumbers.length &&
        interval.values.some(
          (value) => container.values.find((entry) => entry.slotId === value.slotId)?.adjusted !== value.adjusted,
        )
      )
        conflicts.push({ kind: "incompatible-totals" });
      continue;
    }
    chosen.push(interval);
  }
  // Current standings stop at the first gap. Full coverage stays available
  // to inspect later proofs and results without adding them.
  const through = options.contiguous
    ? coveragePrefix([
        ...chosen.flatMap((interval) => interval.validRaceNumbers),
        ...races.map((race) => race.number ?? mogi.races.indexOf(race) + 1),
      ])
    : Infinity;
  const rows = rosterSlots(mogi).map((slot) => {
    const numbers = new Set<number>(),
      selected: string[] = [];
    let points = 0;
    for (const interval of chosen) {
      if (interval.validRaceNumbers.some((number) => number > through)) continue;
      const value = interval.values.find((entry) => entry.slotId === slot.id);
      if (!value) continue;
      points += value.adjusted;
      interval.validRaceNumbers.forEach((n) => numbers.add(n));
      selected.push(interval.id);
    }
    for (const race of races) {
      const number = race.number ?? mogi.races.indexOf(race) + 1;
      if (number > through) continue;
      if (numbers.has(number)) continue;
      const members = mogi.participants.filter((person) => participationSlot(person) === slot.id);
      if (
        !members.some((person) => race.placements.includes(person.id) || race.absentParticipantIds?.includes(person.id))
      )
        continue;
      points += members.reduce((sum, person) => sum + pointsFor(race, person.id), 0);
      numbers.add(number);
    }
    return { slotId: slot.id, points, numbers: [...numbers].sort((a, b) => a - b), intervalIds: selected };
  });
  const common = rows.length
    ? rows[0].numbers.filter((number) => rows.every((row) => row.numbers.includes(number)))
    : [];
  const detailPending = chosen.filter((interval) =>
    interval.validRaceNumbers.some(
      (number) => !races.some((race) => (race.number ?? mogi.races.indexOf(race) + 1) === number),
    ),
  );
  const unequal = rows.some((row) => row.numbers.join() !== common.join());
  const pending = mogi.races
    .filter((race) => race.status === "pending")
    .map((race) => race.number ?? mogi.races.indexOf(race) + 1)
    .filter((number) => !common.includes(number));
  const distance = (from: string, to: string): number | undefined => {
    if (from === to) return 0;
    const forward = mogi.sequence?.relations.find(
      (relation) => relation.fromCaptureId === from && relation.toCaptureId === to,
    );
    if (forward) return forward.completedSteps;
    const reverse = mogi.sequence?.relations.find(
      (relation) => relation.fromCaptureId === to && relation.toCaptureId === from,
    );
    return reverse ? -reverse.completedSteps : undefined;
  };
  const gapCovered = (sources: string[]) =>
    chosen.some((interval) => {
      const from = interval.sourceCaptureIds[0],
        to = interval.sourceCaptureIds.at(-1)!;
      const steps = distance(from, to);
      return (
        steps !== undefined &&
        sources.every((id) => {
          const at = distance(from, id);
          return at !== undefined && at >= 0 && at <= steps;
        })
      );
    });
  const unresolvedBoundary = captureBoundaries(mogi).some(
    (boundary) =>
      boundary.number === undefined &&
      [...boundary.values.values()].some((value) => value.value > 0) &&
      !gapCovered([boundary.captureId]),
  );
  const unresolved =
    !!mogi.sequence?.conflict ||
    unresolvedBoundary ||
    (mogi.sequence?.gaps.some(
      (gap) =>
        (gap.order === "unknown" || gap.count === undefined || gap.validCount === undefined) &&
        !gapCovered(gap.sourceCaptureIds),
    ) ??
      false);
  return {
    rows,
    intervals: chosen,
    common,
    pending,
    detailPending,
    unequal,
    conflicts,
    unresolved,
    complete: common.length === 12 && !conflicts.length && !unequal && !unresolved,
  };
}
