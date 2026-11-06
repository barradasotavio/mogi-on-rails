import type { Mogi } from "../types.ts";
import { recognizedParticipant } from "./name-recognition.ts";
import { spelling, spellingGroups } from "./spelling.ts";

/** Ephemeral index of one mogi identity, shared while it is projected. */
export function nameEvidence(mogi: Mogi, includeDeductions = true) {
  const spellingKey = spellingGroups(mogi.captures ?? []);
  const known = new Map<string, Map<string, boolean>>();
  const synonyms = new Map<string, Map<string, string>>();
  const synonymSources = new Map<string, { captureId: string; name: string }[]>();
  for (const source of mogi.captures ?? [])
    source.nameAssociations?.forEach((answer, index) => {
      if (!answer.participantId || (!includeDeductions && answer.origin === "deduced")) return;
      const shown = (answer.ign ?? source.rows[index]?.text ?? "").trim(),
        key = spellingKey(shown);
      if (!key) return;
      const ids = known.get(key) ?? new Map<string, boolean>();
      ids.set(answer.participantId, !!ids.get(answer.participantId) || answer.origin !== "deduced");
      known.set(key, ids);
      if (recognizedParticipant(mogi, source.rows[index]) === answer.participantId) return;
      const sources = synonymSources.get(answer.participantId) ?? [];
      sources.push({ captureId: source.id, name: shown });
      synonymSources.set(answer.participantId, sources);
      const names = synonyms.get(answer.participantId) ?? new Map<string, string>();
      if (!names.has(spelling(shown))) names.set(spelling(shown), shown);
      synonyms.set(answer.participantId, names);
    });
  return {
    mogi,
    known,
    spellingKey,
    synonymSources,
    synonyms: new Map([...synonyms].map(([id, names]) => [id, [...names.values()].sort((a, b) => a.localeCompare(b))])),
  };
}
export type NameEvidence = ReturnType<typeof nameEvidence>;
