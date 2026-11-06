import assert from "node:assert/strict";
import { test } from "node:test";

import {
  answerNameQuestion,
  type Capture,
  type Mogi,
  mogiQuestions,
  nameAssociationsForCapture,
  reconcileSequence,
  unlinkSynonym,
} from "@mkw/engine";
import { matchRows } from "@mkw/engine/browser";

const roster = [
  "VSPeach",
  "Kameks Eye",
  "funk2006",
  "toad67",
  "Tavo",
  "KingBoo",
  "pom",
  "DonkeyKong",
  "PiranhaPlant",
  "BloopMaster",
  "ActuFunk",
  "iggy",
];
function ffa(readings: string[][], names = roster): Mogi {
  const mogi: Mogi = {
    id: "ffa",
    name: "FFA",
    createdAt: "",
    format: "FFA",
    teams: [],
    participants: names.map((loungeName, i) => ({ id: `p${i}`, loungeName, ign: loungeName, ignOrigin: "fallback" })),
    races: readings.map((_, i) => ({
      id: `r${i}`,
      number: i + 1,
      origin: "observed",
      status: "pending",
      placements: [],
    })),
    captures: [],
  };
  mogi.captures = readings.map((texts, i): Capture => ({
    id: `c${i}`,
    width: 1920,
    height: 1080,
    stage: "context",
    context: { phase: "after", raceId: `r${i}` },
    reviewedAt: "",
    reviewedPlacements: [],
    rows: texts.map((text) => ({ text, confidence: 90, uncertain: true, suggestedParticipantId: "" })),
  }));
  for (const capture of mogi.captures) capture.nameAssociations = nameAssociationsForCapture(mogi, capture);
  return mogi;
}

test("KRAFunk/KRJFunk/KRSFunk form one spelling and one answer resolves every variant (propagatedAssociation)", () => {
  const mogi = ffa(
    ["KRAFunk", "KRJFunk", "KRSFunk"].map((text) => [
      text,
      "???",
      ...roster.filter((name) => !["funk2006", "ActuFunk"].includes(name)),
    ]),
  );
  const questions = mogiQuestions(mogi).filter((q) => q.kind === "name" && q.reading.endsWith("Funk"));
  assert.equal(questions.length, 1);
  assert.ok(questions[0].kind === "name");
  assert.equal(questions[0].occurrences.length, 2);
  const answered = answerNameQuestion(mogi, questions[0].id, { participantId: "p2" });
  assert.deepEqual(
    answered.captures!.map((c) => c.nameAssociations![0].participantId),
    ["p2", "p2", "p2"],
  );
  assert.equal(mogiQuestions(answered).filter((q) => q.kind === "name").length, 0);
});

test("close variants never merge two rows of the same capture, not even through an intermediate variant", () => {
  const remaining = roster.filter((name) => !["funk2006", "ActuFunk"].includes(name));
  const mogi = ffa([
    ["KRAFunk", "KRJFunk", ...remaining],
    ["KRSFunk", "???", ...remaining],
  ]);
  const questions = mogiQuestions(mogi).filter((q) => q.kind === "name" && q.reading.endsWith("Funk"));
  assert.equal(questions.length, 2);
});

test("F☆ peepa/Fwpeepa and two edits in eight characters share questions; four characters don't", () => {
  for (const [first, second, count] of [
    ["F☆ peepa", "Fwpeepa", 1],
    ["Longplay", "Longp1ax", 1],
    ["ABCD", "ABCE", 2],
  ] as const) {
    const mogi = ffa(
      [first, second].map((text) => [
        text,
        "???",
        ...roster.filter((name) => !["funk2006", "ActuFunk"].includes(name)),
      ]),
    );
    assert.equal(mogiQuestions(mogi).filter((q) => q.kind === "name" && q.row === 1).length, count);
  }
});

test("the token Kamek anchors Vs Kamek to Kameks Eye as a deduction without a question (tokenCandidates)", () => {
  const mogi = ffa([["Vs Kamek", "???", ...roster.filter((name) => !["Kameks Eye", "iggy"].includes(name))]]);
  assert.equal(mogi.captures![0].nameAssociations![0].participantId, "p1");
  assert.equal(mogi.captures![0].nameAssociations![0].origin, "deduced");
  assert.equal(
    mogiQuestions(mogi).some((q) => q.kind === "name" && q.row === 1),
    false,
  );
});

test("a unique token anchors the row even when another token also appears in someone else (tokenCandidates)", () => {
  const names = roster.map((name) => (name === "iggy" ? "Eyebird" : name));
  const mogi = ffa(
    [["Vs Kamek.Eye", "???", ...names.filter((name) => !["Kameks Eye", "Eyebird"].includes(name))]],
    names,
  );
  assert.equal(mogi.captures![0].nameAssociations![0].participantId, "p1");
});

