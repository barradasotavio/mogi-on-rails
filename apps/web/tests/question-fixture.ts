import { readFileSync } from "node:fs";

import { assistanceTargets, setAssistanceAnalysis, solveAssistance } from "@mkw/engine";

import type { TrackerState } from "@/lib/mogi/types";

import { inferenceFixture } from "../../../packages/engine/tests/support/mogi";
import type { Loose } from "./mogi-state";

// Question fixtures for `restoreState` (./mogi-state), without simulating OCR. Each takes the state from `mogiState`
// and returns a new one; the first mogi gets the questions.
const jpeg = () =>
  new Blob([readFileSync(new URL("./fixtures/spec29/finish-order-totals.jpeg", import.meta.url))], {
    type: "image/jpeg",
  });

/** A finish order with `unresolved` pending identities, and the same screen again in each of `otherRaces`. */
export function nameQuestions(
  state: TrackerState,
  otherRaces: (number | undefined)[] = [2],
  unresolved = 2,
  decreases = false,
): TrackerState {
  const next: TrackerState = {
    ...structuredClone({ ...state, mogis: [] }),
    mogis: state.mogis.map((mogi) => ({ ...mogi })),
    sharedReceipts: [],
  };
  const mogi: Loose = (next.mogis[0] = structuredClone({ ...next.mogis[0], captures: undefined }));
  delete mogi.captureReview;
  delete mogi.sequence;
  const original = jpeg();
  const reading = (value: number) => ({
    text: String(value),
    value,
    confidence: 99,
    uncertain: false,
    location: { x: 1115, y: 48, width: 65, height: 58 },
  });
  mogi.races.push({
    id: "question-race",
    origin: "observed",
    number: 2,
    status: "pending",
    placements: [],
    captureIds: ["question-capture"],
  });
  mogi.captures = [
    {
      id: "question-capture",
      fileName: "finish-order-totals.jpeg",
      width: 1920,
      height: 1080,
      stage: "context",
      context: { phase: "after", raceId: "question-race" },
      reviewedAt: "2026-10-28",
      reviewedPlacements: [],
      interpretation: {
        version: 1,
        screen: "finishOrderAdded",
        origin: "visual",
        positions: Array.from({ length: 12 }, (_, i) => reading(i + 1)),
        movementRows: [],
        reasons: [],
      },
      rows: mogi.participants.map((person: { id: string; ign: string }, i: number) => ({
        text: i < unresolved ? `Reading ${i + 1}` : person.ign,
        confidence: 90,
        uncertain: i < unresolved,
        suggestedParticipantId: person.id,
        location: { x: 1270, y: 50 + i * 77, width: 385, height: 56 },
      })),
      nameAssociations: mogi.participants.map((person: { id: string }, i: number) => ({
        participantId: i < unresolved ? null : person.id,
      })),
      original,
    },
  ];
  otherRaces.forEach((number, i) => {
    const repeated = {
      ...structuredClone({ ...mogi.captures[0], original: null }),
      original,
      id: i === 0 ? "repeat-capture" : `repeat-capture-${i}`,
    };
    const raceId = number === 2 ? "question-race" : `repeat-race-${number}`;
    repeated.context = { phase: "after", ...(number === undefined ? {} : { raceId }) };
    if (number !== undefined) {
      const race = mogi.races.find((entry: { id: string }) => entry.id === raceId);
      if (race) race.captureIds.push(repeated.id);
      else
        mogi.races.push({
          id: raceId,
          origin: "observed",
          number,
          status: "pending",
          placements: [],
          captureIds: [repeated.id],
        });
    }
    mogi.captures.push(repeated);
  });
  // A single shared decrease justifies the reopening question without a complete vector.
  if (decreases)
    mogi.captures.forEach((capture: Loose, index: number) => {
      capture.interpretation.screen = "finishOrderAdding";
      capture.numericRows = Array.from({ length: 12 }, (_, row) => ({
        row: row + 1,
        right: reading(row === 0 ? 100 - index : 0),
        addition: { ...reading(0), text: "", value: null, uncertain: true },
      }));
    });
  return next;
}

/** One question of `kind` besides names; reconstruction numbers are a mathematical construction. */
export async function otherQuestion(
  state: TrackerState,
  kind: "race" | "points" | "position" | "team" | "sequence",
): Promise<TrackerState> {
  const next = nameQuestions(state, [2], 2, kind === "sequence");
  const mogi: Loose = next.mogis[0];
  const capture = mogi.captures[0];
  mogi.captures = [capture];
  mogi.races.find((race: { id: string }) => race.id === "question-race").captureIds = [capture.id];
  capture.nameAssociations = mogi.participants.map((person: { id: string }) => ({ participantId: person.id }));
  if (kind === "race") {
    mogi.races = mogi.races.filter((race: { id: string }) => race.id !== "question-race");
    capture.context = { phase: "after" };
    // A race-2 screen has its own order: one that repeats race 1 exactly is race 1's result screen.
    [capture.nameAssociations[2], capture.nameAssociations[3]] = [
      capture.nameAssociations[3],
      capture.nameAssociations[2],
    ];
  } else if (kind === "points") {
    const reading = {
      text: "30",
      value: 30,
      confidence: 20,
      uncertain: true,
      location: { x: 1115, y: 48, width: 65, height: 58 },
    };
    capture.numericRows = Array.from({ length: 12 }, (_, i) => ({
      row: i + 1,
      right:
        i === 0
          ? reading
          : {
              ...reading,
              text: String([30, 24, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2][i]),
              value: [30, 24, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2][i],
              uncertain: i === 1,
              confidence: i === 1 ? 20 : 99,
            },
      addition: { ...reading, text: "", value: null },
    }));
  } else if (kind === "team") {
    mogi.format = "2v2";
    mogi.teams = Array.from({ length: 6 }, (_, i) => ({ id: `team-${i}`, name: `Team ${i + 1}` }));
    mogi.participants.forEach((person: { teamId?: string }, i: number) => {
      person.teamId = i === 0 ? undefined : `team-${Math.floor(i / 2)}`;
    });
  } else if (kind === "sequence") {
    const earlier = { ...structuredClone({ ...capture, original: null }), original: capture.original };
    earlier.id = "earlier-capture";
    earlier.context.raceId = mogi.races[0].id;
    mogi.races[0].captureIds = [earlier.id];
    earlier.numericRows[0].right.value = 100;
    earlier.numericRows[0].right.text = "100";
    capture.numericRows[0].right.value = 99;
    capture.numericRows[0].right.text = "99";
    mogi.captures.unshift(earlier);
  } else {
    const input = inferenceFixture(12, 4, [57, 51, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4]);
    const pending = setAssistanceAnalysis(input, await solveAssistance(input, assistanceTargets(input), []));
    next.mogis[0] = { ...pending, id: mogi.id, name: mogi.name, submissionTier: mogi.submissionTier } as Loose;
  }
  return next;
}

