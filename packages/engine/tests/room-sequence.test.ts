import assert from "node:assert/strict";
import { test } from "node:test";

import {
  answerMogiQuestion,
  applyCaptureContext,
  applyReviewedRace,
  applySequenceAnswer,
  type Capture,
  countedRaces,
  individualStandings,
  type Mogi,
  mogiOverview,
  mogiQuestions,
  mogiSummary,
  normalizeReconstructions,
  reconcileSequence,
  sequenceInputSignature,
  setAssistanceAnalysis,
  sourcePairSignature,
} from "@mkw/engine";

import { emptyFfaMogi, ffaReading, ingestReadings } from "./support/real-captures.ts";

const P = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const nativeScale = (size: number) => (size === 12 ? P : P.slice(1));
const people = P.map((_, i) => ({ id: `p${i + 1}`, loungeName: `Player ${i + 1}`, ign: `P${i + 1}` }));
function prefix(n: number): Mogi {
  return {
    id: "room",
    name: "Sessions",
    format: "FFA",
    createdAt: "2026-10-29",
    participants: people,
    races: Array.from({ length: n }, (_, i) => ({
      id: `r${i + 1}`,
      number: i + 1,
      origin: "manual",
      status: "confirmed",
      placements: people.map((p) => p.id),
    })),
  };
}
const reading = (value: number) => ({
  text: String(value),
  value,
  confidence: 100,
  uncertain: false,
  location: { x: 0, y: 0, width: 1, height: 1 },
});
function source(
  id: string,
  n: number,
  screen: "finishOrderAdded" | "overallStandings" | "finishOrderAdding" | "twoColumns" = "finishOrderAdded",
  scale = P,
): Capture {
  return {
    id,
    width: 1920,
    height: 1080,
    stage: "context",
    reviewedAt: "",
    reviewedPlacements: [],
    rows: people
      .slice(0, scale.length)
      .map((p) => ({ text: p.ign, confidence: 100, uncertain: false, suggestedParticipantId: p.id })),
    nameAssociations: people.slice(0, scale.length).map((p) => ({ participantId: p.id })),
    interpretation: {
      version: 1,
      screen,
      origin: "visual",
      positions: [],
      movementRows: [],
      reasons: [],
      ...(screen === "finishOrderAdding" ? { currentScale: 12 as const } : {}),
    },
    numericRows: scale.map((v, i) => ({
      row: i + 1,
      right: reading(n * v),
      addition: screen === "finishOrderAdding" ? reading(v) : { ...reading(0), value: null, uncertain: true },
    })),
  };
}
function session(id: string, length: number, rotation: number, time?: number) {
  return Array.from({ length }, (_, i) => {
    const c = source(`${id}-${i + 1}`, i + 1);
    const order = [...people.slice(rotation), ...people.slice(0, rotation)];
    c.rows = order.map((p) => ({ text: p.ign, confidence: 100, uncertain: false, suggestedParticipantId: p.id }));
    c.nameAssociations = order.map((p) => ({ participantId: p.id }));
    if (time !== undefined) {
      c.lastModified = time + i;
      c.photoMoment = { at: time + i, source: "exif" };
    }
    return c;
  });
}
function disconnected() {
  const capture = source("dc", 1);
  const Q = [12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  capture.rows.shift();
  capture.nameAssociations!.shift();
  capture.numericRows = Q.map((v, i) => ({
    row: i + 1,
    right: reading(5 * P[i + 1] + v),
    addition: { ...reading(0), value: null, uncertain: true },
  }));
  return capture;
}
function ingest(mogi: Mogi, ...captures: Capture[]) {
  for (const capture of captures)
    mogi = applyCaptureContext(mogi, capture, {
      placements: [],
      absentParticipantIds: [],
      reviewed: false,
      nameAssociations: capture.nameAssociations,
    });
  return reconcileSequence(mogi);
}
function number(mogi: Mogi, id: string) {
  return mogi.sequence?.occurrences.find((o) => o.captureIds.includes(id))?.number;
}

test("captures at the same room position keep the room start and question queue independent of capture IDs (roomStart)", () => {
  const orders = [people, [...people].reverse(), [...people.slice(4), ...people.slice(0, 4)]];
  const total = (person: (typeof people)[number], races: number) =>
    orders.slice(0, races).reduce((sum, order) => sum + P[order.indexOf(person)], 0);
  const captures = [source("adding", 0, "finishOrderAdding"), source("before", 0, "twoColumns")];
  for (const capture of captures) {
    const adding = capture.id === "adding",
      order = adding ? orders[2] : people;
    capture.rows = order.map((person, i) =>
      ["p1", "p2"].includes(person.id)
        ? { text: `x${capture.id}${i}`, confidence: 30, uncertain: true, suggestedParticipantId: "" }
        : { text: person.ign, confidence: 100, uncertain: false, suggestedParticipantId: person.id },
    );
    capture.nameAssociations = order.map((person) => ({
      participantId: ["p1", "p2"].includes(person.id) ? null : person.id,
    }));
    capture.numericRows = order.map((person, i) => ({
      row: i + 1,
      right:
        adding && i >= 3 && i <= 8
          ? { ...reading(0), text: "", value: null, confidence: 0, uncertain: true }
          : reading(total(person, adding ? 2 : 3)),
      addition: adding ? reading(P[i]) : { ...reading(0), text: "", value: null, confidence: 0, uncertain: true },
    }));
  }
  for (const ids of [
    ["a", "b"],
    ["b", "a"],
  ]) {
    const mogi = reconcileSequence({
      ...prefix(0),
      captures: captures.map((capture, i) => ({ ...capture, id: ids[i] })),
    });
    assert.deepEqual(
      mogi.races.map((race) => race.number),
      [1, 2, 3],
    );
    assert.deepEqual(
      mogi.sequence!.roomAnalysis!.sessions.map((room) => room.start),
      [1],
    );
    assert.equal(mogiQuestions(mogi).length, 4);
  }
});

test("a pre-race-1 screen dated after later results leaves the start that race 1's own zeros prove (roomStart)", () => {
  const timed = (capture: Capture, at: number) => ({ ...capture, photoMoment: { at, source: "file-date" as const } });
  const captures = [
    timed(source("adding-1", 0, "finishOrderAdding"), 1000),
    timed(source("after-2", 2), 2000),
    timed(source("before-1", 0, "twoColumns"), 9000),
  ];
  const mogi = ingest(prefix(0), ...captures);
  assert.deepEqual(
    captures.map((capture) => number(mogi, capture.id)),
    [1, 2, 1],
  );
  assert.deepEqual(mogiQuestions(mogi), []);
});

test("an earlier final standings photo keeps the previous game cumulatives as its anchor (selectRoom)", async () => {
  const before = source("before-twelve", 11, "twoColumns");
  before.context = { phase: "before" };
  before.photoMoment = { at: 2000, source: "exif" };
  const final = source("final", 12);
  final.interpretation!.screen = "finalStandings";
  final.context = { phase: "event-final", raceId: "r12" };
  final.photoMoment = { at: 1000, source: "exif" };
  final.numericRows![0].right = { ...reading(199), uncertain: true };
  final.numericRows![1].right = { ...reading(0), text: "", value: null, uncertain: true };
  const initial = prefix(0);
  initial.races = [{ id: "r12", number: 12, origin: "observed", status: "pending", placements: [] }];
  initial.captures = [before, final];

  const mogi = (await normalizeReconstructions({ mogis: [initial] })).mogis[0];

  assert.deepEqual(mogiQuestions(mogi), []);
  assert.equal(mogiSummary(mogi).final, true);
});

test("photo moment orders two rooms even when the file dates invert the EXIF", () => {
  const first = session("exif-first", 2, 0, 2000),
    second = session("exif-second", 2, 4, 1000);
  first.forEach((capture, i) => {
    capture.photoMoment = { at: 1000 + i, source: "exif" };
  });
  second.forEach((capture, i) => {
    capture.photoMoment = { at: 2000 + i, source: "exif" };
  });
  const result = ingest(prefix(0), ...second, ...first);
  assert.deepEqual(
    [...first, ...second].map((capture) => number(result, capture.id)),
    [1, 2, 3, 4],
  );
  assert.equal(mogiQuestions(result).length, 0);
});

test("totals that chain race by race win over a later photo time that contradicts them (epochByPhotoTime, sharedPhotoMoment)", () => {
  const minute = 60_000,
    at = { 1: 310, 2: 314, 3: 318, 4: 322, 5: 422, 6: 329, 7: 333, 8: 422, 9: 422, 11: 422 };
  const captures = Object.entries(at).map(([race, minutes]) => {
    const capture = source(`late-${race}`, Number(race) - 1, "finishOrderAdding");
    capture.photoMoment = { at: minutes * minute, source: "exif" };
    return capture;
  });
  // The pre-race screen of race 6 shows the same totals as race 5's results, saved later with the batch.
  const before = source("before-6", 5, "twoColumns");
  before.photoMoment = { at: 327 * minute, source: "exif" };
  const mogi = ingest(prefix(0), ...captures, before);
  assert.deepEqual(
    [...captures, before].map((capture) => number(mogi, capture.id)),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 6],
  );
  assert.deepEqual(mogiQuestions(mogi), []);
});

