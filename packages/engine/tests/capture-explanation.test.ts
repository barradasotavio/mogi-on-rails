import assert from "node:assert/strict";
import { test } from "node:test";

import {
  answerMogiQuestion,
  applyCaptureContext,
  applySequenceAnswer,
  type Capture,
  captureExplanation,
  type Mogi,
  mogiQuestions,
  normalizeReconstructions,
  reconcileSequence,
  sequenceInputSignature,
  sourcePairSignature,
  unlinkSynonym,
} from "@mkw/engine";

import { checkTotals, emptyRealMogi, ingestReal, raw, replayReal } from "./support/real-captures.ts";

const ffaRoster = [
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

for (const format of ["2v2", "FFA"] as const)
  test(`the thirteen real ${format} captures aggregate exact names before the name exceptions`, async () => {
    const input = emptyRealMogi();
    if (format === "FFA") {
      input.format = "FFA";
      input.teams = [];
      input.participants = ffaRoster.map((name) => {
        const copy = { ...input.participants.find((person) => person.loungeName === name)! };
        delete copy.teamId;
        return copy;
      });
    }
    const mogi = await ingestReal(
      input,
      Array.from({ length: 13 }, (_, i) => i),
    );
    // Only "Bloop X" has neither an exact roster name nor an independently known
    // spelling in this batch. The other associated spellings recur in other images.
    const counts =
      format === "2v2" ? [10, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10] : [7, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7];
    for (const [index, capture] of mogi.captures!.entries()) {
      const names = captureExplanation(mogi, capture.id).filter((step) => step.kind === "name");
      assert.deepEqual(names[0], {
        kind: "name",
        subject: capture.id,
        value: counts[index],
        origin: "read",
        rule: "name.as-shown",
        evidence: { compared: 12 },
      });
      assert.equal(names.filter((step) => step.rule === "name.as-shown").length, 1);
      assert.deepEqual(
        names.slice(1).map((step) => [step.evidence.row, step.evidence.readName]),
        index === 1 ? [[4, "Bloop X"]] : [],
      );
      assert.equal(
        names.length - 1 + counts[index],
        capture.nameAssociations!.filter((answer) => answer.participantId).length,
      );
    }
  });

test("the read summary normalizes the Lounge name and explicit IGN with NFKC, case and punctuation", async () => {
  const input = emptyRealMogi();
  input.participants = input.participants.map((person) =>
    person.loungeName === "Kameks Eye"
      ? { ...person, ign: "ＶＳ・ＫＡＭＥＫ", ignOrigin: "explicit" }
      : person.loungeName === "Tavo"
        ? { ...person, loungeName: "ＴＡＶＯ." }
        : person,
  );
  const mogi = await ingestReal(input, [0]);
  const names = captureExplanation(mogi, raw.captures[0].id).filter((step) => step.kind === "name");
  assert.deepEqual(names[0], {
    kind: "name",
    subject: raw.captures[0].id,
    value: 3,
    origin: "read",
    rule: "name.as-shown",
    evidence: { compared: 12 },
  });
  assert.equal(
    names.some((step) => [3, 7, 12].includes(step.evidence.row ?? 0)),
    false,
  );
});

test("a real 2v2 capture explains the name exceptions using Lounge identities", async () => {
  const mogi = await ingestReal(emptyRealMogi(), [0]);
  for (const capture of mogi.captures!) {
    const names = captureExplanation(mogi, capture.id).filter(
      (step) => step.kind === "name" && step.rule !== "name.as-shown",
    );
    assert.deepEqual(
      names.map((step) => [step.evidence.row, step.value]),
      capture.nameAssociations!.flatMap((answer, row) =>
        answer.participantId && !["Tavo", "DonkeyKong"].includes(capture.rows[row].text)
          ? [[row + 1, answer.participantId]]
          : [],
      ),
    );
    assert.ok(names.every((step) => step.origin === "deduced"));
  }
  const first = captureExplanation(mogi, raw.captures[0].id);
  assert.equal(
    first.find((step) => step.kind === "name" && step.evidence.readName === "Diddy.")?.rule,
    "name.exclusion",
  );
  assert.equal(first.find((step) => step.kind === "name" && step.evidence.readName === "Ktoad67")?.rule, "name.tag");
  assert.equal(first.find((step) => step.evidence.readName === "Ktoad67")?.evidence.tag, "k");
});

test("a real FFA capture explains token anchors, answers and roster exclusion with the brief 112 bot roster", async () => {
  const input = emptyRealMogi();
  input.format = "FFA";
  input.teams = [];
  input.participants = ffaRoster.map((name) => {
    const person = { ...input.participants.find((p) => p.loungeName === name)! };
    delete person.teamId;
    return { ...person, ignOrigin: "explicit" as const };
  });
  let mogi = await ingestReal(input, [0]);
  const token = captureExplanation(mogi, raw.captures[0].id).find((step) => step.evidence.readName === "VS Kamek");
  assert.equal(token?.rule, "name.token");
  assert.equal(token?.evidence.token, "kamek");
  assert.equal(mogi.participants.find((p) => p.id === token?.value)?.loungeName, "Kameks Eye");
  const expected: Record<string, string> = {
    "F☆ peepa": "iggy",
    "Diddy.": "pom",
    KRJFunk: "funk2006",
    Funky: "ActuFunk",
    "B·W-": "PiranhaPlant",
    "B·ω": "PiranhaPlant",
  };
  for (let i = 0; i < 10 && mogiQuestions(mogi).length; i++) {
    const q = mogiQuestions(mogi)[0];
    assert.equal(q.kind, "name");
    assert.ok(q.kind === "name");
    const person = mogi.participants.find((p) => p.loungeName === expected[q.reading]);
    assert.ok(person, q.reading);
    mogi = (
      await normalizeReconstructions({
        mogis: [await answerMogiQuestion(mogi, q.id, { kind: "name", answer: { participantId: person.id } })],
      })
    ).mogis[0];
  }
  assert.deepEqual(mogiQuestions(mogi), []);
  checkTotals(mogi, 1);
  const explained = mogi.captures!.flatMap((c) => captureExplanation(mogi, c.id));
  assert.ok(explained.some((step) => step.rule === "name.exclusion"));
  assert.ok(explained.some((step) => step.rule === "name.answered" && step.origin === "answered"));
  const loaded = JSON.parse(JSON.stringify(mogi));
  for (const c of mogi.captures!) {
    const names = captureExplanation(mogi, c.id).filter((step) => step.kind === "name");
    assert.equal(names.length, 11, c.fileName);
    assert.deepEqual(captureExplanation(loaded, c.id), captureExplanation(mogi, c.id));
  }
});

test("unlinking a real deduced name retracts its explanation and returns its question immediately", async () => {
  const mogi = await ingestReal(emptyRealMogi(), [0]);
  const capture = mogi.captures![0],
    person = mogi.participants.find((p) => p.loungeName === "Kameks Eye")!;
  assert.ok(captureExplanation(mogi, capture.id).some((step) => step.kind === "name" && step.value === person.id));
  const unlinked = unlinkSynonym(mogi, person.id, "VS Kamek");
  assert.equal(
    captureExplanation(unlinked, capture.id).some((step) => step.kind === "name" && step.value === person.id),
    false,
  );
  assert.ok(mogiQuestions(unlinked).some((q) => q.kind === "name" && q.reading === "VS Kamek"));
  assert.equal(captureExplanation(unlinked, capture.id).at(-1)?.kind, "pending");
});

test("an explicit correction can also unlink an exact recognized name without accepting it again", async () => {
  const mogi = await ingestReal(emptyRealMogi(), [0]);
  const person = mogi.participants.find((p) => p.loungeName === "Tavo")!;
  const unlinked = reconcileSequence(unlinkSynonym(mogi, person.id, "Tavo"));
  assert.equal(unlinked.captures![0].nameAssociations![6].participantId, null);
  assert.equal(
    captureExplanation(unlinked, raw.captures[0].id).some((step) => step.kind === "name" && step.value === person.id),
    false,
  );
  assert.ok(mogiQuestions(unlinked).some((q) => q.kind === "name" && q.reading === "Tavo"));
});

test("3v3 exclusion exposes the last candidate on the team without requiring game groups", () => {
  const names = [
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
  const capture: Capture = {
    id: "trios",
    width: 1920,
    height: 1080,
    stage: "context",
    context: { phase: "after", raceId: "r" },
    reviewedAt: "",
    reviewedPlacements: [],
    interpretation: {
      version: 1,
      screen: "finishOrderAdded",
      origin: "visual",
      positions: [],
      movementRows: [],
      reasons: [],
    },
    rows: names.map((name, i) => ({
      text: `${["A", "B", "C", "E"][Math.floor(i / 3)]} ${i === 2 ? "?" : name}`,
      confidence: 90,
      uncertain: true,
      suggestedParticipantId: "",
    })),
  };
  const mogi: Mogi = {
    id: "trios",
    name: "",
    createdAt: "",
    format: "3v3",
    captures: [capture],
    races: [{ id: "r", number: 1, origin: "observed", status: "pending", placements: [] }],
    teams: Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, name: "" })),
    participants: names.map((loungeName, i) => ({
      id: `p${i}`,
      loungeName,
      ign: loungeName,
      ignOrigin: "explicit",
      teamId: `t${Math.floor(i / 3)}`,
    })),
  };
  const step = captureExplanation(mogi, capture.id).find((step) => step.kind === "name" && step.evidence.row === 3);
  assert.equal(step?.value, "p2");
  assert.equal(step?.rule, "name.exclusion");
  assert.deepEqual(step?.evidence.group, ["p2"]);
});

