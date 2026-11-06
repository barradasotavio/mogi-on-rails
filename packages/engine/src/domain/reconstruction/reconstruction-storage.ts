import type { Assistance, AssistanceAnalysis, AssistanceEquation, Mogi, Race, Reconstruction } from "../types.ts";
import { sha256Hex } from "./sha256.ts";

// Length of a SHA-256 hex digest; a longer signature is raw JSON stored by an older version.
const SIGNATURE_LENGTH = 64;

/** Every proof and its history are kept, so their signatures must stay small: the whole state is saved as one value. */
export function compactSignature(signature: string): string {
  return signature.length > SIGNATURE_LENGTH ? sha256Hex(signature) : signature;
}

/** Boundary checks keep a digest of their source pair; equality between digests still proves equal sources. */
export function compactEquations(equations: AssistanceEquation[]): AssistanceEquation[] {
  let changed = false;
  const next = equations.map((equation) => {
    if (!equation.boundaryChecks?.some((check) => check.signature.length > SIGNATURE_LENGTH)) return equation;
    changed = true;
    return {
      ...equation,
      boundaryChecks: equation.boundaryChecks.map((check) => ({
        ...check,
        signature: compactSignature(check.signature),
      })),
    };
  });
  return changed ? next : equations;
}

function compactAnalysis(analysis: AssistanceAnalysis): AssistanceAnalysis {
  const equations = compactEquations(analysis.equations);
  return equations === analysis.equations ? analysis : { ...analysis, equations };
}

function compactProof(proof: Reconstruction): Reconstruction {
  const inputSignature = compactSignature(proof.inputSignature);
  const boundaryAnalysis = proof.boundaryAnalysis && compactAnalysis(proof.boundaryAnalysis);
  return inputSignature === proof.inputSignature && boundaryAnalysis === proof.boundaryAnalysis
    ? proof
    : { ...proof, inputSignature, boundaryAnalysis };
}

function compactRace(race: Race): Race {
  const reconstruction = race.reconstruction && compactProof(race.reconstruction);
  const history = race.reconstructionHistory?.map(compactProof);
  return reconstruction === race.reconstruction &&
    (history ?? []).every((proof, index) => proof === race.reconstructionHistory![index])
    ? race
    : { ...race, reconstruction, reconstructionHistory: history };
}

function compactAssistance(group: Assistance): Assistance {
  const analysis = group.analysis && compactAnalysis(group.analysis);
  const history = group.history.map((entry) => {
    const compacted = compactAnalysis(entry.analysis);
    return compacted === entry.analysis ? entry : { ...entry, analysis: compacted };
  });
  return analysis === group.analysis && history.every((entry, index) => entry === group.history[index])
    ? group
    : { ...group, analysis, history };
}

/** Digests raw signatures in stored proofs, histories and assisted analyses; unchanged mogis keep their identity. */
export function compactReconstructions<T extends Mogi>(mogi: T): T {
  const races = mogi.races.map(compactRace);
  const assistance = mogi.assistance && compactAssistance(mogi.assistance);
  return assistance === mogi.assistance && races.every((race, index) => race === mogi.races[index])
    ? mogi
    : { ...mogi, races, assistance };
}
