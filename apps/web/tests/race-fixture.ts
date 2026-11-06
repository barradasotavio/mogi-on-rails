import { participantsForRace } from "@mkw/engine";

import type { TrackerState } from "@/lib/mogi/types";

/** For `restoreState`: race 1 is an observed result whose source was removed. */
export function observedRace(state: TrackerState): TrackerState {
  const next = structuredClone({ ...state, mogis: [] }) as TrackerState;
  next.mogis = state.mogis.map((mogi, index) =>
    index
      ? mogi
      : {
          ...mogi,
          races: [
            {
              id: "observed-race-1",
              number: 1,
              origin: "observed",
              status: "confirmed",
              placements: participantsForRace(mogi, 1).map((person) => person.id),
            },
          ],
        },
  );
  return next;
}
