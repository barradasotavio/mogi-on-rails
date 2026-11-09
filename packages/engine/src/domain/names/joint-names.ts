import { teamSizes } from "../mogi/mogi-rules.ts";
import type { CaptureExplanationStep } from "../sequence/capture-explanation.ts";
import type { Capture, Mogi, NameAssociation, Participant } from "../types.ts";
import { type NameEvidence, nameEvidence } from "./name-evidence.ts";
import { normalizedName } from "./spelling.ts";

// In-game team tags are at most four characters; a longer prefix is part of the name.
const MAX_TAG_LENGTH = 4;
// Shorter tokens ("D", "vs", "kr") occur in too many names to point at one person.
const MIN_TOKEN_LETTERS = 3;
// Below this score gap between the best full assignment and an alternative, OCR noise could explain the difference.
const JOINT_MARGIN = 15;

const normalized = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
function members(mask: number, count: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < count; i++) if (mask & (1 << i)) result.push(i);
  return result;
}
// The combinatorial layout holds no mogi facts; it depends only on the fixed team size.
const partitionPlans = new Map<number, { subsets: number[]; rows: Map<number, number[]>; choices: number[][] }>();
function partitionPlan(size: number) {
  const cached = partitionPlans.get(size);
  if (cached) return cached;
  const subsets: number[] = [],
    rows = new Map<number, number[]>();
  function combine(first: number, remaining: number, mask: number) {
    if (!remaining) {
      subsets.push(mask);
      rows.set(mask, members(mask, 12));
      return;
    }
    for (let row = first; row <= 12 - remaining; row++) combine(row + 1, remaining - 1, mask | (1 << row));
  }
  combine(0, size, 0);
  const choices = Array.from({ length: 1 << 12 }, (_, mask) =>
    subsets.filter((group) => (group & mask) === group && (group & (mask & -mask)) !== 0),
  );
  const plan = { subsets, rows, choices };
  partitionPlans.set(size, plan);
  return plan;
}
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next[j + 1] = Math.min(next[j] + 1, previous[j + 1] + 1, previous[j] + Number(a[i] !== b[j]));
    previous = next;
  }
  return previous[b.length];
}

function similarity(reading: string, names: string[]) {
  const key = normalized(reading);
  let score = 0,
    decisive = false;
  for (const name of names.map(normalized).filter(Boolean)) {
    const edits = distance(key, name),
      ratio = 1 - edits / Math.max(key.length, name.length);
    const contains = !!key && key.includes(name);
    const shortened = key.length >= 4 && name.includes(key);
    const value = 100 * ratio + (key === name ? 300 : contains ? 200 : shortened ? 120 : 0);
    if (value <= score) continue;
    score = value;
    decisive = contains || shortened || (Math.min(key.length, name.length) >= 4 && edits <= 2 && ratio >= 0.7);
  }
  return { score, decisive };
}

/**
 * Tag boundary: a tag ends at a space, period or symbol, never inside a word.
 * Expects lower-case text, so "D Foo" carries tag "d" while "DKarl" carries neither "d" nor "dk".
 */
export function tagBoundary(text: string, tag: string): boolean {
  return text.startsWith(tag) && !!text[tag.length] && !/[a-z0-9]/.test(text[tag.length]);
}

/**
 * Tied partitions: when several best partitions of the rows into teams tie, a row stays linked only to
 * the rows it shares a group with in every one of them, so a tie never becomes an arbitrary group.
 * Returns, per row, the mask of rows it is linked to.
 */
export function tiedPartitionLinks(
  count: number,
  choices: readonly (readonly number[])[],
  scores: ArrayLike<number>,
): number[] {
  const all = (1 << count) - 1;
  const memo = new Int16Array(1 << count).fill(-1);
  memo[0] = 0;
  function best(mask: number): number {
    if (memo[mask] >= 0) return memo[mask];
    let score = 0;
    for (const group of choices[mask]) score = Math.max(score, scores[group] + best(mask ^ group));
    memo[mask] = score;
    return score;
  }
  best(all);
  const links = Array.from({ length: count }, () => all),
    visited = new Uint8Array(1 << count);
  function visit(mask: number) {
    if (!mask || visited[mask]) return;
    visited[mask] = 1;
    for (const group of choices[mask])
      if (scores[group] + best(mask ^ group) === best(mask)) {
        for (const row of members(group, count)) links[row] &= group;
        visit(mask ^ group);
      }
  }
  visit(all);
  return links;
}

