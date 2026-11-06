import { screenProperties } from "../capture/screens.ts";
import { participantsForOccurrence } from "../participation/participation.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import { racePhysicalNumber } from "../scoring/scoring.ts";
import type { Assistance, Mogi, PositionFact, Race, ReconstructionHypothesis } from "../types.ts";

// Fact history keeps the latest hundred changes for review.
const FACT_HISTORY_LIMIT = 100;
// Positions run from first to twelfth in a room of twelve.
const MAX_POSITION = 12;

export function assistanceState(mogi: Mogi): Assistance {
  return (
    mogi.assistance ?? {
      id: crypto.randomUUID(),
      targetRaceIds: [],
      facts: [],
      factHistory: [],
      history: [],
    }
  );
}

export interface FactInput {
  id?: string;
  raceId: string;
  participantId: string;
  position: number | "absent" | "unknown";
}
export function changePositionFact<T extends Mogi>(mogi: T, input: FactInput): T {
  const group = assistanceState(mogi),
    race = mogi.races.find((r) => r.id === input.raceId);
  if (!race || !participantsForOccurrence(mogi, race).some((p) => p.id === input.participantId))
    throw new Error("Choose a player from the selected race.");
  const previous = group.facts.find((f) =>
    input.id ? f.id === input.id : f.raceId === input.raceId && f.participantId === input.participantId,
  );
  if (
    input.id &&
    group.facts.some((f) => f.id !== input.id && f.raceId === input.raceId && f.participantId === input.participantId)
  )
    throw new Error("This player already has a known position in this race. Edit that one.");
  const at = new Date().toISOString();
  if (input.position === "unknown") {
    if (!previous) return skipQuestion({ ...mogi, assistance: group }, `${input.raceId}:${input.participantId}`);
    return {
      ...mogi,
      assistance: {
        ...group,
        facts: group.facts.filter((f) => f.id !== previous.id),
        factHistory: [...group.factHistory, { action: "remove", at, fact: previous }].slice(
          -FACT_HISTORY_LIMIT,
        ) as Assistance["factHistory"],
      },
    };
  }
  if (
    input.position !== "absent" &&
    (!Number.isInteger(input.position) || input.position < 1 || input.position > MAX_POSITION)
  )
    throw new Error("Choose a position from 1 to 12.");
  const fact: PositionFact = {
    id: previous?.id ?? crypto.randomUUID(),
    raceId: input.raceId,
    participantId: input.participantId,
    position: input.position,
    origin: "user",
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
  };
  return {
    ...mogi,
    assistance: {
      ...group,
      facts: [...group.facts.filter((f) => f.id !== fact.id), fact],
      factHistory: [...group.factHistory, { action: previous ? "edit" : "add", at, fact: previous ?? fact }].slice(
        -FACT_HISTORY_LIMIT,
      ) as Assistance["factHistory"],
    },
  };
}
export function skipQuestion<T extends Mogi>(mogi: T, key: string): T {
  const group = mogi.assistance;
  if (!group?.analysis) return mogi;
  return {
    ...mogi,
    assistance: {
      ...group,
      skipped: {
        signature: group.analysis.inputSignature,
        keys: [
          ...new Set([...(group.skipped?.signature === group.analysis.inputSignature ? group.skipped.keys : []), key]),
        ],
      },
    },
  };
}
/** A captured finish order or complete final column needs its reading resolved before position questions. */
export function capturedRaceNeedsReading(mogi: Mogi, race: Race): boolean {
  const raceId = race.id;
  return !!mogi.captures?.some((capture) => {
    const occurrence = mogi.sequence?.occurrences.find((entry) => entry.captureIds.includes(capture.id));
    const number = occurrence?.physicalNumber ?? occurrence?.number;
    const before = screenProperties(capture.interpretation?.screen)?.moment === "before";
    const attached =
      capture.context?.raceId === raceId || race.captureIds?.includes(capture.id) || occurrence?.raceId === raceId;
    return (
      (!before && attached && screenProperties(capture.interpretation?.screen)?.order === "finishOrder") ||
      (screenProperties(capture.interpretation?.screen)?.cumulative === "final" &&
        capture.rows.length === 12 &&
        capture.numericRows?.length === 12 &&
        (before ? number !== undefined && number - 1 === racePhysicalNumber(mogi, race) : attached))
    );
  });
}

