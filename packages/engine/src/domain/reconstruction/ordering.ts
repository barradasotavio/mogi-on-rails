import { participantsForOccurrence } from "../participation/participation.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import { raceNumber } from "../scoring/scoring.ts";
import type { Mogi, OrderAnchor, OrderGap, Race } from "../types.ts";

// The order search enumerates permutations; past this many visited prefixes it stops and reports "incomplete"
// instead of guessing, because only a complete and unique search may support reconstruction.
const ORDER_SEARCH_MAX_NODES = 10000;
// The search also stops after this many milliseconds so a large batch never stalls the app.
const ORDER_SEARCH_MAX_MS = 1500;
// Yield to the event loop every so many race pairs or search nodes to keep the interface responsive.
const PAIRS_PER_YIELD = 64;
const NODES_PER_YIELD = 128;

export interface OrderTransition {
  fromRaceId: string;
  toRaceId: string;
  status: "compatible" | "conflict" | "insufficient";
  anchors: OrderAnchor[];
  details: string[];
}
export interface OrderAnalysis {
  status: "unique" | "ambiguous" | "conflict" | "insufficient" | "incomplete";
  inputSignature: string;
  orders: string[][];
  raceIds: string[];
  unresolvedRaceIds: string[];
  transitions: OrderTransition[];
  issues: string[];
}
export function orderingInputSignature(mogi: Mogi): string {
  return JSON.stringify([
    mogi.substitutions ?? [],
    mogi.races.map((r) => [
      r.id,
      r.number,
      r.physicalNumber,
      r.status,
      r.placements,
      r.absentParticipantIds,
      r.participationReview,
      r.gameEvidence,
    ]),
  ]);
}
function transition(mogi: Mogi, from: Race, to: Race): OrderTransition {
  const a = from.gameEvidence!,
    b = to.gameEvidence!;
  const anchors: OrderAnchor[] = [];
  const details: string[] = [];
  let stable = 0;
  if (a.session === b.session)
    for (const id of from.placements) {
      const older = a.readings[id],
        newer = b.readings[id];
      if (
        !to.placements.includes(id) ||
        !older?.useAsAnchor ||
        !newer?.useAsAnchor ||
        older.segment !== newer.segment ||
        !older.cumulative ||
        !newer.cumulative
      )
        continue;
      stable++;
      const delta = newer.cumulative.value - older.cumulative.value;
      if (newer.current) {
        const intermediateGain = delta - newer.current.value;
        anchors.push({
          participantId: id,
          olderTotal: older.cumulative.value,
          newerTotal: newer.cumulative.value,
          current: newer.current.value,
          intermediateGain,
        });
        if (intermediateGain < 0)
          details.push(
            `${mogi.participants.find((p) => p.id === id)?.loungeName ?? id}: ${newer.cumulative.value} − ${older.cumulative.value} − ${newer.current.value} = ${intermediateGain}. Check the order, the reading or a restart.`,
          );
      } else if (delta < 1)
        details.push(
          `${mogi.participants.find((p) => p.id === id)?.loungeName ?? id}: total does not grow although they were in the race. Check the numeric stretch.`,
        );
    }
  return {
    fromRaceId: from.id,
    toRaceId: to.id,
    anchors,
    details,
    status:
      stable < 2 ? "insufficient" : details.length ? "conflict" : anchors.length >= 2 ? "compatible" : "insufficient",
  };
}
export function orderGaps(order: string[], transitions: OrderTransition[]): OrderGap[] {
  return order.slice(1).flatMap((toRaceId, n) => {
    const fromRaceId = order[n];
    const pair = transitions.find((p) => p.fromRaceId === fromRaceId && p.toRaceId === toRaceId);
    return pair?.status === "compatible" && pair.anchors.some((a) => a.intermediateGain > 0)
      ? [{ fromRaceId, toRaceId, anchors: pair.anchors }]
      : [];
  });
}
export async function analyzeOrder(mogi: Mogi, cancelled: () => boolean = () => false): Promise<OrderAnalysis> {
  const inputSignature = orderingInputSignature(mogi);
  const races = mogi.races.filter(
    (r) =>
      r.placements.length >= 10 &&
      r.status !== "pending" &&
      !r.participationReview &&
      r.gameEvidence?.verified &&
      r.gameEvidence.stage === "post-race",
  );
  const result: OrderAnalysis = {
    status: "insufficient",
    inputSignature,
    orders: [],
    raceIds: races.map((r) => r.id),
    unresolvedRaceIds: mogi.races.filter((r) => !races.includes(r)).map((r) => r.id),
    transitions: [],
    issues: [],
  };
  for (const race of races) {
    const active = new Set(participantsForOccurrence(mogi, race).map((p) => p.id));
    const scale = nativePlacementPoints(race.placements.length);
    for (const [id, reading] of Object.entries(race.gameEvidence!.readings)) {
      if (!reading.useAsAnchor || !reading.current || !reading.cumulative) continue;
      if (reading.cumulative.value < reading.current.value)
        result.issues.push(
          `Race ${raceNumber(mogi, race)}: final total is lower than this race's points. Check the addition step.`,
        );
      for (const value of [reading.current, reading.cumulative])
        if (
          value.origin === "observed" &&
          value.sourceCaptureId &&
          value.sourceRow &&
          race.gameEvidence!.rowAssociations?.[value.sourceCaptureId] &&
          race.gameEvidence!.rowAssociations[value.sourceCaptureId][value.sourceRow - 1] !== id
        )
          result.issues.push(
            `Race ${raceNumber(mogi, race)}: the links of its game totals changed. Review the values per person before ordering.`,
          );
      const position = race.placements.indexOf(id);
      if (!active.has(id) || position < 0) {
        result.issues.push(`Race ${raceNumber(mogi, race)}: reading for someone who was not in this race.`);
        continue;
      }
      if (reading.current.value !== scale[position])
        result.issues.push(
          `Race ${raceNumber(mogi, race)} · ${mogi.participants.find((p) => p.id === id)?.loungeName}: in-game points ${reading.current.value} differ from the usual in-game scale ${scale[position]} for ${race.placements.length} players. Review the reading; Lounge points are not in-game points.`,
        );
    }
  }
  if (result.issues.length) return { ...result, status: "conflict" };
  if (races.length < 2) {
    result.issues.push("At least two races with checked final totals and two stable anchors are needed.");
    return result;
  }
  const incoming = new Map(races.map((r) => [r.id, new Set<string>()]));
  let pairs = 0,
    constrained = 0;
  for (let i = 0; i < races.length; i++)
    for (let j = i + 1; j < races.length; j++) {
      if (cancelled()) return { ...result, status: "incomplete" };
      const a = transition(mogi, races[i], races[j]),
        b = transition(mogi, races[j], races[i]);
      result.transitions.push(a, b);
      if (a.status === "compatible" && b.status === "conflict") {
        incoming.get(races[j].id)!.add(races[i].id);
        constrained++;
      } else if (b.status === "compatible" && a.status === "conflict") {
        incoming.get(races[i].id)!.add(races[j].id);
        constrained++;
      } else if (a.status === "conflict" && b.status === "conflict")
        result.issues.push(
          `Races ${raceNumber(mogi, races[i])} and ${raceNumber(mogi, races[j])}: readings incompatible in both directions. ${a.details.join(" ")} ${b.details.join(" ")}`,
        );
      if (++pairs % PAIRS_PER_YIELD === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  if (result.issues.length) return { ...result, status: "conflict" };
  if (!constrained) {
    result.issues.push(
      "No two compatible anchors to set a direction. Check sessions, stretches, identities and numbers; one person alone does not set the sequence.",
    );
    return result;
  }
  let nodes = 0,
    exhausted = true;
  const started = performance.now();
  async function visit(prefix: string[], remaining: string[]): Promise<void> {
    if (result.orders.length >= 2 || !exhausted) return;
    if (++nodes > ORDER_SEARCH_MAX_NODES || performance.now() - started > ORDER_SEARCH_MAX_MS || cancelled()) {
      exhausted = false;
      return;
    }
    if (nodes % NODES_PER_YIELD === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    if (!remaining.length) {
      result.orders.push(prefix);
      return;
    }
    const choices = remaining.filter((id) => [...incoming.get(id)!].every((prior) => prefix.includes(prior)));
    for (const id of choices)
      await visit(
        [...prefix, id],
        remaining.filter((other) => other !== id),
      );
  }
  await visit(
    [],
    races.map((r) => r.id),
  );
  return {
    ...result,
    status:
      result.orders.length >= 2
        ? "ambiguous"
        : !exhausted
          ? "incomplete"
          : result.orders.length === 1
            ? "unique"
            : "conflict",
  };
}
