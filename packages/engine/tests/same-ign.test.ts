import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  answerMogiQuestion,
  changePositionFact,
  countedRaces,
  type MogiQuestion,
  mogiQuestions,
  normalizeReconstructions,
} from "@mkw/engine";

import type { Capture, Mogi } from "../../../apps/web/lib/mogi/types.ts";
import { questionsWithOverviewInvariant } from "./support/question-invariant.ts";
import { ingestReadings } from "./support/real-captures.ts";

// Real 3v3 of 2026-11-14 as the app read its 13 screenshots, in photo order: the race-1 board (all zeros),
// eleven boards between races (c05 lost one row), and the race-12 results. Birdo and Pauline share the IGN "X",
// the team tag alone; on every board Birdo holds the first "X" slot, and on the results 79 is Birdo's total.
const data = JSON.parse(readFileSync(new URL("./fixtures/3v3-2026-11-14.json", import.meta.url), "utf8")) as {
  teams: Mogi["teams"];
  roster: { id: string; teamId: string; loungeName: string; ign: string }[];
  captures: Capture[];
};
const reading = (id: string) => structuredClone(data.captures.find((capture) => capture.id === id)!);
const emptyMogi = (): Mogi => ({
  id: "3v3-2026-11-14",
  name: "3v3",
  format: "3v3",
  createdAt: "2026-11-14",
  races: [],
  teams: data.teams,
  participants: data.roster.map((person) => ({ ...person, ignOrigin: "learned" })),
});
const person = (mogi: Mogi, name: string) => mogi.participants.find((entry) => entry.loungeName === name)!.id;
const who = (mogi: Mogi, id: string | null | undefined) =>
  mogi.participants.find((entry) => entry.id === id)?.loungeName;
/** Who each "X" row of a capture is linked to. */
const xRows = (mogi: Mogi, id: string) => {
  const capture = mogi.captures!.find((entry) => entry.id === id)!;
  return capture.rows.flatMap((row, index) =>
    row.text === "X" ? [[index + 1, who(mogi, capture.nameAssociations?.[index]?.participantId)]] : [],
  );
};
/** Answers the one question no rule can settle: the first "X" on the board is Birdo. */
async function answerFirstX(mogi: Mogi, asked: MogiQuestion[] = []): Promise<Mogi> {
  const question = mogiQuestions(mogi).find((entry) => entry.kind === "name");
  assert.ok(question?.kind === "name" && question.reading === "X", "The first name question is an X row");
  asked.push(question);
  const capture = mogi.captures!.find((entry) => entry.id === question.captureId)!;
  const firstSlot = capture.rows.findIndex((row) => row.text === "X") + 1 === question.row;
  const answer = { participantId: person(mogi, firstSlot ? "Birdo" : "Pauline") };
  return (
    await normalizeReconstructions({
      version: 1,
      mogis: [await answerMogiQuestion(mogi, question.id, { kind: "name", answer })],
    })
  ).mogis[0];
}

test("an answered first “X” names both X rows of the next board by their board slot (name.slot)", async () => {
  // The race-1 board shows every total as 0, so its gains can't tell the two X rows apart: only the slot can.
  const mogi = await answerFirstX(await ingestReadings(emptyMogi(), [reading("c01"), reading("c02")]));
  assert.deepEqual(xRows(mogi, "c02"), [
    [5, "Birdo"],
    [6, "Pauline"],
  ]);
  assert.deepEqual(
    mogiQuestions(mogi).filter((question) => question.kind === "name"),
    [],
  );
});

test("the results' two X rows follow the totals of the board before them (name.continuity)", async () => {
  // Sorted by place, the results keep no slot: 79 and 87 are the board's totals for Birdo and Pauline.
  const mogi = await answerFirstX(await ingestReadings(emptyMogi(), [reading("c12"), reading("c13")]));
  assert.deepEqual(xRows(mogi, "c13"), [
    [3, "Birdo"],
    [8, "Pauline"],
  ]);
  assert.deepEqual(
    mogiQuestions(mogi).filter((question) => question.kind === "name"),
    [],
  );
});