test("copies without a photo moment ask for the order even with different receipt dates", () => {
  const captures = [...session("copy-first", 2, 0, 1000), ...session("copy-second", 2, 4, 2000)];
  captures.forEach((capture) => {
    delete capture.photoMoment;
  });
  const result = ingest(prefix(0), ...captures);
  assert.equal(
    mogiQuestions(result).filter((q) => q.kind === "sequence" && q.reading === "Which came first?").length,
    1,
  );
  const numericallyOrdered = ingest(
    prefix(0),
    ...[3, 1, 2].map((j) => ({ ...source(`copy-${j}`, j), lastModified: 1000 })),
  );
  assert.deepEqual(
    [1, 2, 3].map((j) => number(numericallyOrdered, `copy-${j}`)),
    [1, 2, 3],
  );
  assert.deepEqual(mogiQuestions(numericallyOrdered), []);
});

test("pending names with a different spelling pair by the unique previous total and do not block deducing other rows", () => {
  const first = source("unresolved-first", 1),
    second = source("unresolved-second", 1, "finishOrderAdding");
  for (const [capture, texts] of [
    [first, ["???", "!!!"]],
    [second, ["Unread north", "Unread south"]],
  ] as const) {
    for (const i of [0, 1]) {
      capture.rows[i] = { ...capture.rows[i], text: texts[i], uncertain: true, suggestedParticipantId: "" };
      capture.nameAssociations![i] = { participantId: null, unlinked: true };
    }
  }
  for (const i of [6, 11])
    second.numericRows![i].right = { ...second.numericRows![i].right, value: null, uncertain: true };
  const result = ingest(prefix(0), first, second);
  assert.ok(mogiQuestions(result).some((q) => q.kind === "name"));
  assert.deepEqual(
    mogiQuestions(result).filter((q) => q.kind === "points"),
    [],
  );
  assert.equal(number(result, second.id), 2);
  assert.deepEqual(
    result.captures!.find((c) => c.id === second.id)!.numericDeductions?.map((d) => [d.row, d.value]),
    [
      [7, 6],
      [12, 1],
    ],
  );
  assert.deepEqual(
    second.nameAssociations!.slice(0, 2).map((a) => a.participantId),
    [null, null],
  );
});
// node:test conserva a mesma tabela it.each sem acrescentar outro runner.
const it = {
  each<T extends { id: number; name: string; run: () => void | Promise<void> }>(cases: T[]) {
    return () => cases.sort((a, b) => a.id - b.id).forEach((c) => test(`${c.id}. ${c.name}`, c.run));
  },
};
it.each([
  {
    id: 15,
    name: "ten represented players without history give only a suggestion",
    run: () => {
      const mogi = ingest(prefix(0), source("ten", 1, "finishOrderAdded", [11, 9, 8, 7, 6, 5, 4, 3, 2, 1]));
      assert.equal(number(mogi, "ten"), undefined);
      const q = mogiQuestions(mogi).find((q) => q.kind === "race");
      assert.equal(q?.suggestion, 1);
      const later = ingest(prefix(0), source("ten-later", 3, "finishOrderAdded", [11, 9, 8, 7, 6, 5, 4, 3, 2, 1]));
      assert.equal(number(later, "ten-later"), undefined);
      assert.equal(mogiQuestions(later).find((q) => q.kind === "race")?.suggestion, 3);
    },
  },
  {
    id: 16,
    name: "a sum of 83 with twelve represented players stays a conflict without rounding",
    run: () => {
      const c = source("bad", 1);
      c.numericRows![10].right = reading(3);
      const mogi = ingest(prefix(0), c);
      assert.equal(number(mogi, "bad"), undefined);
      assert.ok(mogi.sequence!.roomAnalysis!.conflicts.includes("bad"));
      assert.equal(mogi.races.filter((r) => r.status === "confirmed").length, 0);
    },
  },
  {
    id: 19,
    name: "a discarded occurrence keeps physical four as valid three",
    run: () => {
      const seed = prefix(3);
      seed.races.forEach((r, i) => {
        r.physicalNumber = i + 1;
        r.number = i === 1 ? undefined : i === 2 ? 2 : 1;
      });
      seed.races[1].status = "discarded";
      const mogi = ingest(seed, source("physical-four", 4));
      const occurrence = mogi.sequence!.occurrences.find((o) => o.captureIds.includes("physical-four"))!;
      assert.equal(occurrence.physicalNumber, 4);
      assert.equal(occurrence.number, 3);
      assert.equal(mogi.races.filter((r) => r.status === "confirmed").length, 3);
    },
  },
  {
    id: 11,
    name: "an illegible cumulative is deduced without changing the OCR or asking",
    run: () => {
      const c = source("missing", 1);
      c.numericRows![0].right = { ...reading(0), text: "?", value: null, uncertain: true };
      const original = structuredClone(c.numericRows);
      const mogi = ingest(prefix(0), c);
      assert.equal(number(mogi, c.id), 1);
      assert.equal(mogiQuestions(mogi).length, 0);
      assert.deepEqual(mogi.captures![0].numericRows, original);
      assert.equal(mogi.captures![0].numericAnswers, undefined);
      assert.deepEqual(mogi.captures![0].numericDeductions, [{ row: 1, field: "right", value: 15, origin: "deduced" }]);
      const later = source("missing-after-prefix", 6);
      later.numericRows![0].right = { ...reading(0), text: "?", value: null, uncertain: true };
      const next = ingest(prefix(5), later);
      assert.equal(number(next, later.id), 6);
      assert.equal(mogiQuestions(next).length, 0);
      assert.deepEqual(next.captures![0].numericDeductions, [{ row: 1, field: "right", value: 90, origin: "deduced" }]);
    },
  },
  {
    id: 17,
    name: "two unordered sessions use photo times or a single Which came first",
    run: async () => {
      for (const timed of [true, false, "overlap"] as const) {
        const captures = [
          ...session("first", 2, 0, timed ? 1000 : undefined),
          ...session("second", 2, 4, timed === "overlap" ? 1000 : timed ? 2000 : undefined),
        ];
        const mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(0), ...[...captures].reverse())] }))
          .mogis[0];
        const questions = mogiQuestions(mogi);
        if (timed === true) {
          assert.equal(questions.length, 0);
          assert.deepEqual(
            captures.map((c) => number(mogi, c.id)),
            [1, 2, 3, 4],
          );
        } else {
          assert.ok(mogi.sequence!.roomAnalysis!.captures.every((c) => c.number === undefined));
          assert.equal(mogi.races.filter((r) => r.status === "confirmed").length, 0);
          assert.equal(questions.length, 1);
          const q = questions[0];
          assert.equal(q.kind, "sequence");
          assert.equal(q.reading, "Which came first?");
          const answered = (
            await normalizeReconstructions({
              mogis: [await answerMogiQuestion(mogi, q.id, { kind: "sequence", value: "first-1" })],
            })
          ).mogis[0];
          assert.equal(answered.sequence?.conflict, undefined);
          assert.deepEqual(
            captures.map((c) => number(answered, c.id)),
            [1, 2, 3, 4],
          );
          assert.equal(mogiQuestions(answered).length, 0);
        }
      }
      const known = session("known", 2, 0),
        seed = prefix(0);
      seed.sequence = {
        version: 1,
        numbers: known.map((c, i) => ({ captureId: c.id, number: i + 1, phase: "after" })),
        links: [],
        occurrences: [],
        relations: [],
        gaps: [],
        inputSignature: "fixture",
      };
      const pending = ingest(seed, ...known, ...session("next-a", 2, 4), ...session("next-b", 2, 8));
      const q = mogiQuestions(pending).find((q) => q.kind === "sequence")!;
      assert.equal(q?.reading, "Which came first?");
      const sorted = await answerMogiQuestion(pending, q.id, { kind: "sequence", value: "next-a-1" });
      assert.deepEqual(
        ["known-1", "known-2", "next-a-1", "next-a-2", "next-b-1", "next-b-2"].map((id) => number(sorted, id)),
        [1, 2, 3, 4, 5, 6],
      );
      assert.equal(mogiQuestions(sorted).length, 0);
    },
  },
  {
    id: 8,
    name: "three sessions of 3, 4 and 5 races ordered by photo time fill 1 to 12",
    run: () => {
      const captures = [...session("a", 3, 0, 1000), ...session("b", 4, 4, 2000), ...session("c", 5, 8, 3000)];
      const mogi = ingest(prefix(0), ...[...captures].reverse());
      assert.deepEqual(
        captures.map((c) => number(mogi, c.id)),
        Array.from({ length: 12 }, (_, i) => i + 1),
      );
      assert.equal(mogi.sequence!.roomAnalysis!.sessions.length, 3);
      assert.equal(mogi.sequence!.roomAnalysis!.sessions.filter((s) => s.reopening).length, 2);
      assert.equal(mogiQuestions(mogi).length, 0);
    },
  },
  {
    id: 12,
    name: "equal D2 and overall standings are two sources of the same occurrence",
    run: () => {
      const mogi = ingest(prefix(0), source("finishOrder", 3), source("general", 3, "overallStandings"));
      assert.equal(mogi.sequence!.occurrences.length, 1);
      assert.deepEqual(new Set(mogi.sequence!.occurrences[0].captureIds), new Set(["finishOrder", "general"]));
    },
  },
  {
    id: 13,
    name: "equal vectors with a known reopening stay in distinct sessions",
    run: () => {
      const a = source("first-room", 1),
        b = source("second-room", 1);
      const seed = prefix(0);
      seed.sequence = {
        version: 1,
        numbers: [
          { captureId: a.id, number: 1, phase: "after" },
          { captureId: b.id, number: 2, phase: "after" },
        ],
        links: [{ fromCaptureId: a.id, toCaptureId: b.id, signature: sourcePairSignature(a, b), continuity: "reset" }],
        occurrences: [],
        relations: [],
        gaps: [],
        inputSignature: "fixture",
      };
      const mogi = ingest(seed, b, a);
      assert.deepEqual([number(mogi, a.id), number(mogi, b.id)], [1, 2]);
      assert.equal(mogi.sequence!.occurrences.length, 2);
      assert.equal(mogi.sequence!.roomAnalysis!.sessions.length, 2);
      const timed = ingest(
        prefix(0),
        ...[...session("earlier", 2, 0, 1000), ...session("later", 2, 0, 2000)].reverse(),
      );
      assert.deepEqual(
        ["earlier-1", "earlier-2", "later-1", "later-2"].map((id) => number(timed, id)),
        [1, 2, 3, 4],
      );
      assert.equal(timed.sequence!.occurrences.length, 4);
      assert.equal(timed.sequence!.roomAnalysis!.sessions.length, 2);
    },
  },
  {
    id: 14,
    name: "a shuffled batch of one to five does not depend on selection",
    run: () => {
      const mogi = ingest(prefix(0), ...[4, 2, 5, 1, 3].map((j) => source(`race-${j}`, j)));
      assert.deepEqual(
        [1, 2, 3, 4, 5].map((j) => number(mogi, `race-${j}`)),
        [1, 2, 3, 4, 5],
      );
      assert.equal(mogiQuestions(mogi).length, 0);
    },
  },
  {
    id: 10,
    name: "p1 returning restarts only their segment and waits for another capture",
    run: () => {
      const dc = disconnected(),
        back = source("return", 1);
      back.numericRows!.forEach((r, i) => {
        r.right = reading(i === 0 ? P[i] : dc.numericRows![i - 1].right.value! + P[i]);
      });
      const mogi = ingest(prefix(5), back, dc);
      assert.equal(number(mogi, "dc"), 6);
      assert.equal(number(mogi, "return"), 7);
      const entry = mogi.sequence!.roomAnalysis!.captures.find((c) => c.captureId === "return")!;
      assert.equal(entry.segments.find((s) => s.participantId === "p1")?.anchor, false);
      assert.ok(entry.segments.filter((s) => s.participantId !== "p1").every((s) => s.anchor));
      assert.equal(mogiQuestions(mogi).length, 0);
      const reset = source("individual-reset", 6);
      reset.numericRows![0].right = reading(15);
      const firstReturn = ingest(prefix(5), reset);
      assert.equal(number(firstReturn, reset.id), 6);
      assert.equal(
        firstReturn.sequence!.roomAnalysis!.captures[0].segments.find((s) => s.participantId === "p1")?.anchor,
        false,
      );
      const second = source("individual-second", 7);
      second.numericRows![0].right = reading(30);
      const repeated = ingest(firstReturn, second);
      assert.equal(number(repeated, second.id), 7);
      assert.equal(
        repeated
          .sequence!.roomAnalysis!.captures.find((c) => c.captureId === second.id)!
          .segments.find((s) => s.participantId === "p1")?.anchor,
        true,
      );
    },
  },
  {
    id: 9,
    name: "eleven represented players in R6 continue the vector without p1",
    run: () => {
      const capture = disconnected();
      const mogi = ingest(prefix(5), capture);
      assert.equal(number(mogi, "dc"), 6);
      assert.equal(
        mogiQuestions(mogi).some((q) => q.kind === "race" || q.kind === "sequence"),
        false,
      );
    },
  },
  ...([1, 2, 3] as const).map((id) => ({
    id,
    name: [
      "",
      "D2 V(3) numbers three",
      "D1 prior V(2) numbers three",
      "lobby V(3) sits before the fourth without a result",
    ][id],
    run: () => {
      const mogi = ingest(
        prefix(0),
        source("one", id === 2 ? 2 : 3, id === 1 ? "finishOrderAdded" : id === 2 ? "finishOrderAdding" : "twoColumns"),
      );
      assert.equal(number(mogi, "one"), id === 3 ? 4 : 3);
      if (id === 3) {
        assert.equal(mogiOverview(mogi).positions[3].state, "pending");
        assert.equal(
          mogi.races.some((r) => r.captureIds?.includes("one")),
          false,
        );
      }
    },
  })),
  {
    id: 18,
    name: "iterative reopening after R5 does not ask at R6, R7 or R8",
    run: () => {
      for (const observed of [false, true]) {
        let mogi = observed ? ingest(prefix(0), ...session("original", 5, 0, 1000)) : prefix(5);
        for (let j = 1; j <= 3; j++) {
          const c = source(`new-${j}`, j);
          c.photoMoment = { at: 2000 + j, source: "exif" };
          mogi = ingest(mogi, c);
          assert.equal(number(mogi, `new-${j}`), 5 + j);
          assert.equal(mogiQuestions(mogi).length, 0);
        }
      }
    },
  },
  {
    id: 6,
    name: "V(1), V(2), V(3) together fix the new session at 5, 6, 7",
    run: () => {
      const mogi = ingest(prefix(4), source("c", 3), source("a", 1), source("b", 2));
      assert.deepEqual(
        ["a", "b", "c"].map((id) => number(mogi, id)),
        [5, 6, 7],
      );
      assert.equal(mogi.sequence!.roomAnalysis!.sessions.length, 1);
      assert.equal(mogiQuestions(mogi).length, 0);
    },
  },
  {
    id: 7,
    name: "numberedRoomSpan reconstructs race 2 from the first and third game cumulatives",
    run: async () => {
      let mogi = ingest(prefix(0), source("first", 1, "overallStandings"));
      mogi = ingest(mogi, source("third", 3, "overallStandings"));
      mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
      assert.equal(number(mogi, "third"), 3);
      assert.equal(mogi.races.find((r) => r.number === 2)?.status, "confirmed");
      assert.deepEqual(
        mogi.races.find((r) => r.number === 2)?.placements,
        people.map((person) => person.id),
      );
      assert.equal(mogi.races.find((r) => r.number === 3)?.status, "confirmed");
      assert.deepEqual(
        Object.fromEntries(individualStandings(mogi).map((p) => [p.id, p.points])),
        Object.fromEntries(people.map((p, i) => [p.id, 3 * P[i]])),
      );
      assert.equal(
        mogiQuestions(mogi).some((q) => q.kind === "race" || q.kind === "sequence"),
        false,
      );
      const sparse = prefix(3);
      sparse.races[1] = { ...sparse.races[1], status: "pending", placements: [] };
      const afterGap = ingest(sparse, source("after-gap", 4, "overallStandings"));
      assert.equal(number(afterGap, "after-gap"), 4);
    },
  },
  {
    id: 5,
    name: "a new V(3) session after a prefix of four asks once with seven first",
    run: async () => {
      const mogi = ingest(prefix(4), source("new", 3));
      const questions = mogiQuestions(mogi);
      assert.equal(questions.length, 1);
      const q = questions[0];
      assert.equal(q.kind, "race");
      if (q.kind !== "race") return;
      assert.equal(q.suggestion, 7);
      assert.deepEqual(
        q.options.map((o) => o.value),
        [7, 8, 9, 10, 11, 12],
      );
      const answered = await answerMogiQuestion(mogi, q.id, { kind: "race", value: 8 });
      assert.equal(number(answered, "new"), 8);
      assert.equal(mogiQuestions(answered).length, 0);
    },
  },
  {
    id: 4,
    name: "a prefix of five plus V(1) deduces R6 and a reopening",
    run: () => {
      const mogi = ingest(prefix(5), source("new", 1));
      assert.equal(number(mogi, "new"), 6);
      assert.equal(mogiQuestions(mogi).length, 0);
      assert.ok(mogi.sequence?.roomAnalysis?.sessions.some((s) => s.reopening && s.start === 6));
    },
  },
])();

