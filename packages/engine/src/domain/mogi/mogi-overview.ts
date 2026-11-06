import { captureBoundaries } from "../capture/capture-boundary.ts";
import { contextPhase } from "../capture/capture-context.ts";
import { momentOffset } from "../capture/screens.ts";
import { type MogiQuestion, mogiQuestions } from "../questions/mogi-questions.ts";
import { countedRaces, individualStandings, pointsFor, raceNumber, resultCoverage } from "../scoring/scoring.ts";
import { initialRoomSources } from "../sequence/room/room-sequence.ts";
import type { Mogi } from "../types.ts";
import { raceNumbers } from "./mogi-rules.ts";

export type MogiHeaderAction =
  | { kind: "none" }
  | { kind: "reading"; current: number; total: number }
  | { kind: "questions"; count: number }
  | { kind: "copy-submit" }
  | { kind: "copy-table" };
export type MogiNeedsImagesReason = "fewer-players" | "no-later-totals";
export interface MogiRacePosition {
  number: number;
  state: "future" | "unseen" | "pending" | "counted" | "reading" | "questions" | "needs-images";
  raceId?: string;
  questionCount: number;
  /** Only when state === "needs-images". */
  needsImages?: { reason: MogiNeedsImagesReason };
}
export interface MogiOverviewActivity {
  reading?: { current: number; total: number; numbers: number[] } | null;
  questions?: { number?: number; count: number; raceId?: string }[];
  /** Destination decisions derived from received images, before ingestion. */
  imageQuestions?: { number?: number }[];
}

/** No RuleCode while pending: a numbered unrecognized result needs images; an upcoming pre-race screen stays pending. */
export function unrecognizedRaceNeedsImages(mogi: Mogi, number: number): boolean {
  return (mogi.captures ?? []).some(
    (capture) =>
      capture.interpretation?.screen === "unknown" &&
      contextPhase(capture) !== "before" &&
      mogi.sequence?.occurrences.some(
        (occurrence) => occurrence.number === number && occurrence.captureIds.includes(capture.id),
      ),
  );
}

/** No RuleCode while pending: a pre-race source alone leaves the upcoming race in progress. */
export function preRacePending(mogi: Mogi, number: number): boolean {
  return (mogi.captures ?? []).some(
    (capture) =>
      contextPhase(capture) === "before" &&
      mogi.sequence?.occurrences.some(
        (occurrence) => occurrence.number === number && occurrence.captureIds.includes(capture.id),
      ),
  );
}

