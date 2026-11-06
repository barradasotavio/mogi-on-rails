import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { mogiOverview, mogiQuestions } from "../apps/web/lib/mogi/questions.ts";
import { emptyRealMogi, ingestReal, raw } from "../packages/engine/tests/support/real-captures.ts";

// The app's own path: ingestion, normalization and the projections shown after each write.
async function measure(batches: number[][]) {
  let mogi = emptyRealMogi();
  const captures: number[] = [];
  for (const batch of batches) {
    const start = performance.now();
    mogi = await ingestReal(mogi, batch);
    mogiQuestions(mogi);
    mogiOverview(mogi);
    captures.push(performance.now() - start);
  }
  return { totalMs: captures.reduce((sum, value) => sum + value, 0), capturesMs: captures,
    slowestMs: Math.max(...captures) };
}

// Warm up outside the measurement, so start-up isn't charged to the first capture.
await measure([[0]]);
const indices = raw.captures.map((_, index) => index);
const iterative = await measure(indices.map(index => [index]));
const batch = await measure([indices]);
console.log(JSON.stringify({ iterative, batch }, null, 2));
if (!process.argv.includes("--report-only")) {
  assert.ok(iterative.totalMs <= 1500, `Iterative ingestion: ${iterative.totalMs.toFixed(1)} ms > 1500 ms`);
  assert.ok(batch.totalMs <= 1500, `Batch: ${batch.totalMs.toFixed(1)} ms > 1500 ms`);
  // Each capture reprocesses the whole sequence, so the cost grows with the mogi; the limit is per capture, below one long frame.
  assert.ok(iterative.slowestMs <= 100, `Slowest capture: ${iterative.slowestMs.toFixed(1)} ms > 100 ms`);
}