/** Equally useful position questions prefer a player whose native points still differ across hypotheses. */
export function positionQuestionGainVaries(
  hypotheses: ReconstructionHypothesis[],
  raceId: string,
  participantId: string,
): boolean {
  const gains = hypotheses.flatMap((hypothesis) => {
    const result = hypothesis.results.find((entry) => entry.raceId === raceId);
    if (!result) return [];
    const rank = result.placements.indexOf(participantId);
    return [rank < 0 ? 0 : nativePlacementPoints(result.represented)[rank]];
  });
  return new Set(gains).size > 1;
}

export interface UsefulQuestion {
  raceId: string;
  participantId: string;
  key: string;
  /** The examples the question tells apart; the first one suggests the answer. */
  hypotheses: ReconstructionHypothesis[];
}

/** The joint analysis of the pending races asks first; when it has no examples to tell apart (a search cut by its
 * budget), the earliest pending race whose own exact search found competing results asks instead. */
export function usefulQuestion(mogi: Mogi): UsefulQuestion | null {
  const group = mogi.assistance,
    a = group?.analysis;
  if (a && a.hypotheses.length >= 2 && !["stale", "conflict", "insufficient"].includes(a.status)) {
    const joint = bestQuestion(mogi, a.targetRaceIds, a.hypotheses);
    if (joint) return joint;
  }
  for (const race of [...mogi.races].sort((x, y) => racePhysicalNumber(mogi, x) - racePhysicalNumber(mogi, y))) {
    const own = race.reconstruction?.boundaryAnalysis;
    if (race.status !== "pending" || race.placements.length || own?.status !== "ambiguous" || own.hypotheses.length < 2)
      continue;
    // Its own search already read the complete column: what still competes is an absence or a restart it hides.
    const question = bestQuestion(mogi, [race.id], own.hypotheses, false);
    if (question) return question;
  }
  return null;
}

function bestQuestion(
  mogi: Mogi,
  raceIds: string[],
  hypotheses: ReconstructionHypothesis[],
  awaitReading = true,
): UsefulQuestion | null {
  const group = mogi.assistance;
  const skipped = group?.skipped?.signature === group?.analysis?.inputSignature ? (group?.skipped?.keys ?? []) : [];
  let best: (UsefulQuestion & { score: number; nativeVaries: boolean }) | null = null;
  for (const raceId of raceIds) {
    const race = mogi.races.find((r) => r.id === raceId);
    if (!race) continue;
    if (awaitReading && capturedRaceNeedsReading(mogi, race)) continue;
    for (const p of participantsForOccurrence(mogi, race)) {
      const key = `${raceId}:${p.id}`;
      if (group?.facts.some((f) => f.raceId === raceId && f.participantId === p.id) || skipped.includes(key)) continue;
      const counts = new Map<number, number>();
      for (const c of hypotheses) {
        const r = c.results.find((r) => r.raceId === raceId);
        if (!r) continue;
        const position = r.placements.indexOf(p.id);
        counts.set(position, (counts.get(position) ?? 0) + 1);
      }
      const score = Math.max(...counts.values());
      const nativeVaries = positionQuestionGainVaries(hypotheses, raceId, p.id);
      if (
        counts.size > 1 &&
        (!best || score < best.score || (score === best.score && nativeVaries && !best.nativeVaries))
      )
        best = { raceId, participantId: p.id, key, hypotheses, score, nativeVaries };
    }
  }
  return best && { raceId: best.raceId, participantId: best.participantId, key: best.key, hypotheses };
}
