import { captureNameAssociations } from "../questions/mogi-questions.ts";
import type { Mogi, NameAssociation } from "../types.ts";
import { settleCaptures } from "./name-answers.ts";
import { recognizedParticipant } from "./name-recognition.ts";
import { spelling, spellingGroups } from "./spelling.ts";

/**
 * Synonyms derive from the saved answers: each spelling linked to the participant on a row that recognition
 * didn't resolve on its own, confirmed by an answer or propagated from one. No separate state.
 */
export function participantSynonyms(mogi: Mogi, participantId: string): string[] {
  const found = new Map<string, string>();
  for (const capture of mogi.captures ?? [])
    captureNameAssociations(capture).forEach((answer, index) => {
      if (answer.participantId !== participantId || recognizedParticipant(mogi, capture.rows[index]) === participantId)
        return;
      const shown = (answer.ign ?? capture.rows[index]?.text ?? "").trim();
      const key = spelling(shown);
      if (key && !found.has(key)) found.set(key, shown);
    });
  return [...found.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Withdrawal always writes `unlinked: true` with no participant, regardless of the link's origin.
 * Elimination cannot restore it: linking again takes a human answer or new evidence.
 */
export function withdrawnAssociation(): NameAssociation {
  return { participantId: null, unlinked: true };
}

/**
 * Removes only answers confirmed or propagated for that spelling. Readings recognition resolved stay
 * independent. Nothing is propagated again here: the next answer decides anew.
 *
 * A learned IGN came from an answer, so unlinking its spelling takes back what that answer taught: the
 * recognitions it produced are withdrawn too and the IGN returns to the fallback, to be learned from the next
 * accepted answer. An explicit IGN is the user's own statement and keeps its recognitions.
 */
export function unlinkSynonym<T extends Mogi>(
  mogi: T,
  participantId: string,
  synonym: string,
  includeRecognized = false,
): T {
  const spellingKey = spellingGroups(mogi.captures ?? []),
    key = spellingKey(synonym);
  const person = mogi.participants.find((entry) => entry.id === participantId);
  const unlearned = !!key && person?.ignOrigin === "learned" && spellingKey(person.ign) === key;
  const changed = new Set<string>();
  const captures = mogi.captures?.map((capture) => {
    const associations = captureNameAssociations(capture);
    const next = associations.map((answer, index) =>
      answer.participantId === participantId &&
      (includeRecognized || unlearned || recognizedParticipant(mogi, capture.rows[index]) !== participantId) &&
      key &&
      spellingKey(answer.ign ?? capture.rows[index]?.text ?? "") === key
        ? withdrawnAssociation()
        : answer,
    );
    if (next.every((answer, index) => answer === associations[index])) return capture;
    changed.add(capture.id);
    return { ...capture, nameAssociations: next };
  });
  const participants = unlearned
    ? mogi.participants.map((entry) =>
        entry.id === participantId ? { ...entry, ign: entry.loungeName, ignOrigin: "fallback" as const } : entry,
      )
    : mogi.participants;
  return changed.size || unlearned ? settleCaptures({ ...mogi, participants, captures }, changed, false) : mogi;
}
