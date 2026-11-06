import assert from "node:assert/strict";
import test from "node:test";

import { individualStandings, mogiOverview, mogiQuestions, teamStandings } from "@mkw/engine";

import { originalFingerprint } from "../images/compressed.ts";
import { fingerprint } from "../images/fingerprint.ts";
import { knownOriginals, repeatedImages } from "../images/gallery.ts";
import { mergeCompressedImages, pendingImages } from "./compression.ts";
import { deleteMogiImages } from "./free-space.ts";
import type { Mogi, TrackerState } from "./types.ts";

function finishedMogi(): Mogi {
  const participants = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    loungeName: `Player ${i}`,
    ign: `Player ${i}`,
    teamId: `t${Math.floor(i / 2)}`,
  }));
  const mogi: Mogi = {
    id: "m",
    name: "Mogi",
    createdAt: "2026-10-28",
    format: "2v2",
    participants,
    teams: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` })),
    races: Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      number: i + 1,
      origin: "observed",
      status: "confirmed",
      placements: participants.map((p) => p.id),
      captureIds: ["c"],
    })),
    captures: [
      {
        id: "c",
        fileName: "result.jpeg",
        original: new Blob(["image bytes"]),
        width: 1920,
        height: 1080,
        stage: "finish-order-confirmed",
        reviewedAt: "2026-10-28",
        reviewedPlacements: participants.map((p) => p.id),
        rows: [{ text: "Unclear", confidence: 30, uncertain: true, suggestedParticipantId: "p0" }],
        nameAssociations: [{ participantId: null }],
        context: { phase: "after", raceId: "r11" },
      },
    ],
  };
  return mogi;
}

test("deleting finished mogi images preserves races, totals, standings and questions", () => {
  const mogi = finishedMogi();
  const overview = (value: Mogi) => ({
    overview: mogiOverview(value),
    races: value.races,
    individuals: individualStandings(value),
    teams: teamStandings(value),
    questions: mogiQuestions(value),
  });
  assert.equal(mogiOverview(mogi).finished, true);
  const before = overview(mogi);
  assert.ok(before.questions.length > 0);
  const freed = deleteMogiImages(mogi);
  assert.equal(freed.captures![0].original, null);
  assert.deepEqual(overview(freed), before);
  assert.deepEqual(freed.captures![0], { ...mogi.captures![0], original: null });
  assert.ok(mogi.captures![0].original instanceof Blob);
  assert.throws(() => deleteMogiImages({ ...mogi, races: mogi.races.slice(0, 11) }), /finished/i);
});

test("compression selects finished images only, including new images when a mogi finishes again", async () => {
  const mogi = finishedMogi();
  const original = mogi.captures![0].original!;
  mogi.captures!.push(
    { ...mogi.captures![0], id: "compressed", compressedFrom: { sha256: "a".repeat(64), size: 10 } },
    { ...mogi.captures![0], id: "deleted", original: null },
  );
  const state: TrackerState = {
    version: 1,
    activeMogiId: mogi.id,
    mogis: [mogi, { ...mogi, id: "unfinished", races: mogi.races.slice(0, 11) }],
    sharedReceipts: [
      {
        id: "pending",
        receivedAt: "2026-10-28",
        rejections: [],
        files: [{ id: "pending", name: "pending.jpeg", original, mimeType: "image/jpeg", lastModified: 0 }],
      },
    ],
  };
  assert.deepEqual(
    pendingImages(state).map(({ kind, id }) => [kind, id]),
    [["capture", "c"]],
  );
  const image = pendingImages(state)[0];
  const compressed = await mergeCompressedImages(state, [
    { ...image, encoded: new Blob(["webp"], { type: "image/webp" }), sha256: await fingerprint(original) },
  ]);
  const reopened = {
    ...compressed,
    mogis: [
      {
        ...compressed.mogis[0],
        races: mogi.races.slice(0, 11),
        captures: [...compressed.mogis[0].captures!, { ...mogi.captures![0], id: "later" }],
      },
    ],
  };
  assert.deepEqual(pendingImages(reopened), []);
  const refinished = { ...reopened, mogis: [{ ...reopened.mogis[0], races: mogi.races }] };
  assert.deepEqual(
    pendingImages(refinished).map((image) => image.id),
    ["later"],
  );
});

test("compression merges only unchanged bytes into the latest existing capture", async () => {
  const mogi = finishedMogi();
  const state: TrackerState = { version: 1, activeMogiId: mogi.id, mogis: [mogi] };
  const results = await Promise.all(
    pendingImages(state).map(async (image) => ({
      ...image,
      sha256: await fingerprint(image.original),
      encoded: new Blob(["webp"], { type: "image/webp" }),
    })),
  );
  const updated = await mergeCompressedImages(
    {
      ...state,
      loungeNames: ["New name"],
      mogis: [
        {
          ...mogi,
          name: "Edited",
          captures: [{ ...mogi.captures![0], original: new Blob([await results[0].original.arrayBuffer()]) }],
        },
      ],
    },
    results,
  );
  assert.deepEqual(updated.loungeNames, ["New name"]);
  assert.equal(updated.mogis[0].name, "Edited");
  assert.equal(updated.mogis[0].captures![0].fingerprint, results[0].sha256);
  assert.deepEqual(
    {
      ...updated.mogis[0].captures![0],
      original: mogi.captures![0].original,
      compressedFrom: undefined,
      fingerprint: undefined,
    },
    { ...mogi.captures![0], compressedFrom: undefined, fingerprint: undefined },
  );
  for (const latest of [
    updated,
    { ...state, mogis: [] },
    { ...state, mogis: [{ ...mogi, races: mogi.races.slice(0, 11) }] },
    ...[null, new Blob(["replacement"])].map((original) => ({
      ...state,
      mogis: [{ ...mogi, captures: [{ ...mogi.captures![0], original }] }],
    })),
    { ...state, mogis: [{ ...mogi, captures: [] }] },
  ])
    assert.equal(await mergeCompressedImages(latest, results), latest);
});

test("duplicate checks identify compressed captures by their original SHA-256, and an Undo-held file is read afresh", async () => {
  const mogi = finishedMogi(),
    original = mogi.captures![0].original!;
  const sha256 = await fingerprint(original),
    encoded = new Blob(["webp"], { type: "image/webp" });
  const capture = {
    ...mogi.captures![0],
    fingerprint: "b".repeat(64),
    original: encoded,
    compressedFrom: { sha256, size: original.size },
  };
  assert.equal(await originalFingerprint(capture), sha256);
  const state: TrackerState = { version: 1, activeMogiId: mogi.id, mogis: [{ ...mogi, captures: [capture] }] };
  assert.deepEqual(await repeatedImages([original, encoded], knownOriginals(state, mogi.id)), [null, undefined]);
  state.mogis[0].captures = [];
  const { original: _original, ...metadata } = capture;
  void _original;
  state.sourceUndo = { id: "undo", mogiId: mogi.id, fileId: "undo-file", capture: metadata, races: [] };
  state.sharedReceipts = [
    {
      id: "receipt",
      receivedAt: "2026-10-28",
      rejections: [],
      files: [{ id: "undo-file", name: "image.jpeg", mimeType: "image/webp", lastModified: 0, original: encoded }],
    },
  ];
  assert.deepEqual(await repeatedImages([original], knownOriginals(state, mogi.id)), [undefined]);
});
