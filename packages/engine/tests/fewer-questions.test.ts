import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  answerMogiQuestion,
  applyCaptureContext,
  type Capture,
  countedRaces,
  individualStandings,
  type Mogi,
  normalizeReconstructions,
  reconcileSequence,
} from "@mkw/engine";

import { questionsWithOverviewInvariant as mogiQuestions } from "./support/question-invariant.ts";

const base = JSON.parse(readFileSync(new URL("./fixtures/after-r6.json", import.meta.url), "utf8")) as Mogi;
const truth = JSON.parse(readFileSync(new URL("./fixtures/mogi-truth.json", import.meta.url), "utf8")) as {
  races: { race: number; placements: string[] }[];
};
const observations = JSON.parse(readFileSync(new URL("./fixtures/thirteen-captures.json", import.meta.url), "utf8"))
  .observations as Capture[];
const aliases: Record<string, string> = {
  "B·W.": "PiranhaPlant",
  "F☆peepa": "iggy",
  "VS Kamek": "Kameks Eye",
  "Diddy.": "pom",
  Bloop: "BloopMaster",
  KRSFunk: "funk2006",
  "KR√Funk": "funk2006",
  Funky: "ActuFunk",
  "B·ω.": "PiranhaPlant",
  "B-W.": "PiranhaPlant",
  CVSPeach: "VSPeach",
  "T KingBoo": "KingBoo",
  Ktoad67: "toad67",
  "F☆ peepa": "iggy",
};
function prefix(through: number): Mogi {
  return {
    ...structuredClone(base),
    captures: [],
    sequence: undefined,
    coverage: undefined,
    races: truth.races.slice(0, through).map((race) => ({
      id: `race-${race.race}`,
      number: race.race,
      origin: "manual",
      status: "confirmed",
      placements: race.placements.map((name) => base.participants.find((person) => person.loungeName === name)!.id),
    })),
  };
}
function source(number: number): Capture {
  const capture = structuredClone(number <= 6 ? base.captures![number - 1] : observations[number - 1]);
  delete capture.context;
  capture.stage = "context";
  capture.reviewedPlacements = [];
  capture.reviewedAt = "";
  if (number > 6)
    capture.nameAssociations = capture.rows.map((row) => ({
      participantId: base.participants.find((person) => person.loungeName === (aliases[row.text] ?? row.text))!.id,
    }));
  return capture;
}
function ingest(mogi: Mogi, capture: Capture) {
  return reconcileSequence(
    applyCaptureContext(mogi, capture, {
      placements: [],
      absentParticipantIds: [],
      reviewed: false,
      nameAssociations: capture.nameAssociations,
    }),
  );
}

test("real captures 03, 04, 05, 07 and lobby 11 use the cumulative sum for the next free race before resolving names", () => {
  for (const number of [3, 4, 5, 7, 11]) {
    const capture = source(number);
    capture.nameAssociations![0] = { participantId: null };
    capture.nameAssociations![1] = { participantId: null };
    const mogi = ingest(prefix(number - 1), capture);
    assert.equal(
      mogi.sequence!.occurrences.find((entry) => entry.captureIds.includes(capture.id))?.number,
      number,
      `capture ${number}`,
    );
    assert.equal(
      mogiQuestions(mogi).some((question) => question.kind === "race"),
      false,
      `capture ${number}`,
    );
  }
});

test("a continued vector numbers a capture while a majority drop asks about the new room", () => {
  for (const through of [1, 3]) {
    const capture = source(3);
    const mogi = ingest(prefix(through), capture);
    assert.equal(
      mogiQuestions(mogi).some((question) => question.kind === "race"),
      false,
    );
    assert.equal(mogi.sequence!.occurrences.find((entry) => entry.captureIds.includes(capture.id))?.number, 3);
    assert.equal(mogi.sequence?.conflict, undefined);
  }
  const capture = source(3);
  capture.numericRows![0].right.value!++;
  const pending = ingest(prefix(2), capture);
  assert.equal(
    mogiQuestions(pending).some((q) => q.kind === "race"),
    false,
  );
  assert.ok(mogiQuestions(pending).some((q) => q.kind === "points"));
  assert.ok(pending.sequence!.roomAnalysis!.conflicts.includes(capture.id));
});

