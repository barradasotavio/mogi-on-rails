import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  answerMogiQuestion,
  applyCaptureContext,
  applyReviewedRace,
  countedRaces,
  individualStandings,
  initialRaceReview,
  type Mogi,
  mogiOverview,
  mogiQuestions,
  normalizeReconstructions,
  reconcileSequence,
  reviewedRace,
  sourcePairSignature,
  withdrawManualResult,
} from "@mkw/engine";

import { questionsWithOverviewInvariant } from "./support/question-invariant.ts";

const truth = JSON.parse(readFileSync(new URL("./fixtures/mogi-truth.json", import.meta.url), "utf8")) as {
  races: { race: number; placements: string[] }[];
};
const cumulative = JSON.parse(readFileSync(new URL("./fixtures/cumulative.json", import.meta.url), "utf8")) as Record<
  string,
  number
>[];
function fixture(name: "after-r1" | "after-r2" | "after-r6"): Mogi {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

test("reconciling the real sixth capture counts races one through six with the checked cumulative totals", async () => {
  const mogi = (await normalizeReconstructions({ mogis: [fixture("after-r6")] })).mogis[0];
  assert.deepEqual(
    countedRaces(mogi).map((race) => race.number),
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])),
    cumulative[5],
  );
  assert.deepEqual(mogiQuestions(mogi), []);
});

test("a cumulative capture with an established sequence number needs no repeated race answer", async () => {
  const input = (await normalizeReconstructions({ mogis: [fixture("after-r6")] })).mogis[0];
  const last = input.races.find((race) => race.number === 6)!;
  input.races = input.races.map((race) =>
    race.id === last.id
      ? { ...race, status: "pending", origin: "observed", placements: [], reconstruction: undefined }
      : race,
  );
  input.sequence!.numbers = input.sequence!.numbers.filter((fact) => fact.captureId !== input.captures![5].id);
  const mogi = reconcileSequence(input);
  assert.equal(mogi.races.find((race) => race.id === last.id)!.status, "confirmed");
  assert.deepEqual(
    Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])),
    cumulative[5],
  );
});

test("the six real captures applied one at a time match each checked cumulative total", async () => {
  const input = fixture("after-r6");
  let mogi: Mogi = { ...input, races: [], captures: [], sequence: undefined, coverage: undefined };
  for (const [index, source] of input.captures!.entries()) {
    mogi = applyCaptureContext(mogi, source, {
      placements: [],
      absentParticipantIds: [],
      rawOverrides: {},
      reviewed: false,
      nameAssociations: source.nameAssociations,
    });
    mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
    for (let step = 0; step < 12; step++) {
      const question = mogiQuestions(mogi)[0];
      if (!question) break;
      assert.ok(question.kind === "race" || question.kind === "sequence");
      mogi = await answerMogiQuestion(
        mogi,
        question.id,
        question.kind === "race" ? { kind: "race", value: index + 1 } : { kind: "sequence", value: "continuous-12" },
      );
      mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
    }
    mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
    assert.deepEqual(
      countedRaces(mogi).map((race) => race.number),
      Array.from({ length: index + 1 }, (_, n) => n + 1),
    );
    assert.deepEqual(
      Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])),
      cumulative[index],
    );
    assert.deepEqual(questionsWithOverviewInvariant(mogi), []);
  }
});

test("an ambiguous early source withdraws only results without independent evidence", async () => {
  const input = (await normalizeReconstructions({ mogis: [fixture("after-r6")] })).mogis[0];
  input.captures![0].numericRows![0].right.value = 12;
  const mogi = (await normalizeReconstructions({ mogis: [input] })).mogis[0];
  assert.equal(mogi.races.find((race) => race.number === 1)!.status, "pending");
  assert.equal(mogi.races.find((race) => race.number === 5)!.status, "confirmed");
});