test("a single queued answer explains every real image it resolves and disappears after the answer", async () => {
  const mogi = await ingestReal(
    emptyRealMogi(),
    Array.from({ length: 13 }, (_, i) => i),
  );
  const question = mogiQuestions(mogi)[0];
  assert.equal(question.kind, "name");
  for (const capture of mogi.captures!) {
    if (capture.nameAssociations!.every((answer) => answer.participantId)) continue;
    const pending = captureExplanation(mogi, capture.id).filter((step) => step.kind === "pending");
    assert.deepEqual(pending, [
      {
        kind: "pending",
        subject: capture.id,
        value: 1,
        origin: "deduced",
        rule: "pending.question",
        evidence: { questionId: question.id },
      },
    ]);
    assert.equal(captureExplanation(mogi, capture.id).at(-1)?.kind, "pending");
  }
  const answered = await answerMogiQuestion(mogi, question.id, {
    kind: "name",
    answer: { participantId: mogi.participants.find((p) => p.loungeName === "iggy")!.id },
  });
  assert.ok(
    answered.captures!.every((c) => !captureExplanation(answered, c.id).some((step) => step.kind === "pending")),
  );
  assert.ok(
    captureExplanation(answered, question.captureId!).some(
      (step) => step.rule === "name.as-shown" && step.origin === "read" && step.value === 12,
    ),
  );
});