test("incremental real captures 1 through 8 count without asking continuity", async () => {
  const cumulative = JSON.parse(readFileSync(new URL("./fixtures/cumulative.json", import.meta.url), "utf8")) as Record<
    string,
    number
  >[];
  let mogi = prefix(0);
  for (let number = 1; number <= 8; number++) {
    mogi = (await normalizeReconstructions({ mogis: [ingest(mogi, source(number))] })).mogis[0];
    const raceQuestion = mogiQuestions(mogi).find((question) => question.kind === "race");
    if (raceQuestion)
      mogi = (
        await normalizeReconstructions({
          mogis: [await answerMogiQuestion(mogi, raceQuestion.id, { kind: "race", value: number })],
        })
      ).mogis[0];
    assert.deepEqual(
      mogiQuestions(mogi).filter((question) => question.kind === "sequence"),
      [],
      `capture ${number}`,
    );
    if (number === 3 || number === 5 || number === 8) {
      const relation = mogi.sequence!.relations.find(
        (relation) =>
          relation.fromCaptureId === mogi.captures![number - 2].id &&
          relation.toCaptureId === mogi.captures![number - 1].id,
      );
      assert.equal(relation?.stableParticipantIds.length, 12, `capture ${number} preserves proven continuity`);
    }
    assert.deepEqual(
      countedRaces(mogi).map((race) => race.number),
      Array.from({ length: number }, (_, index) => index + 1),
    );
    assert.deepEqual(
      Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])),
      cumulative[number - 1],
    );
  }
});

test("the last eligible free name is recorded without a question and closes the real cumulative race", async () => {
  const capture = source(3),
    expected = capture.nameAssociations![11].participantId;
  capture.nameAssociations![11] = { participantId: null };
  const mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(2), capture)] })).mogis[0];
  assert.equal(mogi.captures![0].nameAssociations![11].participantId, expected);
  assert.equal(
    mogiQuestions(mogi).some((question) => question.kind === "name"),
    false,
  );
  assert.deepEqual(
    countedRaces(mogi).map((race) => race.number),
    [1, 2, 3],
  );
});

test("new spellings suggest the uniquely nearest eligible free IGN or synonym without recording an answer", () => {
  const funk = base.participants.find((person) => person.loungeName === "funk2006")!.id;
  const piranha = base.participants.find((person) => person.loungeName === "PiranhaPlant")!.id;
  for (const reading of ["KRJFunk", "KRSFunk", "ＫＲＳＦＵＮＫ"]) {
    const capture = source(3);
    const index = capture.nameAssociations!.findIndex((answer) => answer.participantId === funk);
    capture.nameAssociations = capture.nameAssociations!.map((answer) =>
      [funk, piranha].includes(answer.participantId!) ? { participantId: null } : answer,
    );
    capture.rows[index] = { ...capture.rows[index], text: reading, suggestedParticipantId: "" };
    const input = { ...prefix(2), format: "FFA" as const };
    input.participants = input.participants.map((person) => ({
      ...person,
      ign: person.loungeName,
      ignOrigin: "fallback",
    }));
    const mogi = ingest(input, capture);
    const question = mogiQuestions(mogi).find((question) => question.kind === "name" && question.row === index + 1);
    assert.ok(question?.kind === "name");
    assert.equal(question.suggestion, null, reading);
    assert.equal(mogi.captures![0].nameAssociations![index].participantId, null);
  }
  // The IGN may be far off: an already confirmed spelling also serves as a reference.
  const mogi = { ...prefix(2), format: "FFA" as const },
    known = source(1),
    capture = source(3);
  mogi.participants.find((person) => person.id === funk)!.ign = "different";
  known.nameAssociations![0] = { participantId: funk, ign: "KRJFunk" };
  known.nameAssociations = [known.nameAssociations![0]];
  known.rows = [known.rows[0]];
  mogi.captures = [known];
  const index = capture.nameAssociations!.findIndex((answer) => answer.participantId === funk);
  capture.nameAssociations![index] = { participantId: null };
  capture.nameAssociations![0] = { participantId: null };
  capture.rows[0].text = "Unclear";
  capture.rows[index].text = "KRSFunk";
  capture.rows[index].suggestedParticipantId = "";
  const resolved = ingest(mogi, capture);
  assert.equal(
    resolved.captures!.find((source) => source.id === capture.id)!.nameAssociations![index].participantId,
    funk,
  );
  assert.equal(
    mogiQuestions(resolved).some(
      (question) => question.kind === "name" && question.captureId === capture.id && question.row === index + 1,
    ),
    false,
  );
});