test("revoking a reconstructed prefix also withdraws the next cumulative deduction before publishing totals", async () => {
  const input = (await normalizeReconstructions({ mogis: [fixture("after-r6")] })).mogis[0];
  for (const source of input.captures!.slice(2)) for (const row of source.numericRows!) row.right.uncertain = true;
  const mogi = (await normalizeReconstructions({ mogis: [input] })).mogis[0];
  assert.equal(mogi.races.find((race) => race.number === 3)!.status, "pending");
  assert.equal(mogi.races.find((race) => race.number === 5)!.status, "pending");
  const repeated = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  assert.deepEqual(
    repeated.races.map((race) => [race.number, race.status, race.placements]),
    mogi.races.map((race) => [race.number, race.status, race.placements]),
  );
});

test("a non-native cumulative difference asks real point questions that can repair the pending race", async () => {
  const input = fixture("after-r6");
  input.races = input.races.slice(0, 5);
  input.captures = input.captures!.slice(0, 5);
  const source = input.captures[4],
    expected = source.numericRows![0].right.value!;
  source.numericRows![0].right.value = expected + 1;
  const pending = (await normalizeReconstructions({ mogis: [input] })).mogis[0];
  assert.equal(pending.races.find((race) => race.number === 5)!.status, "pending");
  const question = questionsWithOverviewInvariant(pending).find(
    (question) => question.kind === "points" && question.captureId === source.id && question.row === 1,
  );
  assert.ok(question, "the pending difference must have an answerable queue page");
  assert.equal(
    mogiOverview(pending).positions[4].questionCount,
    mogiQuestions(pending).filter((question) => question.number === 5).length,
  );
  const repaired = (
    await normalizeReconstructions({
      mogis: [await answerMogiQuestion(pending, question.id, { kind: "points", value: expected })],
    })
  ).mogis[0];
  assert.deepEqual(
    countedRaces(repaired).map((race) => race.number),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    Object.fromEntries(individualStandings(repaired).map((person) => [person.loungeName, person.points])),
    cumulative[4],
  );
});

test("cumulative deduction preserves discard, review, absence, identity and native-point safeguards", () => {
  const cases: [string, (mogi: Mogi) => void][] = [
    [
      "discarded target",
      (mogi) => {
        mogi.races[4].status = "discarded";
      },
    ],
    [
      "discarded prefix",
      (mogi) => {
        mogi.races[1].status = "discarded";
      },
    ],
    [
      "reopened target",
      (mogi) => {
        mogi.races[4].participationReview = "Review";
      },
    ],
    [
      "reopened prefix",
      (mogi) => {
        mogi.races[1].participationReview = "Review";
      },
    ],
    [
      "absent target",
      (mogi) => {
        mogi.races[4].absentParticipantIds = [mogi.participants[0].id];
      },
    ],
    [
      "absent prefix",
      (mogi) => {
        mogi.races[1].absentParticipantIds = [mogi.participants[0].id];
      },
    ],
    [
      "ambiguous names",
      (mogi) => {
        mogi.captures![4].nameAssociations![0] = { participantId: null };
        mogi.captures![4].nameAssociations![1] = { participantId: null };
        mogi.captures![4].rows[0].text = "Unresolved A";
        mogi.captures![4].rows[1].text = "Unresolved B";
      },
    ],
    [
      "different native points",
      (mogi) => {
        const race = mogi.races[1];
        race.nativePoints![race.placements[0]] = 14;
      },
    ],
    [
      "different target native points",
      (mogi) => {
        mogi.races[4].nativePoints = { [mogi.participants[0].id]: 0 };
      },
    ],
    [
      "ambiguous repeated gains",
      (mogi) => {
        const c = mogi.captures![4];
        const names = c
          .nameAssociations!.slice(0, 2)
          .map((a) => mogi.participants.find((p) => p.id === a.participantId)!.loungeName);
        c.numericRows![0].right.value =
          cumulative[3][names[0]] + c.numericRows![1].right.value! - cumulative[3][names[1]];
      },
    ],
  ];
  for (const [reason, change] of cases) {
    const input = fixture("after-r6");
    input.races = input.races.slice(0, 5);
    input.captures = input.captures!.slice(0, 5);
    change(input);
    assert.notEqual(
      reconcileSequence(input).races.find((race) => race.id === input.races[4].id)!.status,
      "confirmed",
      reason,
    );
  }
});

