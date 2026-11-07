import { applyCaptureContext, contextPhase } from "../capture/capture-context.ts";
import { screenProperties } from "../capture/screens.ts";
import { applyReviewedRace, reviewedRace } from "../mogi/race-review.ts";
import { representedPlayers, roomSizeNeedsAnswer } from "../numeric-readings/numeric-candidates.ts";
import { participantsAtPhysical, participantsForRace } from "../participation/participation.ts";
import { lostInferredNumberReview, sequenceConflictReview } from "../reconstruction/origin-scope.ts";
import type { CaptureSequence, Race, SequenceGap, SequenceLink } from "../types.ts";
import { cumulativeRacePlacements } from "./first-race.ts";
import type { OccurrenceNode } from "./occurrences.ts";
import type { RoomAnalysis } from "./room/room-sequence.ts";
import type { Mogi } from "./sequence-input-signature.ts";

export interface RaceProjection<T extends Mogi> {
  input: T;
  detached: T;
  original: T;
  nodes: OccurrenceNode[];
  gaps: SequenceGap[];
  relations: CaptureSequence["relations"];
  old: CaptureSequence | undefined;
  numbers: CaptureSequence["numbers"];
  links: SequenceLink[];
  roomAnalysis: RoomAnalysis;
  priorProjected: Set<string>;
  manualTargets: Set<string>;
  projected: Set<string>;
  projectedAssociations: { captureId: string; raceId: string }[];
}

/** Project numbered occurrences into races, associate their sources and accept complete finish orders;
 * a conflict instead leaves the detached races, marking the ones previously projected. */
export function projectOccurrencesIntoRaces<T extends Mogi>(
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
  }: RaceProjection<T>,
  conflict: string | undefined,
): { mogi: T; conflict: string | undefined } {
  let mogi = input;
  if (!conflict) {
    const races = [...input.races];
    const { released, followed } = followOccurrenceNumbers(input, nodes, races, priorProjected, manualTargets);
    conflict = occurrenceRaces(input, original, detached, nodes, gaps, races, priorProjected, manualTargets, projected);
    if (!conflict) {
      pendingRacesThrough(nodes, races, detached, followed, priorProjected, manualTargets, projected);
      mogi = {
        ...input,
        captures: input.captures?.map((capture) =>
          released.has(capture.id)
            ? { ...capture, stage: "context" as const, context: { phase: contextPhase(capture) } }
            : capture,
        ),
        races: races.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
        sequence: {
          ...old,
          version: 1,
          numbers,
          links,
          relations,
          occurrences: nodes.map((node) => node.occurrence),
          gaps,
          inputSignature: "pending",
        },
      };
      mogi = associateSources(mogi, nodes, projectedAssociations);
      mogi = acceptFinishOrders(mogi, nodes, roomAnalysis);
    }
  }
  if (conflict)
    mogi = {
      ...detached,
      races: detached.races.map((race) =>
        priorProjected.has(race.id) ? { ...race, participationReview: sequenceConflictReview } : race,
      ),
    };
  return { mogi, conflict };
}

