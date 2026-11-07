import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  answerMogiQuestion,
  applyCaptureContext,
  type Capture,
  captureBoundaryValues,
  captureExplanation,
  countedRaces,
  individualStandings,
  type Mogi,
  mogiOverview,
  mogiQuestions,
  normalizeReconstructions,
  numericTextValue,
  reconcileSequence,
} from "@mkw/engine";

import { emptyFfaMogi, ffa, ffaReading, ingestReadings } from "./support/real-captures.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const real = load("real-captures") as { roster: Mogi["participants"]; captures: Capture[] };
type RawNumber = { row: number; text: string; value: number | null; uncertain: boolean };
const tiny = load("tiny-numeric-readings") as {
  captures: { file: string; right: RawNumber[]; addition: RawNumber[] }[];
};
const truth = load("mogi-truth") as { races: { race: number; placements: string[] }[] };
const cumulative = load("cumulative") as Record<string, number>[];
const captureTruth = [
  [
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
  ],
  [
    "KingBoo",
    "Tavo",
    "DonkeyKong",
    "BloopMaster",
    "funk2006",
    "VSPeach",
    "ActuFunk",
    "PiranhaPlant",
    "pom",
    "toad67",
    "Kameks Eye",
    "iggy",
  ],
];
const P = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const person = (name: string) => real.roster.find((p) => p.loungeName === name)!.id;
function prefix(through: number): Mogi {
  return {
    id: "numeric",
    name: "Numeric rules",
    createdAt: "2026-10-29",
    format: "FFA",
    participants: real.roster.map((p) => ({ ...p, ign: p.loungeName })),
    races: truth.races.slice(0, through).map((r) => ({
      id: `r${r.race}`,
      number: r.race,
      origin: "manual",
      status: "confirmed",
      placements: r.placements.map(person),
    })),
  };
}
function source(index: number): Capture {
  const c = structuredClone(real.captures[index]);
  return {
    ...c,
    stage: "context",
    reviewedAt: "",
    reviewedPlacements: [],
    nameAssociations: (index === 12
      ? [
          "Kameks Eye",
          "funk2006",
          "VSPeach",
          "pom",
          "KingBoo",
          "toad67",
          "Tavo",
          "BloopMaster",
          "DonkeyKong",
          "PiranhaPlant",
          "iggy",
          "ActuFunk",
        ]
      : (captureTruth[index] ??
        c.rows.map((row) => {
          const known = real.captures[0].rows.findIndex((r) => r.text === row.text);
          return captureTruth[0][known];
        }))
    ).map((name) => ({ participantId: person(name) })),
  };
}
function ingest(mogi: Mogi, ...captures: Capture[]) {
  for (const c of captures)
    mogi = applyCaptureContext(mogi, c, {
      placements: [],
      absentParticipantIds: [],
      reviewed: false,
      nameAssociations: c.nameAssociations,
    });
  return reconcileSequence(mogi);
}

test("two missing Tiny totals follow the finish order and preserve the readings (firstRacePermutation)", () => {
  const c = source(0);
  // Tiny capture 01: KingBoo and Tavo are empty; iggy's 12 is uncertain.
  const readings = tiny.captures[0].right;
  c.numericRows!.forEach((row) =>
    Object.assign(
      row.right,
      readings.find((r) => r.row === row.row),
    ),
  );
  const original = structuredClone(c.numericRows);
  const mogi = ingest(prefix(0), c);
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.deepEqual(
    countedRaces(mogi).map((r) => r.number),
    [1],
  );
  assert.deepEqual(Object.fromEntries(individualStandings(mogi).map((p) => [p.loungeName, p.points])), cumulative[0]);
  assert.deepEqual(mogi.captures![0].numericRows, original);
  assert.equal(mogi.captures![0].numericAnswers, undefined);
  assert.deepEqual(mogi.captures![0].numericDeductions, [
    { row: 2, field: "right", value: 12, origin: "deduced" },
    { row: 6, field: "right", value: 7, origin: "deduced" },
    { row: 7, field: "right", value: 6, origin: "deduced" },
  ]);
  assert.equal(captureBoundaryValues(mogi.captures![0]).get(person("Tavo"))?.origin, "deduced");
});

