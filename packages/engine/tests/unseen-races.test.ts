import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyCaptureContext,
  applyReviewedRace,
  applySequenceAnswer,
  type Capture,
  individualStandings,
  type Mogi,
  mogiOverview,
  mogiQuestions,
  normalizeReconstructions,
  reconcileSequence,
  resultCoverage,
  reviewedRace,
  sequenceInputSignature,
} from "@mkw/engine";

// Genuine R10 OCR; accepted names isolate sequence/coverage from name clarification.
const saved = JSON.parse(readFileSync(new URL("./fixtures/after-r1.json", import.meta.url), "utf8")) as Mogi;
const raw = JSON.parse(readFileSync(new URL("./fixtures/real-captures.json", import.meta.url), "utf8"));
const names = [
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
const aliases: Record<string, string> = {
  CVSPeach: "VSPeach",
  "VS Kamek": "Kameks Eye",
  KRSFunk: "funk2006",
  KRJFunk: "funk2006",
  Ktoad67: "toad67",
  "K toad67": "toad67",
  TKingBoo: "KingBoo",
  "T KingBoo": "KingBoo",
  "Diddy.": "pom",
  "B·ω": "PiranhaPlant",
  "B·W-": "PiranhaPlant",
  Bloop: "BloopMaster",
  Funky: "ActuFunk",
  "F☆ peepa": "iggy",
  "F☆peepa": "iggy",
};
function raceTen(): Mogi {
  const participants = raw.roster.map((p: Mogi["participants"][number]) => ({ ...p, ign: p.loungeName }));
  const capture: Capture = {
    ...structuredClone(raw.captures[9]),
    stage: "context",
    reviewedAt: "",
    reviewedPlacements: [],
    rows: raw.captures[9].rows.map((row: Capture["rows"][number]) => ({
      ...row,
      uncertain: false,
      suggestedParticipantId: participants.find(
        (p: Mogi["participants"][number]) => p.loungeName === (aliases[row.text] ?? row.text),
      )!.id,
    })),
  };
  capture.nameAssociations = capture.rows.map((row) => ({ participantId: row.suggestedParticipantId }));
  const mogi = {
    ...saved,
    participants,
    races: [],
    captures: [],
    sequence: undefined,
    coverage: undefined,
    assistance: undefined,
  };
  return reconcileSequence(
    applyCaptureContext(mogi, capture, {
      placements: [],
      absentParticipantIds: [],
      reviewed: false,
      nameAssociations: capture.nameAssociations,
    }),
  );
}

test("the first real image of race 10 deduces nine unseen races without inventing results or questions", () => {
  const mogi = raceTen();
  assert.deepEqual(
    mogi.races.map((race) => race.number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.ok(
    mogi.races.slice(0, 9).every((race) => !race.placements.length && !race.captureIds?.length && !race.nativePoints),
  );
  assert.deepEqual(
    mogiOverview(mogi).positions.map((p) => p.state),
    [
      "unseen",
      "unseen",
      "unseen",
      "unseen",
      "unseen",
      "unseen",
      "unseen",
      "unseen",
      "unseen",
      "counted",
      "future",
      "future",
    ],
  );
  assert.deepEqual(resultCoverage(mogi).pending, []);
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.deepEqual(Object.fromEntries(individualStandings(mogi).map((p) => [p.loungeName, p.points])), {
    VSPeach: 87,
    "Kameks Eye": 107,
    funk2006: 92,
    toad67: 62,
    Tavo: 61,
    KingBoo: 79,
    pom: 78,
    DonkeyKong: 56,
    PiranhaPlant: 45,
    BloopMaster: 67,
    ActuFunk: 43,
    iggy: 43,
  });
  assert.deepEqual(new Set(individualStandings(mogi).map((p) => p.loungeName)), new Set(names));
});

test("editing unseen race 3 keeps the evidence, recomputes the sequence and keeps the race 10 totals", async () => {
  let mogi = (await normalizeReconstructions({ mogis: [raceTen()] })).mogis[0];
  const third = mogi.races.find((race) => race.number === 3)!;
  const capture = structuredClone(mogi.captures);
  const result = reviewedRace(
    third,
    { placements: mogi.participants.map((p) => p.id), absentParticipantIds: [], reviewed: true },
    mogi.participants,
  )!;
  mogi = (await normalizeReconstructions({ mogis: [applyReviewedRace(mogi, result)] })).mogis[0];
  assert.equal(mogi.races.find((race) => race.id === third.id)?.origin, "manual");
  assert.equal(mogi.races.find((race) => race.number === 10)?.number, 10);
  assert.deepEqual(
    mogi.captures?.map((c) => [c.id, c.rows, c.numericRows]),
    capture?.map((c) => [c.id, c.rows, c.numericRows]),
  );
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.equal(individualStandings(mogi).find((p) => p.loungeName === "Kameks Eye")?.points, 107);
  assert.deepEqual(
    mogiOverview(mogi)
      .positions.slice(0, 4)
      .map((p) => p.state),
    ["unseen", "unseen", "counted", "unseen"],
  );
});

test("editing race 3 against the cumulatives reopens a question without erasing the user's fact", async () => {
  let mogi = raceTen();
  const iggy = mogi.participants.find((p) => p.loungeName === "iggy")!.id;
  const placements = [iggy, ...mogi.participants.filter((p) => p.id !== iggy).map((p) => p.id)];
  for (const number of [1, 2]) {
    const race = mogi.races.find((r) => r.number === number)!;
    mogi = reconcileSequence(
      applyReviewedRace(
        mogi,
        reviewedRace(race, { placements, absentParticipantIds: [], reviewed: true }, mogi.participants)!,
      ),
    );
  }
  assert.deepEqual(mogiQuestions(mogi), []);
  const third = mogi.races.find((r) => r.number === 3)!;
  mogi = (
    await normalizeReconstructions({
      mogis: [
        applyReviewedRace(
          mogi,
          reviewedRace(third, { placements, absentParticipantIds: [], reviewed: true }, mogi.participants)!,
        ),
      ],
    })
  ).mogis[0];
  assert.deepEqual(mogi.races.find((r) => r.id === third.id)?.placements, placements);
  assert.equal(mogi.captures?.length, 1);
  assert.ok(mogiQuestions(mogi).some((q) => q.kind === "race" || q.kind === "points" || q.kind === "sequence"));
  assert.ok(!resultCoverage(mogi).included.includes(10));
});

test("an absence entered in race 3 requires clarifying the first image without erasing the edit", async () => {
  const initial = raceTen();
  const third = initial.races.find((r) => r.number === 3)!;
  const absent = initial.participants[0].id;
  const result = reviewedRace(
    third,
    {
      placements: initial.participants.slice(1).map((p) => p.id),
      absentParticipantIds: [absent],
      reviewed: true,
    },
    initial.participants,
  )!;
  const mogi = (await normalizeReconstructions({ mogis: [applyReviewedRace(initial, result)] })).mogis[0];
  assert.deepEqual(mogi.races.find((r) => r.id === third.id)?.absentParticipantIds, [absent]);
  assert.equal(mogi.captures?.length, 1);
  assert.ok(mogiQuestions(mogi).some((q) => q.kind === "race" || q.kind === "sequence" || q.kind === "points"));
  assert.ok(!resultCoverage(mogi).included.includes(10));
});

test("an absence edited after a known prefix withdraws the first image's deduction", async () => {
  let mogi = raceTen();
  const first = mogi.races.find((r) => r.number === 1)!;
  const placements = mogi.participants.map((p) => p.id);
  mogi = reconcileSequence(
    applyReviewedRace(
      mogi,
      reviewedRace(first, { placements, absentParticipantIds: [], reviewed: true }, mogi.participants)!,
    ),
  );
  assert.deepEqual(mogiQuestions(mogi), []);
  const third = mogi.races.find((r) => r.number === 3)!;
  const result = reviewedRace(
    third,
    { placements: placements.slice(1), absentParticipantIds: [placements[0]], reviewed: true },
    mogi.participants,
  )!;
  mogi = (await normalizeReconstructions({ mogis: [applyReviewedRace(mogi, result)] })).mogis[0];
  assert.deepEqual(mogi.races.find((r) => r.id === third.id)?.absentParticipantIds, [placements[0]]);
  assert.ok(mogiQuestions(mogi).some((q) => q.kind === "race" || q.kind === "sequence" || q.kind === "points"));
});

test("an explicitly confirmed origin keeps earlier races unseen", () => {
  let mogi = raceTen();
  const captureId = mogi.captures![0].id;
  mogi = reconcileSequence(
    applySequenceAnswer(mogi, { kind: "origin", captureId, value: "zero-valid-12" }, sequenceInputSignature(mogi)),
  );
  assert.equal(mogiOverview(mogi).positions[2].state, "unseen");
  assert.equal(individualStandings(mogi).find((p) => p.loungeName === "Kameks Eye")?.points, 107);
});
