import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  captureBoundaryValues,
  captureExplanation,
  type CaptureObservation,
  type Mogi,
  normalizeReconstructions,
  screenProperties,
} from "@mkw/engine";

import { emptyRealMogi, ingestReadings, raw } from "./support/real-captures.ts";

function coherent(mogi: Mogi) {
  for (const capture of mogi.captures ?? []) {
    const steps = captureExplanation(mogi, capture.id).filter((s) => s.kind === "points");
    const summary = steps.filter((s) => s.rule === "points.as-shown");
    assert.equal(summary.length, 1, `${capture.id}: one summary`);
    assert.equal(summary[0].evidence.compared, capture.rows.length);
    const exceptions = steps.filter((s) => s.evidence.row !== undefined);
    assert.deepEqual(
      exceptions.map((s) => s.evidence.row),
      [...new Set(exceptions.map((s) => s.evidence.row))].sort((a, b) => a! - b!),
    );
    for (const deduction of capture.numericDeductions ?? []) {
      const step = exceptions.find((s) => s.evidence.row === deduction.row);
      assert.ok(step, `${capture.id}, row ${deduction.row}: projected total has an explanation`);
      assert.equal(step.value, deduction.value);
      assert.equal(step.origin, step.rule === "points.noise-candidate" ? "read" : "deduced");
    }
    for (const step of exceptions) {
      assert.equal(step.subject, capture.id);
      const row = step.evidence.row!;
      const projected =
        capture.numericAnswers?.find((a) => a.row === row)?.value ??
        capture.numericDeductions?.find((d) => d.row === row)?.value ??
        null;
      assert.equal(step.value, projected, `${capture.id}, row ${row}: explanation agrees with projection`);
      assert.equal(step.evidence.readText, capture.numericRows?.find((r) => r.row === row)?.right.text ?? "");
      const playerId = capture.nameAssociations?.[row - 1]?.participantId;
      assert.equal(step.evidence.playerId, playerId ?? undefined);
      if (playerId && screenProperties(capture.interpretation?.screen)?.cumulative === "final" && projected !== null)
        assert.equal(captureBoundaryValues(capture).get(playerId)?.value, step.value);
    }
    const unchanged =
      capture.numericRows?.filter(
        (r) =>
          !r.right.uncertain &&
          r.right.value !== null &&
          !capture.numericAnswers?.some((a) => a.row === r.row) &&
          !exceptions.some((s) => s.evidence.row === r.row),
      ).length ?? 0;
    assert.equal(summary[0].value, unchanged, `${capture.id}: only unchanged readings enter the summary`);
  }
}

// Discover every engine fixture carrying capture readings, including historical Mogi states.
for (const file of readdirSync(new URL("./fixtures/", import.meta.url)).filter((f) => f.endsWith(".json"))) {
  const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"));
  if (fixture.captures?.[0]?.rows && fixture.participants) {
    test(`${file}: all projected totals and point explanations agree`, async () => {
      coherent((await normalizeReconstructions({ mogis: [fixture as Mogi] })).mogis[0]);
    });
  } else if (fixture.captures?.[0]?.rows && fixture.roster) {
    test(`${file}: all projected totals and point explanations agree`, async () => {
      coherent(await ingestReadings(emptyRealMogi(), fixture.captures));
    });
  } else if (fixture.observations?.[0]?.rows) {
    test(`${file}: all projected totals and point explanations agree`, async () => {
      const readings = (fixture.observations as CaptureObservation[]).map((c, i) => ({ ...raw.captures[i], ...c }));
      coherent(await ingestReadings(emptyRealMogi(), readings));
    });
  } else if (fixture.captures?.[0]?.right) {
    test(`${file}: all projected totals and point explanations agree`, async () => {
      const readings = structuredClone(raw.captures);
      for (const c of fixture.captures) {
        const source = readings.find((r) => r.fileName === c.file)!;
        for (const row of source.numericRows!) {
          Object.assign(
            row.right,
            c.right.find((r: { row: number }) => r.row === row.row),
          );
          Object.assign(
            row.addition,
            c.addition.find((r: { row: number }) => r.row === row.row),
          );
        }
      }
      coherent(await ingestReadings(emptyRealMogi(), readings));
    });
  }
}
