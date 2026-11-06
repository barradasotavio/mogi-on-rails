import { recognizedParticipant } from "../names/name-recognition.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import { countedRaces, racePhysicalNumber } from "../scoring/scoring.ts";
import type { AssistanceAnalysis, Mogi, PositionFact, Race, ReconstructionHypothesis } from "../types.ts";
import { assistanceProblem, ASSISTED_SEARCH_MAX_MS, hypothesisFits } from "./assistance-problem.ts";
import { assistanceState } from "./known-positions.ts";
import { orderingInputSignature } from "./ordering.ts";
import { compactEquations } from "./reconstruction-storage.ts";

// Search budget in visited nodes; past it the analysis is incomplete, never unique.
const SEARCH_MAX_NODES = 200000;
// Budget of per-player position tuples kept across room contexts.
const SEARCH_MAX_TUPLES = 30000;
// Budget of room-size contexts (12/11/10 per target race) explored.
const SEARCH_MAX_CONTEXTS = 2000;
// Yield to the event loop every this many nodes, or after this many milliseconds, so the search stays cancellable.
const SEARCH_YIELD_NODES = 128;
const SEARCH_YIELD_MS = 12;
// Up to four example hypotheses are kept; they feed the position question and prove ambiguity.
const MAX_EXAMPLE_HYPOTHESES = 4;
// Room sizes tried for each target race, in order: each has a supported native scale.
const ROOM_SIZES = [12, 11, 10] as const;
// A Lounge mogi counts twelve races.
const MAX_COUNTED_RACES = 12;
// Analysis history keeps the last ten conclusions for review.
const ANALYSIS_HISTORY_LIMIT = 10;

