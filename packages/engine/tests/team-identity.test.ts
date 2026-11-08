import assert from "node:assert/strict";
import { test } from "node:test";

import type { Capture, Mogi } from "@mkw/engine";
import {
  answerMogiQuestion,
  mogiQuestions,
  nameAssociationsForCapture,
  normalizeReconstructions,
  participantSynonyms,
  unlinkSynonym,
} from "@mkw/engine";

import { checkTotals, emptyRealMogi, ingestReal, raw, replayReal } from "./support/real-captures.ts";

test("the real race's tags form the bot's six pairs without wrong deductions", () => {
  const mogi: Mogi = emptyRealMogi();
  const source: Capture = {
    ...structuredClone(raw.captures[0]),
    stage: "context",
    context: { phase: "after" },
    reviewedAt: "",
    reviewedPlacements: [],
    rows: raw.captures[0].rows.map((row) => ({ ...row, uncertain: true, suggestedParticipantId: "" })),
  };
  source.nameAssociations = nameAssociationsForCapture(mogi, source, 1);
  mogi.captures = [source];
  const expected = [
    "VSPeach",
    "iggy",
    "Kameks Eye",
    "pom",
    "funk2006",
    "KingBoo",
    "Tavo",
    "BloopMaster",
    "toad67",
    "ActuFunk",
    "PiranhaPlant",
    "DonkeyKong",
  ];
  source.nameAssociations.forEach((answer, index) => {
    if (answer.participantId)
      assert.equal(mogi.participants.find((person) => person.id === answer.participantId)!.loungeName, expected[index]);
  });
  const questions = mogiQuestions(mogi).filter((question) => question.kind === "name");
  assert.ok(questions.length <= 1, JSON.stringify(questions));
  if (questions[0])
    assert.deepEqual(questions[0].options.map((person) => person.loungeName).sort(), ["ActuFunk", "iggy"]);
});

function synthetic(format: "2v2" | "3v3" | "FFA", readings: string[], names: string[]) {
  const size = format === "2v2" ? 2 : format === "3v3" ? 3 : 1;
  const mogi = {
    id: "synthetic",
    name: "",
    createdAt: "",
    format,
    races: [{ id: "r", number: 1, origin: "observed" as const, status: "pending" as const, placements: [] }],
    participants: names.map((loungeName, i) => ({
      id: `p${i}`,
      loungeName,
      ign: loungeName,
      ignOrigin: "fallback" as const,
      ...(size > 1 ? { teamId: `t${Math.floor(i / size)}` } : {}),
    })),
    teams: Array.from({ length: 12 / size }, (_, i) => ({ id: `t${i}`, name: "" })),
    captures: [] as Capture[],
  };
  const source: Capture = {
    id: "c",
    width: 1920,
    height: 1080,
    stage: "context",
    context: { phase: "after", raceId: "r" },
    reviewedAt: "",
    reviewedPlacements: [],
    rows: readings.map((text) => ({ text, uncertain: true, confidence: 90, suggestedParticipantId: "" })),
  };
  source.nameAssociations = nameAssociationsForCapture(mogi, source, 1);
  mogi.captures.push(source);
  return mogi;
}

const trioNames = [
  "Northstar",
  "Waterfall",
  "Sunflower",
  "Dragonfly",
  "Moonbeam",
  "Evergreen",
  "Firestorm",
  "Bluebird",
  "Quicksilver",
  "Snowflake",
  "Sunshine",
  "Raindrop",
];

test("four trios use one anchor per team and the joint assignment for the other members", () => {
  const mogi = synthetic(
    "3v3",
    [
      "A Northstar",
      "A Waterfal",
      "A ?",
      "B Dragonfly",
      "B Moonbea",
      "B ?",
      "C Firestorm",
      "C Bluebir",
      "C ?",
      "E Snowflake",
      "E Sunshin",
      "E ?",
    ],
    trioNames,
  );
  assert.deepEqual(
    mogi.captures[0].nameAssociations!.map((answer) => answer.participantId),
    Array.from({ length: 12 }, (_, i) => `p${i}`),
  );
  assert.equal(mogiQuestions(mogi).length, 0);
});

test("a trio without an anchor asks only among its members and propagates the answer by exclusion (exclusionRow)", async () => {
  const { answerNameQuestion } = await import("@mkw/engine");
  const mogi = synthetic(
    "3v3",
    ["A ?", "A !", "A *", ...trioNames.slice(3).map((name, i) => `${["B", "C", "E"][Math.floor(i / 3)]} ${name}`)],
    trioNames,
  );
  const questions = mogiQuestions(mogi).filter((question) => question.kind === "name");
  assert.equal(questions.length, 1);
  assert.deepEqual(
    questions[0].options.map((person) => person.id),
    ["p0", "p1", "p2"],
  );
  const answered = answerNameQuestion(mogi, questions[0].id, { participantId: "p0" });
  const binary = mogiQuestions(answered).filter((question) => question.kind === "name");
  assert.equal(binary.length, 1);
  assert.deepEqual(
    binary[0].options.map((person) => person.id),
    ["p1", "p2"],
  );
  const finished = answerNameQuestion(answered, binary[0].id, { participantId: "p1" });
  assert.deepEqual(
    finished.captures![0].nameAssociations!.slice(0, 3).map((answer) => answer.participantId),
    ["p0", "p1", "p2"],
  );
});

