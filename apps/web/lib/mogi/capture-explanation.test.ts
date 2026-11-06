import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { CaptureExplanationStep } from "@mkw/engine";

import { captureExplanationLines, rulePhrases } from "./capture-explanation.ts";
import type { Mogi } from "./types.ts";

const continuity = (evidence: { anchorNumber?: number; completedSteps?: number }) =>
  rulePhrases["race.vector-continuity"]({
    kind: "race",
    subject: "c",
    value: 11,
    origin: "deduced",
    rule: "race.vector-continuity",
    evidence,
  }).reason;

test("the order phrase identifies the source of the previous image's moment", () => {
  for (const [source, verb] of [
    ["exif", "taken"],
    ["switch-name", "saved"],
    ["pasted", "pasted"],
    ["file-date", "file dated"],
  ] as const) {
    assert.deepEqual(
      rulePhrases["order.photo-time"]({
        kind: "order",
        subject: "c",
        value: "b",
        origin: "deduced",
        rule: "order.photo-time",
        referenceImage: 2,
        subjectImage: 3,
        evidence: { photoTimeSource: source },
      }),
      {
        decision: "After screenshot 2",
        reason: `screenshot 2 ${verb} before screenshot 3`,
      },
    );
  }
});

test("a pre-race image explains that totals still belong to the previous race", () => {
  assert.equal(continuity({ anchorNumber: 10, completedSteps: 0 }), "the totals still match race 10");
  assert.equal(continuity({ completedSteps: 0 }), "no race has finished yet");
  assert.equal(continuity({ anchorNumber: 10, completedSteps: 1 }), "the totals grew by one finish since race 10");
});

test("the first evidence explains the sum without a previous room", () => {
  assert.equal(continuity({ completedSteps: 1 }), "the totals add up to one race, with no earlier room");
  assert.equal(continuity({ completedSteps: 10 }), "the totals add up to 10 races, with no earlier room");
});

const points = (rule: CaptureExplanationStep["rule"], value = 52) => ({
  kind: "points" as const,
  subject: "c",
  value,
  origin: "deduced" as const,
  rule,
  playerName: "Tavo",
  evidence: { row: 7, readText: "520", discarded: 520, compared: 12 },
});

test("points.as-shown phrases the aggregate", () => {
  assert.deepEqual(rulePhrases["points.as-shown"](points("points.as-shown", 10)), {
    decision: "10 of 12 totals",
    reason: "as shown",
  });
});
test("points.race1-permutation cites the placement of the row", () => {
  assert.deepEqual(rulePhrases["points.race1-permutation"](points("points.race1-permutation", 6)), {
    decision: "Tavo · 6",
    reason: "7th place in race 1",
  });
});
test("points.sum phrases the missing total", () => {
  assert.deepEqual(rulePhrases["points.sum"](points("points.sum")), {
    decision: "Tavo · 52",
    reason: "the totals have to add up",
  });
});
test("points.out-of-range phrases the discarded reading", () => {
  assert.deepEqual(rulePhrases["points.out-of-range"](points("points.out-of-range")), {
    decision: "Tavo · 52",
    reason: "read 520, too high for this race",
  });
});
test("points.noise-candidate phrases the selected reading", () => {
  assert.deepEqual(
    rulePhrases["points.noise-candidate"]({
      ...points("points.noise-candidate", 54),
      evidence: { row: 7, readText: "545", discarded: 545 },
    }),
    { decision: "Tavo · 54", reason: "read 545, the extra digit was noise" },
  );
});
test("point lines use the Lounge name and fall back to the row without an identity", () => {
  const mogi = JSON.parse(
    readFileSync(new URL("../../../../packages/engine/tests/fixtures/after-r1.json", import.meta.url), "utf8"),
  ) as Mogi;
  const c = mogi.captures![0];
  c.numericRows![6].right = { ...c.numericRows![6].right, value: null, text: "", uncertain: true };
  assert.ok(
    captureExplanationLines(mogi, c.id).some((line) => line.decision === "Tavo · 6" && line.origin === "Deduced"),
  );
  c.nameAssociations![6] = { participantId: null, unlinked: true };
  c.rows[6] = { ...c.rows[6], text: "Unknown", uncertain: true };
  assert.ok(captureExplanationLines(mogi, c.id).some((line) => line.decision === "Row 7 · 6"));
});

const name = (rule: CaptureExplanationStep["rule"], readName: string, playerName: string) => ({
  kind: "name" as const,
  subject: "c",
  value: "participant",
  origin: "deduced" as const,
  rule,
  playerName,
  evidence: { readName },
});
test("name.as-shown phrases the exact name aggregate", () => {
  assert.deepEqual(
    rulePhrases["name.as-shown"]({
      kind: "name",
      subject: "c",
      value: 8,
      origin: "read",
      rule: "name.as-shown",
      evidence: { compared: 12 },
    }),
    { decision: "8 of 12 names", reason: "as shown" },
  );
});
test("name.similar uses the Lounge name", () => {
  assert.deepEqual(rulePhrases["name.similar"](name("name.similar", "Vs Kamek", "Kameks Eye")), {
    decision: "Vs Kamek is Kameks Eye",
    reason: "the names are close",
  });
});
test("name.tag explains the shared team tag", () => {
  assert.deepEqual(rulePhrases["name.tag"](name("name.tag", "K toad67", "toad67")), {
    decision: "K toad67 is toad67",
    reason: "same tag as the team",
  });
});
test("name.exclusion distinguishes FFA from team formats", () => {
  for (const format of ["FFA", "2v2", "3v3"] as const)
    assert.deepEqual(rulePhrases["name.exclusion"]({ ...name("name.exclusion", "Diddy.", "pom"), format }), {
      decision: "Diddy. is pom",
      reason: format === "FFA" ? "the only player left" : "the only player left on the team",
    });
});
test("name.token quotes the unique part of the name", () => {
  assert.deepEqual(
    rulePhrases["name.token"]({
      ...name("name.token", "Vs Kamek", "Kameks Eye"),
      evidence: { readName: "Vs Kamek", token: "kamek" },
    }),
    { decision: "Vs Kamek is Kameks Eye", reason: '"kamek" only matches Kameks Eye' },
  );
});
test("name.spelling-group counts the other readings", () => {
  assert.deepEqual(
    rulePhrases["name.spelling-group"]({
      ...name("name.spelling-group", "KRAFunk", "funk2006"),
      evidence: { readName: "KRAFunk", variants: ["KRJFunk", "KRSFunk"] },
    }),
    { decision: "KRAFunk is funk2006", reason: "same name read 3 ways" },
  );
});
test("name.answered explains the player's choice", () => {
  assert.deepEqual(rulePhrases["name.answered"](name("name.answered", "Funky", "ActuFunk")), {
    decision: "Funky is ActuFunk",
    reason: "as you chose",
  });
});
test("pending.question phrases one or several answers", () => {
  for (const value of [1, 3])
    assert.deepEqual(
      rulePhrases["pending.question"]({
        kind: "pending",
        subject: "c",
        value,
        origin: "deduced",
        rule: "pending.question",
        evidence: { questionId: "q" },
      }),
      { decision: "Not counted yet", reason: value === 1 ? "1 question" : "3 questions" },
    );
});
