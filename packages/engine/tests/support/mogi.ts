import { type Mogi, orderingInputSignature, type Race } from "@mkw/engine";

export const scale12 = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const scales = { 10: [11, 9, 8, 7, 6, 5, 4, 3, 2, 1], 11: [12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 12: scale12 };
export const people = Array.from({ length: 12 }, (_, n) => ({
  id: `p${n + 1}`,
  loungeName: `Player ${n + 1}`,
  ign: `P${n + 1}`,
}));
export function source(
  id: string,
  number: number,
  totals: number[],
  represented: 10 | 11 | 12 = 12,
  anchors = 12,
): Race {
  return {
    id,
    number,
    origin: "manual",
    placements: people.slice(0, represented).map((p) => p.id),
    absentParticipantIds: people.slice(represented).map((p) => p.id),
    gameEvidence: {
      stage: "post-race",
      session: "room",
      verified: true,
      readings: Object.fromEntries(
        people.slice(0, anchors).map((p, n) => [
          p.id,
          {
            segment: "room",
            useAsAnchor: true,
            current: { value: scales[represented][n], origin: "manual" },
            cumulative: { value: totals[n], origin: "manual" },
          },
        ]),
      ),
    },
  };
}
export function reviewOrder(state: Mogi): Mogi {
  return {
    ...state,
    orderReview: {
      raceIds: state.races.map((r) => r.id),
      basis: "manual",
      acceptedAt: "2026-10-27",
      gaps: [],
      unresolvedRaceIds: [],
      inputSignature: orderingInputSignature(state),
    },
  };
}
export function mogi(races: Race[]): Mogi {
  return {
    id: "m",
    name: "Migrated literal scenarios",
    createdAt: "2026-10-27",
    format: "FFA",
    participants: people,
    races,
  };
}
export function inferenceFixture(
  anchors = 12,
  last = 3,
  totals = [31, 26, 23, 22, 21, 20, 19, 18, 17, 16, 16, 17],
): Mogi {
  const pending: Race[] = Array.from({ length: last - 2 }, (_, n) => ({
    id: `gap${n + 2}`,
    number: n + 2,
    origin: "manual",
    status: "pending",
    placements: [],
  }));
  return reviewOrder(
    mogi([source("older", 1, scale12, 12, anchors), ...pending, source("newer", last, totals, 12, anchors)]),
  );
}
