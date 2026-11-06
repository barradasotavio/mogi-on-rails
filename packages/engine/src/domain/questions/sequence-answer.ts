import { interpretRightList } from "../../recognition/finish-order.ts";
import { physicalNumberForValid } from "../participation/participation.ts";
import { sequenceInputSignature, sequenceLinkSignature } from "../sequence/sequence.ts";
import type { Mogi } from "../types.ts";
export type SequenceAnswer =
  | { kind: "representation"; captureId: string; value: 10 | 11 | 12 }
  | { kind: "room-order"; firstCaptureId: string }
  | {
      kind: "person-continuity";
      fromCaptureId: string;
      toCaptureId: string;
      participantId: string;
      value: "reset" | "stable" | "unknown";
    }
  | { kind: "origin"; captureId: string; value: "zero-valid-12" | "unknown" }
  | { kind: "number"; captureId: string; value: number | null }
  | { kind: "validity"; gapId: string; value: "counted" | "discarded" | "unknown" }
  | { kind: "continuity"; gapId: string; value: "continuous-12" | "reset" | "unknown" };

/** Apply facts only against the source signature used to render the question. */
export function applySequenceAnswer<T extends Mogi>(item: T, action: SequenceAnswer, signature: string): T {
  if (sequenceInputSignature(item) !== signature)
    throw new Error("The screenshots or answers changed. Check the current sequence before answering.");
  const sequence = item.sequence ?? {
    version: 1 as const,
    numbers: [],
    links: [],
    relations: [],
    occurrences: [],
    gaps: [],
    inputSignature: "",
  };
  if (action.kind === "representation") {
    const source = item.captures?.find((capture) => capture.id === action.captureId);
    if (!source?.interpretation || !source.numericRows || ![10, 11, 12].includes(action.value))
      throw new Error("Check this screenshot's room size.");
    const interpretation = {
      ...interpretRightList(
        source.numericRows,
        source.interpretation.positions,
        source.interpretation.movementRows,
        source.rows,
        action.value,
      ),
      origin: "user" as const,
    };
    return {
      ...item,
      captures: item.captures!.map((capture) => (capture.id === source.id ? { ...capture, interpretation } : capture)),
    };
  }
  if (action.kind === "room-order") {
    const plan = item.sequence?.roomAnalysis;
    const first = plan?.sessions.find((s) => s.captureIds.includes(action.firstCaptureId));
    if (!plan?.order || !first || !plan.order.captureIds.includes(action.firstCaptureId))
      throw new Error("This question changed. Open the questions again.");
    const pending = new Set(plan.order.sessionIds);
    const ordered = [first, ...plan.sessions.filter((s) => s !== first && pending.has(s.id))];
    let start =
      Math.max(
        0,
        ...item.races
          .filter((r) => r.origin === "manual" && r.status !== "pending")
          .map((r) => r.physicalNumber ?? r.number ?? 0),
        ...plan.captures.filter((c) => !pending.has(c.sessionId)).map((c) => c.number ?? 0),
      ) + 1;
    const numbers = [...sequence.numbers];
    for (const room of ordered) {
      const entries = plan.captures.filter((c) => c.sessionId === room.id && c.j !== undefined);
      for (const entry of entries) {
        const capture = item.captures!.find((c) => c.id === entry.captureId)!;
        const phase = capture.context?.phase ?? "after",
          number = start + entry.j! - 1;
        const discarded = item.races.filter(
          (r) => r.status === "discarded" && (r.physicalNumber ?? Infinity) < number,
        ).length;
        if (number - discarded > 12) throw new Error("Choose an available race.");
        numbers.push({ captureId: entry.captureId, number: number - discarded, physicalNumber: number, phase });
      }
      start += Math.max(...entries.map((c) => c.j!));
    }
    return {
      ...item,
      sequence: {
        ...sequence,
        numbers: numbers.filter((f, i) => !numbers.slice(i + 1).some((n) => n.captureId === f.captureId)),
      },
    };
  }
  if (action.kind === "origin") {
    const capture = item.captures?.find((capture) => capture.id === action.captureId);
    if (!capture) throw new Error("This screenshot changed. Reopen it.");
    return {
      ...item,
      sequence: {
        ...sequence,
        origins: [
          ...(sequence.origins ?? []).filter((fact) => fact.captureId !== capture.id),
          { captureId: capture.id, signature: sequenceLinkSignature(capture, capture), answer: action.value },
        ],
      },
    };
  }
  if (action.kind === "number") {
    const capture = item.captures?.find((capture) => capture.id === action.captureId);
    if (
      !capture ||
      (action.value !== null && (!Number.isSafeInteger(action.value) || action.value < 1 || action.value > 99))
    )
      throw new Error("Check this screenshot's number.");
    const phase = capture.context?.phase ?? "after";
    return {
      ...item,
      sequence: {
        ...sequence,
        numbers: [
          ...sequence.numbers.filter((fact) => fact.captureId !== action.captureId),
          {
            captureId: action.captureId,
            number: action.value,
            ...(item.races.some((race) => race.physicalNumber !== undefined) && action.value !== null
              ? { physicalNumber: physicalNumberForValid(item, action.value) }
              : {}),
            phase,
          },
        ],
      },
    };
  }
  if (action.kind === "person-continuity") {
    const from = item.captures?.find((capture) => capture.id === action.fromCaptureId),
      to = item.captures?.find((capture) => capture.id === action.toCaptureId);
    if (
      !from ||
      !to ||
      !item.participants.some((person) => person.id === action.participantId) ||
      !sequence.relations.some((relation) => relation.fromCaptureId === from.id && relation.toCaptureId === to.id)
    )
      throw new Error("This relation changed. Check the current screenshots.");
    const previous = sequence.links.find(
      (link) =>
        (link.fromCaptureId === from.id && link.toCaptureId === to.id) ||
        (link.fromCaptureId === to.id && link.toCaptureId === from.id),
    );
    const start = previous?.fromCaptureId === to.id ? to : from,
      end = start === from ? to : from;
    const link = {
      ...previous,
      fromCaptureId: start.id,
      toCaptureId: end.id,
      signature: sequenceLinkSignature(start, end),
      people: [
        ...(previous?.people ?? []).filter((fact) => fact.participantId !== action.participantId),
        { participantId: action.participantId, answer: action.value },
      ],
    };
    return {
      ...item,
      sequence: { ...sequence, links: [...sequence.links.filter((entry) => entry !== previous), link] },
    };
  }
  const gap = sequence.gaps.find((gap) => gap.id === action.gapId);
  const from = item.captures?.find((capture) => capture.id === gap?.sourceCaptureIds[0]),
    to = item.captures?.find((capture) => capture.id === gap?.sourceCaptureIds[1]);
  if (!gap || !from || !to) throw new Error("This interval changed. Check the current screenshots.");
  const previous = sequence.links.find((link) => link.fromCaptureId === from.id && link.toCaptureId === to.id);
  const link = {
    ...previous,
    fromCaptureId: from.id,
    toCaptureId: to.id,
    signature: sequenceLinkSignature(from, to),
    ...(action.kind === "validity" ? { validity: action.value } : { continuity: action.value }),
  };
  return {
    ...item,
    sequence: {
      ...sequence,
      links: [
        ...sequence.links.filter((entry) => entry.fromCaptureId !== from.id || entry.toCaptureId !== to.id),
        link,
      ],
    },
  };
}
