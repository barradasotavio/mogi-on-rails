import { representedPlayers } from "../numeric-readings/numeric-candidates.ts";
import { FULL_ROOM_PLAYERS } from "../numeric-readings/numeric-deduction.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import { sourcePairSignature } from "../sequence/source-pair-signature.ts";
import type { Capture, GameValue, Mogi } from "../types.ts";
import { capturePhaseOffset, contextPhase } from "./capture-context.ts";
import { prepareCaptureEvidence } from "./evidence.ts";
import { momentOffset, screenProperties } from "./screens.ts";

/** Accepted source fields, independent of race placement or technical session. */
function acceptedBoundaryValues(capture: Capture): Map<string, GameValue> {
  if (!capture.context && capture.stage !== "finish-order-confirmed") return new Map<string, GameValue>();
  const evidence = prepareCaptureEvidence(
    [capture],
    [
      {
        captureId: capture.id,
        accepted: true,
        nameAssociations: capture.nameAssociations,
        numericAnswers: capture.numericAnswers,
        groupTotalAnswers: capture.groupTotalAnswers,
      },
    ],
  );
  const values = new Map(
    evidence.boundaries.flatMap((boundary) =>
      boundary.values.map(({ participantId, value }) => [participantId, value] as const),
    ),
  );
  if (screenProperties(capture.interpretation?.screen)?.cumulative === "final")
    for (const deduction of capture.numericDeductions ?? []) {
      const id = capture.nameAssociations?.[deduction.row - 1]?.participantId;
      if (id && !capture.numericAnswers?.some((answer) => answer.row === deduction.row))
        values.set(id, {
          value: deduction.value,
          origin: "deduced",
          sourceCaptureId: capture.id,
          sourceRow: deduction.row,
          sourceField: "right",
        });
    }
  return values;
}
/** The legible right totals of an adding column whose represented rows all have distinct identities. */
function addingRowValues(capture: Capture): { ids: string[]; values: Map<string, GameValue> } | undefined {
  const size = representedPlayers(capture);
  const values = acceptedBoundaryValues({
    ...capture,
    interpretation: capture.interpretation && { ...capture.interpretation, screen: "finishOrderAdded" },
  });
  const ids = capture.nameAssociations?.slice(0, size).map((answer) => answer.participantId) ?? [];
  if (ids.length !== size || new Set(ids).size !== size || !ids.every((id) => id)) return;
  return {
    ids: ids as string[],
    values: new Map(ids.flatMap((id) => (values.has(id!) ? [[id!, values.get(id!)!] as const] : []))),
  };
}

/** All accepted represented rows must have a legible cumulative and a distinct identity. */
function addingBoundaryValues(capture: Capture): Map<string, GameValue> {
  const rows = addingRowValues(capture);
  return rows && rows.values.size === rows.ids.length ? rows.values : new Map();
}

/** An unreadable addition can be supplied by this capture's independently accepted finish order, never reconstruction. */
export function nativeAddingPoints(mogi: Mogi, capture: Capture, id: string): number | undefined {
  const row = capture.nameAssociations!.findIndex((answer) => answer.participantId === id) + 1;
  const scale = nativePlacementPoints(representedPlayers(capture));
  const addition = capture.numericRows?.find((entry) => entry.row === row)?.addition;
  if (addition && !addition.uncertain && addition.value !== null)
    return addition.value === scale[row - 1] ? addition.value : undefined;
  const race = mogi.races.find(
    (entry) => entry.captureIds?.includes(capture.id) || entry.id === capture.context?.raceId,
  );
  if (
    !race ||
    race.origin === "reconstructed" ||
    race.status === "pending" ||
    race.participationReview ||
    race.placements.length !== scale.length ||
    race.placements[row - 1] !== id
  )
    return;
  const points = race.nativePoints?.[id] ?? scale[row - 1];
  return points === scale[row - 1] ? points : undefined;
}

type BoundaryCheck = { sourceCaptureIds: string[]; signature: string };
type BoundaryColumn = ReturnType<typeof boundaryColumns>[number];

