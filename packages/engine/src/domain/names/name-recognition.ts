import { normalizeName } from "../../recognition/association.ts";
import type { CaptureRow, Mogi } from "../types.ts";

/** A certain suggestion is independent only while the reading matches the person's current name. */
export function recognizedParticipant(mogi: Mogi, row?: CaptureRow): string | undefined {
  if (!row || row.uncertain !== false) return;
  const person = mogi.participants.find((person) => person.id === row.suggestedParticipantId);
  const reading = normalizeName(row.text);
  if (person && reading && reading === normalizeName(person.ign || person.loungeName)) return person.id;
}
