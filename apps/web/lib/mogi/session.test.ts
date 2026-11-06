import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeReconstructions } from "@mkw/engine";

import { emptyRealMogi, ingestReal } from "../../../../packages/engine/tests/support/real-captures.ts";
import { validateTracker } from "../backup/validation.ts";
import { createTrackerSession, storageFailure, type TrackerStore } from "./session.ts";
import { removeSource, undoSource } from "./source-lifecycle.ts";
import { UnsupportedTrackerVersionError } from "./storage-errors.ts";
import { emptyState, type TrackerState } from "./types.ts";

/** A store in memory that runs out of space for the mogi named "full". */
function memoryStore() {
  const saved: TrackerState[] = [];
  const store: TrackerStore = {
    load: async () => saved.at(-1) ?? emptyState,
    async save(state) {
      if (state.activeMogiId === "full") throw new DOMException("full", "QuotaExceededError");
      saved.push(state);
    },
  };
  return { store, saved };
}
const named =
  (activeMogiId: string) =>
  (latest: TrackerState): TrackerState => ({ ...latest, activeMogiId });

test("writes run in order over the latest committed state, and a write the store refuses commits nothing", async () => {
  const { store, saved } = memoryStore();
  const session = createTrackerSession(store);
  const seen: (string | null)[] = [];
  const first = session.write((latest) => {
    seen.push(latest.activeMogiId);
    return named("a")(latest);
  });
  const second = session.write((latest) => {
    seen.push(latest.activeMogiId);
    return named("full")(latest);
  });
  const third = session.write((latest) => {
    seen.push(latest.activeMogiId);
    return named("c")(latest);
  });
  assert.deepEqual(
    (await Promise.all([first, second, third])).map((outcome) => outcome.status),
    ["saved", "storage-failure", "saved"],
  );
  // The third write starts from the first: the failed second never became the state.
  assert.deepEqual(seen, [null, "a", "a"]);
  assert.deepEqual(
    saved.map((state) => state.activeMogiId),
    ["a", "c"],
  );
  assert.equal(session.current(), saved[1]);
  const refused = await session.write(() => {
    throw new Error("The IGN changed. Reopen the editor to continue.");
  });
  assert.equal(
    refused.status === "refused" && refused.cause.message,
    "The IGN changed. Reopen the editor to continue.",
  );
  assert.equal(saved.length, 2);
});

test("storage failures are classified by cause; product errors are not storage failures", () => {
  assert.equal(storageFailure(new DOMException("", "QuotaExceededError")), "quota");
  assert.equal(storageFailure(new DOMException("", "InvalidStateError")), "updated");
  assert.equal(storageFailure(new DOMException("", "VersionError")), "updated");
  assert.equal(storageFailure(new UnsupportedTrackerVersionError()), "updated");
  assert.equal(storageFailure(new DOMException("", "UnknownError")), "unknown");
  assert.equal(storageFailure("thrown string"), "unknown");
  assert.equal(storageFailure(new Error("The data changed. Reopen this action before making corrections.")), null);
});

test("removing the newest screenshot offers an Undo a backup accepts, though reconciliation drops its race", async () => {
  const mogi = await ingestReal(emptyRealMogi(), [0, 1, 2]);
  for (const capture of mogi.captures!) capture.original = new Blob(["x"], { type: "image/png" });
  const state = await normalizeReconstructions({ ...emptyState, activeMogiId: mogi.id, mogis: [mogi] });
  const newest = mogi.captures!.at(-1)!.id;
  // Reconciliation drops race 3, which only the removed screenshot projected.
  const stale = await normalizeReconstructions(removeSource(state, mogi.id, { captureId: newest }), {
    previousState: state,
  });
  assert.equal(stale.mogis[0].races.length, 2);
  const session = createTrackerSession({ load: async () => stale, save: async () => {} });
  validateTracker(await session.load());
  const removing = createTrackerSession(memoryStore().store);
  const removal = await removing.write(() => removeSource(state, mogi.id, { captureId: newest }));
  assert.ok(removal.status === "saved" && removal.offeredUndo);
  validateTracker(removal.state);
  const next = await removing.write((latest) => latest);
  assert.equal(next.status === "saved" && next.offeredUndo, null);
  const undone = await session.write((latest) => undoSource(latest, latest.sourceUndo!.id));
  assert.equal(undone.status === "saved" && undone.state.mogis[0].races.length, 3);
});
