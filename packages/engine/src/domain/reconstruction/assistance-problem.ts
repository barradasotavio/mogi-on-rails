import { participantsForOccurrence } from "../participation/participation.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import { raceNumber, racePhysicalNumber } from "../scoring/scoring.ts";
import type { AssistanceAnalysis, Mogi, PositionFact, Race, ReconstructionHypothesis } from "../types.ts";
import { boundaryEquations, boundaryKnownRaces } from "./boundary-problem.ts";
import { orderingInputSignature } from "./ordering.ts";
import { reconstructionSourceSignature } from "./reconstruction-input.ts";

// Time budget shared by preparing the equations and the search, short enough to keep a phone responsive.
export const ASSISTED_SEARCH_MAX_MS = 1500;
// Equation budget; past it the analysis is incomplete instead of growing without bound.
const MAX_EQUATIONS = 20000;
// Yield to the event loop every this many source pairs so preparation stays cancellable.
const PREPARATION_YIELD_NODES = 16;
// Ten is the smallest represented room with a supported native scale.
const MIN_ROOM_PLAYERS = 10;
// Room sizes with a supported native scale.
const ROOM_SIZES = [10, 11, 12];
// Equations need at least two stable players, or any placement of one player fits.
const MIN_STABLE_PLAYERS = 2;

