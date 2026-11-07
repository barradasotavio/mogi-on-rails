import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  answerMogiQuestion,
  applyCaptureContext,
  type Capture,
  type Mogi,
  mogiQuestions,
  reconcileSequence,
  sourcePairSignature,
} from "@mkw/engine";

// Saved OCR readings need the pure interpretation seam; recognizeImage requires a browser canvas.
import { interpretRightList } from "../src/recognition/finish-order.ts";
import { interpretFinalList } from "../src/recognition/general.ts";

const { readings } = JSON.parse(readFileSync(new URL("./fixtures/eleven-players.json", import.meta.url), "utf8")) as {
  readings: Capture[];
};
function withoutLastNumbers(index: number): Capture {
  const capture = structuredClone(readings[index]);
  for (const reading of [
    capture.numericRows![11].right,
    capture.numericRows![11].addition,
    capture.interpretation!.positions[11],
  ]) {
    Object.assign(reading, { value: null, text: "", uncertain: true });
  }
  return capture;
}
for (const index of [0, 1, 2])
  test(`in capture ${index + 1}, twelve-player additions keep the finish order with the last number row unreadable (votedNativeScale)`, () => {
    const capture = withoutLastNumbers(index);
    const interpretation = interpretRightList(
      capture.numericRows!,
      capture.interpretation!.positions,
      capture.interpretation!.movementRows,
      capture.rows,
    );
    assert.equal(interpretation.represented, 12);
    assert.equal(interpretation.screen, "finishOrderAdding");
  });

test("without an addition vote, a name read on the last row keeps the room from shrinking (representedRoom)", () => {
  const capture = withoutLastNumbers(2);
  for (const row of capture.numericRows!) Object.assign(row.addition, { text: "", value: null, uncertain: true });
  assert.notEqual(capture.rows[11].text.trim(), "");
  const interpretation = interpretRightList(
    capture.numericRows!,
    capture.interpretation!.positions,
    capture.interpretation!.movementRows,
    capture.rows,
  );
  assert.equal(interpretation.represented, undefined);
});

test("real captures 4 to 12 still represent eleven players (representedRoom)", () => {
  for (const capture of readings.slice(3)) {
    const interpretation = interpretRightList(
      capture.numericRows!,
      capture.interpretation!.positions,
      capture.interpretation!.movementRows,
      capture.rows,
    );
    assert.equal(interpretation.represented, 11, capture.id);
  }
});

for (const [label, extra, uncertain, expected] of [
  ["two additions are enough (votedNativeScale)", null, true, 12],
  ["an addition from another scale blocks the vote (votedNativeScale)", 9, false, undefined],
  ["noise outside the scales doesn't vote (votedNativeScale)", 99, false, 12],
  ["an uncertain addition doesn't vote (votedNativeScale)", 9, true, 12],
] as const)
  test(label, () => {
    const capture = withoutLastNumbers(2);
    for (const row of capture.numericRows!) Object.assign(row.addition, { text: "", value: null, uncertain: true });
    Object.assign(capture.numericRows![0].addition, { text: "+15", value: 15, uncertain: false });
    Object.assign(capture.numericRows![1].addition, { text: "+12", value: 12, uncertain: false });
    Object.assign(capture.numericRows![2].addition, {
      text: extra === null ? "" : `+${extra}`,
      value: extra,
      uncertain,
    });
    const interpretation = interpretRightList(
      capture.numericRows!,
      capture.interpretation!.positions,
      capture.interpretation!.movementRows,
      capture.rows,
    );

    assert.equal(interpretation.represented, expected);
    assert.equal(interpretation.currentScale, undefined);
  });

