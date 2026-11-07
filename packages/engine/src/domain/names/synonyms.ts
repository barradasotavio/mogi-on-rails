import { captureNameAssociations } from "../questions/mogi-questions.ts";
import type { Capture, Mogi, NameAssociation } from "../types.ts";
import { settleCaptures } from "./name-answers.ts";
import { recognizedParticipant } from "./name-recognition.ts";
import { spelling, spellingGroups } from "./spelling.ts";

/** Who a row identifies: its answer, or, on a row with no answer and not withdrawn, its certain recognition. */
function linkedParticipant(mogi: Mogi, capture: Capture, answer: NameAssociation, index: number) {
  if (answer.participantId || answer.unlinked) return answer.participantId ?? undefined;
  return recognizedParticipant(mogi, capture.rows[index]);
}

/**
 * Synonyms derive from the saved links: each spelling a row identifies as the participant, whatever the link's
 * origin (answered, deduced, propagated or recognized), the current IGN's spelling included. No separate state.
 */
export function participantSynonyms(mogi: Mogi, participantId: string): string[] {
  const found = new Map<string, string>();
  for (const capture of mogi.captures ?? [])
    captureNameAssociations(capture).forEach((answer, index) => {
      if (linkedParticipant(mogi, capture, answer, index) !== participantId) return;
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
 * Takes the spelling's identification back from every row of the mogi, whatever the link's origin: each row
 * becomes a question again or is deduced anew from the remaining facts. Nothing is propagated again here.
 *
 * When the spelling is the person's IGN and the user didn't type it (learned or legacy), the IGN returns to the
 * fallback, to be learned from the next accepted answer. An explicit IGN is the user's own statement and stays;
 * its rows are withdrawn all the same.
 */
export function unlinkSynonym<T extends Mogi>(mogi: T, participantId: string, synonym: string): T {
  const spellingKey = spellingGroups(mogi.captures ?? []),
    key = spellingKey(synonym);
  if (!key) return mogi;
  const person = mogi.participants.find((entry) => entry.id === participantId);
  const unlearned =
    !!person &&
    (person.ignOrigin === "learned" || person.ignOrigin === undefined) &&
    person.ign !== person.loungeName &&
    spellingKey(person.ign) === key;
  const changed = new Set<string>();
  const captures = mogi.captures?.map((capture) => {
    const associations = captureNameAssociations(capture);
    const next = associations.map((answer, index) =>
      linkedParticipant(mogi, capture, answer, index) === participantId &&
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
