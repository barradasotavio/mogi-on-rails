import { contextPhase } from "../capture/capture-context.ts";
import { screenProperties } from "../capture/screens.ts";
import { consistentTeamRows } from "../capture/team-evidence.ts";
import { compareBoundaryValues } from "../numeric-readings/boundary-values.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import type { SequenceLink } from "../types.ts";
import { cumulativeRacePlacements } from "./first-race.ts";
import type { Capture, Mogi } from "./sequence-input-signature.ts";

export function totals(capture: Capture): Map<string, number> {
  const values = new Map<string, number>();
  if (screenProperties(capture.interpretation?.screen)?.cumulative !== "final") return values;
  const allowed = screenProperties(capture.interpretation?.screen)?.teamTotals
    ? consistentTeamRows(capture)
    : undefined;
  capture.nameAssociations?.forEach((answer, index) => {
    if (!answer.participantId || (allowed && !allowed.includes(index + 1))) return;
    const manual = capture.numericAnswers?.find((value) => value.row === index + 1);
    const observed = capture.numericRows?.find((value) => value.row === index + 1)?.right;
    const value =
      manual?.value ??
      capture.numericDeductions?.find((v) => v.row === index + 1)?.value ??
      (observed && !observed.uncertain ? observed.value : null);
    if (value !== null && value !== undefined) values.set(answer.participantId, value);
  });
  return values;
}
/** A known native result supplies the current gain even when another identity returned.
 * Missing observations never establish representation: that comes from the accepted race. */
function currentStep(mogi: Mogi, from: Capture, to: Capture, answer?: SequenceLink): boolean {
  if (contextPhase(to) === "before") return false;
  const race = mogi.races.find(
    (race) =>
      (race.captureIds?.includes(to.id) || race.id === to.context?.raceId) &&
      race.origin !== "reconstructed" &&
      race.status !== "pending" &&
      !race.participationReview &&
      race.placements.length >= 10 &&
      race.placements.length <= 12,
  );
  if (!race) return false;
  const left = totals(from),
    right = totals(to),
    scale = nativePlacementPoints(race.placements.length);
  let stable = 0;
  for (const [id, value] of left) {
    const next = right.get(id),
      position = race.placements.indexOf(id);
    if (next === undefined || position < 0) continue;
    const fact = answer?.people?.find((fact) => fact.participantId === id)?.answer;
    if (fact === "reset") continue;
    const gain = next - value,
      current = race.nativePoints?.[id] ?? scale[position];
    if (gain < 0 && fact !== "stable") continue;
    if (gain !== current || current !== scale[position]) return false;
    stable++;
  }
  return stable >= 2;
}

/** Complete additions can show the cumulatives before the sum. Check them against
 * already proven native results, without using them as the image's final anchor. */
export function priorTotalsStep(mogi: Mogi, from: Capture, to: Capture, answer?: SequenceLink): boolean {
  if (
    to.interpretation?.screen !== "finishOrderAdding" ||
    to.interpretation.currentScale !== 12 ||
    answer?.people?.some((fact) => fact.answer !== "stable")
  )
    return false;
  const raceFor = (capture: Capture) => {
    const occurrence = mogi.sequence?.occurrences.find((entry) => entry.captureIds.includes(capture.id));
    return mogi.races.find(
      (race) =>
        race.id === capture.context?.raceId || race.captureIds?.includes(capture.id) || race.id === occurrence?.raceId,
    );
  };
  const before = raceFor(from),
    after = raceFor(to),
    number = after?.number;
  if (!before || !number || before.number !== number - 1 || contextPhase(from) === "before") return false;
  const prefix = mogi.races.filter((race) => (race.physicalNumber ?? race.number ?? Infinity) < number);
  if (
    prefix.length !== number - 1 ||
    new Set(prefix.map((race) => race.number)).size !== number - 1 ||
    prefix.some(
      (race) =>
        race.status === "pending" ||
        race.status === "discarded" ||
        race.origin === "reconstructed" ||
        race.participationReview ||
        race.placements.length !== 12 ||
        race.absentParticipantIds?.length,
    )
  )
    return false;
  const ids = to.nameAssociations?.map((answer) => answer.participantId);
  if (ids?.length !== 12 || new Set(ids).size !== 12 || ids.some((id) => !id)) return false;
  const expected = new Map<string, number>(ids.map((id) => [id!, 0]));
  for (const race of prefix)
    for (const [place, id] of race.placements.entries()) {
      if (
        !expected.has(id) ||
        (race.nativePoints?.[id] !== undefined && race.nativePoints[id] !== nativePlacementPoints(12)[place])
      )
        return false;
      expected.set(id, expected.get(id)! + nativePlacementPoints(12)[place]);
    }
  const left = totals(from);
  if (left.size !== 12 || [...expected].some(([id, value]) => left.get(id) !== value)) return false;
  let matched = 0;
  for (const [index, id] of ids.entries()) {
    const row = to.numericRows?.find((row) => row.row === index + 1);
    if (!row || row.addition.uncertain || row.addition.value !== nativePlacementPoints(12)[index]) return false;
    const value =
      to.numericAnswers?.find((answer) => answer.row === index + 1)?.value ??
      (!row.right.uncertain ? row.right.value : null);
    if (value === null) continue;
    if (value !== expected.get(id!)) return false;
    matched++;
  }
  return matched >= 2;
}
/** The finish order closed by the prefix proves the step since the previous race,
 * even when that capture showed an addition still mid-animation. */
export function cumulativeResultStep(mogi: Mogi, from: Capture, to: Capture, answer?: SequenceLink): boolean {
  if (contextPhase(from) === "before" || answer?.people?.some((fact) => fact.answer !== "stable")) return false;
  const raceFor = (capture: Capture) =>
    mogi.races.find(
      (race) =>
        race.id === capture.context?.raceId ||
        race.captureIds?.includes(capture.id) ||
        race.id === mogi.sequence?.occurrences.find((entry) => entry.captureIds.includes(capture.id))?.raceId,
    );
  const before = raceFor(from),
    after = raceFor(to);
  if (!before || !after?.number || before.number !== after.number - 1 || before.status !== "confirmed") return false;
  const ids = from.nameAssociations?.map((answer) => answer.participantId);
  const placements = cumulativeRacePlacements(mogi, after, to);
  return (
    !!placements && ids?.length === 12 && new Set(ids).size === 12 && ids.every((id) => !!id && placements.includes(id))
  );
}
/** Complete native single-race vector corroborates a boundary step, not a zero origin. */
export function boundaryStep(mogi: Mogi, from: Capture, to: Capture, answer?: SequenceLink): number | undefined {
  if (answer?.continuity === "reset") return;
  if (cumulativeResultStep(mogi, from, to, answer) || priorTotalsStep(mogi, from, to, answer)) return 1;
  if (cumulativeResultStep(mogi, to, from, answer) || priorTotalsStep(mogi, to, from, answer)) return -1;
  const forward = currentStep(mogi, from, to, answer),
    backward = currentStep(mogi, to, from, answer);
  if (forward && !backward) return 1;
  if (backward && !forward) return -1;
  const a = totals(from),
    b = totals(to);
  const represented =
    a.size === 12
      ? 12
      : from.reviewedPlacements.length === a.size && to.reviewedPlacements.length === a.size && a.size >= 10
        ? a.size
        : undefined;
  return compareBoundaryValues(a, b, represented, answer?.continuity === "continuous-12");
}
