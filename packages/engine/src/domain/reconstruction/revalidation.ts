import { roomExplanationSteps } from "../sequence/capture-explanation.ts";
import { reconcileSequence } from "../sequence/sequence.ts";
import type { Mogi } from "../types.ts";
import {
  assistanceTargets,
  normalizeAssistance,
  pendingCaptureRead,
  setAssistanceAnalysis,
  settleAssistedRaces,
  solveAssistance,
} from "./assistance.ts";
import { boundaryInputSignature } from "./assistance-problem.ts";
import { boundaryEquations } from "./boundary-problem.ts";
import { normalizeCoverage } from "./coverage.ts";
import { applyReconstruction, reconstructOne } from "./reconstruction.ts";
import { reconstructionSignature } from "./reconstruction-input.ts";
import { compactReconstructions } from "./reconstruction-storage.ts";

/** Reconciliation derives plain records; keep unchanged branches, including opaque image Blobs. */
function reuseUnchanged<T>(previous: T, next: T, changedRecord?: object): T {
  if (previous === next || !previous || !next || typeof previous !== "object" || typeof next !== "object") return next;
  if (next === changedRecord) return next;
  const prototype = Object.getPrototypeOf(next);
  if (
    Object.getPrototypeOf(previous) !== prototype ||
    (prototype !== Object.prototype && prototype !== Array.prototype)
  )
    return next;
  const before = previous as Record<string, unknown>;
  const entries = Object.entries(next).map(
    ([key, value]) => [key, reuseUnchanged(before[key], value, changedRecord)] as const,
  );
  if (
    Object.keys(previous).length === entries.length &&
    entries.every(([key, value]) => Object.hasOwn(previous, key) && value === before[key])
  )
    return previous;
  if (entries.every(([key, value]) => value === (next as Record<string, unknown>)[key])) return next;
  return Object.assign(Array.isArray(next) ? [] : {}, Object.fromEntries(entries)) as T;
}

