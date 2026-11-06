import { capturePhaseOffset as offset, contextPhase } from "../capture/capture-context.ts";
import { native12OriginScope } from "../reconstruction/origin-scope.ts";
import type { CaptureSequence, SequenceOccurrence } from "../types.ts";
import type { complementarySourceGroups } from "./boundary-coordinates.ts";
import { totals } from "./boundary-step.ts";
import type { Capture, Mogi } from "./sequence-input-signature.ts";
import { sourcePairSignature as sequenceLinkSignature } from "./source-pair-signature.ts";

export interface OccurrenceNode {
  component: number;
  position: number;
  captures: Capture[];
  occurrence: SequenceOccurrence;
}

/** Give each group of complementary sources one occurrence: reuse its race or former identity, keep former
 * identities as aliases, and take the number its sources, declared origin or race establish. */
export function sequenceOccurrences(
  input: Mogi,
  groups: ReturnType<typeof complementarySourceGroups>,
  old: CaptureSequence | undefined,
  numbers: CaptureSequence["numbers"],
  automaticNumber: (capture: Capture) => number | undefined,
  manualTargets: Set<string>,
  priorProjected: Set<string>,
  conflict: string | undefined,
): { nodes: OccurrenceNode[]; conflict: string | undefined } {
  const usedIds = new Set<string>();
  const priority = (group: { captures: Capture[] }) =>
    group.captures.some(
      (capture) =>
        numbers.some((fact) => fact.captureId === capture.id && fact.number !== null) || capture.context?.raceId,
    )
      ? 0
      : 1;
  const nodes = [...groups.values()]
    .sort((a, b) => priority(a) - priority(b))
    .map((group) => {
      const ids = new Set(group.captures.map((capture) => capture.id));
      const previous = old?.occurrences.filter((occurrence) => occurrence.captureIds.some((id) => ids.has(id))) ?? [];
      const anchors = [...new Set(group.captures.map(automaticNumber))];
      const anchored =
        anchors.length === 1 &&
        anchors[0] !== undefined &&
        !group.captures.some((capture) => numbers.some((fact) => fact.captureId === capture.id))
          ? input.races.find((race) => race.status !== "discarded" && race.number === anchors[0])
          : undefined;
      const existing =
        input.races.find(
          (race) =>
            race.captureIds?.some((id) => ids.has(id)) ||
            group.captures.some((capture) => capture.context?.raceId === race.id),
        ) ?? anchored;
      const candidates = [existing?.id, ...previous.map((entry) => entry.id), group.captures[0].id].filter(
        (id): id is string => !!id,
      );
      const id = candidates.find((id) => !usedIds.has(id)) ?? crypto.randomUUID();
      usedIds.add(id);
      const occurrence: SequenceOccurrence = {
        id,
        aliases: [],
        captureIds: [...ids],
        ...(existing && existing.id === id ? { raceId: existing.id } : {}),
      };
      // A split cannot alias the same former identity to two new occurrences.
      occurrence.aliases = [
        ...new Set(
          previous
            .flatMap((entry) => [entry.id, ...entry.aliases])
            .filter((alias) => alias !== id && !usedIds.has(alias)),
        ),
      ];
      const explicit = group.captures.flatMap((capture) => {
        const fact = numbers.find((fact) => fact.captureId === capture.id && fact.phase === contextPhase(capture));
        return fact?.number ? [fact.number] : [];
      });
      for (const capture of group.captures) {
        if (!numbers.some((fact) => fact.captureId === capture.id)) {
          const automatic = automaticNumber(capture);
          if (automatic !== undefined) explicit.push(automatic);
        }
        const origin = old?.origins?.find(
          (fact) =>
            fact.captureId === capture.id &&
            fact.answer === "zero-valid-12" &&
            fact.signature === sequenceLinkSignature(capture, capture),
        );
        const values = totals(capture);
        if (origin && values.size === 12) {
          const count = [...values.values()].reduce((sum, value) => sum + value, 0) / 82;
          if (
            Number.isSafeInteger(count) &&
            count >= 0 &&
            count < 99 &&
            [...values.values()].every((value) => value >= count && value <= count * 15)
          ) {
            const number = count + offset(capture);
            const known = input.races.filter(
              (race) =>
                (race.physicalNumber ?? race.number ?? 0) >= 1 && (race.physicalNumber ?? race.number ?? 0) <= count,
            );
            if (number > 0 && native12OriginScope(input, known, values.keys(), true)) explicit.push(number);
          } else conflict = "The values contradict the stated start. Check the totals or the origin.";
        }
      }
      if (
        existing &&
        (existing.status !== "discarded" || existing.physicalNumber !== undefined) &&
        existing.number &&
        (manualTargets.has(existing.id) || (!priorProjected.has(existing.id) && existing.status !== "pending"))
      )
        explicit.push(existing.number);
      if (new Set(explicit).size > 1)
        conflict = "These screenshots have incompatible numbers. Check the number you entered.";
      if (explicit.length) occurrence.number = explicit[0];
      return { ...group, occurrence };
    });
  return { nodes, conflict };
}

/** An occurrence keeps only a race that still exists, and a former identity stays the alias of one live occurrence. */
export function settleOccurrences(mogi: Mogi, nodes: OccurrenceNode[]): void {
  for (const node of nodes)
    if (node.occurrence.raceId && !mogi.races.some((race) => race.id === node.occurrence.raceId))
      node.occurrence.raceId = undefined;
  const liveIds = new Set(nodes.map((node) => node.occurrence.id)),
    aliasOwners = new Set<string>();
  for (const node of nodes)
    node.occurrence.aliases = node.occurrence.aliases.filter((id) => {
      if (liveIds.has(id) || aliasOwners.has(id)) return false;
      aliasOwners.add(id);
      return true;
    });
}