test("an eleven-player finish order keeps the source's twelve links without giving a gain to the absent player", () => {
  const capture = disconnected();
  capture.rows.push({ text: "", confidence: 0, uncertain: false, suggestedParticipantId: "p1" });
  capture.nameAssociations!.push({ participantId: "p1" });
  capture.numericRows!.push({
    row: 12,
    right: { ...reading(0), text: "", value: null, uncertain: true },
    addition: { ...reading(0), text: "", value: null, uncertain: true },
  });
  capture.interpretation!.represented = 11;
  const mogi = ingest(prefix(5), capture);
  const race = mogi.races.find((race) => race.number === 6)!;
  assert.equal(race.status, "confirmed");
  assert.equal(race.placements.length, 11);
  assert.deepEqual(race.absentParticipantIds, ["p1"]);
  assert.equal(race.gameEvidence?.rowAssociations?.[capture.id].length, 12);
  assert.equal(race.gameEvidence?.readings.p1, undefined);
  assert.equal(individualStandings(mogi).find((person) => person.id === "p1")?.points, 76);
});

test("a finish order without additions or extent keeps a question after it is numbered", async () => {
  const capture = disconnected();
  capture.rows.push({ text: "", confidence: 0, uncertain: false, suggestedParticipantId: "p1" });
  capture.nameAssociations!.push({ participantId: "p1" });
  capture.numericRows!.push({
    row: 12,
    right: { ...reading(0), text: "", value: null, uncertain: true },
    addition: { ...reading(0), text: "", value: null, uncertain: true },
  });
  // A finish order without additions uses totals outside the overall order; the last rank was not read.
  [capture.numericRows![0].right, capture.numericRows![1].right] = [
    capture.numericRows![1].right,
    capture.numericRows![0].right,
  ];
  capture.interpretation = {
    version: 1,
    screen: "unknown",
    origin: "visual",
    movementRows: [],
    reasons: [],
    positions: Array.from({ length: 12 }, (_, i) =>
      i < 10 ? reading(i + 1) : { ...reading(0), value: null, text: "", uncertain: true },
    ),
  };
  let mogi = ingest(prefix(5), capture);
  const number = mogiQuestions(mogi).find((question) => question.kind === "race")!;
  mogi = reconcileSequence(await answerMogiQuestion(mogi, number.id, { kind: "race", value: 6 }));
  const room = mogiQuestions(mogi).find((question) => question.reading === "How many players were in this race?");
  assert.ok(room, "A captura numerada pendente continua na fila");
  mogi = reconcileSequence(await answerMogiQuestion(mogi, room.id, { kind: "sequence", value: "11" }));
  assert.equal(mogi.races.find((race) => race.number === 6)?.status, "confirmed");
});

