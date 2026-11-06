// Spacing and punctuation do not create another spelling; letters and symbols stay distinct.
export const spelling = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");

export const normalizedName = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next[j + 1] = Math.min(next[j] + 1, previous[j + 1] + 1, previous[j] + Number(a[i] !== b[j]));
    previous = next;
  }
  return previous[b.length];
}

/** Close variants merge only when no members of the two groups appear in the same capture. */
export function spellingGroups(captures: { rows: { text: string }[]; nameAssociations?: { ign?: string }[] }[]) {
  const sources = new Map<string, Set<number>>();
  captures.forEach((capture, source) =>
    capture.rows.forEach((row) => {
      const key = spelling(row.text),
        present = sources.get(key) ?? new Set<number>();
      present.add(source);
      sources.set(key, present);
    }),
  );
  for (const capture of captures)
    for (const answer of capture.nameAssociations ?? []) {
      if (answer.ign && !sources.has(spelling(answer.ign))) sources.set(spelling(answer.ign), new Set());
    }
  const keys = [...sources.keys()].sort(),
    groups = new Map(keys.map((key) => [key, new Set([key])]));
  for (let i = 0; i < keys.length; i++)
    for (const other of keys.slice(i + 1)) {
      const a = normalizedName(keys[i]),
        b = normalizedName(other),
        min = Math.min(a.length, b.length);
      if (min < 5 || editDistance(a, b) > (min >= 8 ? 2 : 1)) continue;
      const left = groups.get(keys[i])!,
        right = groups.get(other)!;
      if (
        left === right ||
        [...left].some((a) => [...right].some((b) => [...sources.get(a)!].some((id) => sources.get(b)!.has(id))))
      )
        continue;
      const merged = new Set([...left, ...right]);
      for (const key of merged) groups.set(key, merged);
    }
  const representatives = new Map([...groups].map(([key, group]) => [key, [...group].sort()[0]]));
  const key = (value: string) => representatives.get(spelling(value)) ?? spelling(value);
  const readings = [...new Set(captures.flatMap((capture) => capture.rows.map((row) => row.text)))];
  return Object.assign(key, {
    variants: (value: string) =>
      readings.filter((reading) => spelling(reading) !== spelling(value) && key(reading) === key(value)),
  });
}