test("a team question does not describe an already counted image as not counted yet", async () => {
  const { mogi } = await replayReal([[0]]);
  delete mogi.participants[0].teamId;
  const result = reconcileSequence(mogi);
  assert.ok(mogiQuestions(result).some((q) => q.kind === "team"));
  assert.equal(
    captureExplanation(result, raw.captures[0].id).some((step) => step.kind === "pending"),
    false,
  );
});

test("real first race and continuation explain the number produced by the sequence", async () => {
  const mogi = await ingestReal(emptyRealMogi(), [0, 1]);
  for (const [index, value] of [
    [0, 1],
    [1, 2],
  ]) {
    const steps = captureExplanation(mogi, raw.captures[index].id).filter((s) => s.kind === "race");
    assert.deepEqual(
      steps.map(({ kind, value, origin, rule }) => ({ kind, value, origin, rule })),
      [{ kind: "race", value, origin: "deduced", rule: "race.vector-continuity" }],
    );
  }
  assert.equal(captureExplanation(mogi, raw.captures[1].id)[0].evidence.anchorNumber, 1);
  assert.equal(captureExplanation(mogi, raw.captures[1].id)[0].evidence.completedSteps, 1);
});

async function realPrefix(): Promise<Awaited<ReturnType<typeof ingestReal>>> {
  const { mogi: first } = await replayReal([[0]]);
  return {
    ...first,
    captures: [],
    sequence: undefined,
    races: Array.from({ length: 5 }, (_, i) => ({
      id: `manual-${i}`,
      number: i + 1,
      origin: "manual",
      status: "confirmed",
      placements: first.races[0].placements,
    })),
  };
}

test("real readings explain the first and later races of a reopened room", async () => {
  const mogi = await ingestReal(await realPrefix(), [0, 1]);
  assert.deepEqual(
    [0, 1].map((i) =>
      captureExplanation(mogi, raw.captures[i].id)
        .filter((s) => s.kind === "race")
        .map(({ value, origin, rule }) => ({ value, origin, rule })),
    ),
    [
      [{ value: 6, origin: "deduced", rule: "race.reopen-first" }],
      [{ value: 7, origin: "deduced", rule: "race.reopen-later" }],
    ],
  );
  assert.equal(captureExplanation(mogi, raw.captures[0].id)[0].evidence.localRace, 1);
  assert.ok(captureExplanation(mogi, raw.captures[0].id)[0].evidence.decreased! > 6);
});