/** Give each numbered occurrence its race: reuse a pending race of that number, or add one. */
function occurrenceRaces(
  input: Mogi,
  original: Mogi,
  detached: Mogi,
  nodes: OccurrenceNode[],
  gaps: SequenceGap[],
  races: Race[],
  priorProjected: Set<string>,
  manualTargets: Set<string>,
  projected: Set<string>,
): string | undefined {
  let conflict: string | undefined;
  for (const node of nodes) {
    const number = node.occurrence.number;
    if (number === undefined || number < 1 || number > 99) continue;
    const eligible = new Set(
      (input.races.some((race) => race.physicalNumber !== undefined)
        ? participantsAtPhysical(input, number)
        : participantsForRace(input, number)
      ).map((person) => person.id),
    );
    if (
      node.captures.some((capture) =>
        capture.nameAssociations?.some((answer) => answer.participantId && !eligible.has(answer.participantId)),
      )
    ) {
      conflict =
        "The inferred position changes who is eligible to play. Check the links without swapping accepted players.";
      break;
    }
    // A pre-race source alone is upcoming, not a completed missing result.
    if (
      !node.captures.some((capture) => contextPhase(capture) !== "before") &&
      !nodes.some((later) => later.component === node.component && later.position > node.position)
    )
      continue;
    let at = races.findIndex((race) => race.id === node.occurrence.id);
    const sameNumber =
      races.find((race) => race.number === number && race.id !== node.occurrence.id) ??
      detached.races.find(
        (race) =>
          race.number === number &&
          race.id !== node.occurrence.id &&
          race.status === "pending" &&
          !race.captureIds?.length &&
          !nodes.some((other) => other !== node && other.occurrence.id === race.id),
      );
    if (sameNumber) {
      if (sameNumber.status !== "pending" || sameNumber.placements.length || sameNumber.captureIds?.length) {
        conflict = "This number already belongs to another race. Check the link before combining the screenshots.";
        break;
      }
      const previousId = node.occurrence.id;
      node.occurrence.id = sameNumber.id;
      node.occurrence.aliases = [...new Set([...node.occurrence.aliases, previousId])];
      for (const gap of gaps) {
        if (gap.fromId === previousId) gap.fromId = sameNumber.id;
        if (gap.toId === previousId) gap.toId = sameNumber.id;
        gap.id = `${gap.fromId}:${gap.toId}`;
      }
      at = races.findIndex((race) => race.id === sameNumber.id);
      if (at < 0) {
        races.push(sameNumber);
        at = races.length - 1;
      }
    }
    if (
      !original.races.some((race) => race.id === node.occurrence.id) ||
      (priorProjected.has(node.occurrence.id) && !manualTargets.has(node.occurrence.id))
    )
      projected.add(node.occurrence.id);
    if (at < 0) {
      const previous = detached.races.find((race) => race.id === node.occurrence.id);
      races.push(
        previous
          ? { ...previous, number, participationReview: undefined }
          : { id: node.occurrence.id, origin: "observed", number, status: "pending", placements: [], captureIds: [] },
      );
    } else if (races[at].number !== number) {
      conflict = "The sequence changed an already numbered race. Check its number before continuing.";
      break;
    }
    node.occurrence.raceId = node.occurrence.id;
  }
  return conflict;
}

/** A projected race whose result was read only from its own screens follows its occurrence as a fresh import of the
 * same screens would: it takes the occurrence's current number, or, when the occurrence has none, it is withdrawn and
 * its screens go back to context. An older analysis may have numbered it differently, or left it marked by a sequence
 * conflict that this numbering no longer has. Returns the released screens and the races that followed. */
function followOccurrenceNumbers(
  input: Mogi,
  nodes: OccurrenceNode[],
  races: Race[],
  priorProjected: Set<string>,
  manualTargets: Set<string>,
): { released: Set<string>; followed: Set<string> } {
  const released = new Set<string>();
  const followed = new Set<string>();
  for (const node of nodes) {
    const number = node.occurrence.number;
    const at = races.findIndex((race) => race.id === node.occurrence.id);
    const race = races[at];
    if (
      !race ||
      race.number === undefined ||
      (race.number === number && race.participationReview !== sequenceConflictReview) ||
      (number !== undefined && (number < 1 || number > 99)) ||
      !priorProjected.has(race.id) ||
      manualTargets.has(race.id) ||
      race.origin !== "observed" ||
      race.status === "discarded" ||
      (race.participationReview &&
        race.participationReview !== lostInferredNumberReview &&
        race.participationReview !== sequenceConflictReview) ||
      !race.captureIds?.length ||
      race.captureIds.some((id) => !node.captures.some((capture) => capture.id === id)) ||
      Object.values(race.nativePointOrigins ?? {}).includes("manual") ||
      input.assistance?.facts.some((fact) => fact.raceId === race.id) ||
      input.substitutions?.some((entry) => entry.fromRaceId === race.id)
    )
      continue;
    followed.add(race.id);
    if (number === undefined) {
      races.splice(at, 1);
      for (const id of race.captureIds) released.add(id);
    } else
      races[at] = {
        ...race,
        number,
        ...(race.physicalNumber === undefined ? {} : { physicalNumber: number }),
        participationReview: undefined,
      };
  }
  return { released, followed };
}

/** Fill every number up to the last numbered occurrence with a pending race, reusing a detached one that is not
 * already placed and did not follow its occurrence elsewhere. */
