import { nativePlacementPoints } from "../scoring/native-points.ts";
import type { PositionFact, Reconstruction } from "../types.ts";

// Work budget of the exact search; past it the analysis is incomplete, never unique.
const EXACT_SEARCH_MAX_NODES = 30000;
// Time budget of the exact search, short enough to keep a phone responsive.
const EXACT_SEARCH_MAX_MS = 500;
// Yield to the event loop every this many nodes so the search stays cancellable.
const EXACT_SEARCH_YIELD_NODES = 256;
// Two solutions already prove ambiguity, so the search stops there.
export const AMBIGUOUS_SOLUTIONS = 2;
// Room sizes the exact search tries, in order: each has a supported native scale.
const ROOM_SIZES = [12, 11, 10] as const;

type ExactSolution = { placements: string[]; absent: string[]; represented: number };

/** Native gains and known positions determine each participant's possible placements or absence. */
export function nativePlacementDomains(
  active: { id: string }[],
  anchors: Pick<Reconstruction["anchors"][number], "participantId" | "gain">[],
  facts: PositionFact[],
  targetId: string,
  represented: number,
) {
  const scale = nativePlacementPoints(represented);
  return active
    .map((p) => {
      const gain = anchors.find((v) => v.participantId === p.id)?.gain;
      return {
        id: p.id,
        ranks: [...scale.map((_, i) => i), ...(represented < 12 ? [-1] : [])].filter(
          (rank) =>
            (gain === undefined || gain === (rank < 0 ? 0 : scale[rank])) &&
            facts
              .filter((f) => f.raceId === targetId && f.participantId === p.id)
              .every((f) => (f.position === "absent" ? rank < 0 : rank === f.position - 1)),
        ),
      };
    })
    .sort((x, y) => x.ranks.length - y.ranks.length);
}

/** Exact search: every placement of the active players that matches each anchor's gain and the known positions, trying rooms of 12, 11 and 10. */
export async function exactPlacementSearch(
  active: { id: string }[],
  anchors: Pick<Reconstruction["anchors"][number], "participantId" | "gain">[],
  facts: PositionFact[],
  targetId: string,
): Promise<{ solutions: ExactSolution[]; incomplete: boolean }> {
  const solutions: ExactSolution[] = [];
  let nodes = 0,
    incomplete = false;
  const started = performance.now();
  for (const represented of ROOM_SIZES) {
    const domains = nativePlacementDomains(active, anchors, facts, targetId, represented);
    async function visit(index: number, ranks: Record<string, number>, used: number, absences: number): Promise<void> {
      if (solutions.length >= AMBIGUOUS_SOLUTIONS || incomplete) return;
      if (++nodes > EXACT_SEARCH_MAX_NODES || performance.now() - started > EXACT_SEARCH_MAX_MS) {
        incomplete = true;
        return;
      }
      if (nodes % EXACT_SEARCH_YIELD_NODES === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      if (index === domains.length) {
        if (absences !== 12 - represented) return;
        const placements = Array<string>(represented);
        for (const [id, rank] of Object.entries(ranks)) if (rank >= 0) placements[rank] = id;
        solutions.push({
          placements,
          absent: active
            .filter((p) => ranks[p.id] < 0)
            .map((p) => p.id)
            .sort(),
          represented,
        });
        return;
      }
      for (const rank of domains[index].ranks) {
        if (rank < 0 ? absences >= 12 - represented : used & (1 << rank)) continue;
        await visit(
          index + 1,
          { ...ranks, [domains[index].id]: rank },
          rank < 0 ? used : used | (1 << rank),
          absences + (rank < 0 ? 1 : 0),
        );
      }
    }
    await visit(0, {}, 0, 0);
    if (solutions.length >= AMBIGUOUS_SOLUTIONS || incomplete) break;
  }
  return { solutions, incomplete };
}