test("divergent native points on an already deduced race remain a conflict after revalidation", async () => {
  const input = (await normalizeReconstructions({ mogis: [fixture("after-r6")] })).mogis[0];
  const target = input.races.find((race) => race.number === 5)!;
  target.nativePoints![target.placements[0]] = 14;
  const mogi = reconcileSequence(input);
  assert.equal(mogi.races.find((race) => race.id === target.id)!.status, "pending");
});

test("a proven prefix total determines the next race even while its earlier detail is pending", () => {
  const input = fixture("after-r1");
  const prefix = structuredClone(input.captures![0]),
    last = structuredClone(prefix);
  for (const [source, id, number] of [
    [prefix, "prefix", 3],
    [last, "last", 4],
  ] as const) {
    source.id = id;
    source.context = { phase: "after", raceId: id };
    source.reviewedPlacements = [];
    for (const row of source.numericRows!) row.right.value! *= number;
    input.races.push({ id, number, origin: "observed", status: "pending", placements: [], captureIds: [id] });
    input.sequence!.numbers.push({ captureId: id, number, phase: "after" });
  }
  input.races.push({ id: "gap2", number: 2, origin: "manual", status: "pending", placements: [] });
  input.captures!.push(prefix, last);
  input.sequence!.origins = [
    { captureId: prefix.id, signature: sourcePairSignature(prefix, prefix), answer: "zero-valid-12" },
  ];
  const mogi = reconcileSequence(input);
  assert.equal(mogi.races.find((race) => race.id === "last")!.status, "confirmed");
  assert.deepEqual(
    mogi.races
      .find((race) => race.id === "last")!
      .placements.map((id) => mogi.participants.find((person) => person.id === id)!.loungeName),
    truth.races[0].placements,
  );
  assert.equal(mogi.races.find((race) => race.id === "gap2")!.status, "pending");
  assert.equal(
    reconcileSequence({ ...mogi, sequence: { ...mogi.sequence!, origins: [] } }).races.find(
      (race) => race.id === "last",
    )!.status,
    "confirmed",
  );
});

test("the last name answer counts real race one from its final cumulative points", async () => {
  const input = fixture("after-r1");
  const capture = input.captures![0];
  const answer = capture.nameAssociations![11];
  capture.nameAssociations![11] = { participantId: null };
  const question = mogiQuestions(input).find((question) => question.kind === "name")!;
  const answered = await answerMogiQuestion(input, question.id, {
    kind: "name",
    answer: { participantId: answer.participantId! },
  });
  const mogi = (await normalizeReconstructions({ mogis: [answered] })).mogis[0];
  assert.equal(countedRaces(mogi).length, 1);
  assert.deepEqual(
    mogi.races[0].placements.map((id) => mogi.participants.find((person) => person.id === id)!.loungeName),
    truth.races[0].placements,
  );
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.deepEqual(mogiOverview(mogi).action, { kind: "copy-table" });
});

test("both real races count with the independently checked combined totals", async () => {
  const mogi = (await normalizeReconstructions({ mogis: [fixture("after-r2")] })).mogis[0];
  assert.deepEqual(
    countedRaces(mogi).map((race) => race.number),
    [1, 2],
  );
  for (const expected of truth.races.slice(0, 2)) {
    assert.deepEqual(
      mogi.races
        .find((race) => race.number === expected.race)!
        .placements.map((id) => mogi.participants.find((person) => person.id === id)!.loungeName),
      expected.placements,
    );
  }
  assert.deepEqual(Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])), {
    VSPeach: 22,
    "Kameks Eye": 12,
    funk2006: 16,
    toad67: 7,
    Tavo: 18,
    KingBoo: 22,
    pom: 13,
    DonkeyKong: 11,
    PiranhaPlant: 7,
    BloopMaster: 14,
    ActuFunk: 9,
    iggy: 13,
  });
});