/** Prepare each accepted column once per analysis; indexes are local so corrections cannot reuse old evidence. */
function boundaryColumns(mogi: Mogi, replacement?: Capture) {
  const occurrences = new Map(
    mogi.sequence?.occurrences.flatMap((entry) => entry.captureIds.map((id) => [id, entry] as const)),
  );
  return (mogi.captures ?? []).flatMap((original) => {
    const capture = replacement?.id === original.id ? replacement : original;
    const occurrence = occurrences.get(capture.id);
    if ((!capture.context && capture.stage !== "finish-order-confirmed") || !occurrence) return [];
    const adding = capture.interpretation?.screen === "finishOrderAdding";
    const rows = adding ? addingRowValues(capture) : undefined;
    const values = adding ? addingBoundaryValues(capture) : captureBoundaryValues(capture);
    const additions = new Map(
      adding ? [...values.keys()].map((id) => [id, nativeAddingPoints(mogi, capture, id)]) : [],
    );
    const physicalNumber = occurrence.physicalNumber ?? occurrence.number;
    return [
      {
        capture,
        occurrence,
        adding,
        rows,
        values,
        additions,
        physicalNumber,
        completed:
          physicalNumber === undefined ? undefined : physicalNumber - (adding ? 1 : capturePhaseOffset(capture)),
      },
    ];
  });
}

/** Every compared person has the same segment and right + native addition equals the adjacent total. */
export function addingTotalsAgree(
  adding: BoundaryColumn,
  total: BoundaryColumn,
  ids: string[],
  stable?: string[],
): boolean {
  return (
    adding.adding &&
    ids.length > 0 &&
    ids.every((id) => {
      const left = adding.values.get(id),
        right = total.values.get(id),
        addition = adding.additions.get(id);
      return (
        stable?.includes(id) &&
        left !== undefined &&
        right !== undefined &&
        addition !== undefined &&
        left.value + addition === right.value
      );
    })
  );
}

function indexColumns(columns: BoundaryColumn[], coordinate: "completed" | "physicalNumber") {
  const index = new Map<number, BoundaryColumn[]>();
  for (const column of columns) {
    const number = column[coordinate];
    if (number !== undefined) index.set(number, [...(index.get(number) ?? []), column]);
  }
  return index;
}

/** Totals after the column's race, when they are settled: a checked adding column's right + native addition, or a
 * corroborated cumulative of every person. */
function settledTotalsAfter(column: BoundaryColumn, checked: boolean): Map<string, number> | undefined {
  if (!column.values.size) return;
  if (!column.adding) return new Map([...column.values].map(([id, value]) => [id, value.value]));
  if (!checked || [...column.additions.values()].some((value) => value === undefined)) return;
  return new Map([...column.values].map(([id, value]) => [id, value.value + column.additions.get(id)!]));
}

/** One unknown race separates the column from settled totals: every legible right total gains a distinct native
 * twelve-room value, and at most one unread total takes the one value left. Returns the completed column. */
function gapCorroboratedValues(
  column: BoundaryColumn,
  before: Map<string, number>,
  stable?: string[],
): Map<string, GameValue> | undefined {
  const rows = column.rows,
    scale = nativePlacementPoints(FULL_ROOM_PLAYERS);
  if (
    !rows ||
    rows.ids.length !== scale.length ||
    rows.ids.some((id) => !stable?.includes(id) || !before.has(id)) ||
    rows.ids.length - rows.values.size > 1
  )
    return;
  const gains = [...rows.values].map(([id, value]) => value.value - before.get(id)!);
  if (gains.some((gain) => !scale.includes(gain)) || new Set(gains).size !== gains.length) return;
  const left = scale.filter((points) => !gains.includes(points));
  const values = new Map(rows.values);
  for (const [index, id] of rows.ids.entries())
    if (!values.has(id))
      values.set(id, {
        value: before.get(id)! + left[0],
        origin: "deduced",
        sourceCaptureId: column.capture.id,
        sourceRow: index + 1,
        sourceField: "right",
      });
  return values;
}

/** Check adjacent boundaries first, then one unknown race away from a settled column, reusing each column and each
 * relation's stable identities. */