test("Tiny read totals are explained once and each finish-order deduction follows its row (firstRacePermutation)", () => {
  const c = source(0);
  c.numericRows!.forEach((row) =>
    Object.assign(
      row.right,
      tiny.captures[0].right.find((r) => r.row === row.row),
    ),
  );
  const mogi = ingest(prefix(0), c);
  const steps = captureExplanation(mogi, c.id).filter((step) => step.kind === "race" || step.kind === "points");
  assert.deepEqual(
    steps.map((step) => step.kind),
    ["race", "points", "points", "points", "points"],
  );
  assert.deepEqual(steps.slice(1), [
    { kind: "points", subject: c.id, value: 9, origin: "read", rule: "points.as-shown", evidence: { compared: 12 } },
    ...[
      { row: 2, name: "iggy", value: 12, text: "12" },
      { row: 6, name: "KingBoo", value: 7, text: "" },
      { row: 7, name: "Tavo", value: 6, text: "" },
    ].map((r) => ({
      kind: "points",
      subject: c.id,
      value: r.value,
      origin: "deduced",
      rule: "points.race1-permutation",
      evidence: { row: r.row, playerId: person(r.name), readText: r.text },
    })),
  ]);
});

test("the anchor continues through Tiny D1 with x 6 and two unread prior totals, without generic questions (missingTotalsByScale)", () => {
  const c = source(1);
  delete c.interpretation!.currentScale;
  c.numericRows!.forEach((row) => {
    Object.assign(
      row.right,
      tiny.captures[1].right.find((r) => r.row === row.row),
    );
    Object.assign(
      row.addition,
      tiny.captures[1].addition.find((r) => r.row === row.row),
    );
  });
  const original = structuredClone(c.numericRows);
  const mogi = ingest(prefix(1), c);
  assert.equal(mogi.sequence!.occurrences.find((o) => o.captureIds.includes(c.id))?.number, 2);
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.deepEqual(Object.fromEntries(individualStandings(mogi).map((p) => [p.loungeName, p.points])), cumulative[1]);
  assert.deepEqual(mogi.captures![0].numericRows, original);
  assert.deepEqual(mogi.captures![0].numericDeductions, [
    { row: 2, field: "right", value: 6, origin: "deduced" },
    { row: 3, field: "right", value: 1, origin: "deduced" },
  ]);
  assert.deepEqual(
    captureExplanation(mogi, c.id)
      .filter((s) => s.kind === "points" && s.evidence.row)
      .map((s) => [s.evidence.row, s.value, s.origin, s.rule]),
    [
      [2, 6, "deduced", "points.sum"],
      [3, 1, "deduced", "points.sum"],
    ],
  );
  assert.deepEqual(mogi.races.find((r) => r.number === 2)!.gameEvidence?.readings[person("ActuFunk")].current, {
    value: 6,
    origin: "deduced",
    sourceCaptureId: c.id,
    sourceRow: 7,
    sourceField: "addition",
  });
});

test("a missing final total of 54 is explained by the sum (missingTotalsByScale)", () => {
  const c = source(12);
  c.numericRows![10].right = { ...c.numericRows![10].right, text: "", value: null, uncertain: true };
  const mogi = ingest(prefix(11), c);
  assert.deepEqual(
    captureExplanation(mogi, c.id).filter((s) => s.kind === "points"),
    [
      { kind: "points", subject: c.id, value: 11, origin: "read", rule: "points.as-shown", evidence: { compared: 12 } },
      {
        kind: "points",
        subject: c.id,
        value: 54,
        origin: "deduced",
        rule: "points.sum",
        evidence: { row: 11, playerId: person("iggy"), readText: "" },
      },
    ],
  );
});

test("values outside the finish order are discarded and deductions enter standings and boundaries (firstRacePermutation)", () => {
  const c = source(0);
  c.numericRows![5].right.value = 6;
  c.numericRows![6].right.value = 7;
  const mogi = ingest(prefix(0), c);
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.deepEqual(Object.fromEntries(individualStandings(mogi).map((p) => [p.loungeName, p.points])), cumulative[0]);
  assert.deepEqual(mogi.captures![0].numericDeductions, [
    { row: 6, field: "right", value: 7, origin: "deduced" },
    { row: 7, field: "right", value: 6, origin: "deduced" },
  ]);
  assert.equal(captureBoundaryValues(mogi.captures![0]).get(person("Tavo"))?.value, 6);
});