/** Synthetic vectors exercise room sessions: ordered rooms, a deduced total, or an unseen gap. */
export function roomQuestions(state: TrackerState, kind: "session" | "order" | "deduced" | "unseen"): TrackerState {
  const next = nameQuestions(state, []);
  const mogi: Loose = next.mogis[0],
    template = mogi.captures[0];
  const scale = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  mogi.races = Array.from({ length: kind === "session" ? 4 : 0 }, (_, i) => ({
    id: `prefix-${i + 1}`,
    number: i + 1,
    origin: "manual",
    status: "confirmed",
    placements: mogi.participants.map((p: { id: string }) => p.id),
  }));
  const entries =
    kind === "order"
      ? ([
          ["room-a-1", 1, 0],
          ["room-a-2", 2, 0],
          ["room-b-1", 1, 4],
          ["room-b-2", 2, 4],
        ] as const)
      : ([["room-a-1", kind === "session" ? 3 : kind === "unseen" ? 10 : 1, 0]] as const);
  mogi.captures = entries.map(([id, j, rotation]) => {
    const capture = { ...structuredClone({ ...template, original: null }), original: template.original };
    capture.id = id;
    capture.fileName = `${id}.jpeg`;
    capture.context = { phase: "after" };
    const people = [...mogi.participants.slice(rotation), ...mogi.participants.slice(0, rotation)];
    capture.rows = people.map((person: { id: string; ign: string }, i: number) => ({
      ...capture.rows[i],
      text: person.ign,
      suggestedParticipantId: person.id,
      uncertain: false,
    }));
    capture.nameAssociations = people.map((person: { id: string }) => ({ participantId: person.id }));
    const reading = (value: number) => ({
      text: String(value),
      value,
      confidence: 100,
      uncertain: false,
      location: { x: 1728, y: 50, width: 112, height: 56 },
    });
    capture.numericRows = scale.map((v, i) => ({
      row: i + 1,
      right: reading(j * v),
      addition: { ...reading(0), value: null, uncertain: true },
    }));
    if (kind === "deduced") capture.numericRows[0].right = { ...reading(0), text: "?", value: null, uncertain: true };
    return capture;
  });
  return next;
}

/** Only race 12 is known, with one absence: the room shrank and races 1–11 need images. */
export function shrunkRoom(state: TrackerState): TrackerState {
  const next = structuredClone(state);
  const mogi: Loose = next.mogis[0];
  delete mogi.captureReview;
  delete mogi.sequence;
  mogi.captures = [];
  const ids = mogi.participants.map((p: { id: string }) => p.id);
  mogi.races = [
    {
      id: "race-12",
      number: 12,
      origin: "manual",
      status: "confirmed",
      placements: ids.slice(0, 11),
      absentParticipantIds: ids.slice(11),
    },
  ];
  return next;
}

/** An unanchored trio and three readable trios. */
export function teamNameQuestions(state: TrackerState): TrackerState {
  const next = nameQuestions(state, [], 12);
  const mogi: Loose = next.mogis[0];
  const names = [
    "Northstar",
    "Waterfall",
    "Sunflower",
    "Dragonfly",
    "Moonbeam",
    "Evergreen",
    "Firestorm",
    "Bluebird",
    "Quicksilver",
    "Snowflake",
    "Sunshine",
    "Raindrop",
  ];
  mogi.format = "3v3";
  mogi.teams = Array.from({ length: 4 }, (_, i) => ({ id: `team-${i}`, name: `Team ${i + 1}` }));
  mogi.participants.forEach(
    (person: { loungeName: string; ign: string; ignOrigin: string; teamId: string }, i: number) => {
      person.loungeName = names[i];
      person.ign = names[i];
      person.ignOrigin = "fallback";
      person.teamId = `team-${Math.floor(i / 3)}`;
    },
  );
  mogi.captures[0].rows.forEach(
    (row: { text: string; uncertain: boolean; suggestedParticipantId: string }, i: number) => {
      row.text = i < 3 ? `A ${["?", "!", "*"][i]}` : `${["A", "B", "C", "E"][Math.floor(i / 3)]} ${names[i]}`;
      row.uncertain = true;
      row.suggestedParticipantId = mogi.participants[i].id;
    },
  );
  return next;
}
