import { interpretRightList } from "../../recognition/finish-order.ts";
import { contextPhase } from "../capture/capture-context.ts";
import { captureNumericQuestions, screenAddition } from "../capture/capture-evidence.ts";
import { screenProperties } from "../capture/screens.ts";
import { raceNumbers, teamSizes } from "../mogi/mogi-rules.ts";
import { type JointNames, jointNames } from "../names/joint-names.ts";
import { type NameEvidence, nameEvidence } from "../names/name-evidence.ts";
import { spelling } from "../names/spelling.ts";
import { cumulativeNumber } from "../numeric-readings/cumulative-number.ts";
import { roomSizeNeedsAnswer } from "../numeric-readings/numeric-candidates.ts";
import { MAX_COUNTED_RACES, MAX_POINTS_PER_RACE } from "../numeric-readings/per-person-vector.ts";
import {
  participantsForOccurrence,
  participantsForRace,
  participantsWithSpan,
  participationMembers,
  pendingCreditSlots,
  rosterSlots,
} from "../participation/participation.ts";
import { teamLabel } from "../participation/team-tags.ts";
import { type UsefulQuestion, usefulQuestion } from "../reconstruction/known-positions.ts";
import { creditSuggestion } from "../scoring/credit.ts";
import { countedRaces, raceNumber } from "../scoring/scoring.ts";
import {
  type CaptureExplanationStep,
  recordRoomExplanation,
  roomExplanationSteps,
} from "../sequence/capture-explanation.ts";
import { cumulativeRacePointRows } from "../sequence/first-race.ts";
import { sourcePairSignature } from "../sequence/source-pair-signature.ts";
import type { Capture, CaptureRow, Mogi, NameAssociation, Participant, Race } from "../types.ts";
import { blankUnknownScreen, contextQuestions } from "./questions.ts";
import type { SequenceAnswer } from "./sequence-answer.ts";

// A finish-order list may represent 12, 11 or 10 players, the room sizes with a native scale.
const FINISH_ORDER_SIZES = [12, 11, 10] as const;

interface QuestionBase {
  id: string;
  number?: number;
  raceId?: string;
  captureId?: string;
  row: number;
  crop?: { captureId: string; location?: CaptureRow["location"] };
  /** All sources affected by this one answer, including grouped questions. */
  captureIds?: string[];
}

interface CaptureQuestionBase extends QuestionBase {
  captureId: string;
  crop: { captureId: string; location?: CaptureRow["location"] };
}

export interface NameQuestion extends CaptureQuestionBase {
  kind: "name";
  reading: string;
  options: { id: string; loungeName: string }[];
  suggestion: string | null;
  occurrences: { captureId: string; row: number; number?: number }[];
}

/** points.screenshot-total: every value is the person's total on that screenshot, the "+N" being added included. */
export interface PointsQuestion extends CaptureQuestionBase {
  kind: "points";
  reading: string;
  suggestion: number | null;
  /** The total the OCR read on this row; a suggestion that differs comes from the other totals. */
  read: number | null;
}
export interface RaceQuestion extends CaptureQuestionBase {
  sessionCaptureIds?: string[];
  kind: "race";
  reading: string;
  options: { value: number | "reopening" | "another"; label: string }[];
  otherRaces?: { value: number; label: string }[];
  suggestion: number | null;
}
export interface TeamQuestion extends QuestionBase {
  kind: "team";
  participantId: string;
  reading: string;
  options: { value: string; label: string; disabled: boolean }[];
  suggestion: string | null;
}
export interface PositionQuestion extends QuestionBase {
  kind: "position";
  participantId: string;
  reading: string;
  options: { value: number | "absent"; label: string }[];
  suggestion: number | "absent" | null;
}
export interface SequenceQuestion extends CaptureQuestionBase {
  kind: "sequence";
  reading: string;
  options: { value: string; label: string; answer: SequenceAnswer }[];
  suggestion: string | null;
}

export interface CreditQuestion extends QuestionBase {
  kind: "credit";
  slotId: string;
  reading: string;
  options: { value: string; label: string }[];
  suggestion: string;
  reason: string;
}

export type MogiQuestion =
  NameQuestion | PointsQuestion | RaceQuestion | TeamQuestion | PositionQuestion | SequenceQuestion | CreditQuestion;

export function ordinal(value: number): string {
  return `${value}${value === 1 ? "st" : value === 2 ? "nd" : value === 3 ? "rd" : "th"}`;
}

/**
 * Teams a person with a missing team can join: a team that already has the format's size is
 * unavailable, and a roster slot already on a team stays locked to it. The suggestion is the
 * team of a teammate in the same roster block, else the first available team.
 */
