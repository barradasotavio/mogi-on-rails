import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  countedRaces,
  individualStandings,
  type Mogi,
  mogiPlayerChanges,
  mogiQuestions,
  resultCoverage,
  teamStandings,
} from "@mkw/engine";

import {
  emptyFfaMogi,
  emptyRealMogi,
  ingestReadings,
  ingestReal,
  replayReal,
  restartedFfa,
} from "./support/real-captures.ts";

test("the thirteen real captures keep their EXIF moments on ingestion", async () => {
  const mogi = await ingestReal(
    emptyRealMogi(),
    Array.from({ length: 13 }, (_, i) => i),
  );
  assert.deepEqual(
    mogi.captures!.map((capture) => capture.photoMoment?.source),
    Array(13).fill("exif"),
  );
  assert.equal(mogi.captures![0].photoMoment?.at, Date.parse("2026-10-27T10:37:55-03:00"));
});

test("the real batch counts one question for the pair one answer resolves", async () => {
  const { mogiOverview, mogiQuestions, answerMogiQuestion } = await import("@mkw/engine");
  const mogi = await ingestReal(
    emptyRealMogi(),
    Array.from({ length: 13 }, (_, i) => i),
  );
  assert.deepEqual(mogiOverview(mogi).action, { kind: "questions", count: 1 });
  const question = mogiQuestions(mogi)[0];
  assert.equal(question.kind, "name");
  const answered = await answerMogiQuestion(mogi, question.id, {
    kind: "name",
    answer: {
      participantId: mogi.participants.find((person) => person.loungeName === "iggy")!.id,
    },
  });
  assert.deepEqual(mogiQuestions(answered), []);
});

test("an OCR variation on the teammate doesn't duplicate the same team's question", async () => {
  const { ingestReadings, raw } = await import("./support/real-captures.ts");
  const { mogiOverview, mogiQuestions, answerMogiQuestion } = await import("@mkw/engine");
  const sources = structuredClone(raw.captures);
  sources[1].rows.find((row) => row.text === "Funky")!.text = "Funkl";
  sources[2].rows.find((row) => row.text === "F☆ peepa")!.text = "F☆ peeqa";
  const mogi = await ingestReadings(emptyRealMogi(), sources);
  assert.deepEqual(mogiOverview(mogi).action, { kind: "questions", count: 1 });
  const question = mogiQuestions(mogi)[0];
  const answered = await answerMogiQuestion(mogi, question.id, {
    kind: "name",
    answer: {
      participantId: mogi.participants.find((person) => person.loungeName === "iggy")!.id,
    },
  });
  assert.deepEqual(mogiQuestions(answered), []);
});

test("real D1 with an unreadable total still has a single native anchor", async () => {
  const { mogiQuestions } = await import("@mkw/engine");
  const mogi = await ingestReal(emptyRealMogi(), [1]);
  assert.equal(
    mogiQuestions(mogi).some((question) => question.kind === "race"),
    false,
  );
  assert.equal(mogi.sequence?.occurrences[0].number, 2);
});

test("a real batch of five asks at most one name and checks every partial", async () => {
  const result = await replayReal([[0, 1, 2, 3, 4]]);
  assert.equal(result.counts.race, 0);
  assert.equal(result.counts.sequence, 0);
  assert.equal(result.counts.position, 0);
  assert.ok(result.counts.name <= 1, JSON.stringify(result.counts));
  console.log(JSON.stringify({ scenario: "batch5", counts: result.counts }));
});

for (const [scenario, batches] of [
  ["iterative", Array.from({ length: 13 }, (_, index) => [index])],
  ["full batch", [Array.from({ length: 13 }, (_, index) => index)]],
] as const)
  test(`${scenario} checks every race without repeating questions or asking race, continuity or position`, async () => {
    const result = await replayReal(batches.map((batch) => [...batch]));
    console.log(JSON.stringify({ scenario, counts: result.counts }));
    assert.equal(result.counts.race, 0);
    assert.equal(result.counts.sequence, 0);
    assert.equal(result.counts.position, 0);
    assert.ok(result.counts.name <= 1, JSON.stringify(result.counts));
    if (scenario === "full batch") assertPlayerChanges(result.mogi);
  });

