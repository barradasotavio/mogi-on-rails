import assert from "node:assert/strict";
import { test } from "node:test";

import type { Mogi } from "../mogi/types.ts";
import { type CaptureReadUpdate, readCaptures } from "./read-captures.ts";
import type { Recognition } from "./recognize.ts";

test("an identical image reuses the earlier reading without recognizing it again; equal readings of another image are flagged", async () => {
  const mogi: Mogi = {
    id: "m",
    name: "Mogi",
    format: "FFA",
    createdAt: "2026-11-05",
    races: [],
    participants: [{ id: "p1", loungeName: "Tavo", ign: "Tavo" }],
  };
  const reading = {
    width: 1920,
    height: 1080,
    rows: [{ text: "Tavo", confidence: 99, uncertain: false }],
    numericRows: [],
    interpretation: {
      version: 1,
      screen: "finishOrderAdded",
      origin: "visual",
      positions: [],
      movementRows: [],
      reasons: [],
    },
    numericStageSuggestion: "unverified",
    unreadableRowNumbers: [],
    possibleAbsentParticipantIds: [],
  } as unknown as Recognition;
  const file = (name: string, bytes: string) => new File([bytes], name, { type: "image/jpeg" });
  const queue = [file("a.jpeg", "A"), file("again.jpeg", "A"), file("b.jpeg", "B")].map((image, i) => ({
    id: image.name,
    file: image,
    number: i + 1,
  }));
  let recognized = 0;
  const outcomes = new Map<string, CaptureReadUpdate>();
  await readCaptures(queue, mogi, {
    signal: () => new AbortController().signal,
    report: (id, update) => {
      if (update.status && update.status !== "processing") outcomes.set(id, update);
    },
    recognize: () => {
      recognized++;
      return { cancel: () => {}, result: Promise.resolve(reading) };
    },
  });
  assert.equal(recognized, 2);
  assert.deepEqual(
    [...outcomes.values()].map(
      (update) => update.status === "ready" && [update.association, update.duplicate?.split(":")[0]],
    ),
    [
      ["new", undefined],
      ["", "Identical screenshot"],
      ["new", "Similar results"],
    ],
  );
});