export function teamChoices(mogi: Mogi, person: Participant) {
  const size = teamSizes[mogi.format];
  const slots = rosterSlots(mogi);
  const index = slots.findIndex((slot) => slot.id === (person.slotId ?? person.id));
  const teammate = slots
    .slice(Math.floor(index / size) * size, Math.floor(index / size) * size + size)
    .find((person) => person.teamId);
  const assigned = slots[index]?.teamId;
  const options = mogi.teams!.map((team) => ({
    value: team.id,
    label: teamLabel(mogi, team.id),
    disabled: assigned ? assigned !== team.id : slots.filter((person) => person.teamId === team.id).length >= size,
  }));
  return {
    options,
    suggestion:
      options.find((option) => !option.disabled && option.value === teammate?.teamId)?.value ??
      options.find((option) => !option.disabled)?.value ??
      null,
  };
}

export function captureNameAssociations(capture: Capture): NameAssociation[] {
  return (
    capture.nameAssociations ??
    capture.rows.map((row) => ({
      participantId: row.uncertain ? null : row.suggestedParticipantId,
      ...(!row.uncertain && row.text.trim() ? { ign: row.text.trim() } : {}),
    }))
  );
}

export function questionOccurrence(mogi: Mogi, capture: Capture) {
  const occurrence = mogi.sequence?.occurrences.find((entry) => entry.captureIds.includes(capture.id));
  const raceId =
    capture.context?.raceId ??
    mogi.sequence?.associations?.find((entry) => entry.captureId === capture.id)?.raceId ??
    occurrence?.raceId;
  const race = mogi.races.find((entry) => entry.id === raceId || entry.captureIds?.includes(capture.id));
  const number = race
    ? raceNumber(mogi, race)
    : (occurrence?.number ??
      mogi.sequence?.numbers.find((entry) => entry.captureId === capture.id)?.number ??
      undefined);
  // Without a race, the final standings show the last race's room; any other screenshot, whoever held a span.
  const people = race
    ? participantsForOccurrence(mogi, race)
    : number
      ? participantsForRace(mogi, number)
      : contextPhase(capture) === "event-final"
        ? participantsForRace(mogi, Math.max(...raceNumbers()))
        : participantsWithSpan(mogi);
  return { race, number, people };
}

type QuestionOccurrence = ReturnType<typeof questionOccurrence>;
type RoomAnalysis = NonNullable<NonNullable<Mogi["sequence"]>["roomAnalysis"]>;
type ContextQuestion = ReturnType<typeof contextQuestions>[number];

/** Name grouping shared across captures while the queue is built. */
interface NameGrouping {
  /** Rows each name question clarifies inside its own capture, by question ID. */
  impacts: Map<string, number>;
  /** Spelling chosen for each pair/trio of rows, so every capture asks the same one. */
  representatives: Map<string, string>;
  /** Questions about one team's rows, asked once across captures, by question ID. */
  teams: Map<string, string>;
}

/**
 * Queue order: by race number (unknown race last), the credit question after the race's
 * other questions, then by row (race and sequence questions use row 0), then by capture ID.
 */
export function questionOrder(a: MogiQuestion, b: MogiQuestion): number {
  return (
    (a.number ?? Infinity) - (b.number ?? Infinity) ||
    Number(a.kind === "credit") - Number(b.kind === "credit") ||
    a.row - b.row ||
    (a.captureId ?? "").localeCompare(b.captureId ?? "")
  );
}

/** Rows a name answer clarifies: its rows in its own capture times the captures that share its spelling. */
export function nameClarity(question: NameQuestion, impact = 1): number {
  return impact * (question.occurrences.length + 1);
}

/** Queue derived from the facts alone; deferring a question belongs to the interface session. */
export function mogiQuestions(mogi: Mogi): MogiQuestion[] {
  const names = nameEvidence(mogi);
  const roomAnalysis = mogi.sequence?.roomAnalysis;
  const captures = capturesInQueueOrder(mogi);
  const grouping: NameGrouping = { impacts: new Map(), representatives: new Map(), teams: new Map() };
  const askedTeams = new Set<string>();
  const questions: MogiQuestion[] = [];
  const roomOrder = roomOrderQuestion(mogi);
  if (roomOrder) questions.push(roomOrder);
  for (const capture of captures) questions.push(...questionsForCapture(mogi, capture, names, grouping, askedTeams));
  questions.push(...rosterTeamQuestions(mogi, askedTeams));
  const position = positionQuestion(mogi, questions);
  if (position) questions.push(position);
  questions.push(...contextSequenceQuestions(mogi, captures), ...creditQuestions(mogi));
  const ordered = uniqueQuestions(questions).sort(questionOrder);
  for (const question of ordered) question.captureIds ??= affectedCaptureIds(mogi, question, captures);
  const grouped = groupNameTeams(groupSpellings(mogi, ordered, captures, names), grouping.teams);
  const result = orderNamesByClarity(grouped, grouping.impacts);
  if (roomAnalysis) recordPendingQuestions(mogi, roomAnalysis, captures, result);
  return result;
}

/** Captures by race number (unknown race last), then by photo time, then by capture ID. */
function capturesInQueueOrder(mogi: Mogi): Capture[] {
  return [...(mogi.captures ?? [])].sort(
    (a, b) =>
      (questionOccurrence(mogi, a).number ?? Infinity) - (questionOccurrence(mogi, b).number ?? Infinity) ||
      (a.photoMoment?.at ?? Infinity) - (b.photoMoment?.at ?? Infinity) ||
      a.id.localeCompare(b.id),
  );
}