test("one missing total is deduced across one or several races without asking continuity or number (missingTotalsByScale)", () => {
  for (const number of [10, 11]) {
    const seed = prefix(0);
    seed.races = Array.from({ length: 9 }, (_, i) => ({
      id: `r${i + 1}`,
      number: i + 1,
      origin: "manual",
      status: "confirmed",
      placements: captureTruth[0].map(person),
    }));
    const c = source(0);
    c.numericRows!.forEach((row, i) => {
      row.right.value = number * P[i];
    });
    c.numericRows![0].right = { ...c.numericRows![0].right, text: "", value: null, uncertain: true };
    const mogi = ingest(seed, c);
    assert.equal(mogi.sequence!.occurrences.find((o) => o.captureIds.includes(c.id))?.number, number);
    assert.deepEqual(mogiQuestions(mogi), []);
    assert.deepEqual(mogi.captures![0].numericDeductions, [
      { row: 1, field: "right", value: number === 10 ? 150 : 165, origin: "deduced" },
    ]);
  }
});

test("Tiny 545 is impossible at race twelve and the vector deduces 54 even if OCR calls it confident (spuriousCharacterCandidate)", () => {
  for (const uncertain of [true, false]) {
    const c = source(12);
    c.numericRows!.forEach((row) =>
      Object.assign(
        row.right,
        tiny.captures[2].right.find((r) => r.row === row.row),
      ),
    );
    c.numericRows![10].right.uncertain = uncertain;
    const mogi = ingest(prefix(11), c);
    assert.deepEqual(mogiQuestions(mogi), []);
    assert.equal(countedRaces(mogi).length, 12);
    assert.deepEqual(
      Object.fromEntries(individualStandings(mogi).map((p) => [p.loungeName, p.points])),
      cumulative[11],
    );
    assert.deepEqual(mogi.captures![0].numericDeductions, [{ row: 11, field: "right", value: 54, origin: "deduced" }]);
    assert.equal(captureBoundaryValues(mogi.captures![0]).get(person("iggy"))?.value, 54);
    assert.deepEqual(
      captureExplanation(mogi, c.id).filter((s) => s.kind === "points" && s.evidence.row),
      [
        {
          kind: "points",
          subject: c.id,
          value: 54,
          origin: "read",
          rule: "points.noise-candidate",
          evidence: { row: 11, playerId: person("iggy"), readText: "545", discarded: 545 },
        },
      ],
    );
    assert.equal(captureExplanation(mogi, c.id).find((s) => s.rule === "points.as-shown")?.value, 11);
  }
});

test("projections of the same question id produce one answer and one header count", async () => {
  const a = source(0),
    b = source(1);
  const reading = a.numericRows![0].right;
  a.numericRows = [
    {
      row: 1,
      right: { ...reading, value: 100, text: "100", uncertain: false },
      addition: { ...reading, value: null, text: "", uncertain: true },
    },
  ];
  b.numericRows = [
    {
      row: 1,
      right: { ...reading, value: 99, text: "99", uncertain: false },
      addition: { ...reading, value: null, text: "", uncertain: true },
    },
  ];
  b.nameAssociations = structuredClone(a.nameAssociations);
  const mogi = ingest(prefix(0), a, b);
  const gap = mogi.sequence!.gaps[0];
  assert.ok(gap);
  mogi.sequence!.gaps.push(structuredClone(gap), structuredClone(gap));
  const queue = mogiQuestions(mogi);
  const question = queue.find((q) => q.kind === "sequence")!;
  assert.equal(queue.filter((q) => q.id === question.id).length, 1);
  assert.deepEqual(mogiOverview(mogi).action, { kind: "questions", count: queue.length });
  const answered = await answerMogiQuestion(mogi, question.id, { kind: "sequence", value: "continuous-12" });
  assert.equal(
    mogiQuestions(answered).some((q) => q.id === question.id),
    false,
  );
});

test("duplicate first-race totals ask only the ambiguous rows, never generic continuity (duplicateFirstRaceRows)", () => {
  const c = source(0);
  c.numericRows![6].right.value = 7;
  const mogi = ingest(prefix(0), c);
  assert.deepEqual(
    mogiQuestions(mogi).map((q) => [q.kind, q.row]),
    [
      ["points", 6],
      ["points", 7],
    ],
  );
  assert.equal(countedRaces(mogi).length, 0);
});

