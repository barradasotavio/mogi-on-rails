import {
  applyCaptureContext,
  applyReviewedRace,
  nameAssociationsForCapture,
  participantsForRace,
  physicalNumberForValid,
  resultCoverage,
  reviewedRace,
  screenProperties,
} from "@mkw/engine";

import { retainedReviewItem, reviewFile } from "./capture-review.ts";
import type { Capture, Mogi, RaceReviewFields, TrackerState } from "./types.ts";

function incompatibleRoster(state: TrackerState, mogi: Mogi, capture: Capture): string | undefined {
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const read = new Set(
    capture.rows
      .filter((row) => row.confidence >= 65)
      .map((row) => normalize(row.text))
      .filter((name) => name.length >= 3),
  );
  const matches = (other: Mogi) =>
    other.participants.filter((person) => {
      const names = [person.loungeName, person.ign];
      for (const source of other.captures ?? [])
        source.nameAssociations?.forEach((answer, index) => {
          if (answer.participantId === person.id) names.push(answer.ign ?? source.rows[index]?.text ?? "");
        });
      return names.some((name) => read.has(normalize(name)));
    });
  const here = matches(mogi);
  const roster = new Set(mogi.participants.map((person) => normalize(person.loungeName)));
  const other = state.mogis.find((entry) => {
    if (entry.id === mogi.id || resultCoverage(entry).complete) return false;
    const people = matches(entry);
    // Knowing more spellings for the same people does not prove a different roster.
    const outsiders = people.filter((person) => !roster.has(normalize(person.loungeName)));
    return people.length >= 4 && people.length >= here.length + 3 && outsiders.length >= 3;
  });
  return other?.name;
}
/** Suggestions are not historical identity facts when the occurrence is unknown. */
export function sourceFields(mogi: Mogi, capture: Capture, number?: number): RaceReviewFields {
  const historicalUnknown = number === undefined && !!mogi.substitutions?.length;
  return {
    placements: [],
    absentParticipantIds: [],
    rawOverrides: {},
    reviewed: false,
    nameAssociations: historicalUnknown
      ? (capture.nameAssociations ??
        capture.rows.map((row) => ({
          participantId: historicalUnknown || row.uncertain ? null : row.suggestedParticipantId,
          ...(historicalUnknown || row.uncertain || !row.text.trim() ? {} : { ign: row.text.trim() }),
        })))
      : nameAssociationsForCapture(mogi, capture, number),
    numericAnswers: capture.numericAnswers,
    groupTotalAnswers: capture.groupTotalAnswers,
    nextTrackAnswer: capture.nextTrackAnswer,
  };
}
/** Runs inside the serialized latest-state write, after recognition/answers are durable.
 * No async result or provisional number crosses this boundary as evidence. */
