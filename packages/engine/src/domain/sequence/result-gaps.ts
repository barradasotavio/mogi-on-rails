import { contextPhase } from "../capture/capture-context.ts";
import { sharedTotalsContinue } from "../numeric-readings/numeric-candidates.ts";
import type { SequenceGap, SequenceLink } from "../types.ts";
import type { OccurrenceNode } from "./occurrences.ts";
import type { Capture, Mogi } from "./sequence-input-signature.ts";
import { sourcePairSignature as sequenceLinkSignature } from "./source-pair-signature.ts";

/** Result gaps between consecutive occurrences: counted inside a connected component, one uncertain interval
 * where unrelated components meet. */
export function resultGaps(
  input: Mogi,
  nodes: OccurrenceNode[],
  captures: Capture[],
  links: SequenceLink[],
  conflict: string | undefined,
) {
  const gaps: SequenceGap[] = [];
  const components = [...new Set(nodes.map((node) => node.component))];
  conflict = gapsWithinComponents(input, nodes, components, gaps, links, conflict);
  gapsBetweenComponents(nodes, components, gaps, links, captures);
  return { gaps, conflict };
}

/** Missing physical occurrences between positions of one component, with the valid count their numbers allow. */
function gapsWithinComponents(
  input: Mogi,
  nodes: OccurrenceNode[],
  components: number[],
  gaps: SequenceGap[],
  links: SequenceLink[],
  conflict: string | undefined,
): string | undefined {
  for (const component of components) {
    const ordered = nodes.filter((node) => node.component === component).sort((a, b) => a.position - b.position);
    for (let n = 1; n < ordered.length; n++) {
      const from = ordered[n - 1],
        to = ordered[n],
        count = to.position - from.position - 1;
      if (count <= 0) continue;
      const a = from.captures.find((source) => contextPhase(source) !== "before") ?? from.captures[0],
        b = to.captures[0];
      // A complementary capture in this same physical occurrence must not lose
      // the still-current validity answer for its original endpoint pair.
      const link = from.captures
        .flatMap((left) =>
          to.captures.flatMap((right) =>
            links.filter(
              (link) =>
                link.fromCaptureId === left.id &&
                link.toCaptureId === right.id &&
                link.signature === sequenceLinkSignature(left, right),
            ),
          ),
        )
        .find((link) => link.validity !== undefined);
      gaps.push({
        order: "forward",
        id: `${from.occurrence.id}:${to.occurrence.id}`,
        fromId: from.occurrence.id,
        toId: to.occurrence.id,
        sourceCaptureIds: link ? [link.fromCaptureId, link.toCaptureId] : [a.id, b.id],
        count,
        ...(link?.validity === "counted"
          ? { validCount: count }
          : link?.validity === "discarded"
            ? { validCount: 0 }
            : {}),
      });
    }
    // Only established validity across missing physical occurrences can carry a valid number.
    for (let pass = 0; pass < ordered.length; pass++)
      for (let n = 1; n < ordered.length; n++) {
        const from = ordered[n - 1],
          to = ordered[n],
          gap = gaps.find((gap) => gap.fromId === from.occurrence.id && gap.toId === to.occurrence.id);
        const discarded = input.races.find((race) => race.id === from.occurrence.id)?.status === "discarded";
        const a = from.occurrence.number,
          b = to.occurrence.number,
          base = input.races.some((race) => race.physicalNumber !== undefined) ? 1 : discarded ? 0 : 1;
        if (gap && gap.validCount === undefined) {
          if (a !== undefined && b !== undefined) {
            const validCount = b - a - base;
            if (validCount < 0 || validCount > gap.count!)
              conflict =
                "The number you entered contradicts how many races this stretch can hold. Check these screenshots.";
            else gap.validCount = validCount;
          }
          if (gap.validCount === undefined) continue;
        }
        const distance = base + (gap?.validCount ?? 0);
        if (a !== undefined && b !== undefined && b - a !== distance)
          conflict =
            "The number you entered contradicts the observed stretch or its validity. Check these screenshots.";
        else if (a !== undefined && b === undefined) to.occurrence.number = a + distance;
        else if (b !== undefined && a === undefined && b - distance >= 1) from.occurrence.number = b - distance;
      }
  }
  return conflict;
}

function gapsBetweenComponents(
  nodes: OccurrenceNode[],
  components: number[],
  gaps: SequenceGap[],
  links: SequenceLink[],
  captures: Capture[],
): void {
  // Unrelated components preserve a single uncertain interval; selection order is not chronology.
  // The interval sits where the two components meet: the first neighbours that belong to different
  // components, ordered by race number when every node has one, otherwise by photo time.
  const moment = (node: (typeof nodes)[number]) =>
    Math.min(...node.captures.map((capture) => capture.photoMoment?.at ?? Infinity));
  const earliest = (component: number) => Math.min(...nodes.filter((node) => node.component === component).map(moment));
  const chronological = [...components].sort((a, b) => earliest(a) - earliest(b));
  for (let n = 1; n < chronological.length; n++) {
    const pair = nodes.filter((node) => [chronological[n - 1], chronological[n]].includes(node.component));
    const byNumber = pair.every((node) => node.occurrence.number !== undefined);
    pair.sort((a, b) =>
      byNumber ? a.occurrence.number! - b.occurrence.number! : moment(a) - moment(b) || a.position - b.position,
    );
    const meeting = pair.findIndex((node, index) => index > 0 && node.component !== pair[index - 1].component);
    let from = pair[Math.max(0, meeting - 1)],
      to = pair[Math.max(1, meeting)];
    const knownOrder =
      from.occurrence.number !== undefined &&
      to.occurrence.number !== undefined &&
      from.occurrence.number !== to.occurrence.number;
    if (knownOrder && from.occurrence.number! > to.occurrence.number!) [from, to] = [to, from];
    // Once its continuity is settled (answered, or the shared totals continue), an interval between consecutive
    // numbers holds no race, so there is no gap.
    const continues = sharedTotalsContinue(from.captures[0], to.captures[0]);
    const answered =
      continues ||
      links.some(
        (link) =>
          link.continuity !== undefined &&
          [from, to].every((node) =>
            node.captures.some((capture) => [link.fromCaptureId, link.toCaptureId].includes(capture.id)),
          ) &&
          link.signature ===
            sequenceLinkSignature(
              captures.find((capture) => capture.id === link.fromCaptureId)!,
              captures.find((capture) => capture.id === link.toCaptureId)!,
            ),
      );
    if (answered && knownOrder && to.occurrence.number! - from.occurrence.number! === 1) continue;
    gaps.push({
      order: knownOrder ? "forward" : "unknown",
      id: `${from.occurrence.id}:${to.occurrence.id}`,
      fromId: from.occurrence.id,
      toId: to.occurrence.id,
      sourceCaptureIds: [from.captures[0].id, to.captures[0].id],
    });
  }
}
