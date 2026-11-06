import { participantsForOccurrence } from "../participation/participation.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import { countedRaces, raceNumber, racePhysicalNumber } from "../scoring/scoring.ts";
import type { Mogi, PositionFact, Race, Reconstruction } from "../types.ts";
import { assistanceProblem } from "./assistance-problem.ts";
import { boundaryEquations } from "./boundary-problem.ts";
import { AMBIGUOUS_SOLUTIONS, exactPlacementSearch } from "./exact-placement.ts";
import { orderingInputSignature } from "./ordering.ts";
import { reconstructionSignature } from "./reconstruction-input.ts";
export { reconstructionSignature } from "./reconstruction-input.ts";

// A Lounge mogi counts twelve races; a thirteenth result cannot enter the totals.
const MAX_COUNTED_RACES = 12;

/** A single numbered gap uses the exact budget and checks every boundary equation before claiming uniqueness. */
export async function exactBoundarySearch(mogi: Mogi, target: Race, facts: PositionFact[]) {
  const started = performance.now();
  const problem = await assistanceProblem(mogi, [target], facts);
  const analysis = problem.analysis;
  if (!problem.ready) return analysis;
  const equations = analysis.equations;
  if (
    equations.some((equation) =>
      equations.some((other) => other.participantId === equation.participantId && other.gain !== equation.gain),
    )
  ) {
    return {
      ...analysis,
      status: "conflict" as const,
      complete: true,
      message: "The game totals contradict each other. Check the screenshots.",
    };
  }
  const { solutions, incomplete } = await exactPlacementSearch(
    participantsForOccurrence(mogi, target),
    equations,
    facts,
    target.id,
  );
  analysis.hypotheses = solutions.map((solution) => ({
    results: [
      {
        raceId: target.id,
        placements: solution.placements,
        absentParticipantIds: solution.absent,
        represented: solution.represented,
      },
    ],
  }));
  analysis.complete = !incomplete && solutions.length < AMBIGUOUS_SOLUTIONS;
  analysis.status =
    solutions.length >= AMBIGUOUS_SOLUTIONS
      ? "ambiguous"
      : incomplete
        ? "incomplete"
        : solutions.length === 1
          ? "unique"
          : "conflict";
  analysis.message =
    analysis.status === "unique"
      ? "One result fits the game totals; search complete."
      : analysis.status === "ambiguous"
        ? "More than one result fits; the race stays pending."
        : incomplete
          ? "Search incomplete: work limit reached."
          : "No result fits the game totals. Check the screenshots.";
  analysis.stats.elapsedMs = Math.round(performance.now() - started);
  return analysis;
}

