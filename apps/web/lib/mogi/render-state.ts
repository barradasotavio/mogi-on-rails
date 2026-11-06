import type { Mogi, TrackerState } from "./types.ts";

export interface TrackerRenderState {
  state: TrackerState;
  resultMogis: Mogi[];
}

function sameFields(previous: object | undefined, next: object): boolean {
  if (!previous) return false;
  const before = previous as Record<string, unknown>,
    after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  return (
    Object.keys(before).length === keys.length &&
    keys.every((key) => Object.hasOwn(before, key) && before[key] === after[key])
  );
}

/** Publish rule inputs separately from track labels; the Compiler owns their derived projections. */
export function trackerRenderState(state: TrackerState, previous?: TrackerRenderState): TrackerRenderState {
  const prior = new Map(
    previous?.state.mogis.map((mogi, i) => [mogi.id, { source: mogi, result: previous.resultMogis[i] }]),
  );
  const resultMogis = state.mogis.map((mogi) => {
    const before = prior.get(mogi.id);
    if (before?.source === mogi) return before.result;
    const races = mogi.races.map((race, i) => {
      const result = { ...race };
      delete result.track;
      const old = before?.result.races[i];
      return sameFields(old, result) ? old! : result;
    });
    const result = {
      ...mogi,
      races:
        before &&
        before.result.races.length === races.length &&
        races.every((race, i) => race === before.result.races[i])
          ? before.result.races
          : races,
    };
    return sameFields(before?.result, result) ? before!.result : result;
  });
  return {
    state,
    resultMogis:
      previous &&
      previous.resultMogis.length === resultMogis.length &&
      resultMogis.every((mogi, i) => mogi === previous.resultMogis[i])
        ? previous.resultMogis
        : resultMogis,
  };
}