test("a total within the global limit but beyond p + 15 is deduced from the continuous vector (cumulativeInRange)", () => {
  const c = source(12);
  c.numericRows![10].right = { ...c.numericRows![10].right, value: 65, text: "65", uncertain: false };
  const mogi = ingest(prefix(11), c);
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.equal(countedRaces(mogi).length, 12);
  assert.deepEqual(mogi.captures![0].numericDeductions, [{ row: 11, field: "right", value: 54, origin: "deduced" }]);
  assert.deepEqual(
    captureExplanation(mogi, c.id).filter((s) => s.kind === "points" && s.evidence.row),
    [
      {
        kind: "points",
        subject: c.id,
        value: 54,
        origin: "deduced",
        rule: "points.out-of-range",
        evidence: { row: 11, playerId: person("iggy"), readText: "65", discarded: 65 },
      },
    ],
  );
});

test("a total above the global range explains the discarded reading and its replacement (maxGameCumulative)", () => {
  for (const uncertain of [false, true]) {
    const c = source(12);
    c.numericRows![10].right = { ...c.numericRows![10].right, value: 520, text: "520", uncertain };
    const mogi = ingest(prefix(11), c);
    assert.deepEqual(
      captureExplanation(mogi, c.id).filter((s) => s.kind === "points" && s.evidence.row),
      [
        {
          kind: "points",
          subject: c.id,
          value: 54,
          origin: "deduced",
          rule: "points.out-of-range",
          evidence: { row: 11, playerId: person("iggy"), readText: "520", discarded: 520 },
        },
      ],
    );
  }
});

test("a deduced total is retracted by correcting the source, and loading rehydrates the same explanation (spuriousCharacterCandidate)", () => {
  const c = source(12);
  c.numericRows![10].right = { ...c.numericRows![10].right, value: 545, text: "545", uncertain: true };
  const mogi = ingest(prefix(11), c);
  assert.deepEqual(captureExplanation(JSON.parse(JSON.stringify(mogi)), c.id), captureExplanation(mogi, c.id));
  const corrected = structuredClone(mogi);
  corrected.captures![0].numericRows![10].right = {
    ...c.numericRows![10].right,
    value: 54,
    text: "54",
    uncertain: false,
  };
  const result = reconcileSequence(corrected);
  assert.deepEqual(
    captureExplanation(result, c.id).filter((s) => s.kind === "points"),
    [
      {
        kind: "points",
        subject: c.id,
        value: 12,
        origin: "read",
        rule: "points.as-shown",
        evidence: { compared: 12 },
      },
    ],
  );
  assert.equal(captureBoundaryValues(result.captures![0]).get(person("iggy"))?.value, 54);
});