/** A race's own image needs its players identified before alternative placements are searched. */
export function pendingCaptureRead(mogi: Mogi, race: Race): boolean {
  return !!mogi.captures?.some(
    (c) =>
      (c.context?.raceId === race.id ||
        race.captureIds?.includes(c.id) ||
        mogi.sequence?.occurrences.some((o) => o.raceId === race.id && o.captureIds.includes(c.id))) &&
      c.rows.some(
        (row, i) =>
          !(
            c.nameAssociations?.[i]?.participantId ??
            (!c.nameAssociations?.[i]?.unlinked ? recognizedParticipant(mogi, row) : undefined)
          ),
      ),
  );
}
export function assistanceTargets(mogi: Mogi): Race[] {
  return mogi.races
    .filter(
      (r) =>
        !pendingCaptureRead(mogi, r) &&
        ((r.status === "pending" && !r.placements.length && !r.participationReview) ||
          (!!mogi.assistance && r.assistedGroupId === mogi.assistance.id && !r.participationReview)),
    )
    .sort((a, b) => racePhysicalNumber(mogi, a) - racePhysicalNumber(mogi, b));
}
function hypothesisKey(hypothesis: ReconstructionHypothesis): string {
  return JSON.stringify(hypothesis.results.map((r) => [r.raceId, r.placements, [...r.absentParticipantIds].sort()]));
}
export async function solveAssistance(
  mogi: Mogi,
  targets: Race[],
  facts: PositionFact[],
  cancelled: () => boolean = () => false,
): Promise<AssistanceAnalysis> {
  const start = performance.now(),
    p = await assistanceProblem(mogi, targets, facts, cancelled, start),
    a = p.analysis;
  a.stats.elapsedMs = Math.round(performance.now() - start);
  if (!p.ready) return a;
  let lastYield = performance.now(),
    stopped = false,
    capped = false;
  const seen = new Set<string>();
  async function tick(): Promise<boolean> {
    a.stats.nodes++;
    if (cancelled()) {
      a.stats.cancelled = true;
      stopped = true;
      return false;
    }
    if (
      a.stats.nodes > SEARCH_MAX_NODES ||
      performance.now() - start > ASSISTED_SEARCH_MAX_MS ||
      a.stats.tuples > SEARCH_MAX_TUPLES ||
      a.stats.contexts > SEARCH_MAX_CONTEXTS
    ) {
      stopped = true;
      return false;
    }
    if (a.stats.nodes % SEARCH_YIELD_NODES === 0 || performance.now() - lastYield > SEARCH_YIELD_MS) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
    return true;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  const people = [...new Set(p.active.flat())];
  async function context(counts: number[]): Promise<void> {
    if (stopped || capped || !(await tick())) return;
    if (counts.length < targets.length) {
      for (const n of ROOM_SIZES) {
        await context([...counts, n]);
        if (stopped || capped) break;
      }
      return;
    }
    a.stats.contexts++;
    // Complete common-identity sums can prune room contexts; partial anchors cannot.
    if (p.active.every((ids) => JSON.stringify(ids) === JSON.stringify(p.active[0]))) {
      const full = people.map((id) =>
        a.equations.find((e) => e.participantId === id && e.targetIndices.length === targets.length),
      );
      if (
        full.every((e) => !!e) &&
        full.reduce((sum, e) => sum + e!.gain, 0) !==
          counts.reduce((sum, n) => sum + nativePlacementPoints(n).reduce((s, v) => s + v, 0), 0)
      )
        return;
    }
    const entries: { id: string; tuples: number[][] }[] = [];
    for (const id of people) {
      const equations = a.equations.filter((e) => e.participantId === id);
      const domains = targets.map((target, n) =>
        (!p.active[n].includes(id)
          ? [-2]
          : [...Array.from({ length: counts[n] }, (_, i) => i), ...(counts[n] < 12 ? [-1] : [])]
        ).filter((rank) =>
          facts
            .filter((f) => f.raceId === target.id && f.participantId === id)
            .every((f) => rank === (f.position === "absent" ? -1 : f.position - 1)),
        ),
      );
      const tuples: number[][] = [];
      const reward = (n: number, rank: number) => (rank < 0 ? 0 : nativePlacementPoints(counts[n])[rank]);
      async function generate(prefix: number[]): Promise<void> {
        if (!(await tick())) return;
        for (const e of equations) {
          const sum = e.targetIndices.filter((n) => n < prefix.length).reduce((s, n) => s + reward(n, prefix[n]), 0);
          const remaining = e.targetIndices.filter((n) => n >= prefix.length);
          const min = remaining.reduce((s, n) => s + Math.min(...domains[n].map((rank) => reward(n, rank))), 0);
          const max = remaining.reduce((s, n) => s + Math.max(...domains[n].map((rank) => reward(n, rank))), 0);
          if (sum + min > e.gain || sum + max < e.gain) return;
        }
        if (prefix.length === targets.length) {
          tuples.push(prefix);
          a.stats.tuples++;
          return;
        }
        for (const rank of domains[prefix.length]) {
          await generate([...prefix, rank]);
          if (stopped) break;
        }
      }
      await generate([]);
      if (stopped || !tuples.length) return;
      entries.push({ id, tuples });
    }
    function fits(tuple: number[], used: number[], absent: number[]): boolean {
      return tuple.every(
        (rank, n) => rank === -2 || (rank === -1 ? absent[n] < 12 - counts[n] : !(used[n] & (1 << rank))),
      );
    }
    async function assign(
      remaining: typeof entries,
      assigned: Record<string, number[]>,
      used: number[],
      absent: number[],
    ): Promise<void> {
      if (stopped || capped || !(await tick())) return;
      if (!remaining.length) {
        if (absent.some((n, i) => n !== 12 - counts[i])) return;
        const hypothesis: ReconstructionHypothesis = {
          results: targets.map((target, n) => {
            const placements = Array<string>(counts[n]);
            for (const [id, tuple] of Object.entries(assigned)) if (tuple[n] >= 0) placements[tuple[n]] = id;
            return {
              raceId: target.id,
              placements,
              absentParticipantIds: p.active[n].filter((id) => assigned[id][n] === -1).sort(),
              represented: counts[n],
            };
          }),
        };
        if (hypothesisFits(p, hypothesis) && !seen.has(hypothesisKey(hypothesis))) {
          seen.add(hypothesisKey(hypothesis));
          a.hypotheses.push(hypothesis);
          if (a.hypotheses.length >= MAX_EXAMPLE_HYPOTHESES) capped = true;
        }
        return;
      }
      const viable = remaining
        .map((entry) => ({
          ...entry,
          tuples: entry.tuples.filter((tuple) => fits(tuple, used, absent)),
        }))
        .sort((x, y) => x.tuples.length - y.tuples.length);
      if (viable.some((e) => !e.tuples.length)) return;
      for (let n = 0; n < targets.length; n++) {
        let union = used[n];
        for (const e of viable) for (const tuple of e.tuples) if (tuple[n] >= 0) union |= 1 << tuple[n];
        if (union !== (1 << counts[n]) - 1) return;
      }
      const entry = viable[0];
      for (const tuple of entry.tuples) {
        await assign(
          viable.slice(1),
          { ...assigned, [entry.id]: tuple },
          used.map((mask, n) => (tuple[n] >= 0 ? mask | (1 << tuple[n]) : mask)),
          absent.map((v, n) => v + (tuple[n] === -1 ? 1 : 0)),
        );
        if (stopped || capped) break;
      }
    }
    await assign(
      entries,
      {},
      counts.map(() => 0),
      counts.map(() => 0),
    );
  }
  await context([]);
  a.stats.elapsedMs = Math.round(performance.now() - start);
  a.complete = !stopped && !capped;
  a.status =
    a.hypotheses.length >= 2
      ? "ambiguous"
      : !a.complete
        ? "incomplete"
        : a.hypotheses.length === 1
          ? "unique"
          : "conflict";
  a.message =
    a.complete && a.hypotheses.length === 0
      ? "No hypothesis fits the known positions and readings. Check the positions and the gains below."
      : a.complete
        ? `${a.hypotheses.length} ${a.hypotheses.length === 1 ? "hypothesis fits" : "hypotheses fit"}; search complete`
        : a.stats.cancelled
          ? "Analysis canceled; partial examples don't prove a unique result."
          : "Search incomplete: work limit reached; the examples aren't every solution.";
  return a;
}
/**
 * A race names an assisted group only while it is one of that group's reconstructed targets. A result screen that
 * replaced the reconstruction keeps its result; a race the group no longer lists goes back to pending without the
 * group's result, so the next normalization solves it again.
 */
export function settleAssistedRaces<T extends Mogi>(mogi: T): T {
  const group = mogi.assistance;
  let changed = false;
  const races = mogi.races.map((r) => {
    if (r.assistedGroupId === undefined) return r;
    if (r.origin === "reconstructed" && r.assistedGroupId === group?.id && group.targetRaceIds.includes(r.id)) return r;
    changed = true;
    if (r.origin !== "reconstructed" || r.reconstruction) return { ...r, assistedGroupId: undefined };
    return {
      ...r,
      assistedGroupId: undefined,
      origin: "observed" as const,
      status: r.status === "discarded" ? ("discarded" as const) : ("pending" as const),
      placements: [],
      absentParticipantIds: [],
      nativePoints: undefined,
      nativePointOrigins: undefined,
    };
  });
  return changed ? { ...mogi, races } : mogi;
}
export function setAssistanceAnalysis<T extends Mogi>(
  mogi: T,
  analysis: AssistanceAnalysis,
  facts: PositionFact[] = mogi.assistance?.facts ?? [],
): T {
  const previous = assistanceState(mogi);
  const next = settleAssistedRaces({
    ...mogi,
    assistance: {
      ...previous,
      targetRaceIds: analysis.targetRaceIds,
      facts,
      analysis,
      confirmed: undefined,
      history: previous.analysis
        ? [...previous.history, { analysis: previous.analysis, confirmed: previous.confirmed }].slice(
            -ANALYSIS_HISTORY_LIMIT,
          )
        : previous.history,
    },
    races: mogi.races.map((r) =>
      r.assistedGroupId === previous.id
        ? {
            ...r,
            status: r.status === "discarded" ? ("discarded" as const) : ("pending" as const),
            placements: [],
            absentParticipantIds: [],
          }
        : r,
    ),
  });
  return analysis.status === "unique" && analysis.complete
    ? confirmAssistance(next, analysis.hypotheses[0], "unique")
    : next;
}
export function confirmAssistance<T extends Mogi>(
  mogi: T,
  hypothesis: ReconstructionHypothesis,
  kind: "user" | "unique" = "user",
): T {
  const group = mogi.assistance;
  if (!group?.analysis || group.analysis.status !== "unique" || !group.analysis.complete || kind !== "unique")
    return mogi;
  const capacity =
    countedRaces(mogi).filter((r) => !group.targetRaceIds.includes(r.id)).length +
    hypothesis.results.filter((r) => mogi.races.find((race) => race.id === r.raceId)?.status !== "discarded").length;
  if (capacity > MAX_COUNTED_RACES)
    return {
      ...mogi,
      assistance: {
        ...group,
        analysis: {
          ...group.analysis,
          message: "More than 12 races would count. Discard a race before confirming.",
        },
      },
    };
  const next: T = {
    ...mogi,
    assistance: {
      ...group,
      confirmed: {
        at: new Date().toISOString(),
        kind,
        inputSignature: group.analysis.inputSignature,
        hypothesis,
      },
    },
    races: mogi.races.map((r) => {
      const result = hypothesis.results.find((x) => x.raceId === r.id);
      return result
        ? {
            ...r,
            reconstruction: undefined,
            reconstructionHistory: r.reconstruction
              ? [...(r.reconstructionHistory ?? []), r.reconstruction]
              : r.reconstructionHistory,
            origin: "reconstructed",
            assistedGroupId: group.id,
            status: r.status === "discarded" ? "discarded" : "confirmed",
            placements: result.placements,
            absentParticipantIds: result.absentParticipantIds,
          }
        : r;
    }),
  };
  if (next.orderReview)
    next.orderReview = {
      ...next.orderReview,
      inputSignature: orderingInputSignature(next),
    };
  return next;
}
export async function normalizeAssistance<T extends Mogi>(mogi: T, revalidateBoundaryProofs = false): Promise<T> {
  const group = mogi.assistance;
  if (!group?.analysis || (!group.confirmed && group.analysis.status === "stale")) return mogi;
  const targets = group.targetRaceIds.flatMap((id) => {
    const r = mogi.races.find((r) => r.id === id);
    return r ? [r] : [];
  });
  const facts = group.analysis.equations.some((equation) => equation.boundary)
    ? group.facts.filter((fact) => group.targetRaceIds.includes(fact.raceId))
    : group.facts;
  const p = await assistanceProblem(mogi, targets, facts);
  if (
    !group.confirmed &&
    group.analysis.inputSignature === p.analysis.inputSignature &&
    JSON.stringify(group.analysis.facts) === JSON.stringify(facts)
  )
    return mogi;

  const matching =
    JSON.stringify(group.analysis.knownRaces) === JSON.stringify(p.analysis.knownRaces) &&
    JSON.stringify(compactEquations(group.analysis.equations)) ===
      JSON.stringify(compactEquations(p.analysis.equations)) &&
    JSON.stringify(group.analysis.sourceCaptureIds) === JSON.stringify(p.analysis.sourceCaptureIds) &&
    !!group.confirmed &&
    JSON.stringify(group.analysis.facts) === JSON.stringify(facts) &&
    group.confirmed.inputSignature === p.analysis.inputSignature &&
    p.analysis.orderVerified &&
    p.ready &&
    p.analysis.status === "incomplete" &&
    hypothesisFits(p, group.confirmed.hypothesis) &&
    group.confirmed.hypothesis.results.every((result) => {
      const r = targets.find((r) => r.id === result.raceId);
      return (
        r?.assistedGroupId === group.id &&
        JSON.stringify(r.placements) === JSON.stringify(result.placements) &&
        JSON.stringify([...(r.absentParticipantIds ?? [])].sort()) === JSON.stringify(result.absentParticipantIds)
      );
    });
  if (matching) {
    const boundary = group.analysis.equations.some((equation) => equation.boundary);
    const needsVerification = boundary && revalidateBoundaryProofs;
    if (
      !needsVerification &&
      (group.confirmed?.kind === "user" || (group.analysis.status === "unique" && group.analysis.complete))
    )
      return mogi;
    if (needsVerification) {
      const checked = await solveAssistance(mogi, targets, facts);
      if (
        checked.status === "unique" &&
        checked.complete &&
        JSON.stringify(checked.hypotheses[0]) === JSON.stringify(group.confirmed?.hypothesis)
      )
        return mogi;
    }
  }
  return {
    ...mogi,
    assistance: {
      ...group,
      confirmed: undefined,
      history: [...group.history, { analysis: group.analysis, confirmed: group.confirmed }].slice(
        -ANALYSIS_HISTORY_LIMIT,
      ),
      analysis: {
        ...group.analysis,
        status: "stale",
        message:
          "The evidence or known positions changed, so the previous hypothesis is out of the totals. Analyze again.",
      },
    },
    races: mogi.races.map((r) =>
      r.assistedGroupId === group.id
        ? {
            ...r,
            status: r.status === "discarded" ? "discarded" : "pending",
            placements: [],
            absentParticipantIds: [],
            nativePoints: undefined,
            nativePointOrigins: undefined,
          }
        : r,
    ),
  };
}
