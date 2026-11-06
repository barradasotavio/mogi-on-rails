import assert from "node:assert/strict";
import { test } from "node:test";

import { validateTracker } from "./validation.ts";

const roster = `Tier D\n${Array.from({ length: 12 }, (_, index) => `${index + 1}. Piloto ${index + 1}`).join("\n")}`;
const reading = (value: number) => ({
  text: String(value),
  value,
  confidence: 99,
  uncertain: false,
  location: { x: 1115, y: 48, width: 65, height: 58 },
});

/** The state a restored backup holds: one fresh mogi plus one pending finish-order capture. */
function state() {
  const participants = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    loungeName: `Piloto ${i + 1}`,
    ign: `Piloto ${i + 1}`,
  }));
  return {
    version: 1,
    activeMogiId: "m",
    mogis: [
      {
        id: "m",
        name: "Mogi Tier D",
        format: "FFA",
        createdAt: "2026-10-28T00:00:00.000Z",
        submissionTier: "D",
        originalList: roster,
        participants,
        races: [
          {
            id: "question-race",
            origin: "observed",
            number: 2,
            status: "pending",
            placements: [],
            captureIds: ["capture"],
          },
        ],
        captures: [
          {
            id: "capture",
            fileName: "finish-order-totals.jpeg",
            width: 1920,
            height: 1080,
            original: new Blob(["jpeg"], { type: "image/jpeg" }),
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
            rows: participants.map((person, i) => ({
              text: person.ign,
              confidence: 90,
              uncertain: false,
              suggestedParticipantId: person.id,
              location: { x: 1270, y: 50 + i * 77, width: 385, height: 56 },
            })),
            nameAssociations: participants.map((person) => ({ participantId: person.id })),
          },
        ],
      },
    ],
  };
}

type State = ReturnType<typeof state>;
function refuses(change: (state: State) => void, message: RegExp) {
  const malformed = state();
  change(malformed);
  assert.throws(() => validateTracker(malformed), message);
}

test("the fixture state is valid, so each refusal below comes from its single change", () => {
  validateTracker(state());
});

test("restore refuses invalid photo moments and receipt times", () => {
  for (const fields of [
    { photoMoment: { at: 1234, source: "download" } },
    { photoMoment: { at: "1234", source: "exif" } },
    { photoMoment: { at: 1.5, source: "pasted" } },
    { photoMoment: { at: 9e15, source: "exif" } },
    { receivedAt: -1 },
    { pastedAt: "yesterday" },
  ])
    refuses((s) => Object.assign(s.mogis[0].captures[0], fields), /Photo moment|Screenshot received|Screenshot pasted/);
});

test("restore refuses screen properties that contradict the screen or its moment", () => {
  for (const [interpretation, phase] of [
    [{ screen: "teamStandings", positions: [], order: "finishOrder", cumulative: "unsettled" }, "after"],
    [{ screen: "teamStandings", positions: [] }, "event-final"],
    [{ screen: "finishOrderAdded", order: "general" }, "after"],
    [{ screen: "finishOrderAdded", positions: [] }, "after"],
    [{ screen: "unrecognized-screen" }, "after"],
  ] as const)
    refuses((s) => {
      const capture = s.mogis[0].captures[0];
      Object.assign(capture.interpretation, interpretation);
      capture.context = { phase } as typeof capture.context;
    }, /Invalid screenshot interpretation|Context phase does not match/);
});

test("restore refuses a race track outside the track list", () => {
  const manual = (s: State) => {
    const mogi = s.mogis[0] as Omit<State["mogis"][0], "races" | "captures"> & {
      races: Record<string, unknown>[];
      captures?: unknown;
    };
    delete mogi.captures;
    mogi.races = [
      {
        id: "race-1",
        origin: "manual",
        number: 1,
        track: "CC",
        placements: mogi.participants.map((person) => person.id),
      },
    ];
    return mogi.races[0];
  };
  validateTracker(((s) => (manual(s), s))(state()));
  for (const track of [42, null, "", "not-a-track", "Crown City"])
    refuses((s) => {
      manual(s).track = track;
    }, /^Error: Invalid race track\.$/);
});

test("restore refuses an original list that is not non-empty text up to 10,000 characters", () => {
  for (const invalid of [42, "", "x".repeat(10001)])
    refuses((s) => {
      (s.mogis[0] as Record<string, unknown>).originalList = invalid;
    }, /Original list/);
});