/**
 * Groups rows into teams by their tags (longest shared prefix with a boundary); see `tagBoundary` and `tiedPartitionLinks`.
 * Inside a word, at index 1–2 ("CVSPeach" beside "VS Kamek"), a tag supports a row only when some row carries it with
 * a boundary, so "ki" inside "Nikiro" never joins that row to "KIDry".
 */
function tagGroups(capture: Capture, size: number): { rows: number[]; tag: string }[] {
  const count = capture.rows.length;
  if (size === 1 || count !== 12) return [];
  const texts = capture.rows.map((row) => row.text.normalize("NFKC").toLowerCase().trim());
  const heads = texts.map((text) => text.match(/^[a-z0-9]+/)?.[0] ?? "");
  const tags = [
    ...new Set(
      heads.flatMap((head) =>
        Array.from({ length: Math.min(MAX_TAG_LENGTH, head.length) }, (_, i) => head.slice(0, i + 1)),
      ),
    ),
  ];
  const boundary = (row: number, tag: string) => tagBoundary(texts[row], tag);
  const distinct = tags.filter((tag) => texts.filter((_, row) => boundary(row, tag)).length > 0);
  const ambiguous = heads.map((head, row) =>
    distinct.some((a) =>
      distinct.some((b) => a !== b && b.startsWith(a) && head.startsWith(b) && !boundary(row, a) && !boundary(row, b)),
    ),
  );
  const supports = tags.map((tag) =>
    texts.map(
      (text, row) =>
        !ambiguous[row] &&
        !(
          distinct.includes(tag) &&
          distinct.some((other) => other !== tag && other.startsWith(tag) && boundary(row, other))
        ) &&
        (text.startsWith(tag) ||
          (distinct.includes(tag) && tag.length >= 2 && text.indexOf(tag) > 0 && text.indexOf(tag) <= 2)),
    ),
  );
  const { subsets, rows: subsetRows, choices } = partitionPlan(size);
  const scores = new Int16Array(1 << count);
  const scoreTags = (rows: number[]) =>
    tags.map((tag, i) => {
      const support = rows.filter((row) => supports[i][row]);
      // Length and boundaries tell D from DK; a row without a tag may take the remaining slot.
      return {
        tag,
        score:
          support.length < 2
            ? 0
            : (support.length - 1) * (tag.length * 10 + support.filter((row) => boundary(row, tag)).length * 5),
      };
    });
  for (const mask of subsets) {
    const rows = subsetRows.get(mask)!;
    const score = Math.max(0, ...scoreTags(rows).map((candidate) => candidate.score));
    scores[mask] = score;
  }
  const cores = tiedPartitionLinks(count, choices, scores);
  // Even with the third row free, two inseparable members of a trio keep their link.
  return [...new Set(cores)]
    .map((mask) => members(mask, count))
    .filter((rows) => rows.length > 1)
    .map((rows) => ({ rows, tag: scoreTags(rows).sort((a, b) => b.score - a.score)[0]?.tag ?? "" }));
}

/** Tokens of a reading that can identify a person: words with at least three letters. */
export function nameTokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => (word.match(/\p{L}/gu)?.length ?? 0) >= MIN_TOKEN_LETTERS);
}

/**
 * Unique token: a token found in the names of exactly one free person anchors the row to them.
 * Otherwise every person sharing a token stays a candidate: the tokens only constrain and order the question.
 */
export function tokenCandidates(
  words: readonly string[],
  names: readonly (readonly string[])[],
  free: (person: number) => boolean,
): number[] {
  const matches = words.map((word) =>
    names.flatMap((personNames, i) => (personNames.some((name) => normalizedName(name).includes(word)) ? [i] : [])),
  );
  const unique = [...new Set(matches.filter((ids) => ids.length === 1 && free(ids[0])).flat())];
  return unique.length === 1 ? unique : [...new Set(matches.flat())];
}

