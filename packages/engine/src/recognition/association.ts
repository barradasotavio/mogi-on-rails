import type { ObservedNameRow } from "../domain/capture/observations.ts";
export interface AssociationParticipant {
  id: string;
  ign?: string;
  loungeName: string;
}
export interface AssociatedNameRow extends ObservedNameRow {
  suggestedParticipantId: string;
  uncertain: boolean;
}
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, n) => n * 3);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next[j + 1] = Math.min(next[j] + 3, previous[j + 1] + 1, previous[j] + (a[i] === b[j] ? 0 : 2));
    previous = next;
  }
  return previous[b.length];
}
export function matchRows(
  rows: Pick<AssociatedNameRow, "text" | "confidence" | "location" | "bounds" | "alternatives">[],
  participants: AssociationParticipant[],
): AssociatedNameRow[] {
  if (!rows.length) return [];
  if (!participants.length || rows.length > participants.length || participants.length > 16)
    throw new Error("Couldn't match these rows to the available roster. The original screenshot is still pending.");
  const names = participants.map((p) => normalizeName(p.ign || p.loungeName));
  const readings = rows.map((r) => normalizeName(r.text));
  const costs = readings.map((reading) => names.map((name) => (reading ? distance(name, reading) : 100)));
  const size = 1 << participants.length;
  const best = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const choice = new Int32Array(size).fill(-1);
  best[0] = 0;
  for (let mask = 0; mask < size; mask++) {
    let row = 0;
    for (let bits = mask; bits; bits &= bits - 1) row++;
    if (row >= rows.length) continue;
    for (let p = 0; p < participants.length; p++) {
      if (mask & (1 << p)) continue;
      const next = mask | (1 << p);
      const score = best[mask] + costs[row][p];
      if (score < best[next]) {
        best[next] = score;
        parent[next] = mask;
        choice[next] = p;
      }
    }
  }
  const assigned = new Array<number>(rows.length);
  let mask = -1;
  for (let candidate = 0; candidate < size; candidate++) {
    let count = 0;
    for (let bits = candidate; bits; bits &= bits - 1) count++;
    if (count === rows.length && Number.isFinite(best[candidate]) && (mask < 0 || best[candidate] < best[mask]))
      mask = candidate;
  }
  if (mask < 0) throw new Error("Names are still pending. Check the roster for this screenshot.");
  for (let row = rows.length - 1; row >= 0; row--) {
    assigned[row] = choice[mask];
    mask = parent[mask];
  }
  return rows.map((r, row) => {
    const p = assigned[row];
    const cost = costs[row][p];
    const tied = costs[row].filter((value) => value === cost).length > 1;
    return {
      ...r,
      suggestedParticipantId: participants[p].id,
      uncertain:
        !readings[row] ||
        readings[row] !== names[p] ||
        r.confidence < 65 ||
        !!r.alternatives?.some((part) => normalizeName(part.text) && normalizeName(part.text) !== readings[row]) ||
        tied ||
        readings.filter((reading) => reading && reading === readings[row]).length > 1,
    };
  });
}