test("real race two needs no continuity answer when its displayed prior points match proven race one", async () => {
  const input = fixture("after-r2");
  input.sequence!.links = [];
  const mogi = (await normalizeReconstructions({ mogis: [input] })).mogis[0];
  assert.equal(
    mogiQuestions(mogi).some((question) => question.kind === "sequence"),
    false,
  );
  assert.deepEqual(mogiOverview(mogi).action, { kind: "copy-table" });
});

test("a contradictory D1 prior total asks one numeric correction and preserves the OCR", async () => {
  let mogi = fixture("after-r2");
  mogi.sequence!.links = [];
  const source = mogi.captures![1];
  source.numericRows![0].right.value = 8;
  mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  const question = mogiQuestions(mogi).find((q) => q.kind === "points" && q.row === 1);
  assert.ok(question);
  assert.equal(
    mogiQuestions(mogi).some((q) => q.kind === "sequence"),
    false,
  );
  const answered = await answerMogiQuestion(mogi, question.id, { kind: "points", value: 7 });
  mogi = (await normalizeReconstructions({ mogis: [answered] })).mogis[0];
  assert.equal(mogi.captures![1].numericRows![0].right.value, 8);
  assert.equal(mogiQuestions(mogi).length, 0);
});

test("overview questions correspond to queue pages for every real fixture and partial name state", async () => {
  for (const name of ["after-r1", "after-r2"] as const)
    for (const reverse of [false, true]) {
      for (let unresolved = 0; unresolved <= 12; unresolved++) {
        const input = fixture(name);
        for (const source of input.captures!)
          for (let row = 0; row < unresolved; row++) source.nameAssociations![row] = { participantId: null };
        if (reverse) input.captures!.reverse();
        questionsWithOverviewInvariant(input);
        questionsWithOverviewInvariant((await normalizeReconstructions({ mogis: [input] })).mogis[0]);
      }
    }
});

test("correcting the first race's points recalculates its result and ambiguous evidence withdraws it", async () => {
  const input = (await normalizeReconstructions({ mogis: [fixture("after-r1")] })).mogis[0];
  const source = input.captures![0],
    race = input.races[0];
  const corrected = applyCaptureContext(
    input,
    source,
    {
      ...initialRaceReview(race),
      nameAssociations: source.nameAssociations,
      numericAnswers: [
        { row: 1, field: "right", value: 12 },
        { row: 2, field: "right", value: 15 },
      ],
    },
    race.id,
  );
  const mogi = (await normalizeReconstructions({ mogis: [corrected] })).mogis[0];
  assert.deepEqual(mogi.races[0].placements.slice(0, 2), [race.placements[1], race.placements[0]]);
  mogi.captures![0].numericAnswers = [];
  mogi.captures![0].numericRows![0].right.value = 12;
  const withdrawn = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  assert.equal(countedRaces(withdrawn).length, 0);
  assert.deepEqual(withdrawn.races[0].placements, []);
});

test("a manual first-race result survives changes to its cumulative context", async () => {
  let mogi = (await normalizeReconstructions({ mogis: [fixture("after-r1")] })).mogis[0];
  const placements = [...mogi.races[0].placements].reverse();
  mogi = applyReviewedRace(mogi, { ...mogi.races[0], placements });
  mogi.captures![0].numericRows![0].right.uncertain = true;
  const normalized = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  assert.deepEqual(normalized.races[0].placements, placements);
  assert.equal(countedRaces(normalized).length, 1);
});

test("first-race inference requires a supported number, resolved identities and a unique native vector", async () => {
  // j=1 proves the session's finish order even with an explicit k and an earlier gap.
  const shifted = fixture("after-r1");
  shifted.sequence!.numbers[0].number = 2;
  shifted.races[0].number = 2;
  const numbered = (await normalizeReconstructions({ mogis: [shifted] })).mogis[0];
  assert.equal(numbered.races.find((r) => r.number === 2)?.status, "confirmed");
  assert.equal(numbered.races.find((r) => r.number === 1)?.status, "pending");
  assert.ok(individualStandings(numbered).every((p) => p.points === null));
  const cases: ((mogi: Mogi) => void)[] = [
    (mogi) => {
      mogi.captures![0].nameAssociations![11] = { participantId: null, unlinked: true };
      mogi.captures![0].nameAssociations![10] = { participantId: null, unlinked: true };
    },
    (mogi) => {
      mogi.captures![0].numericRows![0].right.value = 12;
    },
    (mogi) => {
      mogi.captures![0].numericRows![0].right.value = 14;
      mogi.captures![0].numericRows![10].right.value = 3;
    },
    (mogi) => {
      mogi.captures![0].interpretation!.screen = "twoColumns";
      mogi.captures![0].context!.phase = "before";
      mogi.sequence!.numbers[0].phase = "before";
    },
  ];
  for (const change of cases) {
    const input = fixture("after-r1");
    change(input);
    const mogi = (await normalizeReconstructions({ mogis: [input] })).mogis[0];
    assert.equal(countedRaces(mogi).length, 0);
  }
});

