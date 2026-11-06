import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  answerMogiQuestion,
  countedRaces,
  individualStandings,
  type MogiQuestionAnswer,
  mogiQuestions,
  normalizeReconstructions,
} from "@mkw/engine";

import type { Capture, Mogi } from "../../../apps/web/lib/mogi/types.ts";
import { ingestReadings } from "./support/real-captures.ts";

// Real 2v2 mogi of 2026-11-06 (apps/web/tests/fixtures/disconnected-race): Tavo dropped in race 5, which has no
// screen, and Cheep1 sat race 9 out. The readings are the saved recognizeImage output of the screens.
const recognitions = JSON.parse(
  readFileSync(new URL("../../../apps/web/tests/fixtures/recognitions.json", import.meta.url), "utf8"),
) as Record<string, Omit<Capture, "id" | "fileName">>;
// The eleven result screens and the boards before races 6 and 10, with seconds after the first screen (EXIF); race 5's
// slot is the longer gap. The boards let races 4, 5 and 9 be reconstructed while their screens are still missing.
const screens = {
  "race-01": 0,
  "race-02": 215,
  "race-03": 434,
  "race-04": 668,
  "before-06": 949,
  "race-06": 1100,
  "race-07": 1315,
  "race-08": 1545,
  "race-09": 1781,
  "before-10": 1854,
  "race-10": 2010,
  "race-11": 2238,
  "race-12": 2463,
};
const capture = (name: keyof typeof screens) => {
  const fileName = `disconnected-race/${name}.webp`;
  return structuredClone({
    ...recognitions[fileName],
    id: name,
    fileName,
    photoMoment: { at: Date.parse("2026-11-06T00:55:00Z") + screens[name] * 1000, source: "exif" },
  } as Capture);
};
const names = Object.keys(screens) as (keyof typeof screens)[];

// Lounge name, in-game name, team.
const roster = [
  ["shy", "Dragonboo", 1],
  ["TrumpetKoopas", "Drakkoopas", 1],
  ["Kameka", "Mallow", 2],
  ["Mon_tyle", "M on_tyle", 2],
  ["Tavo", "Tavo", 3],
  ["Magic KaMe", "TMagicKaMe", 3],
  ["lumaglows", "VoltexW", 4],
  ["Vargoom", "Vargoom", 4],
  ["Cheep1", "Cheep1", 5],
  ["LuMK64", "C IuMK64", 5],
  ["Fang009", "A/Fang", 6],
  ["Ashly", "Ashly", 6],
] as const;
function emptyMogi(): Mogi {
  return {
    id: "disconnected-race",
    name: "Mogi Tier EF",
    format: "2v2",
    createdAt: "2026-11-06",
    races: [],
    teams: Array.from({ length: 6 }, (_, index) => ({ id: `team-${index + 1}`, name: `Team ${index + 1}` })),
    participants: roster.map(([loungeName, ign, team]) => ({
      id: loungeName,
      loungeName,
      ign,
      ignOrigin: "learned",
      teamId: `team-${team}`,
    })),
  };
}
// Lounge table of the mogi: 15…1 per race, 1 for an absent or disconnected player.
const loungeTotals = {
  Kameka: 124,
  Tavo: 115,
  shy: 109,
  Mon_tyle: 95,
  lumaglows: 92,
  Fang009: 79,
  Vargoom: 77,
  TrumpetKoopas: 72,
  LuMK64: 69,
  Cheep1: 54,
  Ashly: 49,
  "Magic KaMe": 49,
};
const race5 = [
  "TrumpetKoopas",
  "Kameka",
  "shy",
  "LuMK64",
  "Mon_tyle",
  "Fang009",
  "Ashly",
  "Vargoom",
  "lumaglows",
  "Magic KaMe",
  "Cheep1",
  "Tavo",
];