test("all thirteen real captures in shuffled order agree with their projected race; equal vectors count once", async () => {
  const { mogi } = await replayReal([[12, 3, 9, 0, 7, 2, 10, 4, 1, 11, 8, 5, 6]], true, true);
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12];
  raw.captures.forEach((capture, i) => {
    const steps = captureExplanation(mogi, capture.id);
    const race = steps.find((step) => step.kind === "race");
    assert.equal(race?.value, numbers[i]);
    assert.equal(race?.origin, "deduced");
    assert.equal(race?.rule, "race.vector-continuity");
    const occurrence = mogi.sequence!.occurrences.find((o) => o.captureIds.includes(capture.id));
    assert.equal(race.value, occurrence?.number);
  });
  for (const i of [0, 1, 7]) {
    const duplicateId = `${raw.captures[i].id}-duplicate`;
    assert.deepEqual(
      captureExplanation(mogi, duplicateId).filter((step) => step.kind === "duplicate"),
      [
        {
          kind: "duplicate",
          subject: duplicateId,
          value: raw.captures[i].id,
          origin: "deduced",
          rule: "duplicate.same-vector",
          evidence: { anchorCaptureId: raw.captures[i].id },
        },
      ],
    );
  }
  assert.equal(
    captureExplanation(mogi, raw.captures[10].id).some((s) => s.kind === "duplicate"),
    false,
    "a lobby is not a duplicate of the previous result",
  );
  assert.deepEqual(captureExplanation(mogi, "removed-image"), []);
});

async function twoRooms(timed: boolean): Promise<Awaited<ReturnType<typeof ingestReal>>> {
  const { mogi } = await replayReal([[0, 1]]);
  const first = mogi.captures!.map((c, i) => ({
    ...c,
    context: undefined,
    photoMoment: timed ? { at: 1000 + i, source: "exif" as const } : undefined,
  }));
  const second = first.map((c, i) => ({
    ...structuredClone(c),
    id: `second-${i}`,
    photoMoment: timed ? { at: 2000 + i, source: "exif" as const } : undefined,
  }));
  return reconcileSequence({
    ...mogi,
    races: [],
    captures: [...second, ...first],
    sequence: {
      version: 1,
      numbers: [],
      links: first.flatMap((a) =>
        second.map((b) => ({
          fromCaptureId: a.id,
          toCaptureId: b.id,
          signature: sourcePairSignature(a, b),
          continuity: "reset" as const,
        })),
      ),
      occurrences: [],
      relations: [],
      gaps: [],
      inputSignature: "fixture",
    },
  });
}

test("photo time explains which of two real room sessions came after the other", async () => {
  const mogi = await twoRooms(true);
  assert.deepEqual(
    captureExplanation(mogi, "second-0").filter((s) => s.kind === "order"),
    [
      {
        kind: "order",
        subject: "second-0",
        value: raw.captures[1].id,
        origin: "deduced",
        rule: "order.photo-time",
        evidence: { anchorCaptureId: raw.captures[1].id, photoTime: 2000, previousTime: 1001, photoTimeSource: "exif" },
      },
    ],
  );
  assert.equal(captureExplanation(mogi, "second-0")[0].value, 3);
});

test("a timed session cites the image that actually supplied its moment when another image has no time", async () => {
  const mogi = await twoRooms(true);
  delete mogi.captures!.find((capture) => capture.id === raw.captures[1].id)!.photoMoment;
  const order = captureExplanation(mogi, "second-0").find((step) => step.kind === "order");
  assert.equal(order?.evidence.anchorCaptureId, raw.captures[0].id);
  assert.equal(order?.evidence.previousTime, 1000);
  assert.equal(order?.evidence.photoTimeSource, "exif");
});

test("answering which room came first explains the answered order and race without inventing photo evidence", async () => {
  const mogi = await twoRooms(false);
  assert.deepEqual(
    captureExplanation(mogi, "second-0").filter((s) => s.kind === "race" || s.kind === "order"),
    [],
  );
  const q = mogiQuestions(mogi).find((q) => q.kind === "sequence" && q.reading === "Which came first?")!;
  for (const c of mogi.captures!)
    assert.deepEqual(
      captureExplanation(mogi, c.id).filter((step) => step.kind === "pending"),
      [
        {
          kind: "pending",
          subject: c.id,
          value: 1,
          origin: "deduced",
          rule: "pending.question",
          evidence: { questionId: q.id },
        },
      ],
    );
  const answered = await answerMogiQuestion(mogi, q.id, { kind: "sequence", value: raw.captures[0].id });
  const steps = captureExplanation(answered, "second-0").filter((s) => s.kind === "race" || s.kind === "order");
  assert.deepEqual(
    steps.map(({ kind, value, origin, rule }) => ({ kind, value, origin, rule })),
    [
      { kind: "race", value: 3, origin: "answered", rule: "race.answered" },
      { kind: "order", value: raw.captures[1].id, origin: "answered", rule: "order.answered" },
    ],
  );
  assert.equal(steps[1].evidence.photoTime, undefined);
});

