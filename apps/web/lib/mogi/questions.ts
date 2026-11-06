import {
  mogiOverview as domainOverview,
  type MogiOverviewActivity,
  type MogiQuestion as DomainQuestion,
  type MogiQuestionAnswer as DomainAnswer,
  mogiQuestions as domainQuestions,
} from "@mkw/engine";

import type { Capture, Mogi } from "./types.ts";

export interface ImageQuestion {
  kind: "image";
  id: string;
  itemId: string;
  captureId: string;
  row: number;
  raceId?: string;
  number?: number;
  otherMogi: string;
  suggestion: string;
  options: { value: string; label: string }[];
  crop: { captureId: string; location?: Capture["rows"][number]["location"] };
}
export type MogiQuestion = DomainQuestion | ImageQuestion;
export type MogiQuestionAnswer = DomainAnswer | { kind: "image"; value: string };

// Tracker writes replace the mogi. Identity invalidates every projection, without parallel facts.
const projections = new WeakMap<Mogi, { questions: MogiQuestion[]; overview: ReturnType<typeof domainOverview> }>();
function projection(mogi: Mogi) {
  const cached = projections.get(mogi);
  if (cached) return cached;
  const images = imageQuestions(mogi),
    domain = domainQuestions(mogi);
  const result = {
    questions: [...images, ...domain],
    overview: domainOverview(mogi, { imageQuestions: images }, domain),
  };
  projections.set(mogi, result);
  return result;
}

/** The destination decision precedes questions about the image content. */
export function imageQuestions(mogi: Mogi): ImageQuestion[] {
  return (mogi.captureReview?.items ?? []).flatMap((item) =>
    item.status === "ready" && item.separation && item.recognition
      ? [
          {
            kind: "image" as const,
            id: `image:${item.id}`,
            itemId: item.id,
            captureId: item.recognition.id,
            row: 0,
            number: item.numberKnown ? item.number : undefined,
            otherMogi: item.separation,
            suggestion: "yes",
            options: [
              { value: "yes", label: "Yes, add it here" },
              { value: "no", label: "No, remove it" },
            ],
            crop: { captureId: item.recognition.id },
          },
        ]
      : [],
  );
}

export function mogiQuestions(mogi: Mogi): MogiQuestion[] {
  return projection(mogi).questions;
}

/** Find the questioned fact again without depending on a group's current representative. */
export function currentQuestion(questions: MogiQuestion[], shown: MogiQuestion): MogiQuestion | undefined {
  const exact = questions.find((question) => question.kind === shown.kind && question.id === shown.id);
  if (exact) return exact;
  const sameLocation = questions.filter(
    (question) =>
      question.kind === shown.kind &&
      question.captureId !== undefined &&
      question.captureId === shown.captureId &&
      question.row === shown.row,
  );
  if (sameLocation.length === 1) return sameLocation[0];
  if (shown.kind !== "name") return undefined;
  const spelling = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
  const names = questions.filter(
    (question) => question.kind === "name" && spelling(question.reading) === spelling(shown.reading),
  );
  const locations = [shown, ...shown.occurrences];
  const group = names.find(
    (question) =>
      question.kind === "name" &&
      [question, ...question.occurrences].some((entry) =>
        locations.some((old) => old.captureId === entry.captureId && old.row === entry.row),
      ),
  );
  return group ?? (names.length === 1 ? names[0] : undefined);
}

export function mogiOverview(mogi: Mogi, activity: MogiOverviewActivity = {}) {
  const overview = projection(mogi).overview;
  if (!activity.reading) return overview;
  const reading = activity.reading;
  return {
    ...overview,
    action: { kind: "reading" as const, current: reading.current, total: reading.total },
    positions: overview.positions.map((position) =>
      reading.numbers.includes(position.number) ? { ...position, state: "reading" as const } : position,
    ),
  };
}