const pairNames = [
  "Northstar",
  "Waterfall",
  "Dragonfly",
  "Evergreen",
  "Firestorm",
  "Bluebird",
  "Quicksilver",
  "Snowflake",
  "Sunshine",
  "Raindrop",
  "Moonbeam",
  "Sunflower",
];
const otherPairs = pairNames.slice(4).map((name, i) => `${["H", "J", "L", "M"][Math.floor(i / 2)]} ${name}`);

test("the two free people of the same team need one answer even without a readable tag", async () => {
  const { answerNameQuestion } = await import("@mkw/engine");
  const mogi = synthetic("2v2", ["?", "!", ...pairNames.slice(2)], pairNames);
  const questions = mogiQuestions(mogi).filter((question) => question.kind === "name");
  assert.equal(questions.length, 1);
  const answered = answerNameQuestion(mogi, questions[0].id, { participantId: "p0" });
  assert.deepEqual(mogiQuestions(answered), []);
  assert.deepEqual(
    answered.captures[0].nameAssociations!.slice(0, 2).map((answer) => answer.participantId),
    ["p0", "p1"],
  );
});

test("tags D and DK take the longest prefix without mixing two anchored pairs (tagBoundary)", () => {
  const mogi = synthetic(
    "2v2",
    ["D Foo", "D Bar", "DK Baz", "DK Qux", ...otherPairs],
    ["Foo", "Waterfall", "Baz", "Evergreen", ...pairNames.slice(4)],
  );
  assert.deepEqual(
    mogi.captures[0].nameAssociations!.map((answer) => answer.participantId),
    Array.from({ length: 12 }, (_, i) => `p${i}`),
  );
});

test("a tag repeated by two teams doesn't allow exclusion among the four rows (tiedPartitionLinks)", () => {
  const mogi = synthetic("2v2", ["D ?", "D !", "D *", "D +", ...otherPairs], pairNames);
  assert.deepEqual(
    mogi.captures[0].nameAssociations!.slice(0, 4).map((answer) => answer.participantId),
    [null, null, null, null],
  );
  const questions = mogiQuestions(mogi).filter((question) => question.kind === "name");
  assert.ok(questions.length > 0);
  assert.deepEqual(
    questions[0].options.map((person) => person.id),
    ["p0", "p1", "p2", "p3"],
  );
});

test("DKarl without a boundary stays free between teams D and DK (tagBoundary)", () => {
  const mogi = synthetic("2v2", ["D Northstar", "?", "DK Dragonfly", "DKarl", ...otherPairs], pairNames);
  assert.deepEqual(
    mogi.captures[0].nameAssociations!.slice(0, 4).map((answer) => answer.participantId),
    ["p0", null, "p2", null],
  );
  const questions = mogiQuestions(mogi).filter((question) => question.kind === "name");
  assert.deepEqual(
    questions[0].options.map((person) => person.id),
    ["p1", "p3"],
  );
});

test("FFA uses the joint assignment for twelve close spellings without questions (clearJointMargin)", () => {
  const mogi = synthetic(
    "FFA",
    trioNames.map((name) => name.slice(0, -1)),
    trioNames,
  );
  assert.deepEqual(
    mogi.captures[0].nameAssociations!.map((answer) => answer.participantId),
    Array.from({ length: 12 }, (_, i) => `p${i}`),
  );
  assert.equal(mogiQuestions(mogi).length, 0);
});

test("team deductions are correctable and don't come back on their own once unlinked (withdrawnAssociation)", async () => {
  const { unlinkSynonym, reconcileSequence, participantSynonyms } = await import("@mkw/engine");
  const mogi = synthetic("2v2", ["D Northstar", "D ?", "DK Dragonfly", "DK ?", ...otherPairs], pairNames);
  assert.equal(mogi.captures[0].nameAssociations![1].origin, "deduced");
  assert.ok(participantSynonyms(mogi, "p1").includes("D ?"));
  const unlinked = reconcileSequence(unlinkSynonym(mogi, "p1", "D ?"));
  assert.equal(unlinked.captures![0].nameAssociations![1].participantId, null);
  assert.ok(mogiQuestions(unlinked).some((question) => question.kind === "name" && question.row === 2));
});

