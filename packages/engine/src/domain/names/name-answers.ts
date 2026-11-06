import { applyCaptureContext, capturePhaseOffset } from "../capture/capture-context.ts";
import { reconcileCaptureEvidence } from "../capture/capture-evidence.ts";
import { screenProperties } from "../capture/screens.ts";
import { applyReviewedRace, initialRaceReview, reviewedRace } from "../mogi/race-review.ts";
import { cumulativeNumber } from "../numeric-readings/cumulative-number.ts";
import { participantsForRace, participationSlot, registerSubstitution } from "../participation/participation.ts";
import { captureNameAssociations, mogiQuestions, questionOccurrence } from "../questions/mogi-questions.ts";
import { nativePlacementPoints } from "../scoring/native-points.ts";
import type { CaptureExplanationStep } from "../sequence/capture-explanation.ts";
import { sourcePairSignature } from "../sequence/source-pair-signature.ts";
import type { Capture, Mogi, NameAssociation } from "../types.ts";
import { jointNames } from "./joint-names.ts";
import { type NameEvidence, nameEvidence } from "./name-evidence.ts";
import { recognizedParticipant } from "./name-recognition.ts";
import { normalizedName } from "./spelling.ts";
import { withdrawnAssociation } from "./synonyms.ts";

export { spelling } from "./spelling.ts";

// Only a full room fixes each race's gains to the twelve native places.
const FULL_ROOM = 12;
// Pairings grow factorially; spellings, tags and exclusion leave a real room one or two rows.
const MAX_CONTINUED_ROWS = 4;

/**
 * Spelling propagation: a known spelling links the same reading in another capture. It keeps the origin of its
 * source: from a human answer it is an answer; from a deduction it stays `deduced`, automatic and correctable.
 */
export function propagatedAssociation(participantId: string, reading: string, confirmed: boolean): NameAssociation {
  return {
    participantId,
    ...(reading.trim() ? { ign: reading.trim() } : {}),
    ...(!confirmed ? { origin: "deduced" as const } : {}),
  };
}

/** Reuses only confirmed, unambiguous spellings, respecting participation and the rows already taken. */
export function nameAssociationsForCapture(
  mogi: Mogi,
  capture: Capture,
  number?: number,
  evidence: NameEvidence = nameEvidence(mogi),
): NameAssociation[] {
  return resolveCaptureNames(mogi, capture, number, evidence).associations;
}