test("two screenshots of the same anchor merge in the batch and in iterative upload", async () => {
  const { ingestReadings, raw, checkTotals } = await import("./support/real-captures.ts");
  const { countedRaces, mogiQuestions } = await import("@mkw/engine");
  const completed = (await replayReal([[0, 1, 2, 3, 4]])).mogi;
  const duplicates = [0, 1, 2, 3, 4].map((index) => ({
    ...structuredClone(raw.captures[index]),
    id: `duplicate-${index}`,
  }));
  const once = await ingestReadings(completed, duplicates);
  assert.deepEqual(mogiQuestions(once), []);
  assert.equal(countedRaces(once).length, 5);
  checkTotals(once, 5);
  for (const duplicate of duplicates) {
    const occurrence = once.sequence!.occurrences.find((entry) => entry.captureIds.includes(duplicate.id))!;
    assert.ok(occurrence.captureIds.includes(raw.captures[Number(duplicate.id.split("-")[1])].id));
  }
});

test("finish orders with pending identities get reading questions, never position questions", async () => {
  const { inferenceFixture } = await import("./support/mogi.ts");
  const { assistanceTargets, setAssistanceAnalysis, solveAssistance, mogiQuestions } = await import("@mkw/engine");
  const input = inferenceFixture(12, 4, [57, 51, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4]);
  const pending = setAssistanceAnalysis(input, await solveAssistance(input, assistanceTargets(input), []));
  assert.ok(mogiQuestions(pending).some((question) => question.kind === "position"));
  pending.captures = assistanceTargets(pending).map((race) => ({
    id: `source-${race.id}`,
    width: 1920,
    height: 1080,
    stage: "context",
    context: { phase: "after", raceId: race.id },
    reviewedAt: "",
    reviewedPlacements: [],
    interpretation: {
      version: 1,
      screen: "finishOrderAdding",
      origin: "visual",
      positions: [],
      movementRows: [],
      reasons: [],
    },
    rows: input.participants.map((_, index) => ({
      text: `Reading ${index}`,
      confidence: 100,
      uncertain: true,
      suggestedParticipantId: "",
    })),
    nameAssociations: input.participants.map(() => ({ participantId: null })),
  }));
  assert.equal(
    mogiQuestions(pending).some((question) => question.kind === "position"),
    false,
  );
  assert.ok(mogiQuestions(pending).some((question) => question.kind === "name"));
});

test("D1 with a consistent addition suggestion deduces the race and keeps the raw reading", async () => {
  const { ingestReadings, raw } = await import("./support/real-captures.ts");
  const { mogiQuestions } = await import("@mkw/engine");
  const source = structuredClone(raw.captures[1]);
  source.numericRows![2].addition.uncertain = true;
  const mogi = await ingestReadings(emptyRealMogi(), [source]);
  assert.equal(
    mogiQuestions(mogi).some((question) => question.kind === "race"),
    false,
  );
  assert.deepEqual(mogi.captures![0].numericRows, source.numericRows);
});

for (const [scenario, batches] of [
  ["duplicated batch", [[0, 1, 2, 3, 4]]],
  ["duplicated iterative", Array.from({ length: 13 }, (_, index) => [index])],
  ["reversed batch", [[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]],
] as const)
  test(`${scenario} keeps anchors, answers and totals`, async () => {
    const result = await replayReal(
      batches.map((batch) => [...batch]),
      true,
      scenario !== "reversed batch",
    );
    assert.equal(result.counts.race + result.counts.sequence + result.counts.position, 0);
    assert.ok(result.counts.name <= 1, JSON.stringify(result.counts));
  });

test("an answered reset blocks reusing the old totals to identify rows", async () => {
  const { reconcileSequence, sourcePairSignature } = await import("@mkw/engine");
  const input = (await replayReal([[0]])).mogi;
  const pending = await ingestReal(input, [1]);
  const source = pending.captures![1];
  source.nameAssociations![3] = { participantId: null };
  source.nameAssociations![7] = { participantId: null };
  // Without a spelling or a tag, only the earlier totals can identify these two rows.
  source.rows[3].text = "?";
  source.rows[7].text = "!";
  const continuous = reconcileSequence(pending);
  assert.ok(continuous.captures![1].nameAssociations![3].participantId);
  assert.ok(continuous.captures![1].nameAssociations![7].participantId);
  assert.equal(continuous.captures![1].nameAssociations![3].origin, "deduced");
  assert.equal(continuous.captures![1].nameAssociations![7].origin, "deduced");
  pending.sequence!.links = [
    {
      fromCaptureId: pending.captures![0].id,
      toCaptureId: source.id,
      signature: sourcePairSignature(pending.captures![0], source),
      continuity: "reset",
    },
  ];
  const result = reconcileSequence(pending);
  assert.equal(result.captures![1].nameAssociations![3].participantId, null);
  assert.equal(result.captures![1].nameAssociations![7].participantId, null);
});

test("numberedRoomSpan and provenIntervals cover pending breakdowns without known positions", async () => {
  const { mogi } = await replayReal(
    [0, 1, 2, 3, 5, 6, 7, 9, 10, 11, 12].map((index) => [index]),
    false,
    false,
    false,
  );
  const question = mogiQuestions(mogi)[0];
  assert.equal(question?.kind, "position");
  assert.equal(question.number, 5);
  assert.equal(resultCoverage(mogi).complete, true);
  const cumulative = JSON.parse(readFileSync(new URL("./fixtures/cumulative.json", import.meta.url), "utf8"));
  assert.deepEqual(
    Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])),
    cumulative[11],
  );
  assert.deepEqual(
    teamStandings(mogi).map((team) => team.points),
    [220, 196, 166, 164, 131, 107],
  );
  for (const number of [5, 6, 9, 10])
    assert.equal(mogi.races.find((race) => race.number === number)?.status, "pending");
});