test("the queue first asks about the trio that resolves the most rows", () => {
  const mogi = synthetic(
    "3v3",
    [
      "A Northstar",
      "A ?",
      "A !",
      "B ?",
      "B !",
      "B *",
      ...trioNames.slice(6).map((name, i) => `${i < 3 ? "C" : "E"} ${name}`),
    ],
    trioNames,
  );
  const questions = mogiQuestions(mogi).filter((question) => question.kind === "name");
  assert.deepEqual(
    questions.map((question) => question.row),
    [4, 2],
  );
});

test("KRJFunk goes with K toad67 even with the tag read imperfectly", () => {
  const mogi = synthetic(
    "2v2",
    ["KRJFunk", "K toad67", ...otherPairs, "D Northstar", "D Waterfall"],
    ["funk2006", "toad67", ...pairNames.slice(4), "Northstar", "Waterfall"],
  );
  assert.deepEqual(
    mogi.captures[0].nameAssociations!.slice(0, 2).map((answer) => answer.participantId),
    ["p0", "p1"],
  );
});

test("shared tags that contradict clear names don't force people from the wrong team (tagAgreesWithAnchors)", () => {
  const mogi = synthetic("2v2", ["X Northstar", "X Dragonfly", "Y Waterfall", "Y Evergreen", ...otherPairs], pairNames);
  assert.deepEqual(
    mogi.captures[0].nameAssociations!.slice(0, 4).map((answer) => answer.participantId),
    ["p0", "p2", "p1", "p3"],
  );
});

test("anchors of one team under incompatible tags keep the doubt instead of forcing an opponent (tagAgreesWithAnchors)", () => {
  const mogi = synthetic("2v2", ["X Northstar", "X ?", "Y Waterfall", "Y Dragonfl", ...otherPairs], pairNames);
  const association = mogi.captures[0].nameAssociations![2];
  assert.ok(association.participantId === null || association.participantId === "p1");
  assert.ok(mogiQuestions(mogi).some((question) => question.kind === "name"));
});

test("two tagged members of each trio stay together when the untagged rows compete for the slots (tiedPartitionLinks)", () => {
  const mogi = synthetic(
    "3v3",
    [
      "A Northstar",
      "A Moombea",
      "?",
      "B Dragonfly",
      "B ?",
      "!",
      ...trioNames.slice(6).map((name, i) => `${i < 3 ? "C" : "E"} ${name}`),
    ],
    trioNames,
  );
  assert.equal(mogi.captures[0].nameAssociations![1].participantId, null);
  const question = mogiQuestions(mogi).find((question) => question.kind === "name" && question.row === 2);
  assert.ok(question?.kind === "name");
  assert.deepEqual(
    question.options.map((person) => person.id),
    ["p1", "p2"],
  );
});

test("unlinking a swapped teammate takes back the IGN it taught, so every race links the name to its player", async () => {
  let mogi = emptyRealMogi();
  const id = (name: string) => mogi.participants.find((person) => person.loungeName === name)!.id;
  const answerNames = async (key: Record<string, string>) => {
    for (let question = mogiQuestions(mogi)[0]; question; question = mogiQuestions(mogi)[0]) {
      assert.ok(question.kind === "name" && key[question.reading], JSON.stringify(question));
      const answered = await answerMogiQuestion(mogi, question.id, {
        kind: "name",
        answer: { participantId: id(key[question.reading]) },
      });
      mogi = (await normalizeReconstructions({ mogis: [answered] })).mogis[0];
    }
  };
  // Race 1 asks for one teammate; answering the other one teaches both swapped IGNs.
  mogi = await ingestReal(mogi, [0]);
  await answerNames({ "F☆ peepa": "ActuFunk" });
  // Races 2 and 3 are recognized by those learned IGNs, so they ask nothing.
  mogi = await ingestReal(mogi, [1, 2]);
  await answerNames({});
  // Players → Unlink, then the corrected answers.
  mogi = unlinkSynonym(mogi, id("ActuFunk"), "F☆ peepa");
  await answerNames({ "F☆ peepa": "iggy", Funky: "ActuFunk" });
  for (const capture of mogi.captures!)
    capture.rows.forEach((row, index) => {
      const expected = { "F☆ peepa": "iggy", Funky: "ActuFunk" }[row.text];
      if (expected)
        assert.equal(capture.nameAssociations![index].participantId, id(expected), `${capture.fileName}: ${row.text}`);
    });
  checkTotals(mogi, 3);
  assert.deepEqual(
    ["iggy", "ActuFunk"].map((name) => mogi.participants.find((person) => person.id === id(name))!.ign),
    ["F☆ peepa", "Funky"],
  );
});

