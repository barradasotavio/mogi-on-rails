import { captureNameAssociations } from "../questions/mogi-questions.ts";
import type { Mogi } from "../types.ts";
import { propagatedAssociation, settleCaptures } from "./name-answers.ts";
import { spellingGroups } from "./spelling.ts";

/** A typed IGN is the newest human statement for its spelling group throughout the mogi. */
export function changeIgn<T extends Mogi>(mogi: T, participantId: string, ign: string): T {
  ign = ign.trim();
  if (!ign || ign.length > 80) throw new Error("Enter an IGN with up to 80 characters.");
  if (!mogi.participants.some((person) => person.id === participantId))
    throw new Error("The IGN changed. Reopen the editor to continue.");
  // Include the typed spelling even when recognition only saw a close variant.
  const spellingKey = spellingGroups([...(mogi.captures ?? []), { rows: [{ text: ign }] }]),
    key = spellingKey(ign);
  const changed = new Set<string>();
  const captures = mogi.captures?.map((capture) => {
    const matching = capture.rows.map((row) => !!key && spellingKey(row.text) === key);
    if (!matching.some(Boolean)) return capture;
    changed.add(capture.id);
    return {
      ...capture,
      nameAssociations: captureNameAssociations(capture).map((answer, index) =>
        matching[index]
          ? propagatedAssociation(participantId, capture.rows[index].text, true)
          : answer.participantId === participantId
            ? { participantId: null }
            : answer,
      ),
    };
  });
  return settleCaptures(
    {
      ...mogi,
      participants: mogi.participants.map((person) =>
        person.id === participantId ? { ...person, ign, ignOrigin: "explicit" as const } : person,
      ),
      captures,
    },
    changed,
    false,
  );
}
