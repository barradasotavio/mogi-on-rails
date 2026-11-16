import { boundaryCompletedSteps, captureBoundaries } from "../capture/capture-boundary.ts";
import { momentOffset } from "../capture/screens.ts";
import { representedPlayers } from "../numeric-readings/numeric-candidates.ts";
import { participantsForOccurrence } from "../participation/participation.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import { raceNumber } from "../scoring/scoring.ts";
import { numberedRoomSpan } from "../sequence/room/room-sequence.ts";
import { sequenceLinkSignature } from "../sequence/sequence.ts";
import type { AssistanceAnalysis, AssistanceEquation, GameValue, Mogi, Race } from "../types.ts";
import { native12OriginScope } from "./origin-scope.ts";

/** Only demonstrated, numbered physical boundaries delimit solver terms.
 * Presentation order is never a placement; reconstructed outputs are not anchors. */
export function boundaryEquations(mogi: Mogi, targets: Race[]): AssistanceEquation[] {
  if (!mogi.sequence || mogi.sequence.conflict) return [];
  const boundaries = captureBoundaries(mogi),
    equations: AssistanceEquation[] = [];
  const ids = new Set(targets.map((race) => race.id));
  for (const relation of mogi.sequence.relations) {
    if (!numberedRoomSpan(mogi, relation.fromCaptureId, relation.toCaptureId, relation.completedSteps)) continue;
    const from = boundaries.find((source) => source.captureId === relation.fromCaptureId);
    const to = boundaries.find((source) => source.captureId === relation.toCaptureId);
    if (from?.number === undefined || to?.number === undefined) continue;
    const left = (from.physicalNumber ?? from.number) - momentOffset(from.phase),
      right = (to.physicalNumber ?? to.number) - momentOffset(to.phase);
    if (right <= left || right - left !== boundaryCompletedSteps(from, to, relation.completedSteps)) continue;
    const inside = mogi.races.filter(
      (race) =>
        (race.physicalNumber ?? raceNumber(mogi, race)) > left &&
        (race.physicalNumber ?? raceNumber(mogi, race)) <= right,
    );
    if (
      inside.length !== right - left ||
      new Set(inside.map((race) => race.physicalNumber ?? raceNumber(mogi, race))).size !== inside.length
    )
      continue;
    const indices = targets.flatMap((race, index) => (inside.some((entry) => entry.id === race.id) ? [index] : []));
    if (!indices.length) continue;
    const known = inside.filter((race) => !ids.has(race.id));
    if (
      known.some(
        (race) =>
          race.origin === "reconstructed" ||
          race.status === "pending" ||
          race.participationReview ||
          race.placements.length < 10 ||
          race.placements.some(
            (id, rank) =>
              race.nativePoints?.[id] !== undefined &&
              race.nativePoints[id] !== nativePlacementPoints(race.placements.length)[rank],
          ),
      )
    )
      continue;
    for (const id of relation.stableParticipantIds) {
      const older = from.values.get(id),
        newer = to.values.get(id);
      if (
        !older ||
        !newer ||
        indices.some((index) => !participantsForOccurrence(mogi, targets[index]).some((person) => person.id === id))
      )
        continue;
      let subtotal = 0,
        compatible = true;
      for (const race of known) {
        const rank = race.placements.indexOf(id);
        if (rank >= 0) subtotal += nativePlacementPoints(race.placements.length)[rank];
        else if (!race.absentParticipantIds?.includes(id)) compatible = false;
      }
      if (!compatible) continue;
      equations.push({
        boundary: true,
        boundaryChecks: [from.check, to.check].filter((check) => check !== undefined),
        knownRaceIds: known.map((race) => race.id),
        participantId: id,
        targetIndices: indices,
        gain: newer.value - older.value - subtotal,
        known: subtotal,
        fromCaptureId: from.captureId,
        toCaptureId: to.captureId,
        fromNumber: from.number,
        toNumber: to.number,
        older,
        newer,
        session: "physical-boundaries",
        segment: id,
      });
    }
  }
  for (const relation of mogi.sequence.relations)
    equations.push(...raceTwoFromNeighbours(mogi, boundaries, relation, targets, ids));
  for (const fact of mogi.sequence.origins ?? []) {
    const source = mogi.captures?.find((capture) => capture.id === fact.captureId);
    const to = boundaries.find((boundary) => boundary.captureId === fact.captureId);
    if (
      fact.answer !== "zero-valid-12" ||
      !source ||
      !to ||
      to.number === undefined ||
      fact.signature !== sequenceLinkSignature(source, source) ||
      to.values.size !== 12
    )
      continue;
    const right = (to.physicalNumber ?? to.number) - momentOffset(to.phase);
    if (right < 1 || right > 12) continue;
    const inside = mogi.races.filter(
      (race) =>
        (race.physicalNumber ?? raceNumber(mogi, race)) >= 1 &&
        (race.physicalNumber ?? raceNumber(mogi, race)) <= right,
    );
    const people = [...to.values.keys()];
    if (
      inside.length !== right ||
      new Set(inside.map((race) => race.physicalNumber ?? raceNumber(mogi, race))).size !== right ||
      !native12OriginScope(mogi, inside, people)
    )
      continue;
    if (
      [...to.values.values()].some((value) => value.value < right || value.value > right * 15) ||
      [...to.values.values()].reduce((sum, value) => sum + value.value, 0) !== 82 * right
    )
      continue;
    const indices = targets.flatMap((race, index) => (inside.some((entry) => entry.id === race.id) ? [index] : []));
    const known = inside.filter((race) => !ids.has(race.id));
    if (
      !indices.length ||
      known.some(
        (race) =>
          race.origin === "reconstructed" ||
          race.status === "pending" ||
          race.placements.length !== 12 ||
          race.absentParticipantIds?.length ||
          race.placements.some(
            (id, rank) =>
              race.nativePoints?.[id] !== undefined && race.nativePoints[id] !== nativePlacementPoints(12)[rank],
          ),
      )
    )
      continue;
    for (const id of people) {
      const subtotal = known.reduce((sum, race) => sum + nativePlacementPoints(12)[race.placements.indexOf(id)], 0);
      equations.push({
        boundary: true,
        boundaryChecks: to.check ? [to.check] : [],
        originFact: { kind: "confirmed-origin", ...fact, answer: "zero-valid-12" },
        knownRaceIds: known.map((race) => race.id),
        participantId: id,
        targetIndices: indices,
        gain: to.values.get(id)!.value - subtotal,
        known: subtotal,
        toCaptureId: to.captureId,
        fromNumber: 0,
        toNumber: to.number,
        older: { value: 0, origin: "manual" },
        newer: to.values.get(id)!,
        session: "confirmed-origin",
        segment: id,
      });
    }
  }
  return equations;
}

