import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { staleActionDestinations, staleActionRecovery } from "./recovery.ts";

test("stale edit notices offer the review that resolves the conflict", () => {
  assert.deepEqual(staleActionRecovery("The IGN changed. Reopen the editor to continue."), {
    message: "The IGN changed.",
    label: "Review Players",
    target: "players",
  });
  assert.deepEqual(staleActionRecovery("This screenshot's file changed. Resume the current review."), {
    message: "This screenshot's file changed.",
    label: "Review Screenshots",
    target: "images",
  });
  assert.deepEqual(staleActionRecovery("This relation changed. Check the current screenshots."), {
    message: "This relation changed.",
    label: "Review Questions",
    target: "questions",
  });
  assert.equal(staleActionRecovery("Enter points from 0 to 9999."), undefined);
});

test("every recoverable notice is still thrown somewhere", () => {
  const roots = ["../../../../packages/engine/src", "../../lib", "../../components"].map(
    (path) => new URL(path, import.meta.url),
  );
  const source = roots
    .flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts") && !file.endsWith("recovery.ts"))
        .map((file) => readFileSync(new URL(file, `${root.href}/`), "utf8")),
    )
    .join("\n");
  for (const message of Object.keys(staleActionDestinations)) assert.ok(source.includes(message), message);
});