function questionsForCapture(
  mogi: Mogi,
  capture: Capture,
  names: NameEvidence,
  grouping: NameGrouping,
  askedTeams: Set<string>,
): MogiQuestion[] {
  // An unrecognized screen with no legible name (a game error, a loading screen) holds nothing to ask about.
  if (blankUnknownScreen(capture)) return [];
  const occurrence = questionOccurrence(mogi, capture);
  const identity = jointNames(mogi, capture, captureNameAssociations(capture), occurrence.people, false, names);
  const questions: MogiQuestion[] = [];
  const finishOrderSize = finishOrderSizeQuestion(mogi, capture, occurrence);
  if (finishOrderSize) questions.push(finishOrderSize);
  const race = raceQuestion(mogi, capture, occurrence);
  if (race) questions.push(race);
  questions.push(
    ...nameQuestions(mogi, capture, occurrence, identity, grouping),
    ...pointsQuestions(mogi, capture, occurrence, identity.associations),
    ...captureTeamQuestions(mogi, capture, occurrence, identity.associations, askedTeams),
  );
  return questions;
}

function roomOrderQuestion(mogi: Mogi): SequenceQuestion | undefined {
  const order = mogi.sequence?.roomAnalysis?.order;
  if (!order) return;
  const ids = [...order.captureIds].sort();
  return {
    id: `room-order:${ids.join(":")}`,
    kind: "sequence",
    captureId: ids[0],
    row: 0,
    reading: "Which came first?",
    crop: { captureId: ids[0] },
    suggestion: ids[0],
    options: ids.map((id) => {
      const source = mogi.captures!.find((c) => c.id === id)!;
      return {
        value: id,
        label:
          "fileName" in source && typeof source.fileName === "string"
            ? source.fileName
            : `Screenshot ${mogi.captures!.indexOf(source) + 1}`,
        answer: { kind: "room-order" as const, firstCaptureId: id },
      };
    }),
  };
}

function finishOrderSizeQuestion(
  mogi: Mogi,
  capture: Capture,
  { race, number }: QuestionOccurrence,
): SequenceQuestion | undefined {
  const extents =
    ((capture.interpretation?.screen === "unknown" && !capture.interpretation.represented) ||
      roomSizeNeedsAnswer(mogi, capture)) &&
    capture.numericRows?.length
      ? FINISH_ORDER_SIZES.filter((extent) => {
          const interpretation = interpretRightList(
            capture.numericRows!,
            capture.interpretation!.positions,
            capture.interpretation!.movementRows,
            capture.rows,
            extent,
          );
          return interpretation.screen === "finishOrderAdding" || interpretation.screen === "finishOrderAdded";
        })
      : [];
  if (!extents.length) return;
  return {
    id: `representation:${capture.id}`,
    kind: "sequence",
    captureId: capture.id,
    raceId: race?.id,
    number,
    row: 0,
    reading: "How many players were in this race?",
    crop: { captureId: capture.id },
    suggestion: null,
    options: extents.map((value) => ({
      value: String(value),
      label: `${value} players`,
      answer: { kind: "representation", captureId: capture.id, value },
    })),
  };
}

/** Races photographed before this capture: the highest counted number, or the result screens before it. */
function numberBefore(mogi: Mogi, capture: Capture): number {
  const at = capture.photoMoment?.at;
  if (at === undefined) return 0;
  const earlier = (mogi.captures ?? []).filter((other) => (other.photoMoment?.at ?? Infinity) < at);
  const results = earlier.filter(
    (other) =>
      contextPhase(other) === "after" && screenProperties(other.interpretation?.screen)?.order === "finishOrder",
  );
  // A pre-race screen of race n only shows that n - 1 races were run.
  return Math.max(
    results.length,
    ...mogi.races
      .filter((race) => race.status !== "discarded")
      .flatMap((race) =>
        earlier
          .filter((other) => race.captureIds?.includes(other.id))
          .map((other) => (raceNumber(mogi, race) ?? 0) - (contextPhase(other) === "before" ? 1 : 0)),
      ),
  );
}

/** No RuleCode while pending: suggest one race first, then list every other free number in numeric order. */
export function suggestedRaceFirst<T extends { value: number }>(options: T[], suggestion: number): T[] {
  return [...options].sort(
    (a, b) => Number(b.value === suggestion) - Number(a.value === suggestion) || a.value - b.value,
  );
}

/** No RuleCode while pending: pre-race and result sources occupy separate slots of a race. */
export function freeRaceOptions(mogi: Mogi, capture: Capture): { value: number; label: string }[] {
  // A race has a slot before it and one after it: a pre-race screen and a result screen don't take each other's.
  const before = contextPhase(capture) === "before";
  const fills = (race: Mogi["races"][number]) =>
    race.captureIds?.some((id) => {
      const source = mogi.captures?.find((other) => other.id === id);
      return !!source && (contextPhase(source) === "before") === before;
    }) ||
    (!before && race.status !== "pending" && !race.captureIds?.length);
  const occupied = new Set(
    mogi.races.filter((race) => race.status !== "discarded" && fills(race)).map((race) => raceNumber(mogi, race)),
  );
  const options = raceNumbers()
    .filter((value) => !occupied.has(value))
    .map((value) => ({ value, label: `Race ${value}` }));
  return options;
}