test("an unknown capture without ranks does not ask the finish-order size", () => {
  const capture = source("unknown-without-ranks", 2);
  capture.interpretation!.screen = "unknown";
  capture.interpretation!.positions = P.map(() => ({ ...reading(0), value: null, text: "", uncertain: true }));
  const mogi = ingest(prefix(0), capture);
  assert.equal(
    mogiQuestions(mogi).some((question) => question.id === `representation:${capture.id}`),
    false,
  );
});

test("a contradictory readable total keeps a conflict even with a deduced prior scale", () => {
  const capture = source("contradictory-prior", 3, "finishOrderAdding");
  delete capture.interpretation!.currentScale;
  // The first row's addition is recoverable, but the readable cumulative is impossible.
  capture.numericRows![0].addition = { ...reading(0), text: "x15", value: null, uncertain: true };
  capture.numericRows![0].right = reading(1000);
  capture.numericRows![1].right = { ...reading(0), text: "", value: null, uncertain: true };
  const mogi = ingest(prefix(1), capture);
  assert.ok(mogi.sequence!.roomAnalysis!.conflicts.includes(capture.id));
  assert.ok(
    mogiQuestions(mogi).some(
      (question) => question.kind === "points" && question.captureId === capture.id && question.row === 1,
    ),
  );
  assert.equal(mogi.captures!.find((source) => source.id === capture.id)!.numericRows![0].right.value, 1000);
});

test("a total no earlier screen can reach is never suggested, and confirming it anyway reopens it empty (points.out-of-range)", async () => {
  // Race 10's screen reads row 4's total with a spurious leading 1, and p9 restarted at 0: no sum fits it.
  const last = source("adding-10", 9, "finishOrderAdding");
  const truth = last.numericRows![3].right.value!;
  last.numericRows![3].right = { ...reading(100 + truth), text: String(100 + truth) };
  last.numericRows![8].right = reading(0);
  const shots = [...Array.from({ length: 9 }, (_, n) => source(`adding-${n + 1}`, n, "finishOrderAdding")), last];
  shots.forEach((shot, n) => (shot.photoMoment = { at: 1_800_000_000_000 + n * 240_000, source: "exif" }));
  let mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(0), ...shots)] })).mogis[0];
  const row4 = () => mogiQuestions(mogi).find((q) => q.kind === "points" && q.captureId === "adding-10" && q.row === 4);
  assert.notEqual(row4()?.kind === "points" && row4()?.suggestion, 100 + truth);
  // Confirming what each field offers, or the misread where it offers nothing, asks each question once; row 4
  // returns once more, empty.
  const asked = new Set<string>();
  for (let question = mogiQuestions(mogi)[0]; question?.kind === "points"; question = mogiQuestions(mogi)[0]) {
    if (asked.has(question.id)) break;
    asked.add(question.id);
    const value = question.suggestion ?? question.read!;
    mogi = (
      await normalizeReconstructions({
        mogis: [await answerMogiQuestion(mogi, question.id, { kind: "points", value })],
      })
    ).mogis[0];
  }
  const again = row4();
  assert.ok(again?.kind === "points" && again.suggestion === null);
  assert.equal(mogiQuestions(mogi)[0]?.id, again.id);
});

test("an unread total on a screen repeating the previous totals takes the previous one (duplicate.same-vector)", async () => {
  // The final standings repeat the totals race 12's result screen adds up to; p5's total is unreadable there. p3
  // restarted before race 12, so no sum closes the screens.
  const shots = Array.from({ length: 12 }, (_, n) => source(`adding-${n + 1}`, n, "finishOrderAdding"));
  shots[11].numericRows![2].right = reading(0);
  const standings = source("standings", 12, "overallStandings");
  standings.interpretation!.screen = "finalStandings";
  standings.numericRows![4].right = { ...reading(0), text: "", value: null, confidence: 0, uncertain: true };
  standings.numericRows![2].right = reading(P[2]);
  [...shots, standings].forEach(
    (shot, n) => (shot.photoMoment = { at: 1_800_000_000_000 + n * 240_000, source: "exif" }),
  );
  const mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(0), ...shots, standings)] })).mogis[0];
  const question = mogiQuestions(mogi).find((q) => q.kind === "points" && q.captureId === "standings" && q.row === 5);
  const deduced = mogi.captures!.at(-1)!.numericDeductions?.find((d) => d.row === 5)?.value;
  assert.equal(question?.kind === "points" ? question.suggestion : deduced, 12 * P[4]);
});

test("a zero game cumulative column remains the room start when unknown photo moments can follow it", async () => {
  for (const timed of [true, false])
    for (const order of [
      [0, 3],
      [3, 0],
    ]) {
      let mogi = emptyFfaMogi();
      for (const index of order) mogi = await ingestReadings(mogi, [ffaReading(index, timed)]);
      assert.equal(mogi.races.find((race) => race.captureIds?.includes("c1"))?.status, "confirmed");
      assert.deepEqual(mogiQuestions(mogi), []);
    }
  const earlier = ffaReading(3, true);
  earlier.photoMoment!.at = 1793592256000;
  const competing = ffaReading(0, false);
  competing.id = "competing-start";
  for (const other of [earlier, competing]) {
    const mogi = await ingestReadings(emptyFfaMogi(), [other, ffaReading(0, !!other.photoMoment)]);
    assert.ok(mogiQuestions(mogi).some((question) => question.captureId === "c1"));
  }
});

test("the twelfth person's total missing from a pre-race crop comes from the race sum, closing race 1 without questions (unseenRowParticipant)", async () => {
  const unseen = (capture: Capture) => {
    capture.rows.splice(4, 1);
    capture.nameAssociations!.splice(4, 1);
    capture.numericRows = capture.numericRows!.filter((row) => row.row !== 5).map((row, i) => ({ ...row, row: i + 1 }));
    return capture;
  };
  const before = [unseen(source("zero", 0, "twoColumns")), unseen(source("after-1", 1, "twoColumns"))];
  const mogi = (
    await normalizeReconstructions({ mogis: [ingest(prefix(0), ...before, source("after-2", 2, "twoColumns"))] })
  ).mogis[0];
  const race = mogi.races.find((race) => race.number === 1);
  assert.equal(race?.origin, "reconstructed");
  assert.deepEqual(
    race.placements,
    people.map((person) => person.id),
  );
  assert.deepEqual(mogiQuestions(mogi), []);
  // An absence typed later, in race 2, leaves the sum before it whole: both crops keep the twelfth total and their numbers.
  const second = mogi.races.find((race) => race.number === 2)!;
  const edited = applyReviewedRace(mogi, {
    ...second,
    placements: second.placements.filter((id) => id !== "p5"),
    absentParticipantIds: ["p5"],
  });
  const after = (await normalizeReconstructions({ mogis: [edited] }, { previousState: { mogis: [mogi] } })).mogis[0];
  assert.equal(after.races.find((race) => race.id === second.id)?.origin, "manual");
  const numbers = (state: Mogi) =>
    ["zero", "after-1"].map(
      (id) => state.sequence?.roomAnalysis?.captures.find((entry) => entry.captureId === id)?.number,
    );
  assert.ok(numbers(mogi).every((number) => number !== undefined));
  assert.deepEqual(numbers(after), numbers(mogi));
});

test("final totals with one unreadable row settle race 12 against the pre-race-12 totals without questions", async () => {
  const final = source("final", 12);
  final.interpretation!.screen = "finalStandings";
  final.numericRows![3].right = { ...reading(0), text: "-1", value: null, uncertain: true };
  const mogi = (
    await normalizeReconstructions({ mogis: [ingest(prefix(11), source("before-12", 11, "twoColumns"), final)] })
  ).mogis[0];
  const race = mogi.races.find((race) => race.number === 12);
  assert.equal(race?.origin, "reconstructed");
  assert.deepEqual(
    race.placements,
    people.map((person) => person.id),
  );
  assert.deepEqual(mogiQuestions(mogi), []);
});

test("an adding column one unknown race after settled totals, with one unread total, settles that race without questions (gapCorroboratedValues)", async () => {
  const adding = source("adding-11", 10, "finishOrderAdding");
  adding.numericRows![0].right = { ...reading(0), text: "69 333s", value: null, uncertain: true };
  const mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(9), source("after-9", 9), adding)] })).mogis[0];
  const race = mogi.races.find((race) => race.number === 10);
  assert.equal(race?.origin, "reconstructed");
  assert.deepEqual(
    race.placements,
    people.map((person) => person.id),
  );
  assert.deepEqual(mogiQuestions(mogi), []);
});