function addingBoundaryAnalysis(mogi: Mogi, columns: BoundaryColumn[]) {
  const completed = indexColumns(columns, "completed"),
    occurrences = indexColumns(columns, "physicalNumber");
  const stable = new Map<string, Map<string, string[]>>();
  for (const relation of mogi.sequence?.relations ?? []) {
    for (const [from, to] of [
      [relation.fromCaptureId, relation.toCaptureId],
      [relation.toCaptureId, relation.fromCaptureId],
    ]) {
      if (!stable.has(from)) stable.set(from, new Map());
      stable.get(from)!.set(to, relation.stableParticipantIds);
    }
  }
  const checks = new Map<string, BoundaryCheck>();
  for (const column of columns) {
    const number = column.physicalNumber;
    if (
      !column.adding ||
      number === undefined ||
      !column.values.size ||
      [...column.additions.values()].some((value) => value === undefined)
    )
      continue;
    const ids = [...column.values.keys()];
    const candidates = new Set([...(completed.get(number) ?? []), ...(occurrences.get(number - 1) ?? [])]);
    for (const other of candidates) {
      if (other === column) continue;
      const people = stable.get(column.capture.id)?.get(other.capture.id);
      const outgoing = other.completed === number && addingTotalsAgree(column, other, ids, people);
      const incoming = other.physicalNumber === number - 1 && addingTotalsAgree(other, column, ids, people);
      if (outgoing || incoming) {
        checks.set(column.capture.id, {
          sourceCaptureIds: [column.capture.id, other.capture.id],
          signature: sourcePairSignature(column.capture, other.capture),
        });
        break;
      }
    }
  }
  const values = new Map<string, Map<string, GameValue>>();
  for (const column of columns) {
    const number = column.physicalNumber;
    if (!column.adding || number === undefined || checks.has(column.capture.id)) continue;
    const earlier = new Set([...(completed.get(number - 2) ?? []), ...(occurrences.get(number - 2) ?? [])]);
    for (const other of earlier) {
      const before =
        (other.adding ? other.physicalNumber : other.completed) === number - 2 &&
        settledTotalsAfter(other, checks.has(other.capture.id));
      const completedValues =
        before && gapCorroboratedValues(column, before, stable.get(column.capture.id)?.get(other.capture.id));
      if (!completedValues) continue;
      checks.set(column.capture.id, {
        sourceCaptureIds: [column.capture.id, other.capture.id],
        signature: sourcePairSignature(column.capture, other.capture),
      });
      values.set(column.capture.id, completedValues);
      break;
    }
  }
  return { checks, values };
}

/** A complete adding column is before its race only when an adjacent native addition corroborates every row. */
export function settledBeforeAdding(mogi: Mogi, capture: Capture): BoundaryCheck | undefined {
  if (capture.interpretation?.screen !== "finishOrderAdding") return;
  return addingBoundaryAnalysis(mogi, boundaryColumns(mogi, capture)).checks.get(capture.id);
}

/** One argument retains the accepted-final-screen API; context additionally admits checked pre-race adding columns. */
export function captureBoundaryValues(capture: Capture, mogi?: Mogi): Map<string, GameValue> {
  if (!mogi || capture.interpretation?.screen !== "finishOrderAdding") return acceptedBoundaryValues(capture);
  const analysis = addingBoundaryAnalysis(mogi, boundaryColumns(mogi, capture));
  if (!analysis.checks.has(capture.id)) return acceptedBoundaryValues(capture);
  return analysis.values.get(capture.id) ?? addingBoundaryValues(capture);
}

/** A checked adding column moves the cumulative boundary back one physical occurrence. */
export function boundaryCompletedSteps(
  from: { phase: string; sequenceOffset: number },
  to: { phase: string; sequenceOffset: number },
  steps: number,
): number {
  return (
    steps +
    (from.phase === "before" ? 1 : 0) -
    from.sequenceOffset -
    (to.phase === "before" ? 1 : 0) +
    to.sequenceOffset
  );
}

export function captureBoundaries(mogi: Mogi) {
  const columns = boundaryColumns(mogi),
    { checks, values: completedValues } = addingBoundaryAnalysis(mogi, columns);
  return columns.map(({ capture, occurrence, values: columnValues }) => {
    const check = checks.get(capture.id);
    const values = completedValues.get(capture.id) ?? columnValues;
    const phase = check ? "before" : (capture.context?.phase ?? contextPhase(capture));
    return {
      captureId: capture.id,
      phase,
      sequenceOffset: capturePhaseOffset(capture),
      check,
      occurrenceId: occurrence.id,
      physicalNumber: occurrence.physicalNumber ?? occurrence.number,
      number:
        occurrence.number ??
        (occurrence.physicalNumber === undefined
          ? undefined
          : occurrence.physicalNumber -
            mogi.races.filter(
              (race) =>
                race.status === "discarded" &&
                race.physicalNumber !== undefined &&
                race.physicalNumber <= occurrence.physicalNumber! - momentOffset(phase),
            ).length),
      values: check || capture.interpretation?.screen !== "finishOrderAdding" ? values : new Map<string, GameValue>(),
    };
  });
}