/** No RuleCode while pending: a reopened room asks on its first capture, with the suggestion first. */
export function reopenedRoomQuestion(
  mogi: Mogi,
  capture: Capture,
  session: RoomAnalysis["sessions"][number],
  options: { value: number; label: string }[],
): RaceQuestion | undefined {
  const roomAnalysis = mogi.sequence?.roomAnalysis;
  // A reopened room session is asked once, on its first capture.
  if (session.captureIds[0] !== capture.id) return;
  // Without legible totals to bound it, the session can still be any free race: asking keeps it from getting stuck.
  const bounded = session.candidates?.length
    ? session.candidates.map((value) => ({ value, label: `Race ${value}` }))
    : options;
  // Earlier free numbers can place the group before the preceding room.
  const firstLocal = roomAnalysis?.captures.find((entry) => entry.captureId === capture.id)?.j;
  const previous = session.candidates?.length && firstLocal !== undefined ? session.candidates[0] - firstLocal : 0;
  const candidates = [
    ...bounded,
    ...options.filter(
      (option) => option.value <= previous && !bounded.some((candidate) => candidate.value === option.value),
    ),
  ];
  if (!candidates.length) return;
  const after = numberBefore(mogi, capture);
  const suggestion =
    session.candidates?.length === 2
      ? session.candidates[1]
      : (bounded.find((option) => option.value > after) ?? bounded[0]).value;
  return {
    id: `race:${session.id}`,
    kind: "race",
    captureId: capture.id,
    row: 0,
    reading: "Which race is this?",
    options: suggestedRaceFirst(candidates, suggestion),
    suggestion,
    sessionCaptureIds: session.captureIds,
    crop: { captureId: capture.id },
  };
}

/** No RuleCode while pending: a capture without an established number keeps a race question. */
export function raceQuestion(
  mogi: Mogi,
  capture: Capture,
  { race, number }: QuestionOccurrence,
): RaceQuestion | undefined {
  const roomAnalysis = mogi.sequence?.roomAnalysis;
  // Once every total is confirmed, a capture that still fits no sum can only be placed by its race number.
  const confirmed = capture.rows.every((_, i) => capture.numericAnswers?.some((answer) => answer.row === i + 1));
  if (
    number !== undefined ||
    race?.status === "discarded" ||
    roomAnalysis?.order ||
    (roomAnalysis?.conflicts.includes(capture.id) && !confirmed)
  )
    return;
  const options = freeRaceOptions(mogi, capture);
  const session = roomAnalysis?.sessions.find(
    (s) => s.captureIds.includes(capture.id) && s.reopening && s.start === undefined,
  );
  if (session) return reopenedRoomQuestion(mogi, capture, session, options);
  const candidate = cumulativeNumber(capture);
  const inferred = options.some((option) => option.value === candidate) ? candidate : undefined;
  const hint = roomAnalysis?.captures.find((c) => c.captureId === capture.id)?.suggestion;
  if (!options.length && !inferred) return;
  const suggestion =
    inferred ??
    options.find((o) => o.value === hint)?.value ??
    options.find((o) => o.value > numberBefore(mogi, capture))?.value ??
    options[0].value;
  return {
    id: `race:${capture.id}`,
    kind: "race",
    captureId: capture.id,
    row: 0,
    reading: inferred ? `Is this race ${inferred}, or a reopening?` : "Which race is this?",
    options: inferred
      ? [
          { value: inferred, label: `Race ${inferred}` },
          { value: "reopening", label: "A reopening" },
          { value: "another", label: "Another race" },
        ]
      : suggestedRaceFirst(options, suggestion),
    ...(inferred ? { otherRaces: options } : {}),
    suggestion,
    crop: { captureId: capture.id },
  };
}

