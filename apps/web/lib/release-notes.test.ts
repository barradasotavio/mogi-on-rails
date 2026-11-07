import assert from "node:assert/strict";
import { test } from "node:test";

import { releaseDate, releaseNotes } from "./release-notes.ts";

test("release notes have one ISO date each, newest first, with labeled, non-empty changes", () => {
  assert.ok(releaseNotes.length > 0);
  releaseNotes.forEach(({ date, changes }, index) => {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
    if (index > 0) assert.ok(date < releaseNotes[index - 1].date, `${date} must come before the newer dates`);
    assert.ok(changes.length > 0, `${date} has no changes`);
    for (const { kind, text } of changes) {
      assert.ok(kind === "new" || kind === "fix", `${date}: kind ${kind}`);
      assert.ok(typeof text === "string" && text.trim(), `${date}: empty text`);
    }
  });
  assert.equal(releaseDate("2026-11-07"), "November 7, 2026");
});