test("first-race placements follow point values regardless of row order and preserve the recognition", async () => {
  const input = fixture("after-r1"),
    source = input.captures![0];
  source.rows.reverse();
  source.nameAssociations!.reverse();
  source.numericRows = source.numericRows!.reverse().map((row, index) => ({ ...row, row: index + 1 }));
  const recognition = structuredClone([source.rows, source.numericRows, source.interpretation]);
  const once = (await normalizeReconstructions({ mogis: [input] })).mogis[0];
  const twice = (await normalizeReconstructions({ mogis: [once] })).mogis[0];
  assert.deepEqual(
    twice.races[0].placements.map((id) => twice.participants.find((person) => person.id === id)!.loungeName),
    truth.races[0].placements,
  );
  assert.deepEqual(twice.races[0].placements, once.races[0].placements);
  assert.deepEqual(
    [twice.captures![0].rows, twice.captures![0].numericRows, twice.captures![0].interpretation],
    recognition,
  );
});

test("withdrawManualResult returns a race edited with a false absence, and the races after it, to what the images prove", async () => {
  const proven = (await normalizeReconstructions({ mogis: [fixture("after-r6")] })).mogis[0];
  const first = proven.races.find((race) => race.number === 1)!;
  const [absent, ...placements] = first.placements;
  const edit = reviewedRace(
    first,
    { placements, absentParticipantIds: [absent], rawOverrides: {}, reviewed: false },
    proven.participants,
  )!;
  const edited = (await normalizeReconstructions({ mogis: [applyReviewedRace(proven, edit)] })).mogis[0];
  assert.equal(edited.races.find((race) => race.id === first.id)!.origin, "manual");
  const standings = (mogi: Mogi) =>
    Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points]));
  assert.notDeepEqual(standings(edited), cumulative[5]);
  const restored = (await normalizeReconstructions({ mogis: [withdrawManualResult(edited, first.id)] })).mogis[0];
  assert.equal(restored.races.find((race) => race.id === first.id)!.origin, first.origin);
  assert.deepEqual(
    restored.races.map((race) => [race.number, race.status, race.placements, race.absentParticipantIds ?? []]),
    proven.races.map((race) => [race.number, race.status, race.placements, race.absentParticipantIds ?? []]),
  );
  assert.deepEqual(standings(restored), cumulative[5]);
});

test("once the sequence no longer conflicts, its review on emptied races is dropped and the images count them again", async () => {
  const proven = (await normalizeReconstructions({ mogis: [fixture("after-r6")] })).mogis[0];
  const flagged = {
    ...proven,
    races: proven.races.map((race) =>
      race.number === 1
        ? race
        : {
            ...race,
            status: "pending" as const,
            placements: [],
            absentParticipantIds: [],
            nativePoints: undefined,
            nativePointOrigins: undefined,
            participationReview: "The sequence changed. Check this race before using its breakdown.",
          },
    ),
  };
  const restored = (await normalizeReconstructions({ mogis: [flagged] })).mogis[0];
  assert.deepEqual(
    restored.races.map((race) => [race.number, race.status, race.participationReview]),
    proven.races.map((race) => [race.number, "confirmed", undefined]),
  );
  assert.deepEqual(
    Object.fromEntries(individualStandings(restored).map((person) => [person.loungeName, person.points])),
    cumulative[5],
  );
});