test("funk limits the question to the two matching people and keeps a suggestion between them (tokenCandidates)", () => {
  const mogi = ffa([
    ["KR♪Funk", "Funky", "???", ...roster.filter((name) => !["funk2006", "ActuFunk", "iggy"].includes(name))],
  ]);
  const question = mogiQuestions(mogi).find((q) => q.kind === "name" && q.row === 1);
  assert.ok(question?.kind === "name");
  assert.deepEqual(question.options.map((p) => p.loungeName).sort(), ["ActuFunk", "funk2006"]);
  assert.ok(question.options.some((p) => p.id === question.suggestion));
  assert.equal(mogi.captures![0].nameAssociations![0].participantId, null);
});

test("without positive evidence an FFA question doesn't preselect anyone", () => {
  const mogi = ffa([["Diddy.", "B·ω·", ...roster.filter((name) => !["pom", "PiranhaPlant"].includes(name))]]);
  const questions = mogiQuestions(mogi).filter((q) => q.kind === "name");
  assert.equal(questions.length, 2);
  assert.deepEqual(
    questions.map((q) => q.suggestion),
    [null, null],
  );
});

test("an incompatible assignment doesn't reuse the raw suggestion without evidence", () => {
  const mogi = ffa([["Vs Kamek", "Vs Kamek", ...roster.filter((name) => !["Kameks Eye", "iggy"].includes(name))]]);
  mogi.captures![0].rows[0].suggestedParticipantId = "p11";
  const question = mogiQuestions(mogi).find((q) => q.kind === "name" && q.row === 1);
  assert.ok(question?.kind === "name");
  assert.equal(question.suggestion, null);
});

test("the last free person in FFA is deduced after the answer and stays reviewable (exclusionRow)", () => {
  const mogi = ffa([["Diddy.", "B·ω·", ...roster.filter((name) => !["pom", "PiranhaPlant"].includes(name))]]);
  const question = mogiQuestions(mogi).find((q) => q.kind === "name")!;
  const answered = answerNameQuestion(mogi, question.id, { participantId: "p6" });
  assert.equal(answered.captures![0].nameAssociations![1].participantId, "p8");
  assert.equal(answered.captures![0].nameAssociations![1].origin, "deduced");
  assert.deepEqual(mogiQuestions(answered), []);
});

test("race 1 in FFA fills the permutation by row without depending on the unresolved names", () => {
  const mogi = ffa([["Diddy.", "B·ω·", ...roster.filter((name) => !["pom", "PiranhaPlant"].includes(name))]]);
  const capture = mogi.captures![0],
    points = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  capture.interpretation = {
    version: 1,
    screen: "finishOrderAdded",
    origin: "visual",
    positions: [],
    movementRows: [],
    reasons: [],
  };
  capture.numericRows = points.map((value, i) => {
    const right = {
      text: String(value),
      value,
      confidence: 99,
      uncertain: [6, 11].includes(i),
      location: { x: 1700, y: 50 + i * 77, width: 100, height: 56 },
    };
    return { row: i + 1, right, addition: { ...right, value: null, text: "", uncertain: true } };
  });
  const result = reconcileSequence(mogi);
  assert.ok(mogiQuestions(result).some((q) => q.kind === "name"));
  assert.deepEqual(
    mogiQuestions(result).filter((q) => q.kind === "points"),
    [],
  );
  assert.deepEqual(
    result.captures![0].numericDeductions?.map((d) => [d.row, d.value, d.origin]),
    [
      [7, 6, "deduced"],
      [12, 1, "deduced"],
    ],
  );
});

test("unlinking a deduced spelling reopens its variants without them proving the withdrawn link (withdrawnAssociation)", () => {
  const mogi = ffa(
    ["KRAFunk", "KRJFunk", "KRSFunk"].map((text) => [
      text,
      "???",
      ...roster.filter((name) => !["funk2006", "ActuFunk"].includes(name)),
    ]),
  );
  const answered = answerNameQuestion(mogi, mogiQuestions(mogi).find((q) => q.kind === "name")!.id, {
    participantId: "p2",
  });
  for (const capture of answered.captures!) capture.nameAssociations![0].origin = "deduced";
  const unlinked = reconcileSequence(unlinkSynonym(answered, "p2", "KRAFunk"));
  assert.deepEqual(
    unlinked.captures!.map((c) => c.nameAssociations![0].participantId),
    [null, null, null],
  );
  assert.equal(mogiQuestions(unlinked).filter((q) => q.kind === "name").length, 1);
});

test("a screen with fewer rows than the room still matches its names (matchRows)", () => {
  // A pre-race screen of a 3v3 showed 11 of 12 names; any shorter list used to read past the costs.
  const participants = Array.from({ length: 12 }, (_, n) => ({ id: `p${n}`, loungeName: `Player${n}` }));
  const rows = participants.slice(0, 10).map((person) => ({ text: person.loungeName, confidence: 100 }));
  assert.deepEqual(
    matchRows(rows, participants).map((row) => row.suggestedParticipantId),
    participants.slice(0, 10).map((person) => person.id),
  );
});