function assertPlayerChanges(mogi: Mogi) {
  const cumulative = JSON.parse(readFileSync(new URL("./fixtures/cumulative.json", import.meta.url), "utf8")) as Record<
    string,
    number
  >[];
  const [before, after] = [cumulative[10], cumulative[11]];
  const rank = (totals: Record<string, number>, name: string) =>
    1 + Object.values(totals).filter((points) => points > totals[name]).length;
  assert.deepEqual(
    Object.fromEntries(
      mogiPlayerChanges(mogi).map(({ slotId, movement, gain }) => [
        mogi.participants.find((person) => person.id === slotId)!.loungeName,
        { movement, gain },
      ]),
    ),
    Object.fromEntries(
      Object.keys(after).map((name) => [
        name,
        {
          movement: rank(before, name) - rank(after, name),
          gain: after[name] - before[name],
        },
      ]),
    ),
    "mogiPlayerChanges compares competition ranks before and after race 12 and its native gains",
  );
}

test("an FFA with a restart after race 1 and board-only races 4–9 counts all twelve races with no questions", async () => {
  // Photo order: the race-1 board and results, a 1-point restart to 0 before race 2, a race-6 board without the user's total.
  const mogi = await ingestReadings(emptyFfaMogi(restartedFfa.roster), structuredClone(restartedFfa.captures));
  assert.deepEqual(
    countedRaces(mogi).map((race) => race.number),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  assert.deepEqual(mogiQuestions(mogi), []);
  const place = (name: string, number: number) =>
    countedRaces(mogi)
      .find((race) => race.number === number)!
      .placements.indexOf(mogi.participants.find((person) => person.loungeName === name)!.id) + 1;
  assert.deepEqual(
    [4, 5, 6].map((number) => [place("Tavo", number), place("Boolossus", number)]),
    [
      [4, 7],
      [1, 5],
      [1, 7],
    ],
  );
  assert.deepEqual(Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])), {
    Tavo: 118,
    "DIDDY 42": 99,
    Boolossus: 98,
    Chompsley: 90,
    shellyz3: 88,
    KoopmeansWaluigi: 83,
    DKJ: 81,
    lakitu: 80,
    Wigglette: 80,
    HlxKoopers: 66,
    Boom: 53,
    "Toadie Clan": 48,
  });
});

test("the restarted FFA fed one capture at a time ends as its batch does", async () => {
  // Watched folders add screenshots one at a time; arrival order changes nothing.
  const summary = (mogi: Mogi) => ({
    races: countedRaces(mogi).map((race) => [
      race.number,
      race.placements.map((id) => mogi.participants.find((person) => person.id === id)!.loungeName),
    ]),
    questions: mogiQuestions(mogi).map((question) => question.kind),
    standings: individualStandings(mogi).map((person) => [person.loungeName, person.points]),
  });
  const batch = await ingestReadings(emptyFfaMogi(restartedFfa.roster), structuredClone(restartedFfa.captures));
  let single = emptyFfaMogi(restartedFfa.roster);
  for (const capture of restartedFfa.captures) single = await ingestReadings(single, [structuredClone(capture)]);
  assert.deepEqual(summary(single), summary(batch));
});