/** Projection of the main screen, with no persisted presentation state. */
export function mogiOverview(
  mogi: Mogi,
  activity: MogiOverviewActivity = {},
  queue: MogiQuestion[] = mogiQuestions(mogi),
): { positions: MogiRacePosition[]; action: MogiHeaderAction; count: number; finished: boolean } {
  const coverage = resultCoverage(mogi);
  const questions: { number?: number; raceId?: string; captureId?: string; otherNumbers?: number[]; count: number }[] =
    [
      ...queue.map((question) => ({
        number: question.number,
        raceId: question.raceId,
        captureId: question.captureId,
        count: 1,
        otherNumbers:
          question.kind === "name"
            ? question.occurrences.flatMap((entry) => (entry.number === undefined ? [] : [entry.number]))
            : [],
      })),
    ];
  // An unnumbered image waits visually in the next open slot; that does not establish its number.
  const waitingNumber = raceNumbers().find((number) => !coverage.included.includes(number));
  questions.push(
    ...(activity.imageQuestions ?? []).map((question) => ({ number: question.number ?? waitingNumber, count: 1 })),
  );
  for (const question of questions)
    if (question.number === undefined) {
      const race = mogi.races.find((race) => race.id === question.raceId);
      question.number = race ? raceNumber(mogi, race) : question.captureId ? waitingNumber : undefined;
    }
  const count = questions.reduce((sum, question) => sum + question.count, 0);
  const firstSeen = Math.min(
    ...initialRoomSources(mogi, true).flatMap(
      (id) =>
        mogi.sequence?.occurrences.filter((o) => o.captureIds.includes(id)).map((o) => o.number ?? Infinity) ?? [],
    ),
  );
  const established = mogi.races.filter(
    (race) => race.status !== "discarded" && (race.placements.length > 0 || !!race.captureIds?.length),
  );
  const lastEstablished = Math.max(
    0,
    ...established.map((race) => raceNumber(mogi, race)),
    ...(mogi.sequence?.occurrences.flatMap((occurrence) =>
      occurrence.captureIds.length && occurrence.number !== undefined ? [occurrence.number] : [],
    ) ?? []),
  );
  const boundaries = captureBoundaries(mogi);
  const initialSources = initialRoomSources(mogi, true);
  const needsImagesReason = (number: number): MogiNeedsImagesReason => {
    // Only accepted representation/absence facts count, never an OCR crop's row count.
    if (
      established.some(
        (race) =>
          raceNumber(mogi, race) > number &&
          (race.status ?? "confirmed") === "confirmed" &&
          !race.participationReview &&
          (race.absentParticipantIds?.length || (race.placements.length > 0 && race.placements.length < 12)),
      )
    )
      return "fewer-players";
    // A full native vector can also demonstrate a deficit. Limit it to an
    // established origin or a continuous span, so reopened totals are not compared to zero.
    for (const to of boundaries) {
      const end = to.number === undefined ? 0 : to.number - momentOffset(to.phase);
      if (end <= number || to.values.size !== 12) continue;
      const steps = (to.physicalNumber ?? 0) - momentOffset(to.phase);
      if (
        initialSources.includes(to.captureId) &&
        steps > 0 &&
        [...to.values.values()].reduce((sum, value) => sum + value.value, 0) < 82 * steps
      )
        return "fewer-players";
      for (const relation of mogi.sequence?.relations ?? []) {
        if (relation.toCaptureId !== to.captureId || relation.stableParticipantIds.length !== 12) continue;
        const from = boundaries.find((boundary) => boundary.captureId === relation.fromCaptureId);
        if (
          !from ||
          from.number === undefined ||
          from.number - momentOffset(from.phase) >= number ||
          from.values.size !== 12
        )
          continue;
        const gains = [...to.values].map(([id, value]) =>
          from.values.has(id) ? value.value - from.values.get(id)!.value : -1,
        );
        if (
          gains.every((gain) => gain >= 0) &&
          gains.reduce((sum, gain) => sum + gain, 0) < 82 * relation.completedSteps
        )
          return "fewer-players";
      }
    }
    return "no-later-totals";
  };
  const positions = raceNumbers().map((number): MogiRacePosition => {
    const race = mogi.races.find((entry) => entry.status !== "discarded" && raceNumber(mogi, entry) === number);
    const questionCount = questions
      .filter((entry) => entry.number === number || entry.otherNumbers?.includes(number))
      .reduce((sum, entry) => sum + entry.count, 0);
    const reading = activity.reading?.numbers.includes(number);
    const empty =
      !race?.placements.length &&
      !race?.captureIds?.length &&
      !mogi.sequence?.occurrences.some((occurrence) => occurrence.number === number && occurrence.captureIds.length);
    const included = coverage.included.includes(number);
    const state = reading
      ? "reading"
      : questionCount
        ? "questions"
        : empty && included && number < firstSeen
          ? "unseen"
          : included
            ? "counted"
            : empty && number < lastEstablished
              ? count
                ? "unseen"
                : "needs-images"
              : unrecognizedRaceNeedsImages(mogi, number)
                ? "needs-images"
                : race?.status === "pending" || preRacePending(mogi, number)
                  ? "pending"
                  : "future";
    return {
      number,
      raceId: race?.id,
      questionCount,
      state,
      ...(state === "needs-images" ? { needsImages: { reason: needsImagesReason(number) } } : {}),
    };
  });
  return {
    positions,
    count: coverage.through,
    finished: coverage.complete,
    action: activity.reading
      ? { kind: "reading", current: activity.reading.current, total: activity.reading.total }
      : count
        ? { kind: "questions", count }
        : coverage.final
          ? { kind: "copy-submit" }
          : coverage.through
            ? { kind: "copy-table" }
            : { kind: "none" },
  };
}

/** Movement between counted standings and the adjusted gain of the last race. */
export function mogiPlayerChanges(mogi: Mogi) {
  const races = countedRaces(mogi)
    .filter((race) => raceNumber(mogi, race) <= resultCoverage(mogi).through)
    .sort((a, b) => raceNumber(mogi, a) - raceNumber(mogi, b));
  if (races.length < 2) return [];
  const last = races.at(-1)!;
  const previous = individualStandings(mogi, { through: raceNumber(mogi, last) - 1 });
  return individualStandings(mogi).map((person) => {
    const before = previous.find((entry) => entry.id === person.id);
    return {
      slotId: person.id,
      movement: person.rank && before?.rank ? before.rank - person.rank : 0,
      gain: person.members.reduce((sum, member) => sum + pointsFor(last, member.id), 0),
    };
  });
}