/** Invalidate before publishing any state to standings, export or restored preview. */
export async function normalizeReconstructions<State extends { mogis: Mogi[] }>(
  state: State,
  options: { revalidateBoundaryProofs?: boolean; previousState?: { mogis: Mogi[] } } = {},
): Promise<State> {
  // Only the last successfully normalized state may supply trusted identities.
  const previous = new Set(options.revalidateBoundaryProofs ? [] : options.previousState?.mogis);
  const mogis = await Promise.all(
    state.mogis.map(async (mogi) => {
      if (previous.has(mogi)) return mogi;
      const original = mogi;
      mogi = reconcileSequence(settleAssistedRaces(compactReconstructions(mogi)));
      if (mogi.sequence) {
        for (const target of mogi.races) {
          if (target.placements.length && target.origin !== "reconstructed") continue;
          const prior = target.reconstruction;
          if (!prior && pendingCaptureRead(mogi, target)) continue;
          const equations = boundaryEquations(mogi, [target]);
          if (!equations.length && !prior?.boundaryAnalysis) continue;
          const facts = (mogi.assistance?.facts ?? []).filter((fact) => fact.raceId === target.id);
          const signature =
            equations.length && !target.participationReview
              ? await boundaryInputSignature(mogi, [target], facts)
              : undefined;
          const current =
            !!prior?.boundaryAnalysis &&
            signature !== undefined &&
            signature === prior.boundaryAnalysis.inputSignature &&
            prior.status === prior.boundaryAnalysis.status &&
            (prior.status !== "unique" ||
              JSON.stringify([target.placements, target.absentParticipantIds ?? []]) ===
                JSON.stringify([prior.placements, prior.absentParticipantIds]));
          if (current && !options.revalidateBoundaryProofs) continue;
          if (current && options.revalidateBoundaryProofs && prior) {
            const checked = await reconstructOne(mogi, target);
            if (
              checked.status === prior.status &&
              JSON.stringify([checked.placements, checked.absentParticipantIds]) ===
                JSON.stringify([prior.placements, prior.absentParticipantIds])
            )
              continue;
            mogi = applyReconstruction(mogi, target, checked);
            continue;
          }
          if (!signature && prior?.boundaryAnalysis) {
            if (prior.status === "stale" && target.status === "pending" && !target.placements.length) continue;
            mogi = applyReconstruction(mogi, target, {
              ...prior,
              status: "stale",
              placements: [],
              absentParticipantIds: [],
              message:
                "The evidence or positions behind this result changed; the previous conclusion no longer counts.",
            });
          } else if (signature) mogi = applyReconstruction(mogi, target, await reconstructOne(mogi, target));
        }
      }
      if (mogi.sequence) {
        const available = assistanceTargets(mogi).filter(
          (race) => race.reconstruction?.boundaryAnalysis?.status !== "unique",
        );
        const all = boundaryEquations(mogi, available);
        const supported = new Set(
          all.flatMap((equation) => equation.targetIndices.map((index) => available[index].id)),
        );
        const targets = available.filter((race) => supported.has(race.id));
        if (targets.length) {
          const facts = (mogi.assistance?.facts ?? []).filter((fact) => supported.has(fact.raceId));
          const signature = await boundaryInputSignature(mogi, targets, facts);
          if (signature !== mogi.assistance?.analysis?.inputSignature || mogi.assistance?.analysis?.status === "stale")
            mogi = setAssistanceAnalysis(
              mogi,
              await solveAssistance(mogi, targets, facts),
              mogi.assistance?.facts ?? [],
            );
        }
      }
      const races = await Promise.all(
        mogi.races.map(async (race) => {
          const proof = race.reconstruction;
          if (!proof || proof.status !== "unique" || proof.boundaryAnalysis) return race;
          const fresh =
            proof.inputSignature === reconstructionSignature(mogi, race) ? await reconstructOne(mogi, race) : null;
          if (
            race.origin === "reconstructed" &&
            fresh?.status === "unique" &&
            fresh.fromRaceId === proof.fromRaceId &&
            fresh.toRaceId === proof.toRaceId &&
            fresh.session === proof.session &&
            JSON.stringify(fresh.sourceCaptureIds) === JSON.stringify(proof.sourceCaptureIds) &&
            JSON.stringify(fresh.knownRaces) === JSON.stringify(proof.knownRaces) &&
            JSON.stringify([...fresh.absentParticipantIds].sort()) ===
              JSON.stringify([...proof.absentParticipantIds].sort()) &&
            JSON.stringify(fresh.anchors) === JSON.stringify(proof.anchors) &&
            fresh.represented === proof.represented &&
            JSON.stringify(fresh.placements) === JSON.stringify(proof.placements) &&
            JSON.stringify(proof.placements) === JSON.stringify(race.placements) &&
            JSON.stringify([...proof.absentParticipantIds].sort()) ===
              JSON.stringify([...(race.absentParticipantIds ?? [])].sort())
          )
            return race;
          return {
            ...race,
            status: race.status === "discarded" ? ("discarded" as const) : ("pending" as const),
            placements: [],
            absentParticipantIds: [],
            nativePoints: undefined,
            nativePointOrigins: undefined,
            reconstruction: {
              ...proof,
              status: "stale" as const,
              message:
                "The evidence changed, so the previous conclusion is out of the totals. Review the race order to work it out again.",
            },
            reconstructionHistory: [...(race.reconstructionHistory ?? []), proof],
          };
        }),
      );
      // A prefix proof may have been revoked in this pass; withdraw the
      // dependent deductions before publishing the standings.
      const normalized = compactReconstructions(
        normalizeCoverage(
          reconcileSequence(
            await normalizeAssistance(
              races.every((race, index) => race === mogi.races[index]) ? mogi : { ...mogi, races },
              options.revalidateBoundaryProofs,
            ),
          ),
        ),
      );
      const before = original.sequence?.roomAnalysis,
        after = normalized.sequence?.roomAnalysis;
      // Explanations are transient and can change even when the numeric analysis is equal.
      // Pending questions are refreshed by the question projection, outside reconciliation.
      const explanationChanged =
        before &&
        after &&
        JSON.stringify(roomExplanationSteps(before).filter((step) => step.kind !== "pending")) !==
          JSON.stringify(roomExplanationSteps(after).filter((step) => step.kind !== "pending"));
      return reuseUnchanged(original, normalized, explanationChanged ? after : undefined);
    }),
  );
  return mogis.every((mogi, index) => mogi === state.mogis[index]) ? state : { ...state, mogis };
}