export function ingestCaptureReview(state: TrackerState, mogiId: string, acceptedItemId?: string): TrackerState {
  const consumed = new Set<string>();
  const mogis = state.mogis.map((initial) => {
    if (initial.id !== mogiId || !initial.captureReview) return initial;
    let mogi = initial;
    const items = initial.captureReview.items.map((item) => {
      if (item.source.fileId === state.sourceUndo?.fileId) return item;
      if (item.status !== "ready" || !item.recognition || !item.source.fileId) return item;
      const file = reviewFile(item, mogi, state.sharedReceipts?.flatMap((receipt) => receipt.files) ?? []);
      if (
        !file ||
        state.mogis.some(
          (other) => other.id !== mogiId && other.captureReview?.items.some((entry) => entry.source.fileId === file.id),
        )
      )
        return item;
      const capture: Capture = {
        ...item.recognition,
        lastModified: file.lastModified,
        photoMoment: file.photoMoment,
        receivedAt: file.receivedAt,
        pastedAt: file.pastedAt,
        original: file.original,
        reviewedAt: "",
        reviewedPlacements: [],
      };
      const separation = item.id === acceptedItemId ? undefined : incompatibleRoster(state, mogi, capture);
      if (separation) return { ...item, separation };
      const existing = mogi.races.find((race) => race.id === item.association);
      const number = existing?.number ?? (item.numberKnown === true ? item.number : undefined);
      const fields = item.draft?.fields ?? sourceFields(mogi, capture, number);
      // Preserve complete-result edits as drafts; a context source cannot carry
      // manual absence/raw-gain edits and must not silently consume them.
      if (item.draft && (fields.absentParticipantIds.length || Object.keys(fields.rawOverrides).length)) return item;
      const notFinishOrder = screenProperties(capture.interpretation?.screen)?.order !== "finishOrder";
      const sizeHint =
        capture.interpretation?.representedBy === "rows" && (capture.interpretation.represented ?? 12) < 12;
      const asContext =
        notFinishOrder ||
        sizeHint ||
        (screenProperties(capture.interpretation?.screen)?.order === "finishOrder" &&
          (number === undefined || fields.nameAssociations?.some((answer) => !answer.participantId)));
      if (asContext) {
        mogi = applyCaptureContext(mogi, capture, fields, existing?.id);
        if (number !== undefined) {
          const sequence = mogi.sequence ?? {
            version: 1 as const,
            numbers: [],
            links: [],
            relations: [],
            occurrences: [],
            gaps: [],
            inputSignature: "pending",
          };
          mogi = {
            ...mogi,
            sequence: {
              ...sequence,
              numbers: [
                ...sequence.numbers.filter((fact) => fact.captureId !== capture.id),
                {
                  captureId: capture.id,
                  number,
                  ...(mogi.races.some((race) => race.physicalNumber !== undefined)
                    ? { physicalNumber: physicalNumberForValid(mogi, number) }
                    : {}),
                  phase: capture.context?.phase ?? "after",
                },
              ],
            },
          };
        }
      } else {
        if (
          screenProperties(capture.interpretation?.screen)?.order !== "finishOrder" ||
          number === undefined ||
          item.duplicate ||
          item.draft?.baseSignature
        )
          return item;
        const people = participantsForRace(mogi, number),
          eligible = new Set(people.map((person) => person.id));
        const associations = fields.nameAssociations;
        if (
          !associations?.length ||
          associations.some((answer) => !answer.participantId || !eligible.has(answer.participantId))
        )
          return item;
        const race = reviewedRace(
          {
            ...(existing ?? { id: item.id, origin: "observed" as const, placements: [] }),
            number,
            status: item.discarded ? "discarded" : "confirmed",
            captureIds: [...new Set([...(existing?.captureIds ?? []), capture.id])],
          },
          { ...fields, placements: associations.map((answer) => answer.participantId!) },
          people,
        );
        if (!race) return item;
        mogi = applyReviewedRace(mogi, race, {
          ...capture,
          nameAssociations: associations,
          numericAnswers: fields.numericAnswers,
          reviewedAt: new Date().toISOString(),
          reviewedPlacements: race.placements,
        });
      }
      consumed.add(file.id);
      return {
        ...item,
        separation: undefined,
        source: { captureId: capture.id },
        status: "saved" as const,
        draft: undefined,
        association: existing?.id ?? (asContext ? "new" : item.id),
      };
    });
    return {
      ...mogi,
      captureReview: items.every((item) => item.status === "saved")
        ? undefined
        : {
            ...initial.captureReview,
            items,
            currentItemId: retainedReviewItem(items, initial.captureReview.currentItemId),
          },
    };
  });
  return {
    ...state,
    mogis,
    sharedReceipts: state.sharedReceipts
      ?.map((receipt) => ({ ...receipt, files: receipt.files.filter((file) => !consumed.has(file.id)) }))
      .filter((receipt) => receipt.files.length),
  };
}

/** Apply the answer to the current state without releasing other images in the batch. */
export function answerImageQuestion(state: TrackerState, mogiId: string, id: string, answer: string): TrackerState {
  const mogi = state.mogis.find((entry) => entry.id === mogiId);
  const item = mogi?.captureReview?.items.find(
    (entry) => `image:${entry.id}` === id && entry.status === "ready" && entry.separation && entry.recognition,
  );
  if (!mogi || !item || !item.source.fileId) return state;
  if (!["yes", "no"].includes(answer)) throw new Error("Choose an answer.");
  if (answer === "no") {
    const items = mogi.captureReview!.items.filter((entry) => entry.id !== item.id);
    return {
      ...state,
      mogis: state.mogis.map((entry) =>
        entry.id !== mogiId
          ? entry
          : {
              ...entry,
              sourceRevision: (entry.sourceRevision ?? 0) + 1,
              raceDraft:
                entry.raceDraft?.purpose === "capture" && entry.raceDraft.sourceFileId === item.source.fileId
                  ? undefined
                  : entry.raceDraft,
              captureReview: items.some((entry) => entry.status !== "saved")
                ? { ...mogi.captureReview!, items, currentItemId: retainedReviewItem(items) }
                : undefined,
            },
      ),
      sharedReceipts: state.sharedReceipts
        ?.map((receipt) => ({ ...receipt, files: receipt.files.filter((file) => file.id !== item.source.fileId) }))
        .filter((receipt) => receipt.files.length),
    };
  }
  const next = ingestCaptureReview(state, mogiId, item.id);
  if (
    !next.mogis.find((entry) => entry.id === mogiId)?.captures?.some((capture) => capture.id === item.recognition!.id)
  )
    throw new Error("The screenshot changed. Open the questions again.");
  return {
    ...next,
    mogis: next.mogis.map((entry) =>
      entry.id === mogiId ? { ...entry, sourceRevision: (entry.sourceRevision ?? 0) + 1 } : entry,
    ),
  };
}