/** Carries the decision out of the same resolver; no explanation facts are persisted. */
export function resolveCaptureNames(
  mogi: Mogi,
  capture: Capture,
  number?: number,
  evidence: NameEvidence = nameEvidence(mogi),
  rehydrating = false,
) {
  if (evidence.mogi !== mogi) evidence = nameEvidence(mogi);
  const people = number === undefined ? questionOccurrence(mogi, capture).people : participantsForRace(mogi, number);
  const eligible = new Set(people.map((person) => person.id));
  const known = new Map<string, Set<string>>();
  const confirmed = new Set<string>();
  for (const [key, candidates] of evidence.known)
    for (const [id, manual] of candidates) {
      if (!eligible.has(id)) continue;
      const ids = known.get(key) ?? new Set<string>();
      ids.add(id);
      known.set(key, ids);
      if (manual) confirmed.add(key);
    }
  const answers = captureNameAssociations(capture).map((answer) => ({ ...answer }));
  const steps: CaptureExplanationStep[] = [];
  const record = (
    index: number,
    rule: CaptureExplanationStep["rule"],
    origin: "answered" | "deduced",
    extra: CaptureExplanationStep["evidence"] = {},
  ) => {
    steps.push({
      kind: "name",
      subject: capture.id,
      value: answers[index].participantId,
      origin,
      rule,
      evidence: { row: index + 1, readName: capture.rows[index].text, ...extra },
    });
  };
  answers.forEach((answer, index) => {
    if (!answer.participantId || !eligible.has(answer.participantId) || answer.origin === "deduced") return;
    const recognized = recognizedParticipant(mogi, capture.rows[index]) === answer.participantId;
    record(index, recognized ? "name.similar" : "name.answered", recognized ? "deduced" : "answered");
  });
  answers.forEach((answer, index) => {
    const key = evidence.spellingKey(capture.rows[index]?.text ?? "");
    const candidates = known.get(key);
    const variants = evidence.spellingKey.variants(capture.rows[index]?.text ?? "");
    if ((answer.participantId && eligible.has(answer.participantId)) || answer.unlinked) {
      if (
        answer.origin === "deduced" &&
        variants.length &&
        candidates?.size === 1 &&
        candidates.has(answer.participantId!)
      )
        record(index, "name.spelling-group", "deduced", { variants });
      return;
    }
    if (rehydrating && !confirmed.has(key) && !variants.length) return;
    if (
      !key ||
      candidates?.size !== 1 ||
      capture.rows.filter((row) => evidence.spellingKey(row.text) === key).length !== 1
    )
      return;
    const id = [...candidates][0];
    if (answers.some((other) => other.participantId === id)) return;
    answers[index] = propagatedAssociation(id, capture.rows[index].text, confirmed.has(key));
    record(
      index,
      confirmed.has(key) ? "name.answered" : variants.length ? "name.spelling-group" : "name.similar",
      confirmed.has(key) ? "answered" : "deduced",
      variants.length ? { variants } : {},
    );
  });
  // Proven earlier totals identify a row only when its value is unique on both sides.
  // No finish-order hypothesis takes part in the proof.
  const anchor = number ?? questionOccurrence(mogi, capture).number ?? cumulativeNumber(capture);
  const prior = capture.interpretation?.screen === "finishOrderAdding" && capture.interpretation.currentScale === 12;
  const before = screenProperties(capture.interpretation?.screen)?.moment === "before";
  const interrupted = interruptedContinuity(mogi, capture);
  if (anchor && (prior || before) && !interrupted) {
    const prefix = mogi.races.filter((race) => (race.physicalNumber ?? race.number ?? Infinity) < anchor);
    const scale = nativePlacementPoints(12);
    if (
      prefix.length === anchor - 1 &&
      new Set(prefix.map((race) => race.physicalNumber ?? race.number)).size === anchor - 1 &&
      prefix.every(
        (race) =>
          race.origin !== "reconstructed" &&
          race.status === "confirmed" &&
          !race.participationReview &&
          race.placements.length === 12 &&
          !race.absentParticipantIds?.length &&
          race.placements.every(
            (id, index) => eligible.has(id) && (race.nativePoints?.[id] ?? scale[index]) === scale[index],
          ),
      )
    ) {
      const totals = people.map((person) => ({
        id: person.id,
        value: prefix.reduce((sum, race) => sum + scale[race.placements.indexOf(person.id)], 0),
      }));
      const values = capture.rows.map((_, index) => {
        const row = capture.numericRows?.find((row) => row.row === index + 1);
        return (
          capture.numericAnswers?.find((answer) => answer.row === index + 1)?.value ??
          (row && !row.right.uncertain ? row.right.value : undefined)
        );
      });
      // An accepted spelling that contradicts the numbers blocks the whole deduction.
      const compatible = answers.every(
        (answer, index) =>
          !answer.participantId ||
          values[index] == null ||
          totals.find((person) => person.id === answer.participantId)?.value === values[index],
      );
      if (compatible)
        answers.forEach((answer, index) => {
          const value = values[index],
            candidates = totals.filter((person) => person.value === value);
          if (
            answer.participantId ||
            answer.unlinked ||
            value == null ||
            candidates.length !== 1 ||
            values.filter((other) => other === value).length !== 1 ||
            answers.some((other) => other.participantId === candidates[0].id)
          )
            return;
          const ign = capture.rows[index].text.trim();
          answers[index] = { participantId: candidates[0].id, ...(ign ? { ign } : {}), origin: "deduced" };
          record(index, "name.exclusion", "deduced", { group: candidates.map((person) => person.id) });
        });
    }
  }
  if (!interrupted) {
    const continued = continuingTotals(mogi, capture, answers, people);
    for (const [index, participantId] of continued?.rows ?? []) {
      const ign = capture.rows[index].text.trim();
      answers[index] = { participantId, ...(ign ? { ign } : {}), origin: "deduced" };
      record(index, "name.continuity", "deduced", { anchorCaptureId: continued!.anchorCaptureId });
    }
  }
  const resolved = jointNames(mogi, capture, answers, people, true, evidence);
  steps.push(...resolved.steps);
  // Loaded deductions have values but no transient trace. Re-enter this resolver with
  // those slots open; only the decision for the already accepted value is retained.
  if (
    !rehydrating &&
    answers.some(
      (answer, index) => answer.origin === "deduced" && !steps.some((step) => step.evidence.row === index + 1),
    )
  ) {
    const replay = resolveCaptureNames(
      mogi,
      {
        ...capture,
        nameAssociations: captureNameAssociations(capture).map((answer) =>
          answer.origin === "deduced" ? { participantId: null } : answer,
        ),
      },
      number,
      nameEvidence(mogi, false),
      true,
    );
    steps.push(
      ...replay.steps.filter(
        (step) =>
          !steps.some((existing) => existing.evidence.row === step.evidence.row) &&
          resolved.associations[step.evidence.row! - 1]?.participantId === step.value,
      ),
    );
  }
  steps.sort((a, b) => a.evidence.row! - b.evidence.row!);
  if (rehydrating) return { associations: resolved.associations, steps };
  const readRows = new Set<number>();
  resolved.associations.forEach((answer, index) => {
    const person = people.find((person) => person.id === answer.participantId);
    const reading = normalizedName(capture.rows[index].text);
    if (!person || !reading) return;
    // A line's own answer/deduction cannot turn itself into an already known synonym.
    const synonyms =
      evidence.synonymSources
        .get(person.id)
        ?.filter((alias) => alias.captureId !== capture.id)
        .map((alias) => alias.name) ?? [];
    if ([person.loungeName, person.ign, ...synonyms].some((name) => normalizedName(name) === reading))
      readRows.add(index + 1);
  });
  const summary: CaptureExplanationStep = {
    kind: "name",
    subject: capture.id,
    value: readRows.size,
    origin: "read",
    rule: "name.as-shown",
    evidence: { compared: capture.rows.length },
  };
  return {
    associations: resolved.associations,
    steps: [summary, ...steps.filter((step) => !readRows.has(step.evidence.row!))],
  };
}

