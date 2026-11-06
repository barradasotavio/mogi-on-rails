import { boundaryCompletedSteps, captureBoundaries } from "../capture/capture-boundary.ts";
import { momentOffset } from "../capture/screens.ts";
import { participantsForOccurrence } from "../participation/participation.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import { raceNumber } from "../scoring/scoring.ts";
import { numberedRoomSpan } from "../sequence/room/room-sequence.ts";
import { sequenceLinkSignature } from "../sequence/sequence.ts";
import type { AssistanceAnalysis, AssistanceEquation, Mogi, Race } from "../types.ts";
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