test("an impossible total without an established origin stays a single cropped points question (maxGameCumulative)", () => {
  const c = source(0),
    Q = [12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  c.rows.pop();
  c.nameAssociations!.pop();
  c.numericRows!.pop();
  c.numericRows!.forEach((row, i) => {
    row.right.value = 3 * Q[i];
  });
  c.numericRows![3].right.value = 545;
  const mogi = ingest(prefix(0), c);
  const questions = mogiQuestions(mogi);
  assert.deepEqual(
    questions.map((q) => [q.kind, q.row]),
    [["points", 4]],
  );
  assert.deepEqual(questions[0].crop, { captureId: c.id, location: c.rows[3].location });
  assert.equal(countedRaces(mogi).length, 0);
});

test("a race question suggests the free k that closes the vector and keeps earlier gaps available", () => {
  const c = source(12),
    mogi = prefix(11);
  c.numericRows![10].right = { ...c.numericRows![10].right, text: "545", value: 545, uncertain: true };
  // Race 2 awaits detail; it must not become the suggestion for the final image.
  mogi.races[1] = { ...mogi.races[1], status: "pending", placements: [] };
  mogi.captures = [c];
  const q = mogiQuestions(mogi).find((q) => q.kind === "race");
  assert.ok(q?.kind === "race");
  assert.equal(q.suggestion, 12);
  assert.ok(q.otherRaces?.some((option) => option.value === 2));
});

test("a forgotten race three stays available and suggested after races one, two and four through twelve count", () => {
  const c = source(0),
    mogi = prefix(12);
  mogi.races = mogi.races.filter((race) => race.number !== 3);
  c.numericRows!.forEach((row, i) => {
    row.right = {
      ...row.right,
      text: String(cumulative[2][captureTruth[0][i]]),
      value: cumulative[2][captureTruth[0][i]],
      uncertain: false,
    };
  });
  mogi.captures = [c];
  assert.equal(countedRaces(mogi).length, 11);
  const q = mogiQuestions(mogi).find((q) => q.kind === "race");
  assert.ok(q?.kind === "race", "The forgotten capture must offer its missing race");
  assert.ok(q.options.some((option) => option.value === 3 && option.label === "Race 3"));
  assert.equal(q.suggestion, 3);
});

test("the upper bound p + 15n also rejects an impossible total across two races (cumulativeInRange)", () => {
  const seed = prefix(0),
    c = source(0);
  seed.races = Array.from({ length: 9 }, (_, i) => ({
    id: `r${i + 1}`,
    number: i + 1,
    origin: "manual",
    status: "confirmed",
    placements: captureTruth[0].map(person),
  }));
  c.numericRows!.forEach((row, i) => {
    row.right.value = 11 * P[i];
  });
  c.numericRows![0].right.value = 180;
  const mogi = ingest(seed, c);
  assert.equal(mogi.sequence!.occurrences.find((o) => o.captureIds.includes(c.id))?.number, 11);
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.deepEqual(mogi.captures![0].numericDeductions, [{ row: 1, field: "right", value: 165, origin: "deduced" }]);
});

test("remaining placements determine one step and an ambiguous sum asks only about rows (missingTotalsByScale)", () => {
  const seed = prefix(0);
  seed.races = [
    { id: "r1", number: 1, origin: "manual", status: "confirmed", placements: captureTruth[0].map(person) },
  ];
  const c = source(0);
  c.numericRows!.forEach((row, i) => {
    row.right.value = 2 * P[i];
  });
  c.numericRows!.slice(0, 2).forEach((row) => {
    row.right = { ...row.right, value: null, uncertain: true };
  });
  const unique = ingest(seed, c);
  assert.deepEqual(mogiQuestions(unique), []);
  assert.deepEqual(
    unique.captures![0].numericDeductions?.map((d) => d.value),
    [30, 24],
  );
  const anchor = source(0),
    after = { ...structuredClone(c), id: "later" };
  anchor.numericRows!.forEach((row, i) => {
    row.right.value = 9 * P[i];
  });
  after.numericRows!.slice(2).forEach((row, i) => {
    row.right.value = 11 * P[i + 2];
  });
  const ambiguous = ingest(prefix(0), anchor, after);
  assert.deepEqual(
    mogiQuestions(ambiguous).map((q) => [q.kind, q.row]),
    [
      ["points", 1],
      ["points", 2],
    ],
  );
});

test("numericTextValue: digits the OCR split into spaced items show one number", () => {
  assert.equal(numericTextValue("1 2"), 12);
  assert.equal(numericTextValue("+ 1 5", true), 15);
  assert.equal(numericTextValue("12a"), null);
});

test("one misread game cumulative keeps its sum-derived race and asks for the corroborated total", async () => {
  for (const timed of [true, false]) {
    let mogi = emptyFfaMogi();
    for (let index = 0; index < ffa.captures.length; index++) {
      mogi = await ingestReadings(mogi, [ffaReading(index, timed)]);
      assert.equal(countedRaces(mogi).length, index + 1);
      assert.deepEqual(
        mogiQuestions(mogi).map((q) => [q.kind, q.captureId, q.row, q.suggestion]),
        index ? [["points", "c2", 5, 7]] : [],
      );
      assert.equal(mogi.sequence!.roomAnalysis!.sessions.length, 1);
      if (index === 1)
        assert.equal(
          mogi.captures!.find((capture) => capture.id === "c2")!.numericDeductions!.find((value) => value.row === 7)!
            .value,
          1,
        );
      if (index === 7)
        assert.deepEqual(
          Object.fromEntries(individualStandings(mogi).map((p) => [p.loungeName, p.points])),
          ffa.afterRace8,
        );
    }
    const laterOnly = await ingestReadings(emptyFfaMogi(), [ffaReading(1, timed), ffaReading(2, timed)]);
    assert.deepEqual(
      mogiQuestions(laterOnly).map((q) => [q.kind, q.captureId, q.row, q.suggestion]),
      [["points", "c2", 5, 7]],
    );
    const source = mogi.captures!.find((c) => c.id === "c2")!;
    assert.equal(source.numericRows![4].right.value, 1);
    assert.equal(source.numericAnswers?.length ?? 0, 0);
    const question = mogiQuestions(mogi)[0];
    assert.equal(question.kind === "points" && question.read, 1);
    mogi = (
      await normalizeReconstructions({
        mogis: [await answerMogiQuestion(mogi, question.id, { kind: "points", value: 7 })],
      })
    ).mogis[0];
    assert.deepEqual(mogiQuestions(mogi), []);
  }
});