test("unlinking every reading Players lists under swapped teammates repairs all 12 races, whatever the IGN's origin", async () => {
  // A saved mogi from older code: race 1 answered right, every later capture recognized with certainty by
  // the swapped IGNs. The short readings have no unrecognized variant except race 10's odd one.
  const replayed = (await replayReal([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]])).mogi;
  const id = (name: string) => replayed.participants.find((person) => person.loungeName === name)!.id;
  const [ko, bo] = [id("iggy"), id("ActuFunk")];
  for (const origin of ["learned", undefined, "explicit"] as const) {
    let mogi = structuredClone(replayed);
    mogi.participants = mogi.participants.map((person) =>
      person.id === ko || person.id === bo
        ? { ...person, ign: person.id === ko ? "Bo" : "Ko★", ignOrigin: origin }
        : person,
    );
    mogi.captures!.forEach((capture, race) =>
      capture.rows.forEach((row, index) => {
        const peepa = row.text.includes("peepa");
        if (!peepa && row.text !== "Funky") return;
        const truth = peepa ? ko : bo,
          swapped = peepa ? bo : ko;
        const text = peepa ? (race === 9 ? "Ko★ 161 1AYE" : "Ko★") : "Bo";
        const recognized = race && text !== "Ko★ 161 1AYE";
        capture.rows[index] = { ...row, text, suggestedParticipantId: swapped, uncertain: !recognized };
        capture.nameAssociations![index] = !race
          ? { participantId: truth, ign: text }
          : recognized
            ? { participantId: swapped }
            : { participantId: swapped, ign: text, origin: "deduced" };
      }),
    );
    // Players → Unlink every reading listed under both teammates, then answer what is asked.
    for (const person of [bo, ko])
      for (const synonym of participantSynonyms(mogi, person)) mogi = unlinkSynonym(mogi, person, synonym);
    for (let question = mogiQuestions(mogi)[0]; question; question = mogiQuestions(mogi)[0]) {
      assert.ok(question.kind === "name", JSON.stringify(question));
      const answered = await answerMogiQuestion(mogi, question.id, {
        kind: "name",
        answer: { participantId: question.reading.startsWith("Ko★") ? ko : bo },
      });
      mogi = (await normalizeReconstructions({ mogis: [answered] })).mogis[0];
    }
    for (const capture of mogi.captures!)
      capture.rows.forEach((row, index) => {
        if (row.text.startsWith("Ko★") || row.text === "Bo")
          assert.equal(
            capture.nameAssociations![index].participantId,
            row.text === "Bo" ? bo : ko,
            `${origin}, ${capture.fileName}: ${row.text}`,
          );
      });
    // An explicit IGN is the user's statement and stays; any other is learned again from the answers.
    assert.deepEqual(
      [ko, bo].map((person) => mogi.participants.find((entry) => entry.id === person)!.ign),
      origin === "explicit" ? ["Bo", "Ko★"] : ["Ko★", "Bo"],
      String(origin),
    );
    checkTotals(mogi, 12);
  }
});

test("a saved confirmed race whose finish order screen lost its link shows that screenshot again on load, result unchanged", async () => {
  // The #31 repair left most races with empty `captureIds`; their occurrences still held their screens.
  const replayed = (await replayReal([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]])).mogi;
  const saved = structuredClone(replayed);
  for (const race of saved.races) if (race.origin === "observed") race.captureIds = [];
  const loaded = (await normalizeReconstructions({ mogis: [saved] }, { revalidateBoundaryProofs: true })).mogis[0];
  for (const race of replayed.races)
    assert.deepEqual(
      loaded.races.find((entry) => entry.id === race.id)!.captureIds,
      race.captureIds,
      `race ${race.number}`,
    );
  checkTotals(loaded, 12);
});

test("answering the names of a race's finish order screen links that screenshot to the race it confirms", async () => {
  // The answer confirms the race from its screen: the link follows even when the race had lost it.
  let mogi = structuredClone((await replayReal([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]])).mogi);
  const race = mogi.races.find((entry) => entry.number === 4)!;
  const capture = mogi.captures!.find((entry) => entry.id === race.captureIds![0])!;
  assert.equal(capture.stage, "finish-order-confirmed");
  race.captureIds = [];
  const person = capture.nameAssociations![0].participantId!;
  for (const synonym of participantSynonyms(mogi, person)) mogi = unlinkSynonym(mogi, person, synonym);
  for (let question = mogiQuestions(mogi)[0]; question; question = mogiQuestions(mogi)[0]) {
    assert.equal(question.kind, "name");
    mogi = await answerMogiQuestion(mogi, question.id, { kind: "name", answer: { participantId: person } });
  }
  const confirmed = mogi.races.find((entry) => entry.id === race.id)!;
  assert.equal(confirmed.status, "confirmed");
  assert.deepEqual(confirmed.captureIds, [capture.id]);
});
