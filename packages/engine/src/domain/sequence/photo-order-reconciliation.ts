import { cumulativeNumber } from "../numeric-readings/cumulative-number.ts";
import { boundaryCoordinates, boundaryEdges, complementarySourceGroups } from "./boundary-coordinates.ts";
import { recordRoomExplanation, roomExplanationSteps } from "./capture-explanation.ts";
import { captureRelations } from "./capture-relations.ts";
import { reviewInferredNumbers } from "./inferred-number-review.ts";
import { sequenceOccurrences, settleOccurrences } from "./occurrences.ts";
import { finishOrderNumber, numberedCapture, recordRaceNumberExplanations } from "./race-number.ts";
import { projectOccurrencesIntoRaces } from "./race-projection.ts";
import { resultGaps } from "./result-gaps.ts";
import { analyzeRoomSequence } from "./room/room-sequence.ts";
import { type Capture, type Mogi, sequenceInputSignature } from "./sequence-input-signature.ts";
import { withoutSequenceAssociations } from "./sequence-projection.ts";
import { revalidateSourceEvidence } from "./source-revalidation.ts";

/** Re-evaluate source evidence, preserving physical IDs and source-local user facts. */
function inPhotoOrder(captures: Capture[] | undefined): Capture[] | undefined {
  return captures
    ?.map((capture, index) => ({ capture, index }))
    .sort(
      (a, b) => (a.capture.photoMoment?.at ?? Infinity) - (b.capture.photoMoment?.at ?? Infinity) || a.index - b.index,
    )
    .map(({ capture }) => capture);
}

/** The analysis reads sources in photo order, so the result never depends on which reading finished first. */
export function reconcilePhysicalSequence<T extends Mogi>(original: T): T {
  const result = reconcileInPhotoOrder({ ...original, captures: inPhotoOrder(original.captures) });
  const position = new Map(original.captures?.map((capture, index) => [capture.id, index]));
  return {
    ...result,
    captures: result.captures
      ? [...result.captures].sort(
          (a: Capture, b: Capture) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity),
        )
      : undefined,
  };
}

function reconcileInPhotoOrder<T extends Mogi>(ordered: T): T {
  const { original, revalidated, numericPlan, namesChanged, nameSteps } = revalidateSourceEvidence(ordered);
  const { detached, priorProjected, manualTargets, input } = analysisInput(original, revalidated);
  const projected = new Set<string>();
  const projectedAssociations: { captureId: string; raceId: string }[] = [];
  const captures = (input.captures ?? []).filter((capture) => numberedCapture(input, capture));
  if (!captures.length && !input.sequence) return input;
  // Withdrawing projected associations/numbers does not change the facts the room analysis reads.
  // Only new identities require comparing the same vectors again in this pass.
  const roomAnalysis = namesChanged ? analyzeRoomSequence(input) : numericPlan;
  recordRoomExplanation(roomAnalysis, [...roomExplanationSteps(roomAnalysis), ...nameSteps]);
  const automaticNumber = (capture: Capture) => {
    const entry = roomAnalysis.captures.find((entry) => entry.captureId === capture.id);
    return (entry ? entry.number : cumulativeNumber(capture)) ?? finishOrderNumber(input, capture);
  };
  const old = input.sequence;
  const numbers = old?.numbers ?? [],
    links = old?.links ?? [];
  let conflict: string | undefined;
  const boundaries = boundaryEdges(input, captures, roomAnalysis, numbers, links, automaticNumber, conflict);
  const edges = boundaries.edges;
  conflict = boundaries.conflict;
  const { coordinates, contradictory } = boundaryCoordinates(edges);
  if (contradictory) conflict = "The totals have contradictory relations. Check the screenshots and the restarts.";
  const groups = complementarySourceGroups(captures, coordinates);
  const occurrences = sequenceOccurrences(
    input,
    groups,
    old,
    numbers,
    automaticNumber,
    manualTargets,
    priorProjected,
    conflict,
  );
  const nodes = occurrences.nodes;
  conflict = occurrences.conflict;
  const resulting = resultGaps(input, nodes, captures, links, conflict);
  const gaps = resulting.gaps;
  conflict = resulting.conflict;
  const relations = captureRelations(captures, edges, coordinates);
  const projection = projectOccurrencesIntoRaces(
    {
      input,
      detached,
      original,
      nodes,
      gaps,
      relations,
      old,
      numbers,
      links,
      roomAnalysis,
      priorProjected,
      manualTargets,
      projected,
      projectedAssociations,
    },
    conflict,
  );
  let mogi = projection.mogi;
  conflict = projection.conflict;
  settleOccurrences(mogi, nodes);
  mogi = reviewInferredNumbers(mogi, nodes, gaps, old, priorProjected, conflict);
  mogi = withGameEvidenceHistory(mogi, original);
  const associations = projectedAssociations.filter((entry) =>
    mogi.captures?.some((capture) => capture.id === entry.captureId && capture.context?.raceId === entry.raceId),
  );
  recordRaceNumberExplanations(input, captures, nodes, numbers, roomAnalysis);
  const output = {
    ...mogi,
    sequence: {
      roomAnalysis,
      version: 1 as const,
      numbers,
      links,
      origins: old?.origins,
      relations,
      occurrences: nodes.map((node) => node.occurrence),
      gaps,
      associations,
      projectedRaceIds: [...new Set([...projected, ...priorProjected])].filter(
        (id) => !manualTargets.has(id) && mogi.races.some((race) => race.id === id),
      ),
      inputSignature: "pending",
      ...(conflict ? { conflict } : {}),
    },
  };
  const reconciled = { ...output, sequence: { ...output.sequence, inputSignature: sequenceInputSignature(output) } };
  // A newly proven finish order can resolve the continuity of the next capture.
  return reconciled.races.some(
    (race) =>
      race.status === "confirmed" && original.races.find((entry) => entry.id === race.id)?.status !== "confirmed",
  )
    ? reconcilePhysicalSequence(reconciled)
    : reconciled;
}