/** Answers race numbers, continuity, and positions as `places` says (race → finish order). */
async function settle(mogi: Mogi, places: Record<number, string[]> = {}) {
  for (let question = mogiQuestions(mogi)[0]; question; question = mogiQuestions(mogi)[0]) {
    let answer: MogiQuestionAnswer;
    if (question.kind === "race") answer = { kind: "race", value: Number(question.captureId.slice(-2)) };
    // The room never reopened.
    else if (question.kind === "sequence" && question.options.some((option) => option.value === "continuous-12"))
      answer = { kind: "sequence", value: "continuous-12" };
    // Two races without a screen leave the board's totals unproven; they read right.
    else if (question.kind === "points" && question.captureId === "before-06" && question.read === question.suggestion)
      answer = { kind: "points", value: question.read! };
    else if (question.kind === "position") {
      const order = places[mogi.races.find((race) => race.id === question.raceId)!.number!];
      assert.ok(order, `Unexpected ${JSON.stringify(question)}`);
      answer = { kind: "position", value: order.indexOf(question.participantId) + 1 };
    } else assert.fail(`Unexpected ${JSON.stringify(question)}`);
    mogi = (
      await normalizeReconstructions({ version: 1, mogis: [await answerMogiQuestion(mogi, question.id, answer)] })
    ).mogis[0];
  }
  return mogi;
}
function assertFinished(mogi: Mogi) {
  assert.deepEqual(mogiQuestions(mogi), []);
  const race = (number: number) => countedRaces(mogi).find((race) => race.number === number)!;
  assert.deepEqual(
    countedRaces(mogi).map((race) => [race.number, race.origin]),
    Array.from({ length: 12 }, (_, n) => [n + 1, n === 4 ? "reconstructed" : "observed"]),
  );
  assert.deepEqual(race(5).placements, race5);
  assert.equal(race(4).assistedGroupId, undefined);
  assert.equal(race(5).assistedGroupId, undefined);
  assert.deepEqual(race(9).absentParticipantIds, ["Cheep1"]);
  assert.deepEqual(
    Object.fromEntries(individualStandings(mogi).map((person) => [person.loungeName, person.points])),
    loungeTotals,
  );
}

test("a 2v2 mogi with no screen for the race Tavo dropped from finishes at the Lounge totals", async () => {
  let mogi = emptyMogi();
  for (const name of names) mogi = await settle(await ingestReadings(mogi, [capture(name)]));
  assertFinished(mogi);
});

test("result screens that arrive after position answers replace the races those answers reconstructed (acceptFinishOrders)", async () => {
  // The places the maintainer gave before the screens of races 4 and 9 were accepted; they fit the totals.
  const answered: Record<number, string[]> = {
    4: [
      "Mon_tyle",
      "Kameka",
      "shy",
      "TrumpetKoopas",
      "Vargoom",
      "Fang009",
      "Ashly",
      "lumaglows",
      "Cheep1",
      "Tavo",
      "Magic KaMe",
      "LuMK64",
    ],
    5: [
      "LuMK64",
      "Kameka",
      "Fang009",
      "shy",
      "Mon_tyle",
      "TrumpetKoopas",
      "Ashly",
      "Vargoom",
      "lumaglows",
      "Magic KaMe",
      "Cheep1",
      "Tavo",
    ],
    9: [
      "Cheep1",
      "Kameka",
      "lumaglows",
      "Tavo",
      "TrumpetKoopas",
      "Fang009",
      "Ashly",
      "shy",
      "LuMK64",
      "Vargoom",
      "Magic KaMe",
      "Mon_tyle",
    ],
  };
  let mogi = emptyMogi();
  for (const name of names.filter((name) => name !== "race-04" && name !== "race-09"))
    mogi = await settle(await ingestReadings(mogi, [capture(name)]), answered);
  assert.equal(countedRaces(mogi).find((race) => race.number === 9)!.placements[0], "Cheep1");
  mogi = await settle(await ingestReadings(mogi, [capture("race-04"), capture("race-09")]));
  assertFinished(mogi);
});