// A full room: the zero start below needs every one of its twelve totals.
const FULL_ROOM = 12;
// Room sizes with a native scale; the people left out of a smaller one gained nothing (absent).
const SCALE_SIZES = [12, 11, 10];

/** The finish order the gains give, when they are exactly one native scale (each value once) and zeros for the
 * absent; otherwise undefined. */
export function nativeScaleOrder(gains: Map<string, number>): { placements: string[]; absent: string[] } | undefined {
  const scored = [...gains].filter(([, gain]) => gain !== 0).sort((a, b) => b[1] - a[1]);
  const scale = nativePlacementPoints(scored.length);
  if (!SCALE_SIZES.includes(scored.length) || scored.some(([, gain], index) => gain !== scale[index])) return;
  return {
    placements: scored.map(([id]) => id),
    absent: [...gains].filter(([, gain]) => gain === 0).map(([id]) => id),
  };
}

/** Totals before race 1 on its own results screen: every one of twelve identified rows reads, is deduced or is
 * answered 0. Undefined as soon as one row is missing, unidentified or not 0. */
function zeroStartTotals(mogi: Mogi, captureId: string): Map<string, GameValue> | undefined {
  const capture = mogi.captures?.find((entry) => entry.id === captureId);
  if (capture?.interpretation?.screen !== "finishOrderAdding" || representedPlayers(capture) !== FULL_ROOM) return;
  const values = new Map<string, GameValue>();
  for (let row = 1; row <= FULL_ROOM; row++) {
    const id = capture.nameAssociations?.[row - 1]?.participantId;
    const answer = capture.numericAnswers?.find((entry) => entry.row === row && entry.field === "right");
    const deduced = capture.numericDeductions?.find((entry) => entry.row === row && entry.field === "right");
    const read = capture.numericRows?.find((entry) => entry.row === row)?.right?.value;
    const value = answer?.value ?? deduced?.value ?? read;
    if (!id || values.has(id) || value !== 0) return;
    values.set(id, {
      value: 0,
      origin: answer ? "manual" : deduced ? "deduced" : "observed",
      sourceCaptureId: capture.id,
      sourceRow: row,
      sourceField: "right",
    });
  }
  return values;
}

/** raceTwoFromNeighbours: race 2 with no result of its own, between the race-1 results screen (totals 0 before
 * race 1, its finish order confirmed) and a confirmed screen of totals after race 2. The race-1 screen has no
 * neighbour to check its column against, so the general boundaries never use it. Only when all twelve totals are
 * read and race 2's gains are exactly one native scale; otherwise nothing, as before. */