export async function reconstructOne(mogi: Mogi, target: Race): Promise<Reconstruction> {
  const number = raceNumber(mogi, target);
  const physicalNumber = racePhysicalNumber(mogi, target);
  const result: Reconstruction = {
    status: "insufficient",
    inputSignature: reconstructionSignature(mogi, target),
    createdAt: new Date().toISOString(),
    targetNumber: number,
    message: "Check the race order and that exactly one race is missing.",
    anchors: [],
    knownRaces: [],
    orderBasis: mogi.orderReview?.basis,
    sourceCaptureIds: [],
    placements: [],
    absentParticipantIds: [],
  };
  if (target.participationReview || (target.placements.length && target.origin !== "reconstructed")) return result;
  if (boundaryEquations(mogi, [target]).length) {
    const facts = (mogi.assistance?.facts ?? []).filter((fact) => fact.raceId === target.id);
    const analysis = await exactBoundarySearch(mogi, target, facts);
    const found = analysis.status === "unique" && analysis.complete ? analysis.hypotheses[0]?.results[0] : undefined;
    return {
      ...result,
      status: analysis.status === "stale" ? "insufficient" : analysis.status,
      message: analysis.message,
      boundaryAnalysis: analysis,
      sourceCaptureIds: analysis.sourceCaptureIds,
      knownRaces: analysis.knownRaces.map((known) => ({
        raceId: known.raceId,
        number: known.number,
        represented: known.represented,
        discarded: known.discarded,
        nativePoints: known.nativePoints,
      })),
      ...(found
        ? {
            placements: found.placements,
            absentParticipantIds: found.absentParticipantIds,
            represented: found.represented,
          }
        : {}),
    };
  }
  const prior = target.reconstruction;
  const orderCurrent = mogi.orderReview?.inputSignature === orderingInputSignature(mogi);
  if (
    !mogi.orderReview ||
    (!orderCurrent && (prior?.status !== "unique" || prior.inputSignature !== result.inputSignature))
  )
    return result;
  const eligible = mogi.races
    .filter(
      (r) =>
        r.origin !== "reconstructed" &&
        r.status !== "pending" &&
        !r.participationReview &&
        r.gameEvidence?.verified &&
        r.gameEvidence.stage === "post-race",
    )
    .sort((a, b) => racePhysicalNumber(mogi, a) - racePhysicalNumber(mogi, b));
  const older = eligible.filter((r) => racePhysicalNumber(mogi, r) < physicalNumber).at(-1);
  const newer = eligible.find((r) => racePhysicalNumber(mogi, r) > physicalNumber);
  if (!older || !newer || !mogi.orderReview.raceIds.includes(older.id) || !mogi.orderReview.raceIds.includes(newer.id))
    return result;
  const a = older.gameEvidence!,
    b = newer.gameEvidence!;
  result.fromRaceId = older.id;
  result.toRaceId = newer.id;
  result.session = a.session;
  const interval = mogi.races.filter(
    (r) =>
      racePhysicalNumber(mogi, r) > racePhysicalNumber(mogi, older) &&
      racePhysicalNumber(mogi, r) < racePhysicalNumber(mogi, newer),
  );
  // Explicit occurrence numbering establishes cardinality; every intervening occurrence is accounted for.
  if (
    interval.length !== racePhysicalNumber(mogi, newer) - racePhysicalNumber(mogi, older) - 1 ||
    interval.filter((r) => r.id === target.id || r.status === "pending" || !r.placements.length).length !== 1 ||
    !interval.some((r) => r.id === target.id) ||
    a.session !== b.session
  )
    return result;
  const known = interval.filter((r) => r.id !== target.id);
  if (known.some((r) => r.origin === "reconstructed" || r.participationReview)) return result;
  result.knownRaces = known.map((r) => ({
    raceId: r.id,
    number: r.status === "discarded" ? racePhysicalNumber(mogi, r) : raceNumber(mogi, r),
    represented: r.placements.length,
    discarded: r.status === "discarded",
    nativePoints: Object.fromEntries(
      r.placements.map((id, i) => [id, r.nativePoints?.[id] ?? nativePlacementPoints(r.placements.length)[i]]),
    ),
  }));
  for (const race of known) {
    const scale = nativePlacementPoints(race.placements.length);
    if (
      race.placements.some(
        (id, position) => race.nativePoints?.[id] !== undefined && race.nativePoints[id] !== scale[position],
      )
    )
      return {
        ...result,
        status: "conflict",
        message: "In-game points don't match the placements of a known race. Review the values.",
      };
  }
  const active = participantsForOccurrence(mogi, target);
  const relevantRaceIds = new Set([target.id, older.id, newer.id, ...known.map((r) => r.id)]);
  const facts = (mogi.assistance?.facts ?? []).filter((f) => relevantRaceIds.has(f.raceId));
  for (const fact of facts) {
    const race = mogi.races.find((r) => r.id === fact.raceId)!;
    const participated = participantsForOccurrence(mogi, race).some((p) => p.id === fact.participantId);
    const contradictsKnown =
      race.id !== target.id &&
      (fact.position === "absent"
        ? !race.absentParticipantIds?.includes(fact.participantId)
        : race.placements.indexOf(fact.participantId) !== fact.position - 1);
    if (!participated || contradictsKnown)
      return {
        ...result,
        status: "conflict",
        message: "No result fits the known positions. Correct or remove the position you gave.",
      };
  }

  for (const p of active) {
    const left = a.readings[p.id],
      right = b.readings[p.id];
    if (
      !left?.useAsAnchor ||
      !right?.useAsAnchor ||
      left.segment !== right.segment ||
      !left.cumulative ||
      !right.cumulative ||
      !right.current ||
      !older.placements.includes(p.id) ||
      !newer.placements.includes(p.id)
    )
      continue;
    let subtotal = 0,
      compatible = true;
    for (const race of known) {
      const reading = race.gameEvidence?.readings[p.id];
      if (
        (race.gameEvidence && race.gameEvidence.session !== a.session) ||
        (reading && reading.segment !== left.segment)
      ) {
        compatible = false;
        break;
      }
      const position = race.placements.indexOf(p.id);
      if (position >= 0) {
        const raw = race.nativePoints?.[p.id] ?? nativePlacementPoints(race.placements.length)[position];
        if (raw === undefined || raw !== nativePlacementPoints(race.placements.length)[position]) {
          compatible = false;
          break;
        }
        subtotal += raw;
      } else if (!race.absentParticipantIds?.includes(p.id)) {
        compatible = false;
        break;
      }
    }
    if (!compatible) continue;
    const current = right.current.value;
    const native = nativePlacementPoints(newer.placements.length)[newer.placements.indexOf(p.id)];
    if (
      left.cumulative.value < nativePlacementPoints(older.placements.length)[older.placements.indexOf(p.id)] ||
      right.cumulative.value < current ||
      current !== native ||
      (left.current &&
        left.current.value !== nativePlacementPoints(older.placements.length)[older.placements.indexOf(p.id)])
    ) {
      return {
        ...result,
        status: "conflict",
        message: "In-game points don't match the placements in a screenshot. Review the values.",
      };
    }
    result.anchors.push({
      participantId: p.id,
      older: left.cumulative,
      newer: right.cumulative,
      current: right.current,
      known: subtotal,
      gain: right.cumulative.value - left.cumulative.value - current - subtotal,
      segment: left.segment,
    });
  }
  result.sourceCaptureIds = [
    ...new Set([
      ...(older.captureIds ?? []),
      ...(newer.captureIds ?? []),
      ...known.flatMap((r) => r.captureIds ?? []),
      ...result.anchors.flatMap((anchor) =>
        [anchor.older, anchor.newer, anchor.current].flatMap((v) => (v.sourceCaptureId ? [v.sourceCaptureId] : [])),
      ),
    ]),
  ];
  if (result.anchors.some((a) => a.gain < 0))
    return {
      ...result,
      status: "conflict",
      message: "A total went down between screenshots. Review the readings, the race order and room reopenings.",
    };
  if (result.anchors.length < 2)
    return {
      ...result,
      message: "Not enough evidence: fewer than two players have steady totals. Check room reopenings.",
    };
  const { solutions, incomplete } = await exactPlacementSearch(active, result.anchors, facts, target.id);
  if (solutions.length >= AMBIGUOUS_SOLUTIONS)
    return {
      ...result,
      status: "ambiguous",
      message: "More than one result fits; the race stays pending.",
    };
  if (incomplete)
    return {
      ...result,
      status: "incomplete",
      message: "Search stopped at its work limit; the result isn't proven unique.",
    };
  if (!solutions.length)
    return {
      ...result,
      status: "conflict",
      message: "No result fits the readings and known positions. Review positions, race numbers and continuity.",
    };
  return {
    ...result,
    status: "unique",
    message: "Only result that fits the current evidence",
    represented: solutions[0].represented,
    placements: solutions[0].placements,
    absentParticipantIds: solutions[0].absent,
  };
}
export function applyReconstruction<T extends Mogi>(mogi: T, target: Race, result: Reconstruction): T {
  if (
    result.status === "unique" &&
    target.status !== "discarded" &&
    countedRaces(mogi).filter((r) => r.id !== target.id).length >= MAX_COUNTED_RACES
  )
    result = {
      ...result,
      status: "insufficient",
      message: "12 races already count. Discard another one first.",
    };
  const canCount =
    result.status === "unique" &&
    (target.status === "discarded" || countedRaces(mogi).filter((r) => r.id !== target.id).length < MAX_COUNTED_RACES);
  const next: T = {
    ...mogi,
    races: mogi.races.map((r) =>
      r.id !== target.id
        ? r
        : {
            ...r,
            origin: canCount ? "reconstructed" : r.origin,
            assistedGroupId: result.boundaryAnalysis && canCount ? undefined : r.assistedGroupId,
            status: r.status === "discarded" ? "discarded" : canCount ? "confirmed" : "pending",
            placements: canCount ? result.placements : [],
            absentParticipantIds: canCount
              ? result.absentParticipantIds
              : r.placements.length
                ? undefined
                : r.absentParticipantIds,
            reconstruction: result,
            reconstructionHistory: r.reconstruction
              ? [...(r.reconstructionHistory ?? []), r.reconstruction]
              : r.reconstructionHistory,
          },
    ),
  };
  if (canCount && next.orderReview)
    next.orderReview = {
      ...next.orderReview,
      inputSignature: orderingInputSignature(next),
    };
  return next;
}