function pendingRacesThrough(
  nodes: OccurrenceNode[],
  races: Race[],
  detached: Mogi,
  followed: Set<string>,
  priorProjected: Set<string>,
  manualTargets: Set<string>,
  projected: Set<string>,
): void {
  // Known valid positions before an explicitly numbered occurrence are real pending results.
  const through = Math.max(
    0,
    ...nodes.map(
      (node) =>
        (node.occurrence.number ?? 0) - (node.captures.every((capture) => contextPhase(capture) === "before") ? 1 : 0),
    ),
  );
  for (let number = 1; number <= through; number++)
    if (
      !races.some(
        (race) => race.number === number && (race.status !== "discarded" || race.physicalNumber !== undefined),
      )
    ) {
      const previous = detached.races.find(
        (race) => race.number === number && !followed.has(race.id) && !races.some((placed) => placed.id === race.id),
      );
      const pending = previous ?? {
        id: crypto.randomUUID(),
        origin: "observed" as const,
        number,
        status: "pending" as const,
        placements: [],
      };
      if (!previous || (priorProjected.has(pending.id) && !manualTargets.has(pending.id))) projected.add(pending.id);
      races.push(pending);
    }
}

/** Associate each source with its occurrence's race, keeping its review and draft. */
function associateSources<T extends Mogi>(
  mogi: T,
  nodes: OccurrenceNode[],
  projectedAssociations: { captureId: string; raceId: string }[],
): T {
  for (const node of nodes)
    if (node.occurrence.raceId)
      for (const source of node.captures) {
        if (source.context?.raceId === node.occurrence.raceId || !source.context) continue;
        const fields = {
          placements: [],
          absentParticipantIds: [],
          rawOverrides: {},
          reviewed: false,
          nameAssociations: source.nameAssociations,
          numericAnswers: source.numericAnswers,
          groupTotalAnswers: source.groupTotalAnswers,
          nextTrackAnswer: source.nextTrackAnswer,
        };
        mogi = applyCaptureContext(mogi, source, fields, node.occurrence.raceId, true);
        mogi = {
          ...mogi,
          captures: mogi.captures?.map((capture) =>
            capture.id === source.id
              ? {
                  ...capture,
                  reviewedAt: source.reviewedAt,
                  reviewedPlacements: source.reviewedPlacements,
                  contextDraft: source.contextDraft,
                }
              : capture,
          ),
        };
        projectedAssociations.push({ captureId: source.id, raceId: node.occurrence.raceId });
      }
  return mogi;
}

/** A complete twelve-name source of a pending numbered race confirms its finish order. */
function acceptFinishOrders<T extends Mogi>(mogi: T, nodes: OccurrenceNode[], roomAnalysis: RoomAnalysis): T {
  for (const node of [...nodes].sort((a, b) => (a.occurrence.number ?? Infinity) - (b.occurrence.number ?? Infinity)))
    if (node.occurrence.raceId && node.occurrence.number) {
      for (const source of node.captures) {
        if (
          source.contextDraft ||
          (!source.context && source.stage !== "finish-order-confirmed") ||
          roomSizeNeedsAnswer(mogi, source, roomAnalysis)
        )
          continue;
        const associations = source.nameAssociations;
        if (associations?.length !== 12 || associations.some((answer) => !answer.participantId)) continue;
        const race = mogi.races.find((race) => race.id === node.occurrence.raceId)!;
        // A reconstruction only fits the totals; the screen's own finish order replaces it.
        const showsOrder = screenProperties(source.interpretation?.screen)?.order === "finishOrder";
        if (race.status !== "pending" && !(race.origin === "reconstructed" && showsOrder)) continue;
        const represented = representedPlayers(source);
        let placements = associations.slice(0, represented).map((answer) => answer.participantId!);
        if (!showsOrder) {
          const inferred = cumulativeRacePlacements(mogi, race, source, roomAnalysis);
          if (!inferred) continue;
          placements = inferred;
        }
        const reviewed = reviewedRace(
          {
            ...race,
            origin: race.origin === "reconstructed" ? "reconstructed" : "observed",
            captureIds: [...new Set([...(race.captureIds ?? []), source.id])],
          },
          {
            placements,
            absentParticipantIds: participantsForRace(mogi, node.occurrence.number)
              .filter((person) => !placements.includes(person.id))
              .map((person) => person.id),
            rawOverrides: {},
            reviewed: false,
          },
          mogi.races.some((race) => race.physicalNumber !== undefined)
            ? participantsAtPhysical(mogi, node.occurrence.number)
            : participantsForRace(mogi, node.occurrence.number),
        );
        const accepted = mogi.captures?.find((capture) => capture.id === source.id) ?? source;
        if (reviewed)
          mogi = applyReviewedRace(
            mogi,
            reviewed,
            {
              ...accepted,
              ...(showsOrder ? { context: undefined, stage: "finish-order-confirmed" as const } : {}),
              contextDraft: undefined,
              reviewedAt: new Date().toISOString(),
              reviewedPlacements: reviewed.placements,
            },
            true,
          );
      }
    }
  return mogi;
}