test("a race between two pre-race screens is reconstructed once its number is supported again, dropping the stale review", async () => {
  const lost = "The inferred number lost its support. Enter the number for this race.";
  let mogi = ingest(prefix(3), source("before-4", 3, "twoColumns"), source("before-5", 4, "twoColumns"));
  const race = mogi.races.find((entry) => entry.number === 4)!;
  mogi = {
    ...mogi,
    races: mogi.races.map((entry) =>
      entry === race ? { ...entry, status: "pending", placements: [], participationReview: lost } : entry,
    ),
  };
  mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  const settled = mogi.races.find((entry) => entry.number === 4);
  assert.equal(settled?.participationReview, undefined);
  assert.equal(settled?.status, "confirmed");
  assert.deepEqual(
    settled?.placements,
    people.map((person) => person.id),
  );
  assert.deepEqual(mogiQuestions(mogi), []);
});

/** A pre-race screen showing each person's total, in people order; `zero` rows show a restart's "0", which OCR rates
 * below certainty. */
function preRace(id: string, totals: number[], zero: number[] = []): Capture {
  const capture = source(id, 0, "twoColumns");
  capture.numericRows = totals.map((total, i) => ({
    row: i + 1,
    right: zero.includes(i)
      ? { ...reading(0), confidence: 71, uncertain: true, alternatives: [{ text: "0", confidence: 71, value: 0 }] }
      : reading(total),
    addition: { ...reading(0), value: null, uncertain: true },
  }));
  return capture;
}

test("a restart shown as zero before a race the person wins settles both races around it, and entering one keeps the other (restartedZeros)", async () => {
  // Race 4: p1 last, everyone else one place up. p1 restarts at 0 before race 5, which they win.
  const race4 = [...people.slice(1), people[0]].map((person) => person.id);
  const after3 = P.map((points) => 3 * points);
  const after4 = after3.map((total, i) => total + P[race4.indexOf(people[i].id)]);
  const after5 = after4.map((total, i) => (i === 0 ? 0 : total) + P[i]);
  let mogi = ingest(
    prefix(3),
    preRace("before-4", after3),
    preRace("before-5", after4, [0]),
    preRace("before-6", after5),
  );
  mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.deepEqual(mogi.races.find((race) => race.number === 4)?.placements, race4);
  assert.deepEqual(
    mogi.races.find((race) => race.number === 5)?.placements,
    people.map((person) => person.id),
  );
  assert.equal(individualStandings(mogi).find((person) => person.id === "p1")?.points, 45 + 1 + 15);
  // Entering race 4 by hand leaves race 5, which its own boundaries determine, established.
  mogi = applyReviewedRace(mogi, { ...mogi.races.find((race) => race.number === 4)!, origin: "manual" });
  mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  assert.deepEqual(
    mogi.races.find((race) => race.number === 5)?.placements,
    people.map((person) => person.id),
  );
});

test("a legible total that dropped within what the person scored since an earlier screen is a restart, not a misread (restartedTotal)", async () => {
  // p12 restarts before race 3 and scores 1 there: two races after the pre-race-2 screen, it shows 1, not 3.
  const after3 = P.map((points, i) => (i === 11 ? points : 3 * points));
  const mogi = (
    await normalizeReconstructions({ mogis: [ingest(prefix(1), preRace("before-2", P), preRace("before-4", after3))] })
  ).mogis[0];
  assert.deepEqual(
    mogiQuestions(mogi).filter((question) => question.kind === "points"),
    [],
  );
});

test("a legible total below one the room's sum filled in for an unreadable row is a restart, not a misread (restartedTotal)", async () => {
  // Everyone keeps their place each race. p12 restarts during race 1 and scores 1 in race 2: its row is unreadable on
  // the pre-race-3 board, whose sum fills in 2 as if it never restarted; the pre-race-4 board shows 2, not 3.
  const blank = preRace(
    "before-3",
    P.map((points) => 2 * points),
  );
  blank.numericRows![11].right = { ...reading(0), text: "", value: null, confidence: 0, uncertain: true };
  const mogi = (
    await normalizeReconstructions({
      mogis: [
        ingest(
          prefix(1),
          preRace("before-2", P),
          blank,
          preRace(
            "before-4",
            P.map((points, i) => (i === 11 ? 2 : 3 * points)),
          ),
        ),
      ],
    })
  ).mogis[0];
  assert.deepEqual(
    mogiQuestions(mogi).filter((question) => question.kind === "points"),
    [],
  );
});

test("a result screen one player short, with another back at zero, continues the room: that player restarted, the room never reopened (restartsAside)", async () => {
  // p11 reconnects before race 4 and shows 0 there; p12 dropped out during race 4, so its screen lists eleven.
  const race4 = source("adding-4", 3, "finishOrderAdding", P.slice(1));
  race4.numericRows = race4.numericRows!.map((row, i) => ({ ...row, right: reading(i === 10 ? 0 : 3 * P[i]) }));
  const mogi = (
    await normalizeReconstructions({
      mogis: [ingest(prefix(0), ...[0, 1, 2].map((n) => source(`adding-${n + 1}`, n, "finishOrderAdding")), race4)],
    })
  ).mogis[0];
  assert.equal(number(mogi, "adding-4"), 4);
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.equal(individualStandings(mogi).find((person) => person.id === "p11")?.points, 3 * 2);
});

test("pre-race boards around restarts take their numbers race by race, never from a longer comparison a restart hides (placeAlong)", async () => {
  // Race r: everyone rotates one place. p1 drops in race 5 and restarts at 0; p2 restarts before race 9 (its board
  // reads an uncertain 0); p3 sits race 9 out (its board lists eleven) and restarts at 0. No board before race 5.
  const order = (race: number) => people.map((_, i) => people[(i + race) % 12].id);
  const totals: Record<string, number>[] = [Object.fromEntries(people.map((p) => [p.id, 0]))];
  for (let race = 1; race <= 11; race++) {
    const next = { ...totals[race - 1] };
    const room = order(race).filter((id) => race !== 9 || id !== "p3");
    room.forEach((id, place) => (next[id] += nativeScale(room.length)[place]));
    if (race === 5) next.p1 = 0;
    if (race === 8) next.p2 = 0;
    if (race === 9) next.p3 = 0;
    totals.push(next);
  }
  const boards = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12].map((race) => {
    const shown = people.filter((p) => race !== 9 || p.id !== "p3");
    const board = preRace(
      `before-${race}`,
      shown.map((p) => totals[race - 1][p.id]),
      race === 9 ? [1] : [],
    );
    board.rows = board.rows.slice(0, shown.length);
    board.nameAssociations = shown.map((p) => ({ participantId: p.id }));
    board.photoMoment = { at: 1_800_000_000_000 + race * 240_000, source: "exif" };
    return board;
  });
  let mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(0), ...boards)] })).mogis[0];
  for (const race of [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]) assert.equal(number(mogi, `before-${race}`), race);
  // p2's zero on board 9 is its restart, never a total filled in from the room's sum.
  assert.deepEqual(
    mogi.captures?.find((capture) => capture.id === "before-9")?.numericDeductions?.map((d) => [d.row, d.value]),
    [[2, 0]],
  );
  // Every board settles the race before it, at most after position answers.
  const asked = new Set<string>();
  for (let question = mogiQuestions(mogi)[0]; question; question = mogiQuestions(mogi)[0]) {
    assert.ok(question.kind === "position" && !asked.has(question.id), JSON.stringify(question));
    asked.add(question.id);
    const room = order(question.number!).filter((id) => question.number !== 9 || id !== "p3");
    const place = room.indexOf(question.participantId);
    const answer = { kind: "position" as const, value: place < 0 ? ("absent" as const) : place + 1 };
    mogi = (await normalizeReconstructions({ mogis: [await answerMogiQuestion(mogi, question.id, answer)] })).mogis[0];
  }
  const counted = countedRaces(mogi).map((race) => race.number);
  for (const race of [6, 7, 8, 9, 10, 11]) assert.ok(counted.includes(race), `race ${race}`);
});

test("a late result screen without legible totals takes the one race whose established order it repeats (finishOrderNumber)", async () => {
  // Race 1 is reconstructed from the zero start and the pre-race-2 totals; its result screen arrives later, mid-animation.
  const race1 = [...people.slice(4), ...people.slice(0, 4)];
  const before2 = people.map((person) => P[race1.indexOf(person)]);
  let mogi = (
    await normalizeReconstructions({
      mogis: [
        ingest(
          prefix(0),
          preRace(
            "before-1",
            P.map(() => 0),
          ),
          preRace("before-2", before2),
        ),
      ],
    })
  ).mogis[0];
  assert.deepEqual(
    mogi.races.find((race) => race.number === 1)?.placements,
    race1.map((person) => person.id),
  );
  const late = source("after-1", 0, "finishOrderAdding");
  late.rows = race1.map((p) => ({ text: p.ign, confidence: 100, uncertain: false, suggestedParticipantId: p.id }));
  late.nameAssociations = race1.map((p) => ({ participantId: p.id }));
  late.numericRows = late.numericRows!.map((row) => ({
    ...row,
    right: { ...reading(0), value: null, uncertain: true },
  }));
  mogi = (await normalizeReconstructions({ mogis: [ingest(mogi, late)] })).mogis[0];
  assert.equal(number(mogi, "after-1"), 1);
  assert.deepEqual(mogiQuestions(mogi), []);
});