function nameQuestions(
  mogi: Mogi,
  capture: Capture,
  { race, number, people }: QuestionOccurrence,
  identity: JointNames,
  grouping: NameGrouping,
): NameQuestion[] {
  const { associations } = identity;
  const questions: NameQuestion[] = [];
  const askedGroups = new Set<string>();
  const eligible = new Set(people.map((person) => person.id));
  associations.forEach((answer, rowIndex) => {
    if (answer.participantId && eligible.has(answer.participantId)) return;
    const identityRow = identity.rows[rowIndex];
    if (askedGroups.has(identityRow.group)) return;
    askedGroups.add(identityRow.group);
    const members = identity.rows.flatMap((entry, index) =>
      entry.group === identityRow.group && !associations[index].participantId ? [index] : [],
    );
    // The same pair/trio picks the same spelling across captures, even when its order changes.
    // That way spelling grouping counts the answer without carrying a name over to the teammate.
    const group = JSON.stringify([
      people.map((person) => person.id).sort(),
      identityRow.options.map((person) => person.id).sort(),
      members.map((index) => spelling(capture.rows[index].text)).sort(),
    ]);
    const preferred = grouping.representatives.get(group) ?? spelling(capture.rows[rowIndex].text);
    grouping.representatives.set(group, preferred);
    const index = members.find((index) => spelling(capture.rows[index].text) === preferred) ?? rowIndex;
    const row = capture.rows[index];
    if (!row) return;
    const selectedIdentity = identity.rows[index];
    const id = `name:${capture.id}:${index + 1}`;
    const teamId = selectedIdentity.options[0]?.teamId;
    if (
      members.length > 1 &&
      teamId &&
      selectedIdentity.options.length <= teamSizes[mogi.format] &&
      selectedIdentity.options.every((person) => person.teamId === teamId)
    )
      grouping.teams.set(
        id,
        JSON.stringify([
          people.map((person) => person.id).sort(),
          selectedIdentity.options.map((person) => person.id).sort(),
        ]),
      );
    grouping.impacts.set(id, selectedIdentity.impact);
    // A reading the user unlinked from a full room can only belong to someone already linked, most often a
    // teammate whose name was swapped with it: those teammates are offered too, and answering moves them.
    const teammates = members.some((index) => associations[index].unlinked)
      ? people.filter(
          (person) =>
            person.teamId &&
            !selectedIdentity.options.some((option) => option.id === person.id) &&
            selectedIdentity.options.some((option) => option.teamId === person.teamId),
        )
      : [];
    const options = [...selectedIdentity.options, ...teammates].map(({ id, loungeName }) => ({ id, loungeName }));
    questions.push({
      id,
      kind: "name",
      captureId: capture.id,
      row: index + 1,
      raceId: race?.id,
      number,
      reading: row.text,
      options,
      occurrences: [],
      suggestion: selectedIdentity.suggestion,
      crop: { captureId: capture.id, location: row.location },
    });
  });
  return questions;
}

/** points.out-of-range: no game total outgrows an earlier screen's by more than fifteen points for every race left
 * after it, so such a reading is never suggested. An earlier screen's totals stand at the latest after its race. */
function beyondReach(mogi: Mogi, capture: Capture, row: number, value: number): boolean {
  const id = capture.nameAssociations?.[row - 1]?.participantId;
  if (!id) return false;
  const races = MAX_COUNTED_RACES + mogi.races.filter((race) => race.status === "discarded").length;
  const number = questionOccurrence(mogi, capture).number,
    at = capture.photoMoment?.at;
  return (mogi.captures ?? []).some((other) => {
    const earlier = questionOccurrence(mogi, other).number;
    const before =
      earlier !== undefined &&
      (number !== undefined ? earlier < number : at !== undefined && (other.photoMoment?.at ?? Infinity) < at);
    const index = other.nameAssociations?.findIndex((answer) => answer.participantId === id) ?? -1;
    if (other.id === capture.id || !before || index < 0) return false;
    const reading = other.numericRows?.find((entry) => entry.row === index + 1)?.right;
    const total =
      other.numericAnswers?.find((answer) => answer.row === index + 1)?.value ??
      (reading && !reading.uncertain ? reading.value : null);
    return total != null && value > total + MAX_POINTS_PER_RACE * (races - (earlier - 1));
  });
}

function pointsQuestions(
  mogi: Mogi,
  capture: Capture,
  { race, number, people }: QuestionOccurrence,
  associations: NameAssociation[],
): PointsQuestion[] {
  // Before race 1 every total is zero: there is nothing to check.
  if (number === 1 && contextPhase(capture) === "before") return [];
  const roomAnalysis = mogi.sequence?.roomAnalysis;
  const entry = roomAnalysis?.captures.find((c) => c.captureId === capture.id);
  const pointRows = new Set([
    ...(entry?.conflictRows ??
      // A capture that fits no sum asks each row once: a confirmed total isn't asked again.
      (roomAnalysis?.conflicts.includes(capture.id)
        ? capture.rows
            .map((_, i) => i + 1)
            .filter((row) => !capture.numericAnswers?.some((answer) => answer.row === row))
        : [])),
    ...captureNumericQuestions(capture).map((numeric) => numeric.row),
    ...(race ? cumulativeRacePointRows(mogi, race, capture) : []),
  ]);
  return [...pointRows].map((rowNumber) => {
    const numeric = capture.numericRows?.find((numeric) => numeric.row === rowNumber);
    const row = capture.rows[rowNumber - 1];
    const person = people.find((person) => person.id === associations[rowNumber - 1]?.participantId);
    const answer = capture.numericAnswers?.find((answer) => answer.row === rowNumber)?.value;
    const fits = entry?.values.find((value) => value.row === rowNumber)?.value;
    // points.out-of-range: a total the other totals contradict is never suggested, read or confirmed.
    const contradicted = !!entry?.conflictRows?.includes(rowNumber);
    const read = numeric?.right.value ?? null;
    const readable = read !== null && !beyondReach(mogi, capture, rowNumber, read);
    // Stored and fitted values are the right-hand column; the question speaks of the screenshot's total.
    const addition = screenAddition(capture, rowNumber);
    const shown = (value: number | null) => (value === null ? null : value + addition);
    return {
      id: `points:${capture.id}:${rowNumber}`,
      kind: "points",
      captureId: capture.id,
      row: rowNumber,
      raceId: race?.id,
      number,
      reading: person?.loungeName ?? row?.text ?? `Row ${rowNumber}`,
      // A contradicted answer is withdrawn quietly: the question returns empty.
      suggestion: shown(
        contradicted
          ? answer === undefined && fits !== undefined && fits !== read
            ? fits
            : null
          : (answer ?? fits ?? (readable ? read : null)),
      ),
      read: shown(read),
      crop: { captureId: capture.id, location: row?.location },
    };
  });
}

