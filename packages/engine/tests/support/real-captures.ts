import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  answerMogiQuestion,
  countedRaces,
  individualStandings,
  type MogiQuestion,
  type MogiQuestionAnswer,
  mogiQuestions,
  normalizeReconstructions,
  type Participant,
} from "@mkw/engine";
import { matchRows } from "@mkw/engine/browser";

import { ingestCaptureReview } from "../../../../apps/web/lib/mogi/ingestion.ts";
import type { Capture, Mogi, TrackerState } from "../../../../apps/web/lib/mogi/types.ts";
// Saved OCR readings need the pure interpretation seam; recognizeImage requires a browser canvas.
import { interpretRightList } from "../../src/recognition/finish-order.ts";

// Readings taken from iterative-13.json, with a roster without learned IGNs.
// The answer key only feeds the queue's answers and the assertions.
const load = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
export const raw = load("real-captures") as {
  roster: Omit<Participant, "ign">[];
  captures: (Omit<Capture, "original" | "reviewedAt" | "reviewedPlacements" | "stage" | "rows"> & {
    rows: Omit<Capture["rows"][number], "suggestedParticipantId" | "uncertain">[];
  })[];
};
// DateTimeOriginal + OffsetTimeOriginal audited in the thirteen original JPEGs.
const moments = load("photo-moments") as Record<string, NonNullable<Capture["photoMoment"]>>;
raw.captures.forEach((capture) => {
  capture.photoMoment = moments[capture.fileName];
});
const truth = load("mogi-truth") as { races: { race: number; placements: string[] }[] };
const cumulative = load("cumulative") as Record<string, number>[];
const spellings: Record<string, string> = {
  CVSPeach: "VSPeach",
  "F☆ peepa": "iggy",
  "F☆peepa": "iggy",
  "VS Kamek": "Kameks Eye",
  VSKamek: "Kameks Eye",
  "Diddy.": "pom",
  KRJFunk: "funk2006",
  KRSFunk: "funk2006",
  "KR√Funk": "funk2006",
  TKingBoo: "KingBoo",
  "T KingBoo": "KingBoo",
  Tavo: "Tavo",
  Bloop: "BloopMaster",
  "Bloop X": "BloopMaster",
  Ktoad67: "toad67",
  "K toad67": "toad67",
  Funky: "ActuFunk",
  "B·W-": "PiranhaPlant",
  "B·W.": "PiranhaPlant",
  "B-W.": "PiranhaPlant",
  "B·ω": "PiranhaPlant",
  "B·ω-": "PiranhaPlant",
  "B·ω.": "PiranhaPlant",
  DonkeyKong: "DonkeyKong",
};
export type Counts = Record<MogiQuestion["kind"], number>;
const emptyCounts = (): Counts => ({ name: 0, race: 0, sequence: 0, position: 0, points: 0, team: 0, credit: 0 });
export function emptyRealMogi(): Mogi {
  return {
    id: "real",
    name: "Real captures",
    format: "2v2",
    createdAt: "2026-10-29",
    races: [],
    participants: raw.roster.map((person) => ({ ...person, ign: person.loungeName, ignOrigin: "fallback" })),
    teams: Array.from({ length: 6 }, (_, index) => ({ id: `team-${index + 1}`, name: `Team ${index + 1}` })),
  };
}
export async function ingestReal(mogi: Mogi, indices: number[]): Promise<Mogi> {
  return ingestReadings(
    mogi,
    indices.map((index) => structuredClone(raw.captures[index])),
  );
}
export async function ingestReadings(mogi: Mogi, captures: typeof raw.captures): Promise<Mogi> {
  const state: TrackerState = {
    version: 1,
    activeMogiId: mogi.id,
    mogis: [
      {
        ...mogi,
        captureReview: {
          version: 1,
          id: "review",
          currentItemId: captures[0].id,
          items: captures.map((capture, index) => ({
            id: capture.id,
            source: { fileId: capture.id },
            number: index + 1,
            numberKnown: false,
            association: "new",
            status: "ready",
            recognition: {
              ...capture,
              stage: "finish-order-confirmed",
              rows: matchRows(capture.rows, mogi.participants),
            },
          })),
        },
      },
    ],
    sharedReceipts: [
      {
        id: "receipt",
        receivedAt: "2026-10-29",
        rejections: [],
        files: captures.map((capture) => ({
          id: capture.id,
          name: capture.fileName,
          mimeType: "image/jpeg",
          lastModified: 0,
          photoMoment: capture.photoMoment,
          original: new Blob(),
        })),
      },
    ],
  };
  return (await normalizeReconstructions(ingestCaptureReview(state, mogi.id))).mogis[0];
}
/** Reinterpret saved raw readings just as the current recognizer does. */
export function reinterpretReading<
  T extends Pick<Capture, "numericRows" | "interpretation"> & { rows: { text: string }[] },