/** A link answered as a reopening, or with people who did not keep their totals, breaks continuity at this capture. */
function interruptedContinuity(mogi: Mogi, capture: Capture): boolean {
  return !!mogi.sequence?.links.some((link) => {
    if (
      ![link.fromCaptureId, link.toCaptureId].includes(capture.id) ||
      (link.continuity !== "reset" && !link.people?.some((person) => person.answer !== "stable"))
    )
      return false;
    const from = mogi.captures?.find((source) => source.id === link.fromCaptureId),
      to = mogi.captures?.find((source) => source.id === link.toCaptureId);
    return from && to && link.signature === sourcePairSignature(from, to);
  });
}

/** Accepted total of each row: an answer, the room's deduction or a certain reading. */
function rowTotals(capture: Capture): (number | undefined)[] {
  return capture.rows.map((_, index) => {
    const row = index + 1,
      reading = capture.numericRows?.find((entry) => entry.row === row)?.right;
    return (
      capture.numericAnswers?.find((answer) => answer.row === row)?.value ??
      capture.numericDeductions?.find((deduction) => deduction.row === row)?.value ??
      (reading && !reading.uncertain && reading.value != null ? reading.value : undefined)
    );
  });
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/**
 * name.continuity: in a full room, the free rows of a screen pair with the people still free in it when the totals
 * of a neighbouring screen in the same room allow exactly one pairing. At the same moment the totals are equal; one
 * race apart, the twelve gains are the twelve native places, so the linked people's gains leave the places the free
 * rows can take. Every neighbour must allow the pairing.
 */
export function continuingTotals(
  mogi: Mogi,
  capture: Capture,
  answers: readonly NameAssociation[],
  people: readonly { id: string }[],
): { rows: [number, string][]; anchorCaptureId: string } | undefined {
  const scale = nativePlacementPoints(FULL_ROOM),
    room = mogi.sequence?.roomAnalysis,
    completed = (source: Capture) => {
      const entry = room?.captures.find((entry) => entry.captureId === source.id);
      return entry?.number === undefined || screenProperties(source.interpretation?.screen)?.cumulative !== "final"
        ? undefined
        : { session: entry.sessionId, races: entry.number - capturePhaseOffset(source) };
    };
  const own = completed(capture);
  const rows = answers.flatMap((answer, index) => (answer.participantId || answer.unlinked ? [] : [index]));
  const free = people.filter((person) => !answers.some((answer) => answer.participantId === person.id));
  const values = rowTotals(capture);
  if (
    !own ||
    people.length !== FULL_ROOM ||
    capture.rows.length !== FULL_ROOM ||
    !rows.length ||
    rows.length > MAX_CONTINUED_ROWS ||
    free.length !== rows.length ||
    values.some((value) => value === undefined)
  )
    return;
  let pairings = permutations(free.map((person) => person.id));
  let anchorCaptureId: string | undefined;
  for (const neighbour of mogi.captures ?? []) {
    const other = neighbour === capture ? undefined : completed(neighbour),
      distance = other && other.session === own.session ? own.races - other.races : undefined;
    if (distance === undefined || Math.abs(distance) > 1 || interruptedContinuity(mogi, neighbour)) continue;
    const previous = new Map<string, number>(),
      totals = rowTotals(neighbour);
    captureNameAssociations(neighbour).forEach((answer, index) => {
      if (answer.participantId && totals[index] !== undefined) previous.set(answer.participantId, totals[index]!);
    });
    if (!people.every((person) => previous.has(person.id))) continue;
    // Gain between the two screens, forward in time.
    const gain = (value: number, id: string) => (distance >= 0 ? value - previous.get(id)! : previous.get(id)! - value);
    const linked = answers.flatMap((answer, index) =>
      answer.participantId ? [gain(values[index]!, answer.participantId)] : [],
    );
    const places = scale.filter((points) => !linked.includes(points));
    if (
      distance === 0
        ? linked.some((value) => value !== 0)
        : new Set(linked).size !== linked.length || places.length !== rows.length
    )
      continue;
    pairings = pairings.filter((pairing) => {
      const gains = pairing.map((id, i) => gain(values[rows[i]]!, id));
      return distance === 0
        ? gains.every((value) => value === 0)
        : new Set(gains).size === gains.length && gains.every((value) => places.includes(value));
    });
    anchorCaptureId ??= neighbour.id;
  }
  if (!anchorCaptureId || pairings.length !== 1) return;
  return { rows: rows.map((row, i) => [row, pairings[0][i]]), anchorCaptureId };
}

export type NameQuestionAnswer =
  | { participantId: string; substitute?: never }
  | {
      participantId?: never;
      substitute: { loungeName: string; replacedParticipantId: string };
    };

/** Saves associations through the same acceptance path as sources/results, inside the serialized write. */
export function answerNameQuestion<T extends Mogi>(input: T, questionId: string, answer: NameQuestionAnswer): T {
  const question = mogiQuestions(input).find((entry) => entry.id === questionId);
  if (!question || question.kind !== "name") throw new Error("This question changed. Open the questions again.");
  let mogi = input;
  let participantId = answer.participantId;
  if (answer.substitute) {
    const replaced = question.options.find((person) => person.id === answer.substitute.replacedParticipantId);
    if (
      !question.number ||
      !replaced ||
      !answer.substitute.loungeName.trim() ||
      answer.substitute.loungeName.trim().length > 80
    )
      throw new Error("Choose who the sub replaced and enter their Lounge name.");
    const person = mogi.participants.find((person) => person.id === replaced.id)!;
    mogi = registerSubstitution(mogi, {
      slotId: participationSlot(person),
      loungeName: answer.substitute.loungeName,
      ign: question.reading,
      fromRace: question.number,
    });
    participantId = mogi.substitutions!.at(-1)!.incomingParticipantId;
  } else if (!question.options.some((person) => person.id === participantId))
    throw new Error("Choose an available player.");
  const occurrences = new Map([question, ...question.occurrences].map((entry) => [entry.captureId, entry.row]));
  const changed = new Set<string>();
  const captures = mogi.captures!.map((capture) => {
    const row = occurrences.get(capture.id);
    if (row === undefined || !questionOccurrence(mogi, capture).people.some((person) => person.id === participantId))
      return capture;
    const associations = captureNameAssociations(capture);
    // Only a reading the user unlinked takes a person from another row; that row reopens for its own answer.
    const moves = associations[row - 1]?.unlinked;
    if (!moves && associations.some((entry, index) => index !== row - 1 && entry.participantId === participantId))
      return capture;
    const reading = capture.rows[row - 1].text.trim();
    changed.add(capture.id);
    return {
      ...capture,
      nameAssociations: associations.map((entry, index) =>
        index === row - 1
          ? { participantId: participantId!, ...(reading ? { ign: reading } : {}) }
          : entry.participantId === participantId
            ? withdrawnAssociation()
            : entry,
      ),
    };
  });
  return settleCaptures({ ...mogi, captures }, changed, true);
}

/**
 * Reapplies the changed captures through the same acceptance path. With `propagate`, confirmed spellings
 * also fill the other captures; without it, only the captures in `changed` are rewritten as they are.
 */
export function settleCaptures<T extends Mogi>(input: T, changed: ReadonlySet<string>, propagate: boolean): T {
  let mogi = input;
  for (const original of mogi.captures ?? []) {
    if (!propagate && !changed.has(original.id)) continue;
    const capture = propagate
      ? { ...original, nameAssociations: nameAssociationsForCapture(mogi, original) }
      : { ...original, nameAssociations: captureNameAssociations(original) };
    if (
      !changed.has(original.id) &&
      JSON.stringify(capture.nameAssociations) === JSON.stringify(captureNameAssociations(original))
    )
      continue;
    const { race, people } = questionOccurrence(mogi, capture);
    const complete =
      capture.nameAssociations.length === capture.rows.length &&
      capture.nameAssociations.every(
        (entry) => entry.participantId && people.some((person) => person.id === entry.participantId),
      );
    if (race?.origin === "observed" && !complete) {
      // Another accepted finish order can support the result; withdrawn answers cannot.
      const independent = mogi.captures?.some(
        (source) =>
          source.id !== capture.id &&
          source.stage === "finish-order-confirmed" &&
          questionOccurrence(mogi, source).race?.id === race.id &&
          JSON.stringify(captureNameAssociations(source).map((answer) => answer.participantId)) ===
            JSON.stringify(race.placements),
      );
      const gameEvidence = reconcileCaptureEvidence(race.gameEvidence, undefined, capture.id);
      mogi = {
        ...mogi,
        races: mogi.races.map((entry) =>
          entry.id !== race.id
            ? entry
            : {
                ...entry,
                gameEvidence,
                ...(!independent
                  ? {
                      status: entry.status === "discarded" ? ("discarded" as const) : ("pending" as const),
                      placements: [],
                      absentParticipantIds: [],
                      nativePoints: undefined,
                      nativePointOrigins: undefined,
                    }
                  : {}),
              },
        ),
      };
      capture.reviewedPlacements = [];
    }
    const fields = {
      ...(race
        ? initialRaceReview(race)
        : { placements: [], absentParticipantIds: [], rawOverrides: {}, reviewed: false }),
      nameAssociations: capture.nameAssociations,
      numericAnswers: capture.numericAnswers,
      groupTotalAnswers: capture.groupTotalAnswers,
      nextTrackAnswer: capture.nextTrackAnswer,
    };
    if (capture.context) {
      const derived = mogi.sequence?.associations?.some(
        (entry) => entry.captureId === capture.id && entry.raceId === race?.id,
      );
      mogi = applyCaptureContext(mogi, capture, fields, race?.id, derived);
    } else if (race && complete) {
      const result =
        race.origin === "manual" && race.status !== "pending"
          ? race
          : reviewedRace(
              race,
              { ...fields, placements: capture.nameAssociations.map((entry) => entry.participantId!) },
              people,
            );
      if (result)
        mogi = applyReviewedRace(mogi, result, {
          ...capture,
          reviewedAt: new Date().toISOString(),
          reviewedPlacements: result.placements,
        });
    } else mogi = { ...mogi, captures: mogi.captures!.map((entry) => (entry.id === capture.id ? capture : entry)) };
  }
  return mogi;
}