function raceTwoFromNeighbours(
  mogi: Mogi,
  boundaries: ReturnType<typeof captureBoundaries>,
  relation: NonNullable<Mogi["sequence"]>["relations"][number],
  targets: Race[],
  ids: Set<string>,
): AssistanceEquation[] {
  const from = boundaries.find((source) => source.captureId === relation.fromCaptureId);
  const to = boundaries.find((source) => source.captureId === relation.toCaptureId);
  if (!from || from.values.size || from.physicalNumber !== 1 || from.number !== 1 || to?.number === undefined)
    return [];
  const start = zeroStartTotals(mogi, from.captureId);
  if (!start || !numberedRoomSpan(mogi, relation.fromCaptureId, relation.toCaptureId, relation.completedSteps))
    return [];
  const right = (to.physicalNumber ?? to.number) - momentOffset(to.phase);
  const before = { phase: "before", sequenceOffset: from.sequenceOffset };
  if (right !== 2 || boundaryCompletedSteps(before, to, relation.completedSteps) !== 2) return [];
  const first = mogi.races.find((race) => race.id === from.occurrenceId);
  const after = mogi.races.find((race) => race.id === to.occurrenceId);
  const inside = mogi.races.filter((race) => [1, 2].includes(race.physicalNumber ?? raceNumber(mogi, race) ?? 0));
  const index = targets.findIndex((race) => race.id !== first?.id && inside.some((entry) => entry.id === race.id));
  if (
    !first ||
    !after ||
    ids.has(first.id) ||
    index < 0 ||
    inside.length !== 2 ||
    !inside.some((race) => race.id === first.id) ||
    [first, after].some((race) => race.status !== "confirmed" || race.participationReview) ||
    first.origin === "reconstructed" ||
    first.placements.length !== FULL_ROOM ||
    first.absentParticipantIds?.length ||
    first.placements.some(
      (id, rank) =>
        first.nativePoints?.[id] !== undefined && first.nativePoints[id] !== nativePlacementPoints(FULL_ROOM)[rank],
    )
  )
    return [];
  const people = participantsForOccurrence(mogi, targets[index]).map((person) => person.id);
  const scale = nativePlacementPoints(FULL_ROOM);
  const gains = new Map<string, number>();
  for (const id of start.keys()) {
    const newer = to.values.get(id);
    if (!newer || !relation.stableParticipantIds.includes(id) || !people.includes(id)) return [];
    gains.set(id, newer.value - scale[first.placements.indexOf(id)]);
  }
  if (people.length !== start.size || !nativeScaleOrder(gains)) return [];
  return [...start].map(([id, older]) => ({
    boundary: true as const,
    boundaryChecks: to.check ? [to.check] : [],
    knownRaceIds: [first.id],
    participantId: id,
    targetIndices: [index],
    gain: gains.get(id)!,
    known: scale[first.placements.indexOf(id)],
    fromCaptureId: from.captureId,
    toCaptureId: to.captureId,
    fromNumber: from.number!,
    toNumber: to.number!,
    older,
    newer: to.values.get(id)!,
    session: "physical-boundaries",
    segment: id,
  }));
}

/** The result the totals around a race give on their own: every participant's gain from one consistent set of
 * boundary equations, forming exactly one native scale. Used to check a result entered by hand, never to change it. */
export function neighbourResult(
  mogi: Mogi,
  race: Race,
): { placements: string[]; absent: string[]; captureIds: string[] } | undefined {
  const equations = boundaryEquations(mogi, [race]);
  const gains = new Map<string, number>();
  for (const equation of equations) {
    if (gains.has(equation.participantId) && gains.get(equation.participantId) !== equation.gain) return;
    gains.set(equation.participantId, equation.gain);
  }
  const people = participantsForOccurrence(mogi, race).map((person) => person.id);
  if (!gains.size || people.length !== gains.size || people.some((id) => !gains.has(id))) return;
  const order = nativeScaleOrder(gains);
  if (!order) return;
  const captureIds = equations.flatMap((equation) => [equation.fromCaptureId, equation.toCaptureId]);
  return { ...order, captureIds: [...new Set(captureIds.filter((id): id is string => !!id))] };
}

/** Identity of a finish order and its absences, as `keptTypedResult` stores it. */
export function typedResultKey(result: { placements: string[]; absent: string[] }): string {
  return JSON.stringify([result.placements, [...result.absent].sort()]);
}

/** Snapshot the independent native contributions actually subtracted by the equations. */
export function boundaryKnownRaces(mogi: Mogi, equations: AssistanceEquation[]): AssistanceAnalysis["knownRaces"] {
  const ids = new Set(equations.flatMap((equation) => equation.knownRaceIds ?? []));
  return mogi.races
    .filter((race) => ids.has(race.id))
    .map((race) => ({
      raceId: race.id,
      number: raceNumber(mogi, race),
      represented: race.placements.length,
      discarded: race.status === "discarded",
      placements: race.placements,
      absentParticipantIds: race.absentParticipantIds ?? [],
      nativePoints: Object.fromEntries(
        race.placements.map((id, index) => [
          id,
          race.nativePoints?.[id] ?? nativePlacementPoints(race.placements.length)[index],
        ]),
      ),
      nativePointOrigins: Object.fromEntries(
        race.placements.map((id) => [id, race.nativePointOrigins?.[id] ?? "modeled"]),
      ),
    }));
}