/** A missing team is asked once per person, on the first capture that names them. */
function captureTeamQuestions(
  mogi: Mogi,
  capture: Capture,
  { race, number, people }: QuestionOccurrence,
  associations: NameAssociation[],
  askedTeams: Set<string>,
): TeamQuestion[] {
  if (mogi.format === "FFA" || !mogi.teams?.length) return [];
  const questions: TeamQuestion[] = [];
  associations.forEach((answer, index) => {
    const person = people.find((person) => person.id === answer.participantId);
    if (!person || mogi.teams!.some((team) => team.id === person.teamId) || askedTeams.has(person.id)) return;
    askedTeams.add(person.id);
    questions.push({
      id: `team:${person.id}`,
      kind: "team",
      participantId: person.id,
      reading: person.loungeName,
      captureId: capture.id,
      row: index + 1,
      number,
      raceId: race?.id,
      ...teamChoices(mogi, person),
      crop: { captureId: capture.id, location: capture.rows[index]?.location },
    });
  });
  return questions;
}

/** Missing teams no capture names, by roster row. */
function rosterTeamQuestions(mogi: Mogi, askedTeams: Set<string>): TeamQuestion[] {
  if (mogi.format === "FFA" || !mogi.teams?.length) return [];
  return [...mogi.participants.entries()]
    .filter(([, person]) => !person.teamId && !askedTeams.has(person.id))
    .map(([index, person]) => ({
      id: `team:${person.id}`,
      kind: "team",
      participantId: person.id,
      reading: person.loungeName,
      row: index + 1,
      ...teamChoices(mogi, person),
    }));
}

/** The position question is the last resort: when a screenshot bounding the race hides the total of someone whose
 * place is in doubt, the points question on that row asks the total instead, and the place follows from it. */
function positionQuestion(mogi: Mogi, asked: MogiQuestion[]): PositionQuestion | undefined {
  const position = usefulQuestion(mogi);
  if (!position) return;
  const race = mogi.races.find((race) => race.id === position.raceId)!;
  if (totalOnScreenshot(mogi, race, position, asked)) return;
  const occupied = new Set(
    mogi.assistance?.facts.filter((fact) => fact.raceId === race.id).map((fact) => fact.position),
  );
  const options: PositionQuestion["options"] = raceNumbers()
    .filter((value) => !occupied.has(value))
    .map((value) => ({ value, label: ordinal(value) }));
  options.push({ value: "absent", label: "Absent from the results" });
  const example = position.hypotheses[0].results.find((result) => result.raceId === race.id);
  const place = example?.placements.indexOf(position.participantId) ?? -1;
  const suggested = place < 0 ? "absent" : place + 1;
  return {
    id: `position:${position.key}`,
    kind: "position",
    raceId: race.id,
    number: raceNumber(mogi, race),
    row: 0,
    participantId: position.participantId,
    reading: mogi.participants.find((person) => person.id === position.participantId)!.loungeName,
    options,
    suggestion: options.some((option) => option.value === suggested) ? suggested : (options[0]?.value ?? null),
  };
}

function totalOnScreenshot(mogi: Mogi, race: Race, position: UsefulQuestion, asked: MogiQuestion[]): boolean {
  const bounds = new Set([
    ...(race.reconstruction?.sourceCaptureIds ?? []),
    ...(race.reconstruction?.boundaryAnalysis?.sourceCaptureIds ?? []),
  ]);
  const places = (id: string) =>
    new Set(
      position.hypotheses.map((hypothesis) =>
        hypothesis.results.find((result) => result.raceId === race.id)?.placements.indexOf(id),
      ),
    );
  return asked.some((question) => {
    if (question.kind !== "points" || !bounds.has(question.captureId)) return false;
    const capture = mogi.captures?.find((capture) => capture.id === question.captureId);
    const id = capture && captureNameAssociations(capture)[question.row - 1]?.participantId;
    return !!id && places(id).size > 1;
  });
}