test("an answered name links its other readings by the totals that continue it, and asks again when they fit either player", async () => {
  const igns = ["Alpha", "Bravo", "Charlie", "Delta", "Golf", "Hotel", "India", "Lima", "Mike", "Oscar"];
  const players = [...igns, "Eggyy", "Kip"].map((name, i) => ({
    id: `p${i + 1}`,
    loungeName: name,
    ign: name,
    teamId: `t${Math.floor(i / 2) + 1}`,
  }));
  // Eggyy and Kip read "EY"/"FYY" (once "J") before races and "E"/"F" on the last result.
  const variants: Record<string, [string, string]> = {
    "pre-2": ["EY", "FYY"],
    "pre-3": ["EY", "J"],
    "pre-4": ["EY", "FYY"],
    "result-4": ["E", "F"],
  };
  const run = async (orders: number[][]) => {
    const total = (person: number, races: number) =>
      orders.slice(0, races).reduce((sum, order) => sum + P[order.indexOf(person)], 0);
    const captures = Object.entries(variants).map(([id, [eleven, twelve]], index) => {
      const result = id.startsWith("result"),
        completed = result ? 4 : index + 1,
        order = result ? orders[3] : players.map((_, i) => i);
      const capture = source(id, 0, result ? "finishOrderAdded" : "twoColumns");
      capture.rows = order.map((person) => ({
        text: person === 10 ? eleven : person === 11 ? twelve : players[person].ign,
        confidence: 100,
        uncertain: false,
        suggestedParticipantId: person >= 10 ? "" : players[person].id,
      }));
      capture.nameAssociations = order.map((person) => ({ participantId: person >= 10 ? null : players[person].id }));
      capture.numericRows = order.map((person, row) => ({
        row: row + 1,
        right: reading(total(person, completed)),
        addition: { ...reading(0), value: null, uncertain: true },
      }));
      return capture;
    });
    let mogi = ingest({ ...prefix(0), format: "2v2", participants: players }, ...captures);
    const asked: string[] = [];
    for (let question = mogiQuestions(mogi).find((q) => q.kind === "name"); question && asked.length < 6;) {
      if (question.kind !== "name") break;
      asked.push(question.reading);
      const person = ["EY", "E"].includes(question.reading) ? "p11" : "p12";
      mogi = await answerMogiQuestion(mogi, question.id, { kind: "name", answer: { participantId: person } });
      question = mogiQuestions(mogi).find((q) => q.kind === "name");
    }
    const last = mogi.captures!.find((capture) => capture.id === "result-4")!;
    return { asked, last: last.rows.map((row, i) => [row.text, last.nameAssociations![i].participantId]) };
  };
  // Eggyy (10) and Kip (11) take the given places; the others fill the rest in rotation.
  const race = (by: number, eggyy: number, kip: number) => {
    const others = Array.from({ length: 10 }, (_, i) => (i + by) % 10);
    return Array.from({ length: 12 }, (_, place) => (place === eggyy ? 10 : place === kip ? 11 : others.shift()!));
  };
  const distinct = await run([race(0, 0, 5), race(3, 7, 2), race(6, 4, 9), race(1, 3, 8)]);
  assert.deepEqual(distinct.asked, ["EY"]);
  assert.deepEqual(distinct.last.filter(([text]) => text === "E" || text === "F").sort(), [
    ["E", "p11"],
    ["F", "p12"],
  ]);
  // Both have 30 before race 4, so "E" and "F" continue either player: the result still asks.
  const tied = await run([race(0, 0, 1), race(3, 3, 2), race(6, 6, 4), race(1, 3, 8)]);
  assert.deepEqual(tied.asked, ["EY", "E"]);
});

/** The adding screens of races 1 to 3, in which everyone keeps their place. */
const firstThree = () => [0, 1, 2].map((n) => source(`adding-${n + 1}`, n, "finishOrderAdding"));
/** The adding screen of race 4, after three races in which everyone kept their place: rows in `order`. */
function adding4(order: typeof people) {
  const capture = source("adding-4", 3, "finishOrderAdding", nativeScale(order.length));
  capture.rows = order.map((p) => ({ text: p.ign, confidence: 100, uncertain: false, suggestedParticipantId: p.id }));
  capture.nameAssociations = order.map((p) => ({ participantId: p.id }));
  capture.numericRows = order.map((p, i) => ({
    row: i + 1,
    right: reading(3 * P[people.indexOf(p)]),
    addition: reading(nativeScale(order.length)[i]),
  }));
  if (order.length === 11) {
    // OCR reads twelve fixed rows; the last one is empty.
    const empty = { ...reading(0), text: "", value: null, confidence: 0, uncertain: true };
    capture.rows.push({ text: "", confidence: 0, uncertain: true, suggestedParticipantId: "" });
    capture.nameAssociations!.push({ participantId: null });
    capture.numericRows!.push({ row: 12, right: empty, addition: empty });
    capture.unreadableRowNumbers = [12];
    capture.interpretation = { ...capture.interpretation!, currentScale: 11, represented: 11, representedBy: "scale" };
  }
  return capture;
}
/** Answers every position question as `orders` (race number → finish order, absent when left out) says. */
async function answerPositions(mogi: Mogi, orders: Record<number, string[]>) {
  for (let question = mogiQuestions(mogi)[0]; question?.kind === "position"; question = mogiQuestions(mogi)[0]) {
    const place = orders[mogi.races.find((race) => race.id === question.raceId)!.number!].indexOf(
      question.participantId,
    );
    const answer = { kind: "position", value: place < 0 ? "absent" : place + 1 } as const;
    mogi = (await normalizeReconstructions({ mogis: [await answerMogiQuestion(mogi, question.id, answer)] })).mogis[0];
  }
  return mogi;
}

test("a finish order read on screen replaces a reconstruction that only fit the totals (acceptFinishOrders)", async () => {
  // Race 5 has no screen. Before race 4's adding screen arrives, the places given for race 4 are race 5's, and the
  // swapped orders fit the totals as well.
  const race4 = [...people.slice(6), ...people.slice(0, 6)].map((p) => p.id);
  const race5 = people.map((p) => p.id).reverse();
  const after5 = people.map((p, i) => 3 * P[i] + P[race4.indexOf(p.id)] + P[race5.indexOf(p.id)]);
  const boards = [
    preRace(
      "before-4",
      P.map((points) => 3 * points),
    ),
    preRace("before-6", after5),
  ];
  let mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(0), ...firstThree(), ...boards)] })).mogis[0];
  mogi = await answerPositions(mogi, { 4: race5, 5: race4 });
  assert.deepEqual(mogi.races.find((race) => race.number === 4)!.placements, race5);
  mogi = (
    await normalizeReconstructions({
      mogis: [ingest(mogi, adding4(race4.map((id) => people.find((p) => p.id === id)!)))],
    })
  ).mogis[0];
  const race = (number: number) => mogi.races.find((entry) => entry.number === number)!;
  assert.deepEqual(race(4).placements, race4);
  assert.equal(race(4).origin, "observed");
  assert.deepEqual(race(5).placements, race5);
});

test("a player missing from an eleven-row finish order is absent, not first as an earlier answer placed them (acceptFinishOrders)", async () => {
  // p5 leaves before race 4 and is back at 0 before race 5, so the totals fit a win or an absence. Asked before the
  // result screen arrives, the answer is first; the screen then lists eleven, with the native 11 additions.
  const finishers = people.filter((p) => p.id !== "p5");
  const before4 = preRace(
    "before-4",
    finishers.map((p) => 3 * P[people.indexOf(p)]),
  );
  before4.rows = before4.rows.filter((row) => row.suggestedParticipantId !== "p5");
  before4.nameAssociations = finishers.map((p) => ({ participantId: p.id }));
  const before5 = preRace(
    "before-5",
    people.map((p) => (p.id === "p5" ? 0 : 3 * P[people.indexOf(p)] + nativeScale(11)[finishers.indexOf(p)])),
  );
  let mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(0), ...firstThree(), before4, before5)] }))
    .mogis[0];
  mogi = await answerPositions(mogi, { 4: ["p5", ...finishers.map((p) => p.id)] });
  assert.equal(mogi.races.find((race) => race.number === 4)!.placements[0], "p5");
  mogi = (await normalizeReconstructions({ mogis: [ingest(mogi, adding4(finishers))] })).mogis[0];
  const race4 = mogi.races.find((race) => race.number === 4)!;
  assert.deepEqual(
    race4.placements,
    finishers.map((p) => p.id),
  );
  assert.deepEqual(race4.absentParticipantIds, ["p5"]);
});

/** Races 4 and 5 confirmed as one assisted group: the places given for race 4 are race 5's, and both fit the totals. */
async function assistedPair() {
  const race4 = [...people.slice(6), ...people.slice(0, 6)].map((p) => p.id);
  const race5 = people.map((p) => p.id).reverse();
  const after5 = people.map((p, i) => 3 * P[i] + P[race4.indexOf(p.id)] + P[race5.indexOf(p.id)]);
  const boards = [
    preRace(
      "before-4",
      P.map((points) => 3 * points),
    ),
    preRace("before-6", after5),
  ];
  const mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(0), ...firstThree(), ...boards)] })).mogis[0];
  return { mogi: await answerPositions(mogi, { 4: race5, 5: race4 }), race4, race5 };
}
/** A race that names an assisted group must be one of its reconstructed targets, or a backup refuses it. */
const orphans = (mogi: Mogi) =>
  mogi.races.filter(
    (race) =>
      race.assistedGroupId !== undefined &&
      (race.origin !== "reconstructed" ||
        race.assistedGroupId !== mogi.assistance?.id ||
        !mogi.assistance.targetRaceIds.includes(race.id)),
  );