/** Every X row of the mogi, by the answer key: Birdo holds the first board slot and the results' total 79. */
const expectedX = () =>
  data.captures.map((capture) =>
    capture.interpretation?.screen === "finishOrderAdding"
      ? [
          [3, "Birdo"],
          [8, "Pauline"],
        ]
      : [
          [5, "Birdo"],
          [6, "Pauline"],
        ],
  );

for (const [mode, ingest] of [
  ["as a batch", (mogi: Mogi) => ingestReadings(mogi, structuredClone(data.captures))],
  [
    "one capture at a time",
    async (mogi: Mogi) => {
      for (const capture of data.captures) mogi = await ingestReadings(mogi, [structuredClone(capture)]);
      return mogi;
    },
  ],
] as const)
  test(`two players named only "X": one answer, “Who is the first X?”, links every X row ${mode}`, async () => {
    let mogi = await ingest(emptyMogi());
    // The pair keeps the room together: nothing but who is who is asked.
    assert.deepEqual(new Set(mogiQuestions(mogi).map((question) => question.kind)), new Set(["name"]));
    const first = mogiQuestions(mogi)[0];
    assert.ok(first.kind === "name" && first.slot === 1, "It asks about the first X slot");
    const asked: MogiQuestion[] = [];
    mogi = await answerFirstX(mogi, asked);
    assert.deepEqual(
      data.captures.map((capture) => xRows(mogi, capture.id!)),
      expectedX(),
    );
    assert.deepEqual(
      mogiQuestions(mogi).filter((question) => question.kind === "name"),
      [],
    );
  });

const normalized = async (mogi: Mogi) => (await normalizeReconstructions({ version: 1, mogis: [mogi] })).mogis[0];
const place = (mogi: Mogi, number: number, name: string) =>
  countedRaces(mogi)
    .find((race) => race.number === number)!
    .placements.indexOf(person(mogi, name)) + 1;

test("a known position the race's totals rule out is asked again with the totals' place, and the mogi ends with every race counted", async () => {
  let mogi = await answerFirstX(await ingestReadings(emptyMogi(), structuredClone(data.captures)));
  // The board missing one row (c05) leaves that total unknown: the room lost the rejoined player's 14 points, so
  // 82 per race minus the others would read 49 where a later board shows 40 (unseenRowParticipant).
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.equal(countedRaces(mogi).length, 12);
  const race = (number: number) => mogi.races.find((entry) => entry.number === number)!.id;
  // Answered while the X rows were swapped: Pauline gained 1 point in race 1 (12th), Birdo 15 in race 3 (1st).
  mogi = changePositionFact(mogi, { raceId: race(1), participantId: person(mogi, "Pauline"), position: 3 });
  mogi = await normalized(
    changePositionFact(mogi, { raceId: race(3), participantId: person(mogi, "Birdo"), position: 11 }),
  );
  for (const [number, name, totalsPlace] of [
    [1, "Pauline", 12],
    [3, "Birdo", 1],
  ] as const) {
    const question = questionsWithOverviewInvariant(mogi)[0];
    assert.ok(question?.kind === "position", `A question settles race ${number}`);
    assert.deepEqual(
      [question.number, who(mogi, question.participantId), question.suggestion],
      [number, name, totalsPlace],
    );
    mogi = await normalized(await answerMogiQuestion(mogi, question.id, { kind: "position", value: totalsPlace }));
  }
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.deepEqual(
    countedRaces(mogi).map((entry) => entry.number),
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
  // Race 1 comes from the zero board and the board after it; in race 3, Lakitulaki rejoined at 0 after placing 11th.
  assert.deepEqual(
    [place(mogi, 1, "Wiggler15"), place(mogi, 1, "Tavo"), place(mogi, 3, "Lakitulaki"), place(mogi, 3, "Pauline")],
    [1, 5, 11, 12],
  );
});