async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
/** Cheap identity of the actual boundary problem, before bounded search. */
export async function boundaryInputSignature(mogi: Mogi, targets: Race[], facts: PositionFact[]): Promise<string> {
  const equations = boundaryEquations(mogi, targets);
  const source = await digest(
    JSON.stringify([
      targets.map((race) => [
        race.id,
        race.number,
        race.physicalNumber,
        race.status === "discarded",
        race.participationReview,
      ]),
      targets.map((race) => participantsForOccurrence(mogi, race).map((person) => person.id)),
      equations,
      boundaryKnownRaces(mogi, equations),
    ]),
  );
  return digest(JSON.stringify([source, facts]));
}
/** The assisted reconstruction problem: the target races, who could play each, the known positions and the gain equations from the anchors around them. */
export interface AssistanceProblem {
  ready: boolean;
  mogi: Mogi;
  targets: Race[];
  active: string[][];
  facts: PositionFact[];
  analysis: AssistanceAnalysis;
}
export async function assistanceProblem(
  mogi: Mogi,
  targets: Race[],
  facts: PositionFact[],
  cancelled: () => boolean = () => false,
  started = performance.now(),
): Promise<AssistanceProblem> {
  const sourceSignature = await digest(
    JSON.stringify([targets.map((r) => r.id), targets[0] ? reconstructionSourceSignature(mogi, targets[0]) : null]),
  );
  const inputSignature = await digest(JSON.stringify([sourceSignature, facts]));
  const analysis: AssistanceAnalysis = {
    facts,
    status: "insufficient",
    sourceSignature,
    inputSignature,
    orderVerified: false,
    createdAt: new Date().toISOString(),
    targetRaceIds: targets.map((r) => r.id),
    hypotheses: [],
    complete: false,
    message: "Check the race order and the numbering of the gaps between final screenshots.",
    equations: [],
    knownRaces: [],
    sourceCaptureIds: [],
    stats: { nodes: 0, contexts: 0, tuples: 0, elapsedMs: 0, cancelled: false },
  };
  const result: AssistanceProblem = {
    ready: false,
    mogi,
    targets,
    active: targets.map((r) => participantsForOccurrence(mogi, r).map((p) => p.id)),
    facts,
    analysis,
  };
  const boundary = boundaryEquations(mogi, targets);
  if (boundary.length) {
    analysis.equations = boundary;
    analysis.knownRaces = boundaryKnownRaces(mogi, boundary);
    analysis.sourceCaptureIds = [
      ...new Set([
        ...boundary.flatMap((equation) =>
          [
            equation.fromCaptureId,
            equation.toCaptureId,
            ...(equation.boundaryChecks ?? []).flatMap((check) => check.sourceCaptureIds),
          ].filter((id): id is string => !!id),
        ),
        ...analysis.knownRaces.flatMap(
          (known) => mogi.races.find((race) => race.id === known.raceId)?.captureIds ?? [],
        ),
      ]),
    ];
    analysis.sourceSignature = await digest(
      JSON.stringify([
        targets.map((race) => [race.id, race.number, race.participationReview]),
        result.active,
        boundary,
        analysis.knownRaces,
      ]),
    );
    analysis.inputSignature = await boundaryInputSignature(mogi, targets, facts);
    analysis.orderVerified = true;
    if (
      facts.some((fact) => {
        const index = targets.findIndex((race) => race.id === fact.raceId);
        return index >= 0 && !result.active[index].includes(fact.participantId);
      })
    ) {
      analysis.status = "conflict";
      analysis.complete = true;
      analysis.message = "A known position belongs to another player. Correct or remove it.";
      return result;
    }
    result.ready =
      targets.length > 0 &&
      targets.every((race) => !race.participationReview) &&
      new Set(boundary.map((equation) => equation.participantId)).size >= MIN_STABLE_PLAYERS;
    analysis.status = result.ready ? "incomplete" : "insufficient";
    return result;
  }
  if (!targets.length || targets.some((r) => r.participationReview) || !mogi.orderReview) return result;
  const current = mogi.orderReview.inputSignature === orderingInputSignature(mogi);
  analysis.orderVerified =
    current ||
    !!(mogi.assistance?.analysis?.orderVerified && mogi.assistance.analysis.sourceSignature === sourceSignature);
  if (!analysis.orderVerified) return result;
  const sources = mogi.races
    .filter(
      (r) =>
        r.origin !== "reconstructed" &&
        r.status !== "pending" &&
        !r.participationReview &&
        r.gameEvidence?.verified &&
        r.gameEvidence.stage === "post-race" &&
        r.placements.length >= MIN_ROOM_PLAYERS,
    )
    .sort((a, b) => racePhysicalNumber(mogi, a) - racePhysicalNumber(mogi, b));
  if (
    !sources.some((r) => racePhysicalNumber(mogi, r) < racePhysicalNumber(mogi, targets[0])) ||
    !sources.some((r) => racePhysicalNumber(mogi, r) > racePhysicalNumber(mogi, targets.at(-1)!))
  )
    return result;
  const targetIds = new Set(targets.map((r) => r.id));
  const factConflict = knownPositionConflict(mogi, facts, targetIds);
  if (factConflict) {
    analysis.status = "conflict";
    analysis.complete = true;
    analysis.message = factConflict;
    return result;
  }
  if (sourceContradictsPlacement(sources)) {
    analysis.status = "conflict";
    analysis.message = "A screenshot's in-game points or totals contradict its placement. Review the evidence.";
    analysis.complete = true;
    return result;
  }
  const sourceCaptureIds = new Set<string>();
  for (let i = 0; i < sources.length; i++)
    for (let j = i + 1; j < sources.length; j++) {
      analysis.stats.nodes++;
      if (
        cancelled() ||
        performance.now() - started > ASSISTED_SEARCH_MAX_MS ||
        analysis.equations.length >= MAX_EQUATIONS
      ) {
        analysis.status = "incomplete";
        analysis.stats.cancelled = cancelled();
        analysis.message = analysis.stats.cancelled
          ? "Analysis canceled; a partial preparation doesn't prove a unique result."
          : "Search incomplete: work limit reached while preparing the evidence.";
        return result;
      }
      if (analysis.stats.nodes % PREPARATION_YIELD_NODES === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      const older = sources[i],
        newer = sources[j],
        a = older.gameEvidence!,
        b = newer.gameEvidence!;
      if (a.session !== b.session) continue;
      const indices = targets.flatMap((r, n) =>
        racePhysicalNumber(mogi, r) > racePhysicalNumber(mogi, older) &&
        racePhysicalNumber(mogi, r) < racePhysicalNumber(mogi, newer)
          ? [n]
          : [],
      );
      if (!indices.length) continue;
      const interval = mogi.races.filter(
        (r) =>
          racePhysicalNumber(mogi, r) > racePhysicalNumber(mogi, older) &&
          racePhysicalNumber(mogi, r) < racePhysicalNumber(mogi, newer),
      );
      if (interval.length !== racePhysicalNumber(mogi, newer) - racePhysicalNumber(mogi, older) - 1) continue;
      const known = interval.filter((r) => !targetIds.has(r.id));
      if (
        known.some(
          (r) =>
            !r.placements.length || r.status === "pending" || r.origin === "reconstructed" || r.participationReview,
        )
      )
        continue;
      for (const r of known)
        if (!analysis.knownRaces.some((v) => v.raceId === r.id)) analysis.knownRaces.push(knownRaceRecord(mogi, r));
      for (const race of known)
        if (
          race.placements.some(
            (id, n) =>
              race.nativePoints?.[id] !== undefined &&
              race.nativePoints[id] !== nativePlacementPoints(race.placements.length)[n],
          )
        ) {
          analysis.status = "conflict";
          analysis.message = "A known native result contradicts the room's scale.";
          analysis.complete = true;
          return result;
        }
      for (const id of older.placements) {
        const left = a.readings[id],
          right = b.readings[id];
        if (
          !newer.placements.includes(id) ||
          !left?.useAsAnchor ||
          !right?.useAsAnchor ||
          left.segment !== right.segment ||
          !left.cumulative ||
          !right.cumulative ||
          !right.current ||
          indices.some((n) => !result.active[n].includes(id))
        )
          continue;
        let subtotal = 0,
          compatible = true;
        for (const r of known) {
          const reading = r.gameEvidence?.readings[id];
          if (
            (r.gameEvidence && r.gameEvidence.session !== a.session) ||
            (reading && reading.segment !== left.segment)
          ) {
            compatible = false;
            break;
          }
          const rank = r.placements.indexOf(id);
          if (rank >= 0) subtotal += r.nativePoints?.[id] ?? nativePlacementPoints(r.placements.length)[rank];
          else if (!r.absentParticipantIds?.includes(id)) {
            compatible = false;
            break;
          }
        }
        if (!compatible) continue;
        const gain = right.cumulative.value - left.cumulative.value - right.current.value - subtotal;
        if (analysis.equations.length >= MAX_EQUATIONS) {
          analysis.status = "incomplete";
          analysis.message = "Search incomplete: work limit reached on the equations.";
          return result;
        }
        analysis.equations.push({
          participantId: id,
          targetIndices: indices,
          gain,
          known: subtotal,
          fromRaceId: older.id,
          toRaceId: newer.id,
          fromNumber: raceNumber(mogi, older),
          toNumber: raceNumber(mogi, newer),
          older: left.cumulative,
          newer: right.cumulative,
          current: right.current,
          session: a.session,
          segment: left.segment,
        });
        for (const value of [left.cumulative, right.cumulative, right.current])
          if (value.sourceCaptureId) sourceCaptureIds.add(value.sourceCaptureId);
        for (const race of [older, newer, ...known])
          for (const capture of race.captureIds ?? []) sourceCaptureIds.add(capture);
      }
    }
  analysis.sourceCaptureIds = [...sourceCaptureIds];
  if (new Set(analysis.equations.map((e) => e.participantId)).size < MIN_STABLE_PLAYERS) {
    analysis.message = "Not enough evidence: at least two players need steady totals. Check room reopenings.";
    return result;
  }
  result.ready = true;
  analysis.status = "incomplete";
  analysis.message = "Comparing hypotheses on this device.";
  return result;
}
/** A known position conflicts when its player wasn't in the race or it contradicts a recorded result outside the targets. */
export function knownPositionConflict(mogi: Mogi, facts: PositionFact[], targetIds: Set<string>): string | undefined {
  for (const fact of facts) {
    const race = mogi.races.find((r) => r.id === fact.raceId);
    if (!race || !participantsForOccurrence(mogi, race).some((p) => p.id === fact.participantId))
      return "A known position names a player who wasn't in that race. Correct or remove it.";
    if (
      !targetIds.has(race.id) &&
      race.placements.length &&
      (fact.position === "absent"
        ? !race.absentParticipantIds?.includes(fact.participantId)
        : race.placements.indexOf(fact.participantId) !== fact.position - 1)
    )
      return "A known position contradicts a recorded result. No hypothesis was confirmed.";
  }
}

/** An anchor image contradicts itself when its race points or its total fall outside the native scale for its placement. */
export function sourceContradictsPlacement(sources: Race[]): boolean {
  return sources.some((source) => {
    const scale = nativePlacementPoints(source.placements.length);
    return Object.entries(source.gameEvidence!.readings).some(([id, reading]) => {
      if (!reading.useAsAnchor) return false;
      const rank = source.placements.indexOf(id);
      if (rank < 0) return false;
      return (
        (reading.current && reading.current.value !== scale[rank]) ||
        (reading.cumulative && reading.cumulative.value < scale[rank])
      );
    });
  });
}

/** A known race between the anchors, with its native points modeled from its scale unless entered. */
function knownRaceRecord(mogi: Mogi, r: Race): AssistanceAnalysis["knownRaces"][number] {
  return {
    raceId: r.id,
    number: r.status === "discarded" ? racePhysicalNumber(mogi, r) : raceNumber(mogi, r),
    represented: r.placements.length,
    discarded: r.status === "discarded",
    placements: r.placements,
    absentParticipantIds: r.absentParticipantIds ?? [],
    nativePoints: Object.fromEntries(
      r.placements.map((id, i) => [id, r.nativePoints?.[id] ?? nativePlacementPoints(r.placements.length)[i]]),
    ),
    nativePointOrigins: Object.fromEntries(r.placements.map((id) => [id, r.nativePointOrigins?.[id] ?? "modeled"])),
  };
}
export function hypothesisFits(p: AssistanceProblem, hypothesis: ReconstructionHypothesis): boolean {
  if (hypothesis.results.length !== p.targets.length) return false;
  for (let n = 0; n < p.targets.length; n++) {
    const r = hypothesis.results[n];
    if (
      r.raceId !== p.targets[n].id ||
      !ROOM_SIZES.includes(r.represented) ||
      r.placements.length !== r.represented ||
      r.absentParticipantIds.length !== 12 - r.represented
    )
      return false;
    const all = [...r.placements, ...r.absentParticipantIds];
    if (new Set(all).size !== 12 || all.some((id) => !p.active[n].includes(id))) return false;
  }
  if (
    p.facts.some((fact) => {
      const r = hypothesis.results.find((r) => r.raceId === fact.raceId);
      if (!r) return false;
      return fact.position === "absent"
        ? !r.absentParticipantIds.includes(fact.participantId)
        : r.placements.indexOf(fact.participantId) !== fact.position - 1;
    })
  )
    return false;
  return p.analysis.equations.every(
    (e) =>
      e.targetIndices.reduce((sum, n) => {
        const r = hypothesis.results[n],
          rank = r.placements.indexOf(e.participantId);
        return sum + (rank < 0 ? 0 : nativePlacementPoints(r.represented)[rank]);
      }, 0) === e.gain,
  );
}