/** Clear names prevail over a tag: a tag group survives only if its anchored rows agree on one team. */
export function tagAgreesWithAnchors(rows: readonly number[], anchors: readonly (string | undefined)[]): boolean {
  return new Set(rows.map((row) => anchors[row]).filter(Boolean)).size <= 1;
}

/** Similarity margin: a row is deduced only when its best joint assignment beats every alternative by a clear margin. */
export function clearJointMargin(best: number, alternative: number): boolean {
  return best - alternative > JOINT_MARGIN;
}

/**
 * Exclusion: once every other row of an anchored group (in FFA, of the whole roster) is linked,
 * the last free row is deduced. A withdrawn (`unlinked`) row stays open for a human answer.
 */
export function exclusionRow(rows: readonly number[], answers: readonly NameAssociation[]): number | undefined {
  const remaining = rows.filter((row) => !answers[row].participantId);
  return remaining.length === 1 && !answers[remaining[0]].unlinked ? remaining[0] : undefined;
}

interface Choice {
  mask: number;
  people: number[];
  score: number;
}
export interface JointNames {
  associations: NameAssociation[];
  steps: CaptureExplanationStep[];
  rows: { options: Participant[]; suggestion: string | null; group: string; impact: number }[];
}

/** Assigns groups to teams and rows to people in a single optimization, never reusing a participant. */
export function jointNames(
  mogi: Mogi,
  capture: Capture,
  associations: NameAssociation[],
  people: Participant[],
  deduce = true,
  evidence?: NameEvidence,
): JointNames {
  const answers = associations.map((answer) => ({ ...answer }));
  const steps: CaptureExplanationStep[] = [];
  const synonyms = (evidence?.mogi === mogi ? evidence : nameEvidence(mogi)).synonyms;
  const names = people.map((person) => [person.loungeName, person.ign, ...(synonyms.get(person.id) ?? [])]);
  const positive = (row: number, person: number) =>
    similarity(capture.rows[row].text, names[person]).decisive ||
    nameTokens(capture.rows[row].text).some((token) =>
      names[person].some((name) => normalizedName(name).includes(token)),
    );
  const fallback = () => ({
    associations: answers,
    steps,
    rows: capture.rows.map((row, i) => ({
      options: people.filter((person) => !answers.some((answer, j) => j !== i && answer.participantId === person.id)),
      suggestion: people.some(
        (person, p) =>
          person.id === row.suggestedParticipantId &&
          positive(i, p) &&
          !answers.some((answer, j) => j !== i && answer.participantId === person.id),
      )
        ? row.suggestedParticipantId
        : null,
      group: `row:${i}`,
      impact: 1,
    })),
  });
  if (
    !people.length ||
    people.length > 12 ||
    capture.rows.length > people.length ||
    answers.every((answer) => answer.participantId && people.some((person) => person.id === answer.participantId))
  )
    return fallback();
  const size = teamSizes[mogi.format];
  const occupied = new Set(answers.flatMap((answer) => (answer.participantId ? [answer.participantId] : [])));
  const free = people.filter((person) => !occupied.has(person.id));
  const unresolved = answers.flatMap((answer, row) => (answer.participantId ? [] : [row]));
  const tokenWords = capture.rows.map((row) => nameTokens(row.text));
  const tokens = tokenWords.map((words) => tokenCandidates(words, names, (person) => !occupied.has(people[person].id)));
  // When only one team remains, the facts already fix the group; tags cannot add candidates.
  const remainingTeam =
    size > 1 &&
    free.length > 1 &&
    free.length <= size &&
    free.length === unresolved.length &&
    free[0].teamId &&
    free.every((person) => person.teamId === free[0].teamId);
  const anchors = capture.rows.map((row, index) => {
    const accepted = people.find((person) => person.id === answers[index]?.participantId);
    if (accepted) return accepted.teamId;
    if (tokens[index].length === 1) return people[tokens[index][0]].teamId;
    const key = normalized(row.text);
    const exact = people.filter((person) => key && key === normalized(person.loungeName));
    const contained = exact.length
      ? exact
      : people.filter((person) => normalized(person.loungeName) && key.includes(normalized(person.loungeName)));
    return contained.length === 1 ? contained[0].teamId : undefined;
  });
  // A tag shared by opponents cannot contradict clear identities.
  const tagged = people.every((person) => person.teamId) ? tagGroups(capture, size) : [];
  const groups = remainingTeam
    ? [unresolved]
    : tagged.map((group) => group.rows).filter((rows) => tagAgreesWithAnchors(rows, anchors));
  // With the last team free, the other ten/nine rows no longer take part in the search.
  const units = remainingTeam
    ? [unresolved]
    : [
        ...groups,
        ...capture.rows.flatMap((_, row) => (groups.some((group) => group.includes(row)) ? [] : [[row]])),
      ].sort((a, b) => a[0] - b[0]);
  // Fixed names contribute a constant; occupied alternatives never enter a valid assignment.
  const similarities = capture.rows.map((row, index) =>
    names.map((names, person) =>
      answers[index]?.participantId || occupied.has(people[person].id)
        ? { score: 0, decisive: false }
        : {
            score: similarity(row.text, names).score + (tokens[index].includes(person) ? 120 : 0),
            decisive:
              (tokens[index].length === 1 && tokens[index][0] === person) ||
              similarity(row.text, [
                people[person].loungeName,
                ...(people[person].ignOrigin === "explicit" ? [people[person].ign] : []),
              ]).decisive,
          },
    ),
  );
  const choices: Choice[][] = units.map((rows) => {
    const result: Choice[] = [];
    const anchoredTeam = rows.length > 1 ? rows.map((row) => anchors[row]).find(Boolean) : undefined;
    function assign(selected: number[], mask: number, score: number) {
      if (selected.length === rows.length) {
        result.push({ mask, people: selected, score });
        return;
      }
      const row = rows[selected.length],
        fixed = answers[row]?.participantId;
      for (let person = 0; person < people.length; person++) {
        if (mask & (1 << person) || (fixed && fixed !== people[person].id)) continue;
        if (!fixed && occupied.has(people[person].id)) continue;
        if (!fixed && tokens[row].some((i) => !occupied.has(people[i].id)) && !tokens[row].includes(person)) continue;
        if (anchoredTeam && people[person].teamId !== anchoredTeam) continue;
        if (rows.length > 1 && selected.length && people[person].teamId !== people[selected[0]].teamId) continue;
        assign([...selected, person], mask | (1 << person), score + similarities[row][person].score);
      }
    }
    assign([], 0, 0);
    return result;
  });
  const memo = units.map(() => new Map<number, number>());
  function best(unit: number, used: number): number {
    if (unit === units.length) return 0;
    if (memo[unit].has(used)) return memo[unit].get(used)!;
    const value = Math.max(
      -Infinity,
      ...choices[unit]
        .filter((choice) => !(choice.mask & used))
        .map((choice) => choice.score + best(unit + 1, used | choice.mask)),
    );
    memo[unit].set(used, value);
    return value;
  }
  const total = best(0, 0);
  if (!Number.isFinite(total)) return fallback();
  // The forward and backward passes compute the best complete assignment for every alternative of every row.
  const alternatives = capture.rows.map(() => people.map(() => -Infinity));
  let forward = new Map([[0, 0]]);
  units.forEach((rows, unit) => {
    const next = new Map<number, number>();
    for (const [used, prefix] of forward)
      for (const choice of choices[unit]) {
        if (choice.mask & used) continue;
        const mask = used | choice.mask,
          score = prefix + choice.score;
        next.set(mask, Math.max(next.get(mask) ?? -Infinity, score));
        const complete = score + best(unit + 1, mask);
        rows.forEach((row, i) => {
          alternatives[row][choice.people[i]] = Math.max(alternatives[row][choice.people[i]], complete);
        });
      }
    forward = next;
  });
  const selected: number[] = [];
  let used = 0;
  units.forEach((rows, unit) => {
    const choice = choices[unit].find(
      (choice) =>
        !(choice.mask & used) &&
        Math.abs(choice.score + best(unit + 1, used | choice.mask) - best(unit, used)) < 0.00001,
    )!;
    rows.forEach((row, i) => {
      selected[row] = choice.people[i];
    });
    used |= choice.mask;
  });
  const accept = (
    row: number,
    rule: CaptureExplanationStep["rule"],
    evidence: CaptureExplanationStep["evidence"] = {},
  ) => {
    answers[row] = {
      participantId: people[selected[row]].id,
      ...(capture.rows[row].text.trim() ? { ign: capture.rows[row].text.trim() } : {}),
      origin: "deduced",
    };
    steps.push({
      kind: "name",
      subject: capture.id,
      value: answers[row].participantId,
      origin: "deduced",
      rule,
      evidence: { row: row + 1, readName: capture.rows[row].text, ...evidence },
    });
  };
  if (deduce) {
    capture.rows.forEach((_, row) => {
      if (answers[row].participantId || answers[row].unlinked) return;
      const person = selected[row];
      const other = Math.max(-Infinity, ...alternatives[row].filter((_, i) => i !== person));
      if (clearJointMargin(total, other) && similarities[row][person].decisive) {
        const group = groups.find((rows) => rows.includes(row));
        const token =
          tokens[row].length === 1
            ? tokenWords[row].find(
                (word) =>
                  names[person].some((name) => normalizedName(name).includes(word)) &&
                  names.filter((names) => names.some((name) => normalizedName(name).includes(word))).length === 1,
              )
            : undefined;
        accept(
          row,
          group ? "name.tag" : token ? "name.token" : "name.similar",
          group
            ? {
                tag: tagged.find((tagged) => tagged.rows === group)?.tag,
                group: group.map((row) => people[selected[row]].id),
              }
            : token
              ? { token }
              : {},
        );
      }
    });
    for (const rows of units) {
      const last = rows.length > 1 && rows.length === size ? exclusionRow(rows, answers) : undefined;
      if (last !== undefined)
        accept(last, "name.exclusion", {
          group: people
            .filter(
              (person) =>
                person.teamId === people[selected[last]].teamId &&
                !answers.some((answer) => answer.participantId === person.id),
            )
            .map((person) => person.id),
        });
    }
    const free = people.filter((person) => !answers.some((answer) => answer.participantId === person.id));
    const last =
      free.length === 1
        ? exclusionRow(
            answers.map((_, row) => row),
            answers,
          )
        : undefined;
    if (last !== undefined) accept(last, "name.exclusion", { group: free.map((person) => person.id) });
  }
  return {
    associations: answers,
    steps,
    rows: capture.rows.map((_, row) => {
      if (remainingTeam && !unresolved.includes(row))
        return { options: [], suggestion: null, group: `row:${row}`, impact: 0 };
      const unit = units.find((rows) => rows.includes(row))!;
      const teams = new Set(
        people.filter((_, i) => alternatives[row][i] >= total - JOINT_MARGIN).map((person) => person.teamId),
      );
      const available = people.filter((person) => !answers.some((answer) => answer.participantId === person.id));
      const options = available.filter(
        (person) =>
          (!tokens[row].some((i) => !occupied.has(people[i].id)) || tokens[row].includes(people.indexOf(person))) &&
          (size === 1 || unit.length === 1 || teams.has(person.teamId)),
      );
      const person = selected[row];
      const positive = tokens[row].includes(person) || similarity(capture.rows[row].text, names[person]).decisive;
      const suggestion =
        positive && options.some((option) => option.id === people[person].id) ? people[person].id : null;
      return {
        options,
        suggestion,
        group: unit.length > 1 ? `group:${unit.join(",")}` : `row:${row}`,
        impact: unit.filter((row) => !answers[row].participantId).length,
      };
    }),
  };
}