/** Continuity, validity and person-continuity questions between two captures. */
function contextSequenceQuestions(mogi: Mogi, captures: Capture[]): SequenceQuestion[] {
  const roomAnalysis = mogi.sequence?.roomAnalysis;
  const questions: SequenceQuestion[] = [];
  for (const descriptor of contextQuestions(mogi, ["continuity", "validity", "person-continuity"])) {
    if (
      roomAnalysis?.order &&
      descriptor.captureIds.every((id) => roomAnalysis.captures.some((c) => c.captureId === id))
    )
      continue;
    if (
      descriptor.kind === "continuity" &&
      descriptor.captureIds.some((id) =>
        roomAnalysis?.captures.some((c) => c.captureId === id && c.conflictRows?.length),
      )
    )
      continue;
    // A totals drop asks only for the new group's number; that answer decides reopening versus an earlier race.
    if (
      descriptor.kind === "continuity" &&
      descriptor.captureIds.some((id) => {
        const entry = roomAnalysis?.captures.find((entry) => entry.captureId === id);
        const session = roomAnalysis?.sessions.find((session) => session.id === entry?.sessionId);
        return (
          session?.reopening &&
          descriptor.captureIds.some((otherId) =>
            roomAnalysis?.captures.some((other) => other.captureId === otherId && other.sessionId !== session.id),
          )
        );
      })
    )
      continue;
    const capture = captures.find((capture) => capture.id === descriptor.captureIds[0]);
    if (!capture) continue;
    // Continuity refers to the accepted people: settling the names first avoids
    // signing an answer that each following association would make stale.
    if (
      descriptor.kind === "continuity" &&
      descriptor.captureIds.some((id) => {
        const source = captures.find((source) => source.id === id);
        return (
          !source ||
          captureNameAssociations(source).some(
            (answer) =>
              !answer.participantId ||
              !questionOccurrence(mogi, source).people.some((person) => person.id === answer.participantId),
          )
        );
      })
    )
      continue;
    const link = mogi.sequence?.links.find(
      (link) => descriptor.captureIds.includes(link.fromCaptureId) && descriptor.captureIds.includes(link.toCaptureId),
    );
    const from = captures.find((capture) => capture.id === link?.fromCaptureId),
      to = captures.find((capture) => capture.id === link?.toCaptureId);
    if (
      link &&
      from &&
      to &&
      link.signature === sourcePairSignature(from, to) &&
      (descriptor.kind === "continuity"
        ? link.continuity !== undefined
        : descriptor.kind === "validity"
          ? link.validity !== undefined
          : link.people?.some((person) => person.participantId === descriptor.participantId))
    )
      continue;
    const { race, number } = questionOccurrence(mogi, capture);
    questions.push({
      id: descriptor.id,
      kind: "sequence",
      captureId: capture.id,
      captureIds: descriptor.captureIds,
      raceId: race?.id,
      number,
      row: 0,
      reading:
        descriptor.kind === "person-continuity"
          ? `Did “${mogi.participants.find((person) => person.id === descriptor.participantId)?.loungeName}” restart their points between these screenshots?`
          : descriptor.kind === "validity"
            ? "Did the missing races count for this mogi?"
            : "Did everyone keep their points between these screenshots?",
      options: contextSequenceOptions(descriptor),
      suggestion: null,
      crop: { captureId: capture.id },
    });
  }
  return questions;
}

function contextSequenceOptions(descriptor: ContextQuestion): SequenceQuestion["options"] {
  if (descriptor.kind === "person-continuity")
    return [
      {
        value: "reset",
        label: "Their points restarted",
        answer: {
          kind: "person-continuity",
          fromCaptureId: descriptor.captureIds[0],
          toCaptureId: descriptor.captureIds[1],
          participantId: descriptor.participantId!,
          value: "reset",
        },
      },
      {
        value: "unknown",
        label: "Continuity is unknown",
        answer: {
          kind: "person-continuity",
          fromCaptureId: descriptor.captureIds[0],
          toCaptureId: descriptor.captureIds[1],
          participantId: descriptor.participantId!,
          value: "unknown",
        },
      },
    ];
  if (descriptor.kind === "validity")
    return [
      {
        value: "counted",
        label: "All counted",
        answer: { kind: "validity", gapId: descriptor.gapId!, value: "counted" },
      },
      {
        value: "discarded",
        label: "None counted",
        answer: { kind: "validity", gapId: descriptor.gapId!, value: "discarded" },
      },
    ];
  return [
    {
      value: "continuous-12",
      label: "Yes, points carried over",
      answer: { kind: "continuity", gapId: descriptor.gapId!, value: "continuous-12" },
    },
    {
      value: "reset",
      label: "No, the room reopened",
      answer: { kind: "continuity", gapId: descriptor.gapId!, value: "reset" },
    },
  ];
}

function creditQuestions(mogi: Mogi): CreditQuestion[] {
  return pendingCreditSlots(mogi).flatMap((slot) => {
    const suggestion = creditSuggestion(mogi, slot.id);
    if (!suggestion) return [];
    return [
      {
        id: `credit:${slot.id}`,
        kind: "credit" as const,
        slotId: slot.id,
        reading: slot.loungeName,
        row: rosterSlots(mogi).findIndex((person) => person.id === slot.id),
        options: participationMembers(mogi, slot.id).map((person) => ({ value: person.id, label: person.loungeName })),
        suggestion: suggestion.participantId,
        reason: suggestion.reason,
      },
    ];
  });
}

