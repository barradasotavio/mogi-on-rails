import { readFileSync } from "node:fs";

import { mogiQuestions, normalizeReconstructions } from "@mkw/engine";

import type { Capture, Mogi, TrackerState } from "@/lib/mogi/types";

import { replayReal } from "../../../packages/engine/tests/support/real-captures.ts";

/** Three mogis of real audited readings and sequence proofs, with the representative JPEG used by the capture specs. */
export async function trackSaveState() {
  const { mogi } = await replayReal([Array.from({ length: 13 }, (_, i) => i)]);
  const last = mogi.captures!.at(-1)!;
  const pending = {
    ...mogi,
    captures: mogi.captures!.map((capture) =>
      capture.id !== last.id
        ? { ...capture, fingerprint: undefined }
        : {
            ...capture,
            fingerprint: undefined,
            rows: capture.rows.map((row, i) => (i < 2 ? { ...row, text: `Unread ${i + 1}`, uncertain: true } : row)),
            nameAssociations: capture.nameAssociations!.map((answer, i) =>
              i < 2 ? { participantId: null, unlinked: true } : answer,
            ),
          },
    ),
  };
  const normalized = (await normalizeReconstructions({ mogis: [pending] })).mogis[0];
  const original = new Blob([readFileSync(new URL("./fixtures/spec29/finish-order-totals.jpeg", import.meta.url))], {
    type: "image/jpeg",
  });
  const activeId = "mogi-1";
  const mogis = Array.from({ length: 3 }, (_, i): Mogi => ({
    ...normalized,
    id: i ? `other-${i}` : activeId,
    submissionTier: ["D", "B", "A"][i],
    createdAt: `2026-10-${28 - i}T12:00:00Z`,
    captures: normalized.captures!.map((capture): Capture => ({ ...capture, original }) as Capture),
  }));
  const state: TrackerState = { version: 1, mogis, activeMogiId: activeId, sharedReceipts: [] };
  return {
    activeId,
    state,
    shape: {
      mogis: 3,
      capturesPerMogi: normalized.captures!.length,
      racesPerMogi: normalized.races.length,
      reconstructionsPerMogi: normalized.races.filter((race) => race.reconstruction?.status === "unique").length,
      questionsPerMogi: mogiQuestions(normalized).length,
    },
  };
}
