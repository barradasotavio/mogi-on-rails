import assert from "node:assert/strict";
import { test } from "node:test";

import type { Capture, Mogi, Race, SharedFile } from "../mogi/types.ts";
import { newIntakeItems, persistIntake, restoreIntake } from "./intake.ts";
import { identicalDuplicateNotice, newRaceProblem } from "./intake-review.ts";

const race: Race = { id: "r1", origin: "observed", status: "confirmed", number: 1, placements: ["p1"] };
const mogi: Mogi = {
  id: "m",
  name: "Mogi",
  format: "FFA",
  createdAt: "2026-11-05",
  races: [race],
  participants: [{ id: "p1", loungeName: "Tavo", ign: "Tavo" }],
};
const shared = (id: string): SharedFile => ({
  id,
  name: `${id}.jpeg`,
  mimeType: "image/jpeg",
  lastModified: 1,
  original: new Blob([id]),
});

test("new images follow the last race with unconfirmed numbers; a reading in progress resumes as waiting, without the file or review answers", () => {
  const files = [shared("a"), shared("b")];
  const [reading, waiting] = newIntakeItems(mogi, files);
  assert.deepEqual(
    [reading, waiting].map((item) => [item.number, item.numberKnown, item.association]),
    [
      [2, false, "new"],
      [3, false, "new"],
    ],
  );
  const capture = {
    id: "c",
    fileName: "a.jpeg",
    rows: [],
    original: files[0].original,
    reviewedAt: "x",
    reviewedPlacements: ["p1"],
  } as unknown as Capture;
  const review = persistIntake("review", reading.id, [{ ...reading, status: "processing", capture }, waiting]);
  assert.deepEqual(
    review.items.map((item) => [item.source, item.status, item.recognition]),
    [
      [{ fileId: "a" }, "waiting", { id: "c", fileName: "a.jpeg", rows: [] }],
      [{ fileId: "b" }, "waiting", undefined],
    ],
  );
  const [restored] = restoreIntake({ ...mogi, captureReview: review }, files);
  assert.deepEqual(
    [
      restored.sharedFileId,
      restored.capture?.original,
      restored.capture?.reviewedAt,
      restored.capture?.reviewedPlacements,
    ],
    ["a", files[0].original, "", []],
  );
});

test("a new race needs a confirmed number not taken, and an identical image has to join the race already saved", () => {
  const item = {
    id: "i",
    file: new File([], "a.jpeg"),
    number: 2,
    association: "new",
    status: "ready" as const,
    progress: "",
  };
  assert.equal(newRaceProblem(mogi, item, undefined), null);
  assert.equal(newRaceProblem(mogi, { ...item, numberKnown: false }, undefined), "");
  // A batch item stores the notice it was read with: every shipped wording still blocks a new race.
  for (const duplicate of [
    identicalDuplicateNotice,
    "Identical image: add it to the race already saved, without creating another occurrence.",
    "Identical screenshot: add it to the race already saved, without counting the race twice.",
  ])
    assert.equal(
      newRaceProblem(mogi, { ...item, duplicate }, undefined),
      "Add this identical screenshot to the race already saved.",
      duplicate,
    );
  assert.equal(
    newRaceProblem(mogi, { ...item, number: 1 }, undefined),
    "This race number already exists. Add the screenshot to that race or fix the numbering.",
  );
  assert.equal(newRaceProblem(mogi, { ...item, number: 1, duplicate: "Identical screenshot: …" }, race), null);
});