/** Each ID is one page, even when several projections generate it; the first one wins. */
function uniqueQuestions(questions: MogiQuestion[]): MogiQuestion[] {
  const ids = new Set<string>();
  return questions.filter((question) => {
    if (ids.has(question.id)) return false;
    ids.add(question.id);
    return true;
  });
}

/** Every source one answer affects, unless the question already lists them. */
function affectedCaptureIds(mogi: Mogi, question: MogiQuestion, captures: Capture[]): string[] {
  const roomAnalysis = mogi.sequence?.roomAnalysis;
  return question.kind === "race" && question.sessionCaptureIds
    ? question.sessionCaptureIds
    : question.kind === "sequence" && roomAnalysis?.order
      ? roomAnalysis.captures.filter((c) => c.number === undefined).map((c) => c.captureId)
      : question.kind === "team"
        ? captures
            .filter((c) => captureNameAssociations(c).some((a) => a.participantId === question.participantId))
            .map((c) => c.id)
        : question.captureId
          ? [question.captureId]
          : question.raceId
            ? captures.filter((c) => questionOccurrence(mogi, c).race?.id === question.raceId).map((c) => c.id)
            : [];
}

/** One name question per spelling among captures with the same eligible people; the first in queue order stands for the rest. */
function groupSpellings(mogi: Mogi, ordered: MogiQuestion[], captures: Capture[], names: NameEvidence): MogiQuestion[] {
  const spellings = new Map<string, NameQuestion>();
  return ordered.filter((question) => {
    if (question.kind !== "name") return true;
    const key = names.spellingKey(question.reading);
    const capture = captures.find((capture) => capture.id === question.captureId)!;
    // Empty spellings, or spellings repeated within one capture, need one answer per row.
    if (!key || capture.rows.filter((row) => names.spellingKey(row.text) === key).length !== 1) return true;
    const group = JSON.stringify([
      key,
      questionOccurrence(mogi, capture)
        .people.map((person) => person.id)
        .sort(),
    ]);
    const representative = spellings.get(group);
    if (!representative) {
      spellings.set(group, question);
      return true;
    }
    representative.occurrences.push({ captureId: question.captureId, row: question.row, number: question.number });
    representative.captureIds = [...new Set([...representative.captureIds!, ...question.captureIds!])];
    return false;
  });
}

/** Rows of one team, asked once across captures; the first in queue order stands for the rest. */
function groupNameTeams(questions: MogiQuestion[], teams: Map<string, string>): MogiQuestion[] {
  const asked = new Map<string, MogiQuestion>();
  return questions.filter((question) => {
    const group = teams.get(question.id);
    if (!group) return true;
    const representative = asked.get(group);
    if (representative) {
      representative.captureIds = [...new Set([...representative.captureIds!, ...question.captureIds!])];
      return false;
    }
    asked.set(group, question);
    return true;
  });
}

/**
 * Name questions keep the queue places they hold; within each race, the name with the
 * highest `nameClarity` takes the first of them, counting repeated spellings.
 */
function orderNamesByClarity(questions: MogiQuestion[], impacts: Map<string, number>): MogiQuestion[] {
  const byRace = new Map<number, NameQuestion[]>();
  for (const question of questions)
    if (question.kind === "name") {
      const key = question.number ?? Infinity;
      const bucket = byRace.get(key) ?? [];
      bucket.push(question);
      byRace.set(key, bucket);
    }
  for (const bucket of byRace.values())
    bucket.sort((a, b) => nameClarity(b, impacts.get(b.id)) - nameClarity(a, impacts.get(a.id)));
  return questions.map((question) =>
    question.kind === "name" ? byRace.get(question.number ?? Infinity)!.shift()! : question,
  );
}

/** Records how many questions each uncounted capture still waits on, for the capture explanation. */
function recordPendingQuestions(mogi: Mogi, roomAnalysis: RoomAnalysis, captures: Capture[], queue: MogiQuestion[]) {
  const counted = new Set(countedRaces(mogi).map((race) => race.id));
  const pending: CaptureExplanationStep[] = captures.flatMap((capture) => {
    const race = questionOccurrence(mogi, capture).race;
    if (race && (race.status === "discarded" || counted.has(race.id))) return [];
    const questions = queue.filter((question) => question.captureIds?.includes(capture.id));
    return questions.length
      ? [
          {
            kind: "pending",
            subject: capture.id,
            value: questions.length,
            origin: "deduced",
            rule: "pending.question",
            evidence: { questionId: questions[0].id },
          },
        ]
      : [];
  });
  recordRoomExplanation(roomAnalysis, [
    ...roomExplanationSteps(roomAnalysis).filter((step) => step.kind !== "pending"),
    ...pending,
  ]);
}
