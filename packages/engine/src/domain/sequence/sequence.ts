import { physicalNumberForValid, withLinksInSpan } from "../participation/participation.ts";
import { withCurrentReviews } from "../reconstruction/origin-scope.ts";
import { recordRoomExplanation, roomExplanationSteps } from "./capture-explanation.ts";
import { reconcilePhysicalSequence } from "./photo-order-reconciliation.ts";
import { type Mogi, sequenceInputSignature } from "./sequence-input-signature.ts";
export { boundaryCoordinates, complementarySourceGroups } from "./boundary-coordinates.ts";
export { finishOrderNumber, numberedCapture } from "./race-number.ts";
export { sequenceInputSignature } from "./sequence-input-signature.ts";
export { sourcePairSignature as sequenceLinkSignature } from "./source-pair-signature.ts";

/** Reconcile evidence in stable physical coordinates, then project Lounge numbering.
 * Source answers retain the number originally supplied and its physical referent. */
export function reconcileSequence<T extends Mogi>(input: T): T {
  // Links saved before a participation change may still name someone outside the screenshot's span.
  const original = withLinksInSpan(withCurrentReviews(input));
  if (!original.races.some((race) => race.physicalNumber !== undefined)) return reconcilePhysicalSequence(original);
  const discarded = original.races
    .filter((race) => race.status === "discarded")
    .map((race) => race.physicalNumber!)
    .filter(Number.isFinite);
  const valid = (physical: number) => physical - discarded.filter((number) => number < physical).length;
  const physical: T = {
    ...original,
    races: original.races.map((race) => ({
      ...race,
      number:
        race.physicalNumber ?? (race.number === undefined ? undefined : physicalNumberForValid(original, race.number)),
    })),
    substitutions: original.substitutions?.map((entry) => ({
      ...entry,
      fromRace: entry.fromPhysicalNumber ?? entry.fromRace,
    })),
    sequence: original.sequence
      ? {
          ...original.sequence,
          numbers: original.sequence.numbers.map((fact) => ({
            ...fact,
            number:
              fact.number === null ? null : (fact.physicalNumber ?? physicalNumberForValid(original, fact.number)),
          })),
          occurrences: original.sequence.occurrences.map((entry) => ({
            ...entry,
            number: entry.physicalNumber ?? entry.number,
          })),
        }
      : undefined,
  };
  const output = reconcilePhysicalSequence(physical);
  const races = output.races.map((race) => {
    const number = race.number ?? race.physicalNumber;
    return {
      ...race,
      physicalNumber: number,
      number: race.status === "discarded" ? undefined : number === undefined ? undefined : valid(number),
    };
  });
  if (output.sequence?.roomAnalysis)
    recordRoomExplanation(
      output.sequence.roomAnalysis,
      roomExplanationSteps(output.sequence.roomAnalysis).map((step) =>
        step.kind === "race"
          ? {
              ...step,
              value: typeof step.value === "number" ? valid(step.value) : step.value,
              evidence: {
                ...step.evidence,
                anchorNumber: step.evidence.anchorNumber === undefined ? undefined : valid(step.evidence.anchorNumber),
                sessionStart: step.evidence.sessionStart === undefined ? undefined : valid(step.evidence.sessionStart),
              },
            }
          : step,
      ),
    );
  const sequence = output.sequence
    ? {
        ...output.sequence,
        numbers: output.sequence.numbers.map((fact) => {
          const prior = original.sequence?.numbers.find((entry) => entry.captureId === fact.captureId);
          return { ...fact, number: prior?.number ?? fact.number, physicalNumber: fact.number ?? undefined };
        }),
        occurrences: output.sequence.occurrences.map((entry) => {
          const number = entry.number;
          return {
            ...entry,
            physicalNumber: number,
            number:
              number === undefined || races.some((race) => race.id === entry.id && race.status === "discarded")
                ? undefined
                : valid(number),
          };
        }),
        gaps: output.sequence.gaps.map((gap) => {
          const from = output.sequence!.occurrences.find((entry) => entry.id === gap.fromId)?.number,
            to = output.sequence!.occurrences.find((entry) => entry.id === gap.toId)?.number;
          return from !== undefined && to !== undefined && gap.validCount !== undefined
            ? { ...gap, validCount: gap.validCount - discarded.filter((number) => number > from && number < to).length }
            : gap;
        }),
      }
    : undefined;
  const result = {
    ...output,
    races,
    sequence,
    substitutions: original.substitutions?.map((entry) => ({
      ...entry,
      fromRaceId: entry.fromRaceId ?? races.find((race) => race.physicalNumber === entry.fromPhysicalNumber)?.id,
    })),
  };
  return sequence ? { ...result, sequence: { ...sequence, inputSignature: sequenceInputSignature(result) } } : result;
}