>(capture: T): T {
  return {
    ...capture,
    interpretation: interpretRightList(
      capture.numericRows!,
      capture.interpretation!.positions,
      capture.interpretation!.movementRows,
      capture.rows,
    ),
  };
}
function answer(mogi: Mogi, question: MogiQuestion): MogiQuestionAnswer {
  if (question.kind === "name") {
    const name = spellings[question.reading];
    assert.ok(name, `Spelling without an answer key: ${question.reading}`);
    return {
      kind: "name",
      answer: { participantId: mogi.participants.find((person) => person.loungeName === name)!.id },
    };
  }
  if (question.kind === "race") {
    const index = raw.captures.findIndex((capture) => capture.id === question.captureId);
    return { kind: "race", value: Math.min(index + 1, 12) };
  }
  if (question.kind === "sequence") return { kind: "sequence", value: "continuous-12" };
  if (question.kind === "position") {
    const name = mogi.participants.find((person) => person.id === question.participantId)!.loungeName;
    return { kind: "position", value: truth.races[question.number! - 1].placements.indexOf(name) + 1 };
  }
  throw new Error(`Unexpected question: ${JSON.stringify(question)}`);
}
export function checkTotals(mogi: Mogi, through: number): void {
  assert.equal(countedRaces(mogi).length, through);
  assert.deepEqual(
    Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])),
    cumulative[through - 1],
    "Totals the app publishes",
  );
  for (let number = 1; number <= through; number++) {
    const prefix = {
      ...mogi,
      races: countedRaces(mogi).filter((race) => race.number! <= number),
      captures: [],
      sequence: undefined,
      coverage: undefined,
    };
    assert.deepEqual(
      Object.fromEntries(individualStandings(prefix).map((person) => [person.loungeName, person.points])),
      cumulative[number - 1],
      `Totals after race ${number}`,
    );
    const race = countedRaces(mogi).find((race) => race.number === number);
    assert.ok(race, `Race ${number} counted`);
    assert.deepEqual(
      race.placements.map((id) => mogi.participants.find((person) => person.id === id)!.loungeName),
      truth.races[number - 1].placements,
    );
  }
}
export async function replayReal(batches: number[][], strict = true, withDuplicates = false, answerPositions = true) {
  let mogi = emptyRealMogi();
  const counts = emptyCounts(),
    seenIds = new Set<string>(),
    seenContent = new Set<string>(),
    repeats: string[] = [],
    questions: MogiQuestion[] = [];
  for (const indices of batches) {
    mogi = await ingestReadings(
      mogi,
      indices.flatMap((index) => {
        const source = structuredClone(raw.captures[index]);
        return withDuplicates && [0, 1, 7].includes(index)
          ? [source, { ...structuredClone(source), id: `${source.id}-duplicate` }]
          : [source];
      }),
    );
    for (let step = 0; step < 100; step++) {
      // The answer key checks every automatic association before giving any answer.
      for (const source of mogi.captures ?? [])
        source.nameAssociations?.forEach((association, row) => {
          if (!association.participantId) return;
          const reading = source.rows[row].text;
          const expected = spellings[reading] ?? reading;
          assert.equal(
            mogi.participants.find((person) => person.id === association.participantId)?.loungeName,
            expected,
            `Strong association: ${reading}`,
          );
        });
      const question = mogiQuestions(mogi)[0];
      if (!question || (!answerPositions && question.kind === "position")) break;
      const content = JSON.stringify([
        question.kind,
        question.captureId ?? question.raceId,
        question.row,
        question.reading,
      ]);
      if (seenIds.has(question.id) || seenContent.has(content)) {
        repeats.push(question.id);
        if (strict) assert.fail(`Repeated question: ${question.id} / ${content}`);
        break;
      }
      seenIds.add(question.id);
      seenContent.add(content);
      questions.push(question);
      counts[question.kind]++;
      const response = answer(mogi, question);
      mogi = (await normalizeReconstructions({ mogis: [await answerMogiQuestion(mogi, question.id, response)] }))
        .mogis[0];
      if (strict) await assert.rejects(() => answerMogiQuestion(mogi, question.id, response), /question changed/);
    }
    if (strict) assert.deepEqual(mogiQuestions(mogi), [], "The queue ends with no pending questions");
    // Both lobbies show the previous race; the last scoreboard closes R12.
    const completed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 12];
    if (strict) checkTotals(mogi, Math.max(...indices.map((index) => completed[index])));
  }
  return { mogi, counts, repeats, questions };
}

export const ffa = load("ffa-2026-11-02") as typeof raw & { afterRace8: Record<string, number> };
export function emptyFfaMogi(): Mogi {
  return {
    ...emptyRealMogi(),
    format: "FFA",
    teams: undefined,
    participants: ffa.roster.map((person) => ({ ...person, ign: person.loungeName, ignOrigin: "fallback" })),
  };
}
export function ffaReading(index: number, timed: boolean): (typeof raw.captures)[number] {
  const capture = structuredClone(ffa.captures[index]);
  return {
    ...capture,
    nameAssociations: undefined,
    numericAnswers: undefined,
    photoMoment: timed ? { at: 1793592257000 + index * 240000, source: "file-date" } : undefined,
    rows: capture.rows.map((row) => ({ ...row, suggestedParticipantId: undefined, uncertain: undefined })),
  };
}
