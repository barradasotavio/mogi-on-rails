import { nativePlacementPoints } from "../scoring/native-points.ts";

/** Existing native-vector criterion. A caller must establish identity and represented scope. */
export function compareBoundaryValues(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  represented: number | undefined,
  continuous12 = false,
): number | undefined {
  if (!a.size || a.size !== b.size || [...a.keys()].some((id) => !b.has(id))) return;
  const delta = [...a].map(([id, value]) => b.get(id)! - value);
  if (represented === undefined) return;
  if (delta.every((value) => value === 0)) return 0;
  const scale = nativePlacementPoints(represented),
    sorted = [...delta].sort((a, b) => b - a);
  if (sorted.every((value, index) => value === scale[index])) return 1;
  if (
    sorted
      .map((value) => -value)
      .sort((a, b) => b - a)
      .every((value, index) => value === scale[index])
  )
    return -1;
  // This factual scope establishes full twelve-person continuity, not a universal sum rule.
  if (continuous12 && represented === 12) {
    const count = delta.reduce((sum, value) => sum + value, 0) / 82;
    if (
      Number.isSafeInteger(count) &&
      count !== 0 &&
      Math.abs(count) <= 99 &&
      delta.every(
        (value) =>
          Math.sign(value) === Math.sign(count) &&
          Math.abs(value) >= Math.abs(count) &&
          Math.abs(value) <= Math.abs(count) * 15,
      )
    )
      return count;
  }
}
