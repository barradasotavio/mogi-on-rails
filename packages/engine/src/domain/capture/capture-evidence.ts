import { nativePriorScale, representedPlayers } from "../numeric-readings/numeric-candidates.ts";
import type { Capture, GameEvidence, Race } from "../types.ts";
import { screenProperties } from "./screens.ts";
import { consistentTeamRows } from "./team-evidence.ts";

/** Project accepted source rows; never infer continuity between captures here. */
export function acceptedCaptureEvidence(capture: Capture, race: Race): GameEvidence | undefined {
  const interpretation = capture.interpretation;
  if (
    !interpretation ||
    capture.context?.phase === "before" ||
    !["finishOrder", "general", "grouped"].includes(screenProperties(interpretation.screen).order)
  )
    return;
  const identities = capture.nameAssociations?.map((answer) => answer.participantId);
  if (!identities?.length) return;
  if (identities.some((id) => !id) || new Set(identities).size !== identities.length)
    throw new Error("This screenshot's names changed. Check the finish order.");
  // Explicit full-result edits may change the finish order/absence interpretation. Keep their source,
  // but do not project its old row order as a proof of the edited result.
  if (
    screenProperties(interpretation.screen).order === "finishOrder" &&
    (Math.min(identities.length, representedPlayers(capture)) !==
      race.placements.filter((id) => !race.absentParticipantIds?.includes(id)).length ||
      identities.slice(0, representedPlayers(capture)).some((id, n) => id !== race.placements[n]))
  )
    return;
  const session = `capture:${capture.id}`;
  const priorScale = nativePriorScale(capture);
  return {
    stage: screenProperties(interpretation.screen).cumulative === "final" ? "post-race" : "animation",
    session,
    verified: screenProperties(interpretation.screen).cumulative === "final",
    rowAssociations: { [capture.id]: identities as string[] },
    readings: Object.fromEntries(
      identities.slice(0, representedPlayers(capture)).map((id, n) => {
        const row = capture.numericRows?.find((row) => row.row === n + 1);
        const allowed =
          !screenProperties(interpretation.screen).teamTotals || consistentTeamRows(capture).includes(n + 1);
        const current = priorScale
          ? {
              value: priorScale[n],
              origin:
                row?.addition.uncertain || row?.addition.value !== priorScale[n]
                  ? ("deduced" as const)
                  : ("observed" as const),
              sourceCaptureId: capture.id,
              sourceRow: n + 1,
              sourceField: "addition" as const,
            }
          : undefined;
        const answer = capture.numericAnswers?.find((answer) => answer.row === n + 1);
        const deduced = capture.numericDeductions?.find((value) => value.row === n + 1);
        const cumulative =
          allowed && screenProperties(interpretation.screen).cumulative === "final" && deduced
            ? {
                value: deduced.value,
                origin: "deduced" as const,
                sourceCaptureId: capture.id,
                sourceRow: n + 1,
                sourceField: "right" as const,
              }
            : allowed &&
                screenProperties(interpretation.screen).cumulative === "final" &&
                row?.right &&
                row.right.value !== null &&
                !row.right.uncertain
              ? {
                  value: row.right.value,
                  origin: "observed" as const,
                  sourceCaptureId: capture.id,
                  sourceRow: n + 1,
                  sourceField: "right" as const,
                }
              : undefined;
        return [
          id!,
          {
            segment: session,
            useAsAnchor:
              allowed && screenProperties(interpretation.screen).cumulative === "final" && (!!answer || !!cumulative),
            ...(current ? { current } : {}),
            ...(allowed && screenProperties(interpretation.screen).cumulative === "final" && answer
              ? {
                  cumulative: {
                    value: answer.value,
                    origin: "manual" as const,
                    sourceCaptureId: capture.id,
                    sourceRow: n + 1,
                    sourceField: "right" as const,
                  },
                }
              : cumulative
                ? { cumulative }
                : {}),
          },
        ];
      }),
    ),
  };
}

/** Result confirmation does not close independently unresolved numeric source questions. */
export function captureNumericQuestions(capture: Capture) {
  if (screenProperties(capture.interpretation?.screen)?.cumulative !== "final") return [];
  return (capture.numericRows ?? []).filter(
    (row) =>
      row.row <= representedPlayers(capture) &&
      row.right.uncertain &&
      !capture.numericAnswers?.some((answer) => answer.row === row.row) &&
      !capture.numericDeductions?.some((value) => value.row === row.row),
  );
}

/** Combine complementary sources for one unchanged result, retaining independent anchors. */
export function reconcileCaptureEvidence(
  previous: GameEvidence | undefined,
  incoming: GameEvidence | undefined,
  correctedSourceId?: string,
): GameEvidence | undefined {
  if (!previous) return incoming;
  if (!incoming && !correctedSourceId) return previous;
  const retained = {
    ...previous,
    rowAssociations: Object.fromEntries(
      Object.entries(previous.rowAssociations ?? {}).filter(([source]) => source !== correctedSourceId),
    ),
    readings: Object.fromEntries(
      Object.entries(previous.readings).map(([id, reading]) => {
        const current =
          correctedSourceId && reading.current?.sourceCaptureId === correctedSourceId ? undefined : reading.current;
        const cumulative =
          correctedSourceId && reading.cumulative?.sourceCaptureId === correctedSourceId
            ? undefined
            : reading.cumulative;
        return [id, { ...reading, current, cumulative, useAsAnchor: reading.useAsAnchor && !!cumulative }];
      }),
    ),
  };
  if (!incoming) {
    const verified = retained.verified && Object.values(retained.readings).some((reading) => reading.useAsAnchor);
    return { ...retained, verified, stage: verified ? "post-race" : "unknown" };
  }
  const readings = { ...retained.readings };
  for (const [id, next] of Object.entries(incoming.readings)) {
    const older = readings[id];
    for (const field of ["current", "cumulative"] as const) {
      if (older?.[field] && next[field] && older[field]!.value !== next[field]!.value)
        throw new Error("The screenshots of this race have incompatible numbers. Check the screenshots and the names.");
    }
    const cumulative = older?.cumulative ?? next.cumulative;
    readings[id] = {
      ...next,
      ...older,
      current: older?.current ?? next.current,
      cumulative,
      useAsAnchor: !!cumulative && (!!older?.useAsAnchor || next.useAsAnchor),
    };
  }
  const verified =
    (retained.verified && Object.values(retained.readings).some((reading) => reading.useAsAnchor)) || incoming.verified;
  return {
    ...retained,
    stage: verified ? "post-race" : incoming.stage,
    verified,
    readings,
    rowAssociations: { ...retained.rowAssociations, ...incoming.rowAssociations },
  };
}
