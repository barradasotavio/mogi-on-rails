import assert from "node:assert/strict";
import { test } from "node:test";

import { decideUpdate } from "./update.ts";

test("hidden and idle activates only after the backup is saved", () => {
  assert.equal(
    decideUpdate({ waiting: true, idle: true, trigger: "hidden", otherWindows: false, backup: "saved" }),
    "activate",
  );
});

// Literal brief results: six columns per row, without recalculating the decision.
const blocked = ["wait", "wait", "wait", "wait", "wait", "wait"] as const;
const eligible = ["backup", "activate", "backup-failed", "other-windows", "other-windows", "other-windows"] as const;
const rows = [
  ["opening", false, false, blocked],
  ["opening", false, true, blocked],
  ["opening", true, false, blocked],
  ["opening", true, true, eligible],
  ["hidden", false, false, blocked],
  ["hidden", false, true, blocked],
  ["hidden", true, false, blocked],
  ["hidden", true, true, eligible],
  ["visible", false, false, blocked],
  ["visible", false, true, blocked],
  ["visible", true, false, blocked],
  ["visible", true, true, blocked],
  ["manual", false, false, blocked],
  ["manual", false, true, blocked],
  ["manual", true, false, blocked],
  ["manual", true, true, eligible],
] as const;
const columns = [
  [false, "pending"],
  [false, "saved"],
  [false, "failed"],
  [true, "pending"],
  [true, "saved"],
  [true, "failed"],
] as const;
for (const [trigger, waiting, idle, outcomes] of rows) {
  for (const [index, [otherWindows, backup]] of columns.entries()) {
    test(`${trigger}, waiting=${waiting}, idle=${idle}, otherWindows=${otherWindows}, backup=${backup}: ${outcomes[index]}`, () => {
      assert.equal(decideUpdate({ trigger, waiting, idle, otherWindows, backup }), outcomes[index]);
    });
  }
}