test("unfamiliar FFA spellings wait without a suggestion until elimination", () => {
  const piranha = base.participants.find((person) => person.loungeName === "PiranhaPlant")!.id;
  const funk = base.participants.find((person) => person.loungeName === "funk2006")!.id;
  for (const reading of ["B·W-", "B·ω-", "B·ω.", "B-W.", "B·W.", "farawayname"]) {
    const capture = source(3),
      index = capture.nameAssociations!.findIndex((answer) => answer.participantId === piranha);
    capture.nameAssociations = capture.nameAssociations!.map((answer) =>
      [piranha, funk].includes(answer.participantId!) ? { participantId: null } : answer,
    );
    capture.rows[index].text = reading;
    capture.rows[index].suggestedParticipantId = "";
    const input = { ...prefix(2), format: "FFA" as const };
    input.participants = input.participants.map((person) => ({
      ...person,
      ign: person.loungeName,
      ignOrigin: "fallback",
    }));
    const mogi = ingest(input, capture);
    const question = mogiQuestions(mogi).find((question) => question.kind === "name" && question.row === index + 1);
    assert.ok(question?.kind === "name");
    assert.equal(question.suggestion, null, reading);
    const remaining = mogi.captures![0];
    const funkRow = source(3).nameAssociations!.findIndex((answer) => answer.participantId === funk);
    remaining.nameAssociations![funkRow] = { participantId: funk };
    assert.equal(reconcileSequence(mogi).captures![0].nameAssociations![index].participantId, piranha);
  }
  const mogi = { ...prefix(2), format: "FFA" as const },
    capture = source(3);
  const index = capture.nameAssociations!.findIndex((answer) => answer.participantId === funk);
  capture.nameAssociations = capture.nameAssociations!.map((answer) =>
    [piranha, funk].includes(answer.participantId!) ? { participantId: null } : answer,
  );
  mogi.participants.find((person) => person.id === funk)!.ign = "KRJFunk";
  mogi.participants.find((person) => person.id === piranha)!.ign = "KRXFunk";
  capture.rows[index].text = "KRSFunk";
  capture.rows[index].suggestedParticipantId = funk;
  const question = mogiQuestions(ingest(mogi, capture)).find(
    (question) => question.kind === "name" && question.row === index + 1,
  );
  assert.ok(question?.kind === "name");
  assert.ok(question.options.some((option) => option.id === question.suggestion));
});

test("continuity calls a room reopening by its final English copy", () => {
  const mogi = prefix(0);
  mogi.captures = [source(1), source(3)].map((capture) => ({
    ...capture,
    numericRows: [
      {
        row: 1,
        right: { ...capture.numericRows![0].right, value: capture.id === source(1).id ? 100 : 1, uncertain: false },
        addition: { ...capture.numericRows![0].addition, value: null },
      },
    ],
  }));
  const question = mogiQuestions(reconcileSequence(mogi)).find((question) => question.kind === "sequence");
  assert.ok(question?.kind === "sequence");
  assert.ok(question.options.some((option) => option.label === "No, the room reopened"));
});

test("a new screenshot of an occupied anchor joins that occurrence without a question", async () => {
  const mogi = (await normalizeReconstructions({ mogis: [structuredClone(base)] })).mogis[0];
  const capture = { ...source(3), id: "new-capture-of-race-three" };
  const question = mogiQuestions(ingest(mogi, capture)).find(
    (question) => question.kind === "race" && question.captureId === capture.id,
  );
  assert.equal(question, undefined);
  const result = ingest(mogi, capture);
  assert.equal(result.sequence?.conflict, undefined);
  assert.ok(result.sequence?.occurrences.find((entry) => entry.number === 3)?.captureIds.includes(capture.id));
});

test("nearest-name suggestions exclude occupied identities and people outside the historical roster", () => {
  const funk = base.participants.find((person) => person.loungeName === "funk2006")!;
  const piranha = base.participants.find((person) => person.loungeName === "PiranhaPlant")!;
  for (const substituted of [false, true]) {
    const mogi = prefix(2),
      capture = source(3);
    const row = capture.nameAssociations!.findIndex((answer) => answer.participantId === piranha.id);
    capture.rows[row].text = "KRSFunk";
    capture.rows[row].suggestedParticipantId = "";
    capture.nameAssociations![row] = { participantId: null };
    capture.nameAssociations![0] = { participantId: null };
    if (substituted) {
      mogi.participants.push({
        id: "sub",
        slotId: funk.id,
        loungeName: "Incoming",
        ign: "Incoming",
        teamId: funk.teamId,
      });
      mogi.substitutions = [
        {
          id: "substitution",
          slotId: funk.id,
          outgoingParticipantId: funk.id,
          incomingParticipantId: "sub",
          fromRace: 3,
        },
      ];
      capture.nameAssociations = capture.nameAssociations!.map((answer) =>
        answer.participantId === funk.id ? { participantId: "sub" } : answer,
      );
    }
    const question = mogiQuestions(ingest(mogi, capture)).find(
      (question) => question.kind === "name" && question.row === row + 1,
    );
    assert.ok(question?.kind === "name");
    assert.equal(question.suggestion, null);
    assert.equal(
      question.options.some((option) => option.id === funk.id),
      false,
    );
  }
});

test("a name placed on an unread row saves with no spelling to learn", () => {
  const mogi = prefix(6);
  const capture = source(6);
  capture.rows[0] = { ...capture.rows[0], text: "" };
  capture.nameAssociations = capture.rows.map((row, index) => ({
    participantId: mogi.races[5].placements[index],
    ign: row.text.trim(),
  }));
  const person = mogi.participants.find((entry) => entry.id === mogi.races[5].placements[0])!;
  person.ignOrigin = "fallback";
  const saved = applyCaptureContext(
    mogi,
    capture,
    {
      placements: [],
      absentParticipantIds: [],
      reviewed: false,
      nameAssociations: capture.nameAssociations,
    },
    "race-6",
  );
  assert.equal(saved.participants.find((entry) => entry.id === person.id)!.ignOrigin, "fallback");
});
