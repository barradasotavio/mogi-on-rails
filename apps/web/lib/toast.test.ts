import assert from "node:assert/strict";
import { test } from "node:test";

import { toastDuration } from "./toast.ts";

test("a toast lasts 4 s and gains 1 s per 40 characters beyond 40, up to 8 s", () => {
  assert.equal(toastDuration("Backup restored"), 4000);
  assert.equal(toastDuration("x".repeat(40)), 4000);
  assert.equal(toastDuration("x".repeat(41)), 5000);
  assert.equal(toastDuration("x".repeat(81)), 6000);
  assert.equal(toastDuration("y".repeat(400)), 8000);
});
