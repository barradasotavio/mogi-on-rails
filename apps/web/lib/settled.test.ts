import assert from "node:assert/strict";
import { test } from "node:test";

import { fail, settled } from "./settled.ts";

test("settled preserves the return value and cleans up only after the work finishes", async () => {
  let finish!: (value: number) => void;
  const work = new Promise<number>((resolve) => {
    finish = resolve;
  });
  let cleaned = false;
  const result = settled(
    () => work,
    () => {
      cleaned = true;
    },
  );

  assert.equal(cleaned, false);
  finish(42);
  assert.equal(await result, 42);
  assert.equal(cleaned, true);
});

test("settled cleans up before propagating the same work error", async () => {
  const error = new Error("Couldn't save.");
  let cleaned = false;

  await assert.rejects(
    settled(
      async () => {
        throw error;
      },
      () => {
        cleaned = true;
      },
    ),
    (failure) => {
      assert.equal(failure, error);
      assert.equal(cleaned, true);
      return true;
    },
  );
});

test("fail throws an Error with the supplied message", () => {
  assert.throws(() => fail("The data changed."), { name: "Error", message: "The data changed." });
});