/** Retract the previous pass's projections, keeping projected races that now hold facts. */
function analysisInput<T extends Mogi>(original: T, revalidated: T) {
  const detached = withoutSequenceAssociations(revalidated);
  const priorProjected = new Set(original.sequence?.projectedRaceIds ?? []);
  const manualTargets = new Set(
    detached.captures?.flatMap((capture) => (capture.context?.raceId ? [capture.context.raceId] : [])) ?? [],
  );
  const hasManualFacts = (id: string) =>
    !!original.assistance?.facts.some((fact) => fact.raceId === id) ||
    !!original.substitutions?.some((entry) => entry.fromRaceId === id) ||
    !!original.assistance?.targetRaceIds.includes(id) ||
    !!original.races.find(
      (race) =>
        race.id === id &&
        (race.participationReview ||
          race.absentParticipantIds?.length ||
          Object.keys(race.nativePoints ?? {}).length ||
          race.reconstruction ||
          race.reconstructionHistory?.length ||
          race.sourceRemovalHistory?.length),
    );
  const input = {
    ...detached,
    races: detached.races.filter(
      (race) =>
        !priorProjected.has(race.id) ||
        manualTargets.has(race.id) ||
        race.placements.length ||
        race.status === "discarded" ||
        hasManualFacts(race.id),
    ),
  };
  return { detached, priorProjected, manualTargets, input };
}

/** A race whose game evidence changed keeps the previous evidence in its history. */
function withGameEvidenceHistory<T extends Mogi>(mogi: T, original: Mogi): T {
  mogi = {
    ...mogi,
    races: mogi.races.map((race) => {
      const previous = original.races.find((entry) => entry.id === race.id);
      const unchanged = JSON.stringify(previous?.gameEvidence) === JSON.stringify(race.gameEvidence);
      return {
        ...race,
        gameEvidenceHistory: unchanged
          ? previous?.gameEvidenceHistory
          : previous?.gameEvidence
            ? [
                ...(previous.gameEvidenceHistory ?? []),
                { changedAt: new Date().toISOString(), evidence: previous.gameEvidence },
              ]
            : undefined,
      };
    }),
  };
  return mogi;
}