test("row twelve with no name or numbers stays in the queue and never becomes an absence (representedRoom)", async () => {
  const capture = withoutLastNumbers(0);
  const participants = capture.rows.map((row, index) => ({ id: `p${index + 1}`, loungeName: row.text, ign: row.text }));
  capture.nameAssociations = participants.map((person) => ({ participantId: person.id }));
  for (const index of [10, 11]) {
    capture.rows[index] = { ...capture.rows[index], text: "", uncertain: true, suggestedParticipantId: "" };
    capture.nameAssociations[index] = { participantId: null, unlinked: true };
  }
  capture.interpretation = interpretRightList(
    capture.numericRows!,
    capture.interpretation!.positions,
    capture.interpretation!.movementRows,
    capture.rows,
  );
  const initial: Mogi = {
    id: "missing-last-row",
    name: "Twelve",
    createdAt: "2026-10-30",
    format: "FFA",
    participants,
    races: [],
  };
  let mogi = reconcileSequence(
    applyCaptureContext(initial, capture, {
      placements: [],
      absentParticipantIds: [],
      reviewed: false,
      nameAssociations: capture.nameAssociations,
    }),
  );
  assert.ok(mogiQuestions(mogi).some((question) => question.kind === "name" && question.row === 12));
  for (let step = 0; step < 2; step++) {
    const question = mogiQuestions(mogi).find((question) => question.kind === "name");
    if (!question) break;
    mogi = reconcileSequence(
      await answerMogiQuestion(mogi, question.id, {
        kind: "name",
        answer: { participantId: participants[question.row - 1].id },
      }),
    );
  }
  assert.equal(mogi.races[0].status, "confirmed");
  assert.equal(mogi.races[0].placements.length, 12);
  assert.deepEqual(mogi.races[0].absentParticipantIds, []);
});

test("a single addition doesn't set the room (votedNativeScale)", () => {
  const capture = withoutLastNumbers(2);
  for (const row of capture.numericRows!) Object.assign(row.addition, { text: "", value: null, uncertain: true });
  Object.assign(capture.numericRows![0].addition, { text: "+15", value: 15, uncertain: false });

  const interpretation = interpretRightList(
    capture.numericRows!,
    capture.interpretation!.positions,
    capture.interpretation!.movementRows,
    capture.rows,
  );
  assert.equal(interpretation.represented, undefined);
});

function rowsOnlyFinishOrder(): Capture {
  const capture = withoutLastNumbers(2);
  for (const row of capture.numericRows!) Object.assign(row.addition, { text: "", value: null, uncertain: true });
  capture.rows[11] = { ...capture.rows[11], text: "", uncertain: true, suggestedParticipantId: "" };
  capture.interpretation = interpretRightList(
    capture.numericRows!,
    capture.interpretation!.positions,
    capture.interpretation!.movementRows,
    capture.rows,
  );
  return capture;
}

test("tells a complete scale, a vote, rows and an answer apart (representedRoom)", () => {
  const complete = readings[3];
  const voted = withoutLastNumbers(0);
  const hinted = rowsOnlyFinishOrder();
  const interpret = (capture: Capture, answer?: 10 | 11 | 12) =>
    interpretRightList(
      capture.numericRows!,
      capture.interpretation!.positions,
      capture.interpretation!.movementRows,
      capture.rows,
      answer,
    );
  assert.equal(interpret(complete).representedBy, "scale");
  assert.equal(interpret(voted).representedBy, "vote");
  assert.equal(hinted.interpretation!.representedBy, "rows");
  assert.equal(interpret(hinted, 12).representedBy, "user");
});

function numberedRoomCaptures(entries: { capture: Capture; number: number }[], askLastName = false): Mogi {
  const participants = Array.from({ length: 12 }, (_, index) => ({
    id: `p${index + 1}`,
    loungeName: `Player ${index + 1}`,
    ign: `P${index + 1}`,
  }));
  let mogi: Mogi = {
    id: "room-extent",
    name: "Room extent",
    createdAt: "2026-10-30",
    format: "FFA",
    participants,
    races: [],
    sequence: {
      version: 1,
      numbers: entries.map(({ capture, number }) => ({ captureId: capture.id, number, phase: "after" })),
      links: [],
      occurrences: [],
      relations: [],
      gaps: [],
      inputSignature: "fixture",
    },
  };
  for (const { capture } of entries) {
    const nameAssociations = participants.map((person, index) =>
      askLastName && index === 11 ? { participantId: null } : { participantId: person.id },
    );
    mogi = applyCaptureContext(mogi, capture, {
      placements: [],
      absentParticipantIds: [],
      reviewed: false,
      nameAssociations,
    });
  }
  return reconcileSequence(mogi);
}

test("a smaller size suggested by rows asks before counting an absence (roomSizeNeedsAnswer)", async () => {
  const capture = rowsOnlyFinishOrder();
  let mogi = numberedRoomCaptures([{ capture, number: 2 }], true);
  const room = mogiQuestions(mogi).find((question) => question.id === `representation:${capture.id}`);
  assert.ok(room, "Without a neighboring proof, the suggested size needs an answer");
  assert.equal(mogi.races.find((race) => race.number === 2)?.status, "pending");
  assert.ok(mogi.races.every((race) => !race.absentParticipantIds?.length));
  mogi = await answerMogiQuestion(mogi, room.id, { kind: "sequence", value: "12" });
  assert.equal(mogi.captures!.find((source) => source.id === capture.id)!.interpretation!.representedBy, "user");
  assert.ok(
    mogiQuestions(mogi).some(
      (question) =>
        question.captureId === capture.id &&
        question.row === 12 &&
        (question.kind === "name" || question.kind === "points"),
    ),
  );
  assert.ok(mogi.races.every((race) => !race.absentParticipantIds?.length));
});

