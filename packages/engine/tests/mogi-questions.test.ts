import assert from "node:assert/strict";
import { test } from "node:test";

import {
  answerMogiQuestion,
  answerNameQuestion,
  assistanceTargets,
  type Capture,
  changeIgn,
  changePositionFact,
  type Mogi,
  mogiOverview,
  nameAssociationsForCapture,
  normalizeReconstructions,
  participantsForRace,
  participantSynonyms,
  reconcileSequence,
  registerSubstitution,
  resultCoverage,
  setAssistanceAnalysis,
  solveAssistance,
  sourcePairSignature,
  unlinkSynonym,
} from "@mkw/engine";

import { inferenceFixture } from "./support/mogi.ts";
import { questionsWithOverviewInvariant as mogiQuestions } from "./support/question-invariant.ts";

const participants = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`,
  loungeName: `Player ${i}`,
  ign: `Player ${i}`,
  ignOrigin: "fallback" as const,
}));
function capture(id: string, raceId: string): Capture {
  return {
    id,
    width: 1920,
    height: 1080,
    stage: "context",
    context: { phase: "after", raceId },
    reviewedAt: "",
    reviewedPlacements: [],
    rows: participants.map((p, i) => ({
      text: i < 2 ? `Read ${i}` : p.ign,
      confidence: 90,
      uncertain: i < 2,
      suggestedParticipantId: p.id,
      location: { x: 1100, y: 80 + i * 76, width: 400, height: 70 },
    })),
    nameAssociations: participants.map((p, i) => ({ participantId: i < 2 ? null : p.id })),
  };
}
function fixture(): Mogi {
  return {
    id: "m",
    name: "Mogi",
    format: "FFA",
    createdAt: "2026-10-28",
    participants,
    races: [1, 2].map((n) => ({
      id: `r${n}`,
      number: n,
      origin: "observed",
      status: "pending",
      placements: [],
      captureIds: [`c${n}`],
    })),
    captures: [capture("c2", "r2"), capture("c1", "r1")],
  };
}

function repeatedSpellingFixture(): Mogi {
  const mogi = fixture();
  mogi.races = [{ ...mogi.races[0], captureIds: ["c1", "c2", "c3"] }];
  mogi.captures = ["c1", "c2", "c3"].map((id) => {
    const source = capture(id, "r1");
    source.rows[0].text = "Ktoad67";
    return source;
  });
  mogi.captures[1].nameAssociations![1] = { participantId: "p1" };
  return mogi;
}

test("the same spelling shares one question across three captures with different available options", () => {
  const questions = mogiQuestions(repeatedSpellingFixture())
    .filter((q) => q.kind === "name")
    .filter((q) => q.reading === "Ktoad67");
  assert.equal(questions.length, 1);
  assert.equal(questions[0].captureId, "c1");
  assert.deepEqual(
    questions[0].options.map((person) => person.id),
    ["p0", "p1"],
  );
  assert.deepEqual(questions[0].occurrences, [
    { captureId: "c2", row: 1, number: 1 },
    { captureId: "c3", row: 1, number: 1 },
  ]);
});

test("answering a grouped spelling resolves free captures and leaves an occupied capture's own question", () => {
  const mogi = repeatedSpellingFixture();
  mogi.captures![2].nameAssociations![1] = { participantId: "p0" };
  mogi.captures![2].nameAssociations![2] = { participantId: null };
  mogi.captures![2].rows[2].text = "Third unresolved";
  const before = structuredClone(mogi);
  const question = mogiQuestions(mogi)
    .filter((q) => q.kind === "name")
    .find((q) => q.reading === "Ktoad67")!;
  assert.deepEqual(question.occurrences, [
    { captureId: "c2", row: 1, number: 1 },
    { captureId: "c3", row: 1, number: 1 },
  ]);
  const answered = answerNameQuestion(mogi, question.id, { participantId: "p0" });
  assert.deepEqual(
    answered.captures!.map((source) => source.nameAssociations![0]),
    [{ participantId: "p0", ign: "Ktoad67" }, { participantId: "p0", ign: "Ktoad67" }, { participantId: null }],
  );
  assert.equal(answered.captures![2].nameAssociations![1].participantId, "p0");
  const remaining = mogiQuestions(answered)
    .filter((q) => q.kind === "name")
    .filter((q) => q.reading === "Ktoad67");
  assert.deepEqual(
    remaining.map((q) => [q.captureId, q.row, q.options.map((person) => person.id), q.occurrences]),
    [["c3", 1, ["p1", "p2"], []]],
  );
  assert.deepEqual(mogi, before);
});

test("seven captures of twelve unresolved spellings ask twelve questions and one answer resolves seven rows", () => {
  const mogi = fixture();
  mogi.races = [{ ...mogi.races[0], captureIds: Array.from({ length: 7 }, (_, i) => `c${i + 1}`) }];
  mogi.captures = mogi.races[0].captureIds!.map((id) => {
    const source = capture(id, "r1");
    source.rows = source.rows.map((row, i) => ({
      ...row,
      text: i === 0 ? "Ktoad67" : `Unknown ${i}`,
      uncertain: true,
    }));
    source.nameAssociations = participants.map(() => ({ participantId: null }));
    return source;
  });
  const before = structuredClone(mogi);
  const questions = mogiQuestions(mogi).filter((q) => q.kind === "name");
  assert.equal(questions.length, 12);
  assert.equal(questions[0].captureId, "c1");
  assert.deepEqual(
    questions[0].occurrences,
    [2, 3, 4, 5, 6, 7].map((n) => ({ captureId: `c${n}`, row: 1, number: 1 })),
  );
  assert.deepEqual(
    mogiQuestions({ ...mogi, captures: [...mogi.captures].reverse() }).map((q) => q.id),
    questions.map((q) => q.id),
  );
  assert.deepEqual(mogiOverview(mogi).action, { kind: "questions", count: 12 });
  assert.equal(mogiOverview(mogi).positions[0].questionCount, 12);
  const answered = answerNameQuestion(mogi, questions[0].id, { participantId: "p0" });
  assert.deepEqual(
    answered.captures!.map((source) => source.nameAssociations![0]),
    Array.from({ length: 7 }, () => ({ participantId: "p0", ign: "Ktoad67" })),
  );
  assert.equal(mogiQuestions(answered).filter((q) => q.kind === "name").length, 11);
  assert.deepEqual(mogiOverview(answered).action, { kind: "questions", count: 11 });
  assert.equal(mogiOverview(answered).positions[0].questionCount, 11);
  assert.deepEqual(mogi, before);
});

test("name questions follow race then source row, with stable IDs, plausible choices and a crop reference", () => {
  const mogi = fixture(),
    before = structuredClone(mogi);
  const questions = mogiQuestions(mogi).filter((q) => q.kind === "name");
  assert.deepEqual(
    questions.map((q) => [q.number, q.row, q.reading]),
    [
      [1, 1, "Read 0"],
      [1, 2, "Read 1"],
    ],
  );
  assert.deepEqual(questions[0].occurrences, [{ captureId: "c2", row: 1, number: 2 }]);
  assert.deepEqual(
    questions[0].options.map((p) => p.id),
    ["p0", "p1"],
  );
  assert.equal(questions[0].suggestion, null);
  assert.deepEqual(questions[0].crop, { captureId: "c1", location: { x: 1100, y: 80, width: 400, height: 70 } });
  assert.deepEqual(
    mogiQuestions({ ...mogi, captures: [...mogi.captures!].reverse() }).map((q) => q.id),
    questions.map((q) => q.id),
  );
  assert.deepEqual(mogi, before);
});

test("an answer resolves every grouped occurrence even when that spelling has conflicting past confirmations", () => {
  const mogi = fixture();
  const [c2, c1] = mogi.captures!;
  c1.rows[0].text = "Twin";
  c1.nameAssociations![0] = { participantId: "p0", ign: "Twin" };
  c2.rows[1].text = "Twin";
  c2.nameAssociations![1] = { participantId: "p1", ign: "Twin" };
  mogi.captures!.push(
    ...["c3", "c4"].map((id) => {
      const source = capture(id, "r2");
      source.rows[0].text = "Twin";
      return source;
    }),
  );
  const question = mogiQuestions(mogi).find((q) => q.kind === "name" && q.captureId === "c3")!;
  const answered = answerNameQuestion(mogi, question.id, { participantId: "p0" });
  assert.deepEqual(
    answered.captures!.slice(2).map((source) => source.nameAssociations![0]),
    [
      { participantId: "p0", ign: "Twin" },
      { participantId: "p0", ign: "Twin" },
    ],
  );
});

test("the header counts grouped names once while each affected race shows its grouped questions", () => {
  const overview = mogiOverview(fixture());
  assert.deepEqual(overview.action, { kind: "questions", count: 2 });
  assert.deepEqual(
    overview.positions.slice(0, 2).map((position) => position.questionCount),
    [2, 2],
  );
});

test("a grouped spelling stays separate across eligibility boundaries and leaves occupied rows unanswered", () => {
  const mogi = fixture();
  mogi.participants = [...participants, { id: "sub", slotId: "p0", loungeName: "Sub", ign: "Sub" }];
  mogi.substitutions = [
    { id: "substitution", slotId: "p0", outgoingParticipantId: "p0", incomingParticipantId: "sub", fromRace: 2 },
  ];
  const blocked = capture("c3", "r1");
  blocked.rows[1].text = "Other reading";
  blocked.nameAssociations![1] = { participantId: "p0" };
  blocked.nameAssociations![2] = { participantId: null };
  blocked.rows[2].text = "Third unresolved";
  mogi.captures!.push(blocked);
  const questions = mogiQuestions(mogi)
    .filter((q) => q.kind === "name")
    .filter((q) => q.reading === "Read 0");
  assert.deepEqual(
    questions.map((q) => [q.captureId, q.options.map((person) => person.id)]),
    [
      ["c1", ["p0", "p1"]],
      ["c2", ["sub", "p1"]],
    ],
  );
  assert.deepEqual(
    questions.map((q) => q.occurrences),
    [[{ captureId: "c3", row: 1, number: 1 }], []],
  );
  const answered = answerNameQuestion(mogi, questions[0].id, { participantId: "p0" });
  assert.deepEqual(
    mogiQuestions(answered)
      .filter((q) => q.kind === "name" && q.reading === "Read 0")
      .map((q) => q.captureId),
    ["c3", "c2"],
  );
  assert.equal(answered.captures!.find((source) => source.id === "c3")!.nameAssociations![0].participantId, null);
  assert.equal(answered.captures!.find((source) => source.id === "c3")!.nameAssociations![1].participantId, "p0");
  assert.equal(answered.captures!.find((source) => source.id === "c2")!.nameAssociations![0].participantId, null);
});

test("duplicate spellings in one capture keep a question per row and never join another capture's group", () => {
  const mogi = fixture();
  const duplicate = mogi.captures![0];
  duplicate.rows[1].text = " READ 0 ";
  const questions = mogiQuestions(mogi).filter((q) => q.kind === "name");
  assert.equal(questions.length, 4);
  assert.ok(questions.every((q) => q.occurrences.length === 0));
  const first = answerNameQuestion(mogi, questions[0].id, { participantId: "p0" });
  assert.deepEqual(first.captures![0].nameAssociations!.slice(0, 2), [
    { participantId: null },
    { participantId: null },
  ]);
  const own = mogiQuestions(first).find((q) => q.kind === "name" && q.captureId === duplicate.id && q.row === 1)!;
  const answered = answerNameQuestion(first, own.id, { participantId: "p0" });
  const remaining = mogiQuestions(answered)
    .filter((q) => q.kind === "name")
    .filter((q) => q.captureId === duplicate.id);
  assert.deepEqual(remaining, []);
  assert.equal(answered.captures![0].nameAssociations![1].participantId, "p1");
});

test("grouping uses normalized spelling and queue order while empty readings stay local", () => {
  const mogi = fixture();
  mogi.captures![0].rows[0].text = " ＲＥＡＤ ０ ";
  mogi.captures![0].rows[1].text = " ";
  mogi.captures![1].rows[1].text = "";
  const questions = mogiQuestions(mogi).filter((q) => q.kind === "name");
  assert.equal(questions.length, 3);
  assert.equal(questions[0].captureId, "c1");
  assert.deepEqual(questions[0].occurrences, [{ captureId: "c2", row: 1, number: 2 }]);
  const answered = answerNameQuestion(mogi, questions[0].id, { participantId: "p0" });
  assert.equal(answered.captures![0].nameAssociations![0].ign, "ＲＥＡＤ ０");
  assert.deepEqual(
    mogiQuestions(answered).filter((q) => q.kind === "name"),
    [],
  );
  assert.ok(answered.captures!.every((source) => source.nameAssociations![1].participantId === "p1"));
});

test("different eligible rosters stay separate even when their remaining available options coincide", () => {
  const mogi = fixture();
  mogi.participants = [...participants, { id: "sub", slotId: "p2", loungeName: "Sub", ign: "Sub" }];
  mogi.substitutions = [
    { id: "substitution", slotId: "p2", outgoingParticipantId: "p2", incomingParticipantId: "sub", fromRace: 2 },
  ];
  mogi.captures![0].nameAssociations![2] = { participantId: "sub" };
  const questions = mogiQuestions(mogi)
    .filter((q) => q.kind === "name")
    .filter((q) => q.reading === "Read 0");
  assert.deepEqual(
    questions.map((q) => q.captureId),
    ["c1", "c2"],
  );
  assert.ok(questions.every((q) => q.occurrences.length === 0));
});

test("unreadable points join names in race and row order without replacing the reading", () => {
  const mogi = fixture();
  const source = mogi.captures![1];
  source.interpretation = {
    version: 1,
    screen: "finishOrderAdded",
    origin: "visual",
    positions: [],
    movementRows: [],
    reasons: [],
  };
  const reading = {
    text: "?",
    value: 15,
    confidence: 20,
    uncertain: true,
    location: { x: 1115, y: 48, width: 65, height: 58 },
  };
  source.numericRows = [{ row: 1, right: reading, addition: reading }];
  const questions = mogiQuestions(mogi);
  assert.deepEqual(
    questions.map((q) => [q.kind, q.number, q.row]),
    [
      ["name", 1, 1],
      ["points", 1, 1],
      ["name", 1, 2],
    ],
  );
  const points = questions.find((q) => q.kind === "points")!;
  assert.equal(points.suggestion, 15);
  assert.equal(points.reading, "Read 0");
  assert.deepEqual(points.crop!.location, source.rows[0].location);
  source.numericAnswers = [{ row: 1, field: "right", value: 16 }];
  assert.equal(
    mogiQuestions(mogi).some((q) => q.kind === "points"),
    false,
  );
  assert.equal(source.numericRows[0].right.text, "?");
});

test("unknown race questions follow numbered sources and precede names, offering free races", () => {
  const mogi = fixture();
  const unknown = capture("unknown", "");
  mogi.captures!.unshift(unknown);
  mogi.races.push({ id: "gap", number: 3, origin: "manual", status: "pending", placements: [] });
  const questions = mogiQuestions(mogi);
  assert.deepEqual(
    questions.map((q) => q.kind),
    ["name", "name", "race"],
  );
  const race = questions.find((q) => q.kind === "race")!;
  assert.equal(race.row, 0);
  assert.equal(race.number, undefined);
  assert.deepEqual(
    race.options.map((option) => option.value),
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(race.suggestion, 3);
  assert.deepEqual(race.crop, { captureId: "unknown" });
});

test("the header counts an unknown capture's actionable queue once", () => {
  const mogi = fixture();
  mogi.captures = [capture("unknown", "")];
  assert.deepEqual(mogiOverview(mogi).action, { kind: "questions", count: 3 });
  // Pending races without pages of their own add no questions.
});

test("cumulative evidence deduces a reversed batch without asking its race numbers", () => {
  const mogi = fixture();
  const gain = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  mogi.races = [];
  mogi.captures = [2, 1].map((n) => {
    const source = capture(`c${n}`, "");
    source.nameAssociations = participants.map((p) => ({ participantId: p.id }));
    source.interpretation = {
      version: 1,
      screen: "finishOrderAdded",
      origin: "visual",
      positions: [],
      movementRows: [],
      reasons: [],
    };
    const reading = (value: number) => ({
      text: String(value),
      value,
      confidence: 99,
      uncertain: false,
      location: { x: 1, y: 1, width: 1, height: 1 },
    });
    source.numericRows = gain.map((value, i) => ({ row: i + 1, right: reading(value * n), addition: reading(value) }));
    return source;
  });
  const first = mogi.captures[1];
  mogi.sequence = {
    version: 1,
    numbers: [],
    links: [],
    occurrences: [],
    relations: [],
    gaps: [],
    inputSignature: "",
    origins: [{ captureId: first.id, signature: sourcePairSignature(first, first), answer: "zero-valid-12" }],
  };
  const reconciled = reconcileSequence(mogi);
  assert.deepEqual(reconciled.sequence!.occurrences.map((o) => o.number).sort(), [1, 2]);
  assert.equal(
    mogiQuestions(reconciled).some((q) => q.kind === "race"),
    false,
  );
});

test("the question queue disables full teams and suggests a teammate's team; missing teams follow source row order (teamChoices)", () => {
  const mogi = fixture();
  mogi.format = "2v2";
  mogi.teams = Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: `Team ${i + 1}` }));
  mogi.participants = participants.map((p, i) => ({ ...p, teamId: i === 2 ? undefined : String(Math.floor(i / 2)) }));
  const questions = mogiQuestions(mogi);
  assert.deepEqual(
    questions.map((q) => [q.kind, q.number, q.row]),
    [
      ["name", 1, 1],
      ["team", 1, 3],
    ],
  );
  const team = questions.find((q) => q.kind === "team")!;
  assert.equal(team.participantId, "p2");
  assert.equal(team.suggestion, "1");
  assert.deepEqual(
    team.options.map((option) => option.value),
    ["0", "1", "2", "3", "4", "5"],
  );
  assert.equal(team.options[0].disabled, true);
  assert.equal(team.options[1].disabled, false);
  const withoutCaptures = mogiQuestions({ ...mogi, captures: [] });
  assert.deepEqual(
    withoutCaptures.map((q) => q.kind),
    ["team"],
  );
  assert.equal(withoutCaptures[0].crop, undefined);
});

test("a substitute keeps the bot-list team even when another team has a vacancy", async () => {
  const mogi = fixture();
  mogi.format = "2v2";
  mogi.teams = Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: `Team ${i + 1}` }));
  mogi.participants = participants.map((p, i) => ({ ...p, teamId: String(Math.floor(i / 2)) }));
  mogi.participants.push({ id: "sub", loungeName: "Sub", ign: "Sub", ignOrigin: "fallback", slotId: "p0" });
  mogi.participants[2].teamId = undefined;
  const question = mogiQuestions({ ...mogi, captures: [] })
    .filter((q) => q.kind === "team")
    .find((q) => q.participantId === "sub");
  assert.equal(question?.suggestion, "0");
  assert.equal(question?.options.find((option) => option.value === "1")?.disabled, true);
  const answered = await answerMogiQuestion(mogi, question!.id, { kind: "team", value: "0" });
  assert.equal(answered.participants.at(-1)!.teamId, "0");
});

test("known-position questions use free places and sort before later capture rows", async () => {
  const input = inferenceFixture(12, 4, [57, 51, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4]);
  let mogi = setAssistanceAnalysis(input, await solveAssistance(input, assistanceTargets(input), []));
  const source = capture("later", "last");
  source.context = { phase: "after", raceId: mogi.races.at(-1)!.id };
  mogi.captures = [source];
  const questions = mogiQuestions(mogi);
  assert.equal(questions[0].kind, "position");
  const position = questions.find((q) => q.kind === "position")!;
  assert.deepEqual(mogiOverview(mogi).action, { kind: "questions", count: questions.length });
  assert.equal(position.number, 2);
  assert.equal(position.reading, "Player 1");
  assert.equal(position.suggestion, 1);
  assert.deepEqual(
    position.options.map((option) => option.value),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, "absent"],
  );
  mogi = changePositionFact(mogi, { raceId: position.raceId!, participantId: position.participantId, position: 3 });
  const next = mogiQuestions(mogi).find((q) => q.kind === "position");
  assert.ok(!next || !next.options.some((option) => option.value === 3));
});

test("queue answers persist existing numeric, sequence, team and position facts and reject stale choices", async () => {
  let mogi = fixture();
  const source = mogi.captures![1];
  source.interpretation = {
    version: 1,
    screen: "finishOrderAdded",
    origin: "visual",
    positions: [],
    movementRows: [],
    reasons: [],
  };
  const reading = {
    text: "?",
    value: null,
    confidence: 20,
    uncertain: true,
    location: { x: 1, y: 1, width: 1, height: 1 },
  };
  source.numericRows = [{ row: 3, right: reading, addition: reading }];
  mogi = await answerMogiQuestion(mogi, "points:c1:3", { kind: "points", value: 42 });
  assert.deepEqual(mogi.captures![1].numericAnswers, [{ row: 3, field: "right", value: 42 }]);
  assert.equal(mogi.captures![1].numericRows![0].right.value, null);
  await assert.rejects(() => answerMogiQuestion(mogi, "points:c1:3", { kind: "points", value: 43 }));
  mogi.captures!.push(capture("unknown", ""));
  mogi = await answerMogiQuestion(mogi, "race:unknown", { kind: "race", value: 3 });
  assert.equal(mogi.sequence!.numbers.find((fact) => fact.captureId === "unknown")!.number, 3);
  mogi.format = "2v2";
  mogi.teams = [{ id: "a", name: "Team 1" }];
  mogi = await answerMogiQuestion(mogi, "team:p2", { kind: "team", value: "a" });
  assert.equal(mogi.participants[2].teamId, "a");
  const input = inferenceFixture(12, 4, [57, 51, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4]);
  const pending = setAssistanceAnalysis(input, await solveAssistance(input, assistanceTargets(input), []));
  const position = mogiQuestions(pending).find((q) => q.kind === "position")!;
  const answered = await answerMogiQuestion(pending, position.id, { kind: "position", value: 1 });
  assert.equal(answered.assistance!.facts[0].position, 1);
  assert.equal(answered.assistance!.analysis!.status, "unique");
});

test("answering points cannot confirm a legacy finish order with unresolved names", async () => {
  const mogi = fixture();
  const source = mogi.captures![1];
  delete source.context;
  source.stage = "finish-order-confirmed";
  source.interpretation = {
    version: 1,
    screen: "finishOrderAdded",
    origin: "visual",
    positions: [],
    movementRows: [],
    reasons: [],
  };
  const reading = {
    text: "?",
    value: null,
    confidence: 20,
    uncertain: true,
    location: { x: 1, y: 1, width: 1, height: 1 },
  };
  source.numericRows = [{ row: 1, right: reading, addition: reading }];
  const answered = await answerMogiQuestion(mogi, "points:c1:1", { kind: "points", value: 15 });
  assert.equal(answered.races[0].status, "pending");
  assert.deepEqual(answered.races[0].placements, []);
  assert.deepEqual(answered.captures![1].numericAnswers, [{ row: 1, field: "right", value: 15 }]);
});

test("sequence questions precede their source rows and a current continuity fact is not asked again", async () => {
  const input = fixture();
  input.captures!.forEach((source) => {
    source.nameAssociations = participants.map((person) => ({ participantId: person.id }));
    source.interpretation = {
      version: 1,
      screen: "finishOrderAdded",
      origin: "visual",
      positions: [],
      movementRows: [],
      reasons: [],
    };
    const value = source.id === "c1" ? 100 : 99;
    const reading = {
      text: String(value),
      value,
      confidence: 100,
      uncertain: false,
      location: { x: 0, y: 0, width: 1, height: 1 },
    };
    source.numericRows = [{ row: 1, right: reading, addition: { ...reading, text: "", value: null, uncertain: true } }];
  });
  const mogi = reconcileSequence(input);
  const question = mogiQuestions(mogi).find((question) => question.kind === "sequence")!;
  assert.equal(question.number, 1);
  assert.equal(question.row, 0);
  const answered = reconcileSequence(
    await answerMogiQuestion(mogi, question.id, { kind: "sequence", value: "continuous-12" }),
  );
  assert.equal(answered.sequence!.links[0].continuity, "continuous-12");
  assert.equal(
    mogiQuestions(answered).some((entry) => entry.id === question.id),
    false,
  );
});

test("answering preserves unrelated sources and a substitute only occupies the slot from this race", () => {
  const mogi = fixture();
  mogi.captures![1].rows[0].text = "Earlier player";
  mogi.captures![1].rows[1].text = "Another earlier player";
  mogi.captures![1].nameAssociations = undefined;
  mogi.captures![1].rows[2] = { ...mogi.captures![1].rows[2], text: "Unrelated", uncertain: true };
  const earlier = structuredClone(mogi.captures![1]);
  const answered = answerNameQuestion(mogi, "name:c2:1", {
    substitute: { loungeName: "New player", replacedParticipantId: "p0" },
  });
  assert.deepEqual(answered.captures![1], earlier);
  assert.equal(participantsForRace(answered, 1)[0].id, "p0");
  assert.equal(participantsForRace(answered, 2)[0].loungeName, "New player");
  assert.equal(answered.substitutions![0].fromRace, 2);
  assert.equal(
    answered.captures![0].nameAssociations![0].participantId,
    answered.substitutions![0].incomingParticipantId,
  );
});

test("the final name answer lets an established finish order count through the existing normalization", async () => {
  let mogi = fixture();
  mogi = { ...mogi, races: mogi.races.slice(0, 1), captures: [mogi.captures![1]] };
  mogi.captures![0].interpretation = {
    version: 1,
    screen: "finishOrderAdded",
    origin: "visual",
    positions: [],
    movementRows: [],
    reasons: [],
  };
  mogi.captures![0].nameAssociations![1] = { participantId: "p1" };
  const answered = answerNameQuestion(mogi, "name:c1:1", { participantId: "p0" });
  const normalized = (await normalizeReconstructions({ mogis: [answered] })).mogis[0];
  assert.equal(mogiQuestions(normalized).length, 0);
  assert.deepEqual(resultCoverage(normalized).included, [1]);
});

test("an answer resolves that spelling across the mogi and future captures without changing OCR or explicit IGNs", () => {
  const mogi = fixture();
  mogi.participants = participants.map((p) => ({ ...p, ignOrigin: "explicit" }));
  const answered = answerNameQuestion(mogi, mogiQuestions(mogi)[0].id, { participantId: "p0" });
  assert.deepEqual(
    mogiQuestions(answered)
      .filter((q) => q.kind === "name")
      .map((q) => q.reading),
    [],
  );
  assert.equal(answered.captures![0].nameAssociations![0].ign, "Read 0");
  assert.equal(answered.captures![0].rows[0].uncertain, true);
  assert.equal(answered.participants[0].ign, "Player 0");
  assert.equal(nameAssociationsForCapture(answered, capture("future", "r2"))[0].participantId, "p0");
  assert.equal(mogiQuestions(mogi).length, 2);
  assert.throws(() => answerNameQuestion(answered, "name:c1:1", { participantId: "p1" }));
});

test("a confirmed spelling becomes a synonym of that participant only", () => {
  const answered = answerNameQuestion(fixture(), "name:c1:1", { participantId: "p0" });
  assert.deepEqual(participantSynonyms(answered, "p0"), ["Read 0"]);
  // Readings recognition resolved on its own are not confirmed synonyms.
  assert.deepEqual(participantSynonyms(answered, "p2"), []);
  assert.equal(answered.captures![0].nameAssociations![0].participantId, "p0");
});

test("a spelling confirmed for two participants does not propagate on its own", () => {
  const mogi = fixture();
  mogi.races.push({ id: "r3", number: 3, origin: "observed", status: "pending", placements: [], captureIds: ["c3"] });
  mogi.captures!.push(capture("c3", "r3"));
  const [c2, c1, c3] = mogi.captures!;
  c1.rows[0].text = "Twin";
  c1.nameAssociations![0] = { participantId: "p0", ign: "Twin" };
  c2.rows[1].text = "Twin";
  c2.nameAssociations![1] = { participantId: "p1", ign: "Twin" };
  c3.rows[0].text = "Twin";
  for (const source of [c2, c3]) {
    source.nameAssociations![2] = { participantId: null };
    source.rows[2].text = "Third unresolved";
  }
  const answered = answerNameQuestion(mogi, "name:c1:2", { participantId: "p1" });
  assert.deepEqual(
    mogiQuestions(answered)
      .filter((q) => q.kind === "name" && q.row !== 3)
      .map((q) => [q.number, q.reading]),
    [
      [2, "Read 0"],
      [3, "Twin"],
    ],
  );
  assert.equal(
    nameAssociationsForCapture(answered, {
      ...capture("future", "r3"),
      nameAssociations: undefined,
      rows: c3.rows.map((row, index) => ({ ...row, uncertain: index === 2 || row.uncertain })),
    })[0].participantId,
    null,
  );
  assert.deepEqual(participantSynonyms(answered, "p0"), ["Twin"]);
  assert.deepEqual(participantSynonyms(answered, "p1"), ["Read 1", "Twin"]);
});

test("a substitution keeps a spelling from reaching the other player's races", () => {
  const mogi = fixture();
  mogi.participants = [...participants, { id: "sub", slotId: "p2", loungeName: "Sub", ign: "Sub" }];
  mogi.substitutions = [
    { id: "substitution", slotId: "p2", outgoingParticipantId: "p2", incomingParticipantId: "sub", fromRace: 2 },
  ];
  mogi.captures![0].nameAssociations![2] = { participantId: "sub" };
  for (const source of mogi.captures!) {
    source.nameAssociations![3] = { participantId: null };
    source.rows[3].text = "Third unresolved";
  }
  const answered = answerNameQuestion(mogi, "name:c2:1", {
    substitute: { loungeName: "New player", replacedParticipantId: "p0" },
  });
  const incoming = answered.substitutions!.at(-1)!.incomingParticipantId;
  assert.deepEqual(
    mogiQuestions(answered)
      .filter((q) => q.kind === "name" && q.row <= 2)
      .map((q) => [q.number, q.reading]),
    [
      [1, "Read 0"],
      [1, "Read 1"],
      [2, "Read 1"],
    ],
  );
  assert.deepEqual(participantSynonyms(answered, incoming), ["Read 0"]);
  assert.deepEqual(participantSynonyms(answered, "p0"), []);
  assert.equal(nameAssociationsForCapture(answered, capture("future", "r2"))[0].participantId, incoming);
  assert.equal(
    nameAssociationsForCapture(answered, {
      ...capture("future", "r1"),
      nameAssociations: participants.map((person, index) => ({
        participantId: index < 2 || index === 3 ? null : person.id,
      })),
    })[0].participantId,
    null,
  );
});

test("links and reviews left by a race-1 sub move to the sub on load, and race 12 still counts", async () => {
  // Twelve pre-race screenshots and the final standings; the three without a race still name the original.
  const order = (race: number) => participants.map((_, i) => participants[(i * 5 + race * 7) % 12].id);
  const totals = [Object.fromEntries(participants.map((person) => [person.id, 0]))];
  for (let race = 0; race < 12; race++)
    totals.push(
      Object.fromEntries(
        participants.map((person) => [
          person.id,
          totals[race][person.id] + [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1][order(race).indexOf(person.id)],
        ]),
      ),
    );
  const screenshot = (id: string, after: number, stale: boolean): Capture => {
    const ranked = [...participants].sort(
      (a, b) => totals[after][b.id] - totals[after][a.id] || a.id.localeCompare(b.id),
    );
    const reading = (person: (typeof participants)[number]) =>
      person.id === "p11" ? (stale ? "Kmk" : "Chomp") : person.ign;
    return {
      id,
      width: 1920,
      height: 1080,
      stage: "context",
      reviewedAt: "",
      reviewedPlacements: [],
      context: { phase: id === "final" ? "event-final" : "before" },
      rows: ranked.map((person) => ({
        text: reading(person),
        confidence: 100,
        uncertain: false,
        suggestedParticipantId: person.id,
      })),
      nameAssociations: ranked.map((person) => ({ participantId: person.id, ign: reading(person) })),
      numericRows: ranked.map((person, n) => ({
        row: n + 1,
        right: {
          text: "",
          value: totals[after][person.id],
          confidence: 100,
          uncertain: false,
          location: { x: 0, y: 0, width: 1, height: 1 },
        },
        addition: {
          text: "",
          value: null,
          confidence: 0,
          uncertain: true,
          location: { x: 0, y: 0, width: 1, height: 1 },
        },
      })),
      interpretation: {
        version: 1,
        screen: id === "final" ? "finalStandings" : "twoColumns",
        origin: "visual",
        positions: [],
        movementRows: [],
        reasons: [],
      },
    };
  };
  const load = async (mogi: Mogi) => (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  const stale = new Set(["pre11", "pre12", "final"]);
  const captures = [...Array.from({ length: 12 }, (_, k) => `pre${k + 1}`), "final"].map((id, k) =>
    screenshot(id, k, stale.has(id)),
  );
  const played = await load({ ...fixture(), races: [], captures });
  const substituted = registerSubstitution(played, { slotId: "p11", loungeName: "Chomp", ign: "Chomp", fromRace: 1 });
  const sub = substituted.substitutions![0].incomingParticipantId;
  // As saved by earlier versions: the sub took the placed screenshots only, and races 11 and 12 await a number
  // under the review's earlier wording, with a stale reconstruction.
  const saved: Mogi = {
    ...substituted,
    races: played.races.map((race) =>
      race.number! < 11
        ? { ...race, placements: race.placements.map((id) => (id === "p11" ? sub : id)) }
        : {
            ...race,
            status: "pending",
            placements: [],
            participationReview: "The inferred number lost its support. Enter the number for this occurrence.",
            reconstruction: race.reconstruction && {
              ...race.reconstruction,
              status: "stale",
              anchors: [],
              knownRaces: [],
            },
          },
    ),
    captures: played.captures!.map((source) =>
      stale.has(source.id)
        ? { ...source, context: { phase: source.context!.phase } }
        : {
            ...source,
            nameAssociations: source.nameAssociations!.map((answer) =>
              answer.participantId === "p11" ? { ...answer, participantId: sub } : answer,
            ),
          },
    ),
  };
  const loaded = await load(saved);
  assert.deepEqual(
    loaded
      .captures!.filter((source) => stale.has(source.id))
      .map((source) => source.nameAssociations!.find((answer) => answer.ign === "Kmk")!.participantId),
    [sub, sub, sub],
  );
  assert.deepEqual(
    loaded.races
      .filter((race) => race.number! > 10)
      .map((race) => [race.status, race.placements.length, race.participationReview]),
    [
      ["confirmed", 12, undefined],
      ["confirmed", 12, undefined],
    ],
  );
  assert.equal(resultCoverage(loaded).through, 12);
  assert.deepEqual(
    mogiQuestions(loaded).map((question) => question.kind),
    ["credit"],
  );
});

test("unlinking a synonym asks again every occurrence that depended on it", () => {
  const answered = answerNameQuestion(fixture(), "name:c1:1", { participantId: "p0" });
  assert.equal(mogiQuestions(answered).length, 0);
  const unlinked = unlinkSynonym(answered, "p0", " read 0 ");
  assert.deepEqual(
    mogiQuestions(unlinked)
      .filter((q) => q.kind === "name")
      .map((q) => [q.number, q.reading]),
    [[1, "Read 0"]],
  );
  assert.deepEqual(participantSynonyms(unlinked, "p0"), []);
  assert.deepEqual(participantSynonyms(unlinked, "p1"), ["Read 1"]);
  assert.equal(nameAssociationsForCapture(unlinked, capture("future", "r2"))[0].participantId, "p0");
  assert.deepEqual(unlinkSynonym(unlinked, "p0", "Read 0"), unlinked);
});

test("unlink only retracts results dependent on user answers and keeps independently recognized rows", () => {
  const current = fixture();
  current.participants = participants.map((person) => (person.id === "p0" ? { ...person, ign: "Read 0" } : person));
  current.captures = current.captures!.map((source) => ({
    ...source,
    context: undefined,
    stage: "finish-order-confirmed",
  }));
  const recognized: Capture = {
    ...capture("c3", "r3"),
    context: undefined,
    stage: "finish-order-confirmed",
    rows: participants.map((person) => ({
      text: person.id === "p0" ? "Read 0" : person.ign,
      confidence: 100,
      uncertain: false,
      suggestedParticipantId: person.id,
    })),
    nameAssociations: undefined,
    reviewedPlacements: participants.map((person) => person.id),
  };
  current.captures.push(recognized);
  current.races.push({
    id: "r3",
    number: 3,
    origin: "observed",
    placements: recognized.reviewedPlacements,
    captureIds: ["c3"],
  });
  const answered = answerNameQuestion(current, "name:c1:1", { participantId: "p0" });
  assert.deepEqual(resultCoverage(answered).included, [1, 2, 3]);
  assert.deepEqual(participantSynonyms(answered, "p0"), ["Read 0"]);
  const before = structuredClone(answered);
  const unlinked = unlinkSynonym(answered, "p0", " read 0 ");
  assert.deepEqual(
    mogiQuestions(unlinked)
      .filter((q) => q.kind === "name")
      .map((q) => q.id),
    ["name:c1:1"],
  );
  assert.deepEqual(resultCoverage(unlinked).included, [3]);
  assert.deepEqual(
    unlinked.races.slice(0, 2).map((race) => [race.status, race.placements, race.nativePoints]),
    [
      ["pending", [], undefined],
      ["pending", [], undefined],
    ],
  );
  assert.deepEqual(
    unlinked.captures!.find((source) => source.id === "c3"),
    answered.captures!.find((source) => source.id === "c3"),
  );
  assert.deepEqual(participantSynonyms(unlinked, "p0"), []);
  assert.deepEqual(answered, before);
  const restored = answerNameQuestion(unlinked, "name:c1:1", { participantId: "p0" });
  assert.deepEqual(resultCoverage(restored).included, [1, 2, 3]);
  const typed = changeIgn(unlinked, "p0", "Read 0");
  assert.deepEqual(resultCoverage(typed).included, [1, 2, 3]);
  for (const id of ["c1", "c2"]) {
    assert.deepEqual(unlinked.captures!.find((source) => source.id === id)!.nameAssociations![0], {
      participantId: null,
      unlinked: true,
    });
    for (const relinked of [restored, typed])
      assert.deepEqual(relinked.captures!.find((source) => source.id === id)!.nameAssociations![0], {
        participantId: "p0",
        ign: "Read 0",
      });
  }
  const manual: Mogi = { ...answered, races: answered.races.map((race) => ({ ...race, origin: "manual" })) };
  assert.deepEqual(resultCoverage(unlinkSynonym(manual, "p0", "Read 0")).included, [1, 2, 3]);
  const alternate: Mogi = {
    ...answered,
    races: answered.races.slice(0, 2).map((race) => (race.id === "r1" ? { ...race, captureIds: ["c1", "c3"] } : race)),
  };
  assert.deepEqual(resultCoverage(unlinkSynonym(alternate, "p0", "Read 0")).included, [1]);
});

test("a race question puts its suggestion before every other free number in numeric order", () => {
  for (const reopening of [false, true]) {
    const mogi = fixture();
    const source = capture("unknown", "");
    mogi.captures!.push(source);
    mogi.sequence = {
      version: 1,
      inputSignature: "",
      numbers: [],
      links: [],
      occurrences: [],
      relations: [],
      gaps: [],
      roomAnalysis: {
        origin: "deduced",
        conflicts: [],
        captures: [{ captureId: source.id, sessionId: "room", j: 3, suggestion: 7, values: [], segments: [] }],
        sessions: [{ id: "room", captureIds: [source.id], reopening, candidates: [7, 8, 9, 10, 11, 12] }],
      },
    };
    const question = mogiQuestions(mogi).find((q) => q.kind === "race")!;
    assert.equal(question.suggestion, 7);
    assert.deepEqual(
      question.options.map((option) => option.value),
      reopening ? [7, 3, 4, 8, 9, 10, 11, 12] : [7, 3, 4, 5, 6, 8, 9, 10, 11, 12],
    );
  }
});

// Race 1 was answered the wrong way round and race 2 was then recognized against the learned names.
function swappedTeammatesFixture(): Mogi {
  const mogi = fixture();
  mogi.captures = mogi.captures!.map((source) => ({ ...source, context: undefined, stage: "finish-order-confirmed" }));
  const [second, first] = mogi.captures;
  first.nameAssociations![0] = { participantId: "p1", ign: "Read 0" };
  first.nameAssociations![1] = { participantId: "p0", ign: "Read 1", origin: "deduced" };
  second.rows[0] = { ...second.rows[0], uncertain: false, suggestedParticipantId: "p1" };
  second.rows[1] = { ...second.rows[1], uncertain: false, suggestedParticipantId: "p0" };
  second.nameAssociations![0] = { participantId: "p1", ign: "Read 0" };
  second.nameAssociations![1] = { participantId: "p0", ign: "Read 1" };
  mogi.participants = participants.map((person, index) =>
    index < 2 ? { ...person, ign: `Read ${1 - index}`, ignOrigin: "learned" as const } : person,
  );
  return mogi;
}
const swappedRows = (mogi: Mogi) =>
  ["c1", "c2"].map((id) =>
    mogi
      .captures!.find((source) => source.id === id)!
      .nameAssociations!.slice(0, 2)
      .map((answer) => answer.participantId),
  );

test("a swapped pair of in-game names is corrected in every race, by unlinking or by typing the names", () => {
  // Typing the right in-game names relinks every capture.
  let typed = changeIgn(swappedTeammatesFixture(), "p0", "Read 0");
  typed = changeIgn(typed, "p1", "Read 1");
  assert.deepEqual(swappedRows(typed), [
    ["p0", "p1"],
    ["p0", "p1"],
  ]);

  // Typed earlier, the names left recognition stale: Unlink withdraws every race, and the answers settle it.
  const stale = swappedTeammatesFixture();
  stale.participants = participants.map((person, index) =>
    index < 2 ? { ...person, ign: `Read ${index}`, ignOrigin: "explicit" as const } : person,
  );
  assert.deepEqual(participantSynonyms(stale, "p1"), ["Read 0"]);
  // Unlinked one at a time, elimination must not hand a reading straight back to the same player.
  let unlinked = reconcileSequence(unlinkSynonym(stale, "p1", "Read 0"));
  assert.deepEqual(swappedRows(unlinked), [
    [null, "p0"],
    [null, "p0"],
  ]);
  unlinked = reconcileSequence(unlinkSynonym(unlinked, "p0", "Read 1"));
  assert.deepEqual(swappedRows(unlinked), [
    [null, null],
    [null, null],
  ]);
  for (const reading of ["Read 0", "Read 1"]) {
    const question = mogiQuestions(unlinked).find((q) => q.kind === "name" && q.reading === reading);
    if (question) unlinked = answerNameQuestion(unlinked, question.id, { participantId: `p${reading.at(-1)}` });
  }
  assert.deepEqual(swappedRows(unlinked), [
    ["p0", "p1"],
    ["p0", "p1"],
  ]);
});

test("an unlinked reading also offers the teammates, and choosing one reopens the row they held", () => {
  // p0 learned p1's reading, so recognition holds it; p1's typed name matches neither reading.
  const mogi = swappedTeammatesFixture();
  mogi.format = "2v2";
  mogi.teams = Array.from({ length: 6 }, (_, index) => ({ id: `t${index}`, name: `Team ${index + 1}` }));
  mogi.participants = mogi.participants.map((person, index) => ({
    ...person,
    teamId: `t${Math.floor(index / 2)}`,
    ...(index === 1 ? { ign: "Typo", ignOrigin: "explicit" as const } : {}),
  }));
  let unlinked = reconcileSequence(unlinkSynonym(mogi, "p1", "Read 0", true));
  assert.deepEqual(swappedRows(unlinked), [
    [null, "p0"],
    [null, "p0"],
  ]);
  for (const reading of ["Read 0", "Read 1"]) {
    const question = mogiQuestions(unlinked).find((q) => q.kind === "name" && q.reading === reading);
    assert.ok(question?.kind === "name", reading);
    unlinked = answerNameQuestion(unlinked, question.id, { participantId: `p${reading.at(-1)}` });
  }
  assert.deepEqual(swappedRows(unlinked), [
    ["p0", "p1"],
    ["p0", "p1"],
  ]);
});