test("a race that leaves its assisted group drops the group, and its gap is solved again (setAssistanceAnalysis)", async () => {
  let { mogi } = await assistedPair();
  const race = (number: number) => mogi.races.find((entry) => entry.number === number)!;
  const answered = race(5).placements;
  // A new analysis covers race 4 only, as when race 5 stops being a target.
  mogi = setAssistanceAnalysis(mogi, { ...mogi.assistance!.analysis!, targetRaceIds: [race(4).id], status: "stale" });
  assert.deepEqual(orphans(mogi), []);
  mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  assert.deepEqual(race(5).placements, answered);
});

test("a saved result screen that kept its assisted group's id is settled on load (normalizeReconstructions)", async () => {
  const pair = await assistedPair();
  let mogi = (
    await normalizeReconstructions({
      mogis: [ingest(pair.mogi, adding4(pair.race4.map((id) => people.find((p) => p.id === id)!)))],
    })
  ).mogis[0];
  // Saved by an earlier version: race 4's screen replaced its reconstruction but the race kept the group's id.
  mogi = {
    ...mogi,
    races: mogi.races.map((race) => (race.number === 4 ? { ...race, assistedGroupId: mogi.assistance!.id } : race)),
  };
  mogi = (await normalizeReconstructions({ mogis: [mogi] }, { revalidateBoundaryProofs: true })).mogis[0];
  assert.deepEqual(orphans(mogi), []);
  assert.deepEqual(mogi.races.find((race) => race.number === 4)!.placements, pair.race4);
  assert.deepEqual(mogi.races.find((race) => race.number === 5)!.placements, pair.race5);
});

test("a reopened room's first screen read mid-animation, every total an uncertain 0, a blank or an O, starts that room (zeroRoomBoundary)", async () => {
  const timed = (capture: Capture, minute: number) => ({
    ...capture,
    photoMoment: { at: minute * 60000, source: "exif" as const },
  });
  const zeros = source("reopened-1", 0, "finishOrderAdding");
  zeros.numericRows = zeros.numericRows!.map((row, i) => ({
    ...row,
    right:
      i === 4
        ? { ...reading(0), text: "O", value: null, confidence: 43, uncertain: true }
        : [3, 7, 8].includes(i)
          ? { ...reading(0), text: "", value: null, confidence: 0, uncertain: true }
          : { ...reading(0), confidence: 71, uncertain: true },
  }));
  let mogi = ingest(
    prefix(0),
    timed(source("room-1", 0, "finishOrderAdding"), 0),
    timed(source("room-2", 1, "finishOrderAdding"), 4),
    timed(zeros, 16),
    ...[1, 2, 3].map((n) => timed(source(`reopened-${n + 1}`, n, "finishOrderAdding"), 16 + 4 * n)),
  );
  mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  const [question, ...rest] = mogiQuestions(mogi);
  assert.deepEqual([question?.kind, question?.captureId, rest], ["race", "reopened-1", []]);
  mogi = (
    await normalizeReconstructions({ mogis: [await answerMogiQuestion(mogi, question.id, { kind: "race", value: 3 })] })
  ).mogis[0];
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.deepEqual(
    ["room-1", "room-2", "reopened-1", "reopened-2", "reopened-3", "reopened-4"].map((id) => number(mogi, id)),
    [1, 2, 3, 4, 5, 6],
  );
});

test("a saved reopened room an older analysis numbered from race 3 is numbered again on load, as a fresh import would", async () => {
  const timed = (capture: Capture, minute: number) => ({
    ...capture,
    photoMoment: { at: minute * 60000, source: "exif" as const },
  });
  const zeros = source("reopened-1", 0, "finishOrderAdding");
  zeros.numericRows = zeros.numericRows!.map((row) => ({ ...row, right: { ...reading(0), confidence: 71 } }));
  let fresh = ingest(
    prefix(0),
    timed(source("room-1", 0, "finishOrderAdding"), 0),
    timed(source("room-2", 1, "finishOrderAdding"), 4),
    timed(zeros, 16),
    ...[1, 2, 3].map((n) => timed(source(`reopened-${n + 1}`, n, "finishOrderAdding"), 16 + 4 * n)),
  );
  fresh = (await normalizeReconstructions({ mogis: [fresh] })).mogis[0];
  const question = mogiQuestions(fresh)[0];
  const answered = (mogi: Mogi) => answerMogiQuestion(mogi, question.id, { kind: "race", value: 3 });
  const counted = async (mogi: Mogi) =>
    (await normalizeReconstructions({ mogis: [mogi] })).mogis[0].races.map((race) => [
      race.number,
      race.status,
      race.captureIds?.join(),
      race.participationReview,
    ]);
  const saved = (await normalizeReconstructions({ mogis: [await answered(fresh)] })).mogis[0];
  const expected = await counted(saved);
  // An older analysis left the zero screen as context and numbered the room's later screens 3 to 5.
  const older: Mogi = {
    ...saved,
    captures: saved.captures!.map((capture) =>
      capture.id === "reopened-1" ? { ...capture, stage: "context", context: { phase: "after" } } : capture,
    ),
    races: saved.races
      .filter((race) => race.number !== 3)
      .map((race) => (race.number! > 3 ? { ...race, number: race.number! - 1 } : race)),
    sequence: { ...fresh.sequence!, projectedRaceIds: saved.races.map((race) => race.id) },
  };
  const loaded = (await normalizeReconstructions({ mogis: [older] })).mogis[0];
  assert.deepEqual(await counted(loaded), await counted(fresh));
  assert.deepEqual(
    mogiQuestions(loaded).map((entry) => entry.captureId),
    ["reopened-1"],
  );
  assert.equal(expected.length, 6);
  assert.deepEqual(await counted(await answered(loaded)), expected);
});

test("answering a later race for a counted room's screen moves its races without reviving them at their old numbers", async () => {
  const screens = () =>
    [1, 2].map((n) => ({ ...source(`room-${n}`, n), photoMoment: { at: n * 60000, source: "exif" as const } }));
  const answered = async (mogi: Mogi) =>
    (
      await normalizeReconstructions({
        mogis: [
          reconcileSequence(
            applySequenceAnswer(mogi, { kind: "number", captureId: "room-1", value: 5 }, sequenceInputSignature(mogi)),
          ),
        ],
      })
    ).mogis[0];
  const counted = (mogi: Mogi) => mogi.races.map((race) => [race.number, race.status, race.captureIds?.join() ?? ""]);
  const before = (await normalizeReconstructions({ mogis: [ingest(prefix(0), ...screens())] })).mogis[0];
  assert.deepEqual(
    before.races.map((race) => [race.number, race.captureIds?.join()]),
    [
      [1, "room-1"],
      [2, "room-2"],
    ],
  );
  const moved = await answered(before);
  const ids = moved.races.map((race) => race.id);
  assert.deepEqual(ids, [...new Set(ids)]);
  assert.deepEqual(
    moved.races.filter((race) => race.captureIds?.length).map((race) => race.number),
    [5, 6],
  );
  assert.deepEqual(counted(moved), counted(await answered(ingest(prefix(0), ...screens()))));
});

/** Three adding screens: p12 finishes race 1 last, restarts at 0, then places 7th in race 2 (shows 0) and 4th in
 * race 3 (shows 6). */
function restartAfterRace1(): Capture[] {
  const others = people.slice(0, 11);
  const orders = [
    people,
    [...others.slice(5, 11), people[11], ...others.slice(0, 5)],
    [...others.slice(3, 6), people[11], ...others.slice(6), ...others.slice(0, 3)],
  ];
  const totals: Record<string, number> = Object.fromEntries(people.map((p) => [p.id, 0]));
  return orders.map((order, race) => {
    const capture = source(`adding-${race + 1}`, 0, "finishOrderAdding");
    capture.rows = order.map((p) => ({ text: p.ign, confidence: 100, uncertain: false, suggestedParticipantId: p.id }));
    capture.nameAssociations = order.map((p) => ({ participantId: p.id }));
    capture.numericRows = order.map((p, row) => ({
      row: row + 1,
      right: reading(totals[p.id]),
      addition: reading(P[row]),
    }));
    capture.photoMoment = { at: 1_800_000_000_000 + race * 240_000, source: "exif" };
    order.forEach((p, row) => (totals[p.id] += P[row]));
    if (race === 0) totals.p12 = 0;
    return capture;
  });
}
function assertRestartRoom(mogi: Mogi) {
  assert.deepEqual(
    ["adding-1", "adding-2", "adding-3"].map((id) => number(mogi, id)),
    [1, 2, 3],
  );
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.equal(individualStandings(mogi).find((person) => person.id === "p12")?.points, 1 + 6 + 9);
}

test("a total back at zero right after race 1, read cleanly, is a restart: the room stays one and nothing asks for points (restartedTotal)", async () => {
  assertRestartRoom((await normalizeReconstructions({ mogis: [ingest(prefix(0), ...restartAfterRace1())] })).mogis[0]);
});

