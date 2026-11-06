import assert from "node:assert/strict";
import test from "node:test";

import { analyzeOrder, raceTotal } from "@mkw/engine";

import { mogi, source } from "./support/mogi.ts";

test("native eleven and ten values are checked before ordering without assigning positions to absences", async () => {
  const older = source("older", 1, [12, 10], 11, 2);
  const newer = source("newer", 2, [23, 19], 10, 2);
  newer.gameEvidence!.readings.p1.current!.value = 15;
  const state = mogi([older, newer]);
  const conflict = await analyzeOrder(state);
  assert.equal(conflict.status, "conflict");
  assert.ok(conflict.issues.some((issue) => issue.includes("in-game scale 11")));
  newer.gameEvidence!.readings.p1.current!.value = 11;
  const established = await analyzeOrder(state);
  assert.equal(established.status, "unique");
  assert.deepEqual(established.orders, [["older", "newer"]]);
  assert.deepEqual(newer.absentParticipantIds, ["p11", "p12"]);
  assert.equal(raceTotal(newer), 81);
});

test("a bad reading conflicts and one stable person cannot bridge an individual or room reset", async () => {
  const older = source("older", 1, [115, 112], 12, 2);
  const newer = source("newer", 2, [8, 124], 12, 2);
  const state = mogi([older, newer]);
  assert.equal((await analyzeOrder(state)).status, "conflict");
  newer.gameEvidence!.readings.p1.current!.value = 15;
  newer.gameEvidence!.readings.p1.cumulative!.value = 15;
  newer.gameEvidence!.readings.p1.segment = "returned";
  assert.equal((await analyzeOrder(state)).status, "insufficient");
  older.gameEvidence!.readings.p3 = {
    segment: "room",
    useAsAnchor: true,
    current: { value: 10, origin: "manual" },
    cumulative: { value: 110, origin: "manual" },
  };
  newer.gameEvidence!.readings.p3 = {
    segment: "room",
    useAsAnchor: true,
    current: { value: 10, origin: "manual" },
    cumulative: { value: 120, origin: "manual" },
  };
  assert.deepEqual((await analyzeOrder(state)).orders, [["older", "newer"]]);
  newer.gameEvidence!.session = "new-room";
  assert.equal((await analyzeOrder(state)).status, "insufficient");
});

test("discarded occurrences stay in native chronology without inventing an intermediate finish order", async () => {
  const older = { ...source("older", 1, [15, 12], 12, 2), physicalNumber: 1 };
  const discarded = { ...source("discarded", 2, [30, 24], 12, 2), physicalNumber: 2, status: "discarded" as const };
  const newer = { ...source("newer", 2, [75, 60], 12, 2), physicalNumber: 3 };
  const state = mogi([older, discarded, newer]);
  const original = structuredClone(state);
  const analysis = await analyzeOrder(state);
  assert.equal(analysis.status, "unique");
  assert.deepEqual(analysis.orders, [["older", "discarded", "newer"]]);
  assert.deepEqual(
    analysis.transitions
      .find((pair) => pair.fromRaceId === "discarded" && pair.toRaceId === "newer")
      ?.anchors.map((anchor) => anchor.intermediateGain),
    [30, 24],
  );
  assert.deepEqual(state, original);
});

test("the credited substitute is not the earlier numeric identity while two other people can anchor the order", async () => {
  const { registerSubstitution } = await import("@mkw/engine");
  const older = source("older", 1, [115, 112], 12, 2);
  const state = registerSubstitution(mogi([older]), {
    slotId: "p1",
    fromRace: 2,
    loungeName: "Reserve",
    ign: "NewKart",
  });
  const incoming = state.participants.find((person) => person.loungeName === "Reserve")!;
  const newer = source("newer", 2, [15, 124], 12, 2);
  newer.placements[0] = incoming.id;
  newer.gameEvidence!.readings[incoming.id] = newer.gameEvidence!.readings.p1;
  delete newer.gameEvidence!.readings.p1;
  state.races.push(newer);
  state.creditedParticipantIds = { p1: incoming.id };
  assert.equal((await analyzeOrder(state)).status, "insufficient");
  older.gameEvidence!.readings.p3 = {
    segment: "room",
    useAsAnchor: true,
    current: { value: 10, origin: "manual" },
    cumulative: { value: 110, origin: "manual" },
  };
  newer.gameEvidence!.readings.p3 = {
    segment: "room",
    useAsAnchor: true,
    current: { value: 10, origin: "manual" },
    cumulative: { value: 120, origin: "manual" },
  };
  const result = await analyzeOrder(state);
  assert.equal(result.status, "unique");
  assert.deepEqual(
    result.transitions
      .find((pair) => pair.fromRaceId === "older" && pair.toRaceId === "newer")
      ?.anchors.map((anchor) => [anchor.participantId, anchor.intermediateGain]),
    [
      ["p2", 0],
      ["p3", 0],
    ],
  );
});