test("a later reopening waits for an answer, and correcting that answer updates the explanation", async () => {
  const mogi = await ingestReal(await realPrefix(), [2]);
  assert.deepEqual(
    captureExplanation(mogi, raw.captures[2].id).filter((s) => s.kind === "race"),
    [],
  );
  const q = mogiQuestions(mogi).find((q) => q.kind === "race")!;
  const answered = await answerMogiQuestion(mogi, q.id, { kind: "race", value: 8 });
  assert.deepEqual(
    captureExplanation(answered, raw.captures[2].id)
      .filter((s) => s.kind === "race")
      .map(({ value, origin, rule }) => ({ value, origin, rule })),
    [{ value: 8, origin: "answered", rule: "race.answered" }],
  );
  const corrected = reconcileSequence(
    applySequenceAnswer(
      answered,
      { kind: "number", captureId: raw.captures[2].id, value: 9 },
      sequenceInputSignature(answered),
    ),
  );
  assert.equal(captureExplanation(corrected, raw.captures[2].id)[0].value, 9);
  assert.equal(captureExplanation(corrected, raw.captures[2].id)[0].origin, "answered");
});

test("a discarded occurrence does not turn the explained Lounge number into a physical number", async () => {
  const prefix = await realPrefix();
  prefix.races.forEach((r, i) => {
    r.physicalNumber = i + 1;
    r.number = i < 2 ? i + 1 : i === 2 ? undefined : i;
  });
  prefix.races[2].status = "discarded";
  const mogi = await ingestReal(prefix, [0]);
  assert.equal(captureExplanation(mogi, raw.captures[0].id)[0].value, 5);
});

test("explanations survive reloading from facts without adding persisted explanation data", async () => {
  const mogi = await ingestReal(emptyRealMogi(), [0, 1]);
  const serialized = JSON.stringify(mogi);
  assert.equal(serialized.includes('"steps"'), false);
  assert.deepEqual(
    captureExplanation(JSON.parse(serialized), raw.captures[1].id),
    captureExplanation(mogi, raw.captures[1].id),
  );
});

test("an image explicitly attached to an existing race explains the user's chosen race", async () => {
  const { mogi } = await replayReal([[0]]);
  const capture = mogi.captures![0];
  const selected = reconcileSequence(
    applyCaptureContext(
      {
        ...mogi,
        captures: [],
        sequence: undefined,
        races: [{ id: "chosen-race", number: 4, origin: "manual", status: "pending", placements: [] }],
      },
      capture,
      {
        placements: [],
        absentParticipantIds: [],
        rawOverrides: {},
        reviewed: false,
        nameAssociations: capture.nameAssociations,
      },
      "chosen-race",
    ),
  );
  assert.deepEqual(
    captureExplanation(selected, capture.id)
      .filter((s) => s.kind === "race")
      .map(({ value, origin, rule }) => ({ value, origin, rule })),
    [{ value: 4, origin: "answered", rule: "race.answered" }],
  );
});

test("an answered reopening keeps equal vectors in different races and explains the actual reopening evidence", async () => {
  const { mogi } = await replayReal([[0]]);
  const first = mogi.captures![0],
    next = { ...structuredClone(first), id: "new-room", context: undefined };
  const result = reconcileSequence({
    ...mogi,
    captures: [first, next],
    sequence: {
      ...mogi.sequence!,
      numbers: [{ captureId: first.id, number: 1, phase: "after" }],
      links: [
        {
          fromCaptureId: first.id,
          toCaptureId: next.id,
          signature: sourcePairSignature(first, next),
          continuity: "reset",
        },
      ],
    },
  });
  const steps = captureExplanation(result, next.id);
  assert.equal(steps[0].value, 2);
  assert.equal(steps[0].rule, "race.reopen-first");
  assert.equal(steps[0].evidence.reopeningBasis, "answered");
  assert.equal(
    steps.some((s) => s.kind === "duplicate"),
    false,
  );
});