test("answering a restart's total on its screenshot settles it, even over a continuing total answered before (restartedTotal)", async () => {
  // An older app stored the continuing total, 1 + 6, as p12's race-2 right column. That row shows "+6" and "0", so
  // the user now answers its total on the screenshot, 6.
  let mogi = ingest(prefix(0), ...restartAfterRace1());
  mogi.captures!.find((capture) => capture.id === "adding-2")!.numericAnswers = [{ row: 7, field: "right", value: 7 }];
  mogi = (await normalizeReconstructions({ mogis: [reconcileSequence(mogi)] })).mogis[0];
  // The room asks that row again, empty, and nothing else.
  assert.deepEqual(
    mogiQuestions(mogi).map((question) =>
      question.kind === "points" ? [question.id, question.suggestion] : [question.id],
    ),
    [["points:adding-2:7", null]],
  );
  mogi = await answerMogiQuestion(mogi, "points:adding-2:7", { kind: "points", value: 6 });
  assert.deepEqual(mogi.captures!.find((capture) => capture.id === "adding-2")!.numericAnswers, [
    { row: 7, field: "right", value: 0 },
  ]);
  assertRestartRoom((await normalizeReconstructions({ mogis: [reconcileSequence(mogi)] })).mogis[0]);
});

// After the race, the screen's total is the right-hand column as it stands: see the finish-order answer in
// mogi-questions.test.ts.
for (const [screen, total, right] of [
  ["twoColumns", 45, 45],
  ["finishOrderAdding", 60, 45],
] as const)
  test(`a points answer is the person's total on the screenshot: ${screen} (points.screenshot-total)`, async () => {
    // Race 4's screen misreads p1's total. The user answers the total that screenshot shows, adding any "+15", and
    // confirms what every other question suggests.
    const capture = source("race-4", 3, screen);
    capture.numericRows![0].right = reading(46);
    let mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(3), capture)] })).mogis[0];
    assert.ok(mogiQuestions(mogi).some((q) => q.id === "points:race-4:1"));
    for (let question = mogiQuestions(mogi)[0]; question?.kind === "points"; question = mogiQuestions(mogi)[0]) {
      mogi = await answerMogiQuestion(mogi, question.id, {
        kind: "points",
        value: question.id === "points:race-4:1" ? total : question.suggestion!,
      });
      mogi = (await normalizeReconstructions({ mogis: [reconcileSequence(mogi)] })).mogis[0];
    }
    assert.deepEqual(mogiQuestions(mogi), []);
    assert.equal(mogi.captures![0].numericAnswers?.find((answer) => answer.row === 1)?.value, right);
    assert.equal(individualStandings(mogi).find((person) => person.id === "p1")?.points, total);
  });

test("a stored answer over a misread total stays settled, even where the room's sum disagrees (singleMisreadTotal)", async () => {
  // Race 2's screen misreads row 5's pre-race total as 1, and the user answered 15, which the sum doesn't give. The
  // answer is the user's word: only a restart the screen shows asks that row again.
  const rotate = (n: number) => [...people.slice(n), ...people.slice(0, n)];
  const orders = [people, rotate(3), rotate(5)];
  const totals: Record<string, number> = Object.fromEntries(people.map((p) => [p.id, 0]));
  const captures = orders.map((order, race) => {
    const capture = source(`adding-${race + 1}`, 0, "finishOrderAdding");
    capture.rows = order.map((p) => ({ text: p.ign, confidence: 100, uncertain: false, suggestedParticipantId: p.id }));
    capture.nameAssociations = order.map((p) => ({ participantId: p.id }));
    capture.numericRows = order.map((p, row) => ({
      row: row + 1,
      right: reading(totals[p.id]),
      addition: reading(P[row]),
    }));
    capture.photoMoment = { at: 1_800_000_000_000 + race * 240_000, source: "exif" };
    order.forEach((p, row) => (totals[p.id] += P[row]));
    return capture;
  });
  captures[1].numericRows![4].right = { ...reading(1), confidence: 98 };
  let mogi = ingest(prefix(0), ...captures);
  mogi.captures!.find((capture) => capture.id === "adding-2")!.numericAnswers = [{ row: 5, field: "right", value: 15 }];
  mogi = (await normalizeReconstructions({ mogis: [reconcileSequence(mogi)] })).mogis[0];
  assert.deepEqual(
    captures.map((capture) => number(mogi, capture.id)),
    [1, 2, 3],
  );
  assert.deepEqual(mogi.sequence?.roomAnalysis?.conflicts, []);
  assert.deepEqual(mogiQuestions(mogi), []);
});

/** An FFA mogi as the boards and result screens of a live session read it: a pre-race board before races 1–10 and
 * result screens for races 1–3 and 10–12. p12 finishes race 1 last and restarts at 0. Each race's points, in people
 * order. */
const lobbyGapRaces = [
  [15, 12, 10, 9, 8, 6, 4, 7, 3, 2, 5, 1],
  [4, 15, 5, 9, 6, 2, 1, 12, 8, 7, 10, 3],
  [1, 8, 2, 5, 3, 9, 10, 12, 4, 6, 15, 7],
  [9, 15, 1, 7, 2, 4, 10, 12, 6, 8, 5, 3],
  [15, 5, 4, 12, 2, 10, 6, 9, 8, 3, 1, 7],
  [15, 5, 1, 3, 7, 10, 12, 4, 6, 8, 2, 9],
  ...[0, 1, 2, 3, 4, 5].map((race) => people.map((_, i) => P[(i + race * 5) % 12])),
];
function lobbyGap(): Capture[] {
  const totals = people.map(() => 0);
  const before = [[...totals]];
  lobbyGapRaces.forEach((points, race) => {
    points.forEach((gain, i) => (totals[i] += gain));
    if (race === 0) totals[11] = 0;
    before.push([...totals]);
  });
  const result = (race: number) => {
    const points = lobbyGapRaces[race];
    const order = [...people].sort((a, b) => points[people.indexOf(b)] - points[people.indexOf(a)]);
    const capture = source(`adding-${race + 1}`, 0, "finishOrderAdding");
    capture.rows = order.map((p) => ({ text: p.ign, confidence: 100, uncertain: false, suggestedParticipantId: p.id }));
    capture.nameAssociations = order.map((p) => ({ participantId: p.id }));
    capture.numericRows = order.map((p, row) => ({
      row: row + 1,
      right: reading(before[race][people.indexOf(p)]),
      addition: reading(P[row]),
    }));
    return capture;
  };
  const board = (race: number) => preRace(`before-${race + 1}`, before[race]);
  const captures = [
    ...[0, 1, 2].flatMap((race) => [board(race), result(race)]),
    ...[3, 4, 5, 6, 7, 8, 9].map(board),
    ...[9, 10, 11].map(result),
  ];
  const capture = (id: string) => captures.find((entry) => entry.id === id)!;
  // The race-1 result screen reads its zeros below certainty, two of them not at all.
  capture("adding-1").numericRows!.forEach((row, i) => {
    row.right = i < 2 ? { ...reading(0), text: "", value: null, confidence: 0, uncertain: true } : uncertainZero();
  });
  // The race-2 board shows p12's restart as a legible zero.
  capture("before-2").numericRows![11].right = { ...reading(0), confidence: 80 };
  // The race-6 board drops the user's highlighted row.
  const dropped = capture("before-6");
  dropped.rows.shift();
  dropped.nameAssociations!.shift();
  dropped.numericRows = dropped.numericRows!.slice(1).map((row, i) => ({ ...row, row: i + 1 }));
  captures.forEach((entry, i) => (entry.photoMoment = { at: 1_800_000_000_000 + i * 180_000, source: "exif" }));
  return captures;
}
const uncertainZero = () => ({
  ...reading(0),
  confidence: 70,
  uncertain: true,
  alternatives: [{ text: "0", confidence: 70, value: 0 }],
});

test("a race-1 result screen photographed after the race-1 board shares its start, so the boards after it settle every race (zeroColumnRoomStart)", async () => {
  const mogi = (await normalizeReconstructions({ mogis: [ingest(prefix(0), ...lobbyGap())] })).mogis[0];
  assert.deepEqual(mogiQuestions(mogi), []);
  for (const [race, points] of lobbyGapRaces.entries()) {
    const placements = mogi.races.find((entry) => entry.number === race + 1)?.placements ?? [];
    assert.deepEqual(
      placements.map((id) => points[people.findIndex((p) => p.id === id)]),
      P,
      `race ${race + 1}`,
    );
  }
});

test("two unread totals on the lobby after a race ask the total on that screenshot, never a position (placesForced)", async () => {
  // Race 4: everyone keeps their place except p5 and p6, who swap; the lobby before race 5 hides both their totals.
  const race4 = people.map((p) => p.id);
  [race4[4], race4[5]] = [race4[5], race4[4]];
  const after4 = people.map((p, i) => 3 * P[i] + P[race4.indexOf(p.id)]);
  const lobby = preRace("before-5", after4);
  for (const row of [5, 6]) lobby.numericRows![row - 1].right = { ...reading(0), value: null, uncertain: true };
  let mogi = ingest(
    prefix(3),
    preRace(
      "before-4",
      P.map((points) => 3 * points),
    ),
    lobby,
  );
  mogi = (await normalizeReconstructions({ mogis: [mogi] })).mogis[0];
  const question = mogiQuestions(mogi)[0];
  assert.ok(question?.kind === "points" && question.captureId === "before-5", JSON.stringify(question));
  assert.ok(!mogiQuestions(mogi).some((q) => q.kind === "position"));
  const answer = { kind: "points" as const, value: after4[question.row - 1] };
  mogi = (await normalizeReconstructions({ mogis: [await answerMogiQuestion(mogi, question.id, answer)] })).mogis[0];
  assert.deepEqual(mogiQuestions(mogi), []);
  assert.deepEqual(mogi.races.find((race) => race.number === 4)?.placements, race4);
});