test("even with every name resolved, empty rows alone don't confirm an absence (roomSizeNeedsAnswer)", () => {
  const capture = rowsOnlyFinishOrder();
  const mogi = numberedRoomCaptures([{ capture, number: 2 }]);
  assert.equal(mogi.races.find((race) => race.number === 2)?.status, "pending");
  assert.ok(mogi.races.every((race) => !race.absentParticipantIds?.length));
});

function hintedWithNeighbor(distance: number) {
  const hinted = rowsOnlyFinishOrder();
  hinted.id = "rows-only";
  const scale = [12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  hinted.numericRows!.slice(0, 11).forEach((row, index) => {
    const value = index === 0 ? 32 : index === 1 ? 30 : 30 + index * 2;
    Object.assign(row.right, { value, text: String(value), uncertain: false });
  });
  hinted.interpretation = interpretRightList(hinted.numericRows!, hinted.interpretation!.positions, [], hinted.rows);
  const neighbor = structuredClone(hinted);
  neighbor.id = `voted-${distance}`;
  neighbor.numericRows!.slice(0, 11).forEach((row, index) => {
    const value = row.right.value! + (distance - 1) * scale[index];
    Object.assign(row.right, { value, text: String(value), uncertain: false });
    Object.assign(row.addition, {
      value: index === 0 ? null : scale[index],
      text: index === 0 ? "" : `+${scale[index]}`,
      uncertain: index === 0,
    });
  });
  neighbor.interpretation = interpretRightList(
    neighbor.numericRows!,
    neighbor.interpretation!.positions,
    [],
    neighbor.rows,
  );
  return { hinted, neighbor };
}

for (const distance of [-1, 0, 1])
  test(`an eleven-player proof in the neighboring race (${distance}) settles the hint without asking (provesRoomSize)`, () => {
    const { hinted, neighbor } = hintedWithNeighbor(distance);
    assert.equal(neighbor.interpretation!.representedBy, "vote");
    const mogi = numberedRoomCaptures([
      { capture: hinted, number: 5 },
      { capture: neighbor, number: 5 + distance },
    ]);

    assert.equal(
      mogiQuestions(mogi).some((question) => question.id === `representation:${hinted.id}`),
      false,
    );
    assert.equal(
      mogiQuestions(mogi).some((question) => question.captureId === hinted.id),
      false,
    );
    assert.equal(mogi.races.find((race) => race.number === 5)?.status, "confirmed");
    assert.deepEqual(mogi.races.find((race) => race.number === 5)?.absentParticipantIds, ["p12"]);
  });

test("a distant proof doesn't confirm a smaller room (provesRoomSize)", () => {
  const { hinted, neighbor } = hintedWithNeighbor(2);
  const mogi = numberedRoomCaptures([
    { capture: hinted, number: 5 },
    { capture: neighbor, number: 7 },
  ]);

  assert.ok(mogiQuestions(mogi).some((question) => question.id === `representation:${hinted.id}`));
  assert.equal(mogi.races.find((race) => race.number === 5)?.status, "pending");
});

for (const change of ["remove", "reset"] as const)
  test(`losing the neighboring proof (${change}) withdraws the deduced absence (provesRoomSize)`, () => {
    const { hinted, neighbor } = hintedWithNeighbor(1);
    let mogi = numberedRoomCaptures([
      { capture: hinted, number: 5 },
      { capture: neighbor, number: 6 },
    ]);
    assert.equal(mogi.races.find((race) => race.number === 5)?.status, "confirmed");
    if (change === "remove")
      mogi = { ...mogi, captures: mogi.captures!.filter((capture) => capture.id !== neighbor.id) };
    else {
      const from = mogi.captures!.find((capture) => capture.id === hinted.id)!,
        to = mogi.captures!.find((capture) => capture.id === neighbor.id)!;
      mogi = {
        ...mogi,
        sequence: {
          ...mogi.sequence!,
          links: [
            {
              fromCaptureId: from.id,
              toCaptureId: to.id,
              signature: sourcePairSignature(from, to),
              continuity: "reset",
            },
          ],
        },
      };
    }
    mogi = reconcileSequence(mogi);
    assert.equal(mogi.races.find((race) => race.number === 5)?.status, "pending");
    assert.deepEqual(mogi.races.find((race) => race.number === 5)?.absentParticipantIds, []);
    assert.ok(mogiQuestions(mogi).some((question) => question.id === `representation:${hinted.id}`));
  });

test("twelve represented by rows needs no size confirmation (roomSizeNeedsAnswer)", () => {
  const capture = structuredClone(readings[2]);
  for (const row of capture.numericRows!) Object.assign(row.addition, { text: "", value: null, uncertain: true });
  capture.interpretation = interpretRightList(
    capture.numericRows!,
    capture.interpretation!.positions,
    [],
    capture.rows,
  );
  assert.equal(capture.interpretation.represented, 12);
  assert.equal(capture.interpretation.representedBy, "rows");
  const mogi = numberedRoomCaptures([{ capture, number: 2 }]);
  assert.equal(
    mogiQuestions(mogi).some((question) => question.id === `representation:${capture.id}`),
    false,
  );
});

for (const distance of [-1, 0, 1])
  test(`two additions in the neighbor (${distance}) are enough to prove the size (provesRoomSize)`, () => {
    const { hinted, neighbor } = hintedWithNeighbor(distance);
    neighbor
      .numericRows!.slice(0, 9)
      .forEach((row) => Object.assign(row.addition, { text: "", value: null, uncertain: true }));
    neighbor.interpretation = interpretRightList(
      neighbor.numericRows!,
      neighbor.interpretation!.positions,
      [],
      neighbor.rows,
    );
    assert.equal(neighbor.interpretation.representedBy, "vote");
    const mogi = numberedRoomCaptures([
      { capture: hinted, number: 5 },
      { capture: neighbor, number: 5 + distance },
    ]);
    assert.equal(
      mogiQuestions(mogi).some((question) => question.id === `representation:${hinted.id}`),
      false,
    );
    assert.equal(mogi.races.find((race) => race.number === 5)?.status, "confirmed");
  });

test("a complete scale of additions keeps the finish order when OCR reads rank 7 as 1 (showsFinishOrder)", () => {
  // Real readings of an FFA race 3 result screen (2026-11-02): rank 7 read as "1", Tavo's highlighted total unread.
  const reading = (text: string, value: number | null) => ({
    text,
    value,
    confidence: value === null ? 0 : 100,
    uncertain: value === null,
    location: { x: 0, y: 0, width: 1, height: 1 },
  });
  const totals = [9, null, 16, 20, 16, 21, 6, 9, 15, 20, 13, 12];
  const additions = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const ranks = [1, 2, 3, 4, 5, 6, 1, 8, 9, 10, 11, 12];
  const interpretation = interpretRightList(
    totals.map((total, index) => ({
      row: index + 1,
      right: reading(total === null ? "" : String(total), total),
      addition: reading(`+${additions[index]}`, additions[index]),
    })),
    ranks.map((rank) => reading(String(rank), rank)),
    [],
    [
      "CatPeach",
      "Tavo",
      "Bloop",
      "Piranha",
      "nabi",
      "Goomrod07",
      "Ziggy",
      "Rosalilou",
      "Sanskoopa",
      "mustachios",
      "Mario",
      "Kongo",
    ].map((text) => ({ text })),
  );
  assert.equal(interpretation.screen, "finishOrderAdding");
  assert.equal(interpretation.positions[6].uncertain, true);
});

test("final standings keep an out-of-order game cumulative as an uncertain reading (interpretFinalList)", () => {
  const reading = (value: number | null) => ({
    text: value === null ? "" : String(value),
    value,
    confidence: value === null ? 0 : 100,
    uncertain: value === null,
    location: { x: 0, y: 0, width: 1, height: 1 },
  });
  const numericRows = [103, 97, 96, 194, 89, 89, 87, 85, 77, 71, 52, 44].map((value, index) => ({
    row: index + 1,
    right: reading(value),
    addition: reading(null),
  }));
  const result = interpretFinalList(
    numericRows,
    [1, 2, 3, 4, 5, 5, 7, 8, 9, 10, 11, 12].map(reading),
    numericRows.map((row) => ({ text: `Player ${row.row}` })),
  );
  assert.equal(result?.interpretation.screen, "finalStandings");
  assert.deepEqual(result.numericRows[3].right, { ...numericRows[3].right, uncertain: true });
  assert.equal(numericRows[3].right.uncertain, false);
});
