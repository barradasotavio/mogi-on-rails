import assert from "node:assert/strict";
import { test } from "node:test";

import { answerImageQuestion, ingestCaptureReview } from "./ingestion.ts";
import { mogiOverview, mogiQuestions } from "./questions.ts";
import type { Mogi, TrackerState } from "./types.ts";

// Roster and readings from capture 1 of the real case, with synonyms learned only in A.
const names = [
  "VSPeach",
  "Kameks Eye",
  "funk2006",
  "toad67",
  "Tavo",
  "KingBoo",
  "pom",
  "DonkeyKong",
  "PiranhaPlant",
  "BloopMaster",
  "ActuFunk",
  "iggy",
];
const igns = [
  "CVSPeach",
  "VS Kamek",
  "KR♪Funk",
  "K toad67",
  "Tavo",
  "T KingBoo",
  "Diddy.",
  "DonkeyKong",
  "B·ω·",
  "Bloop",
  "Funky",
  "F☆ peepa",
];
const readings = [
  "CVSPeach",
  "F☆ peepa",
  "VS Kamek",
  "Diddy.",
  "KRJFunk",
  "TKingBoo",
  "Tavo",
  "Bloop",
  "Ktoad67",
  "Funky",
  "B·W-",
  "DonkeyKong",
];

function scenario(): TrackerState {
  const destination: Mogi = {
    id: "b",
    name: "Mogi B",
    format: "2v2",
    createdAt: "2026-10-29",
    races: [],
    participants: names.map((loungeName, i) => ({ id: `b${i}`, loungeName, ign: loungeName })),
    captureReview: {
      version: 1,
      id: "review",
      currentItemId: "item",
      items: [
        {
          id: "item",
          source: { fileId: "file" },
          number: 1,
          numberKnown: false,
          association: "new",
          status: "ready",
          recognition: {
            id: "capture",
            fileName: "race-1.jpeg",
            stage: "finish-order-confirmed",
            width: 1920,
            height: 1080,
            rows: readings.map((text, i) => ({
              text,
              confidence: i === 10 ? 63 : 100,
              uncertain: true,
              suggestedParticipantId: `b${i}`,
            })),
          },
        },
      ],
    },
  };
  const learned: Mogi = {
    ...destination,
    id: "a",
    name: "Mogi A",
    captureReview: undefined,
    participants: names.map((loungeName, i) => ({ id: `a${i}`, loungeName, ign: igns[i] })),
  };
  return {
    version: 1,
    activeMogiId: "b",
    mogis: [learned, destination],
    sharedReceipts: [
      {
        id: "receipt",
        receivedAt: "2026-10-29",
        rejections: [],
        files: [
          {
            id: "file",
            name: "race-1.jpeg",
            mimeType: "image/jpeg",
            lastModified: 0,
            original: new Blob(["image"], { type: "image/jpeg" }),
          },
        ],
      },
    ],
  };
}

test("the same roster accepts a capture even when only the other mogi learned the IGNs", () => {
  const result = ingestCaptureReview(scenario(), "b").mogis[1];
  assert.equal(result.captureReview, undefined);
  assert.equal(result.captures?.[0].id, "capture");
});

test("a capture keeps its moment and file receipt without inheriting another reading's time", () => {
  const state = scenario(),
    file = state.sharedReceipts![0].files[0];
  file.receivedAt = 1793293506000;
  file.photoMoment = { at: 1793108275000, source: "exif" };
  state.mogis[1].captureReview!.items[0].recognition!.photoMoment = { at: 1234, source: "file-date" };
  const capture = ingestCaptureReview(state, "b").mogis[1].captures![0];
  assert.deepEqual(capture.photoMoment, file.photoMoment);
  assert.equal(capture.receivedAt, 1793293506000);
});

test("an old diagnostic does not keep the same roster separate", () => {
  const state = scenario();
  state.mogis[1].captureReview!.items[0].separation = "Another roster identified: VSPeach, toad67, pom.";
  const result = ingestCaptureReview(state, "b").mogis[1];
  assert.equal(result.captureReview, undefined);
  assert.equal(result.captures?.[0].id, "capture");
});

test("a different roster must recognize three people absent from the destination", () => {
  for (const outsiders of [2, 3]) {
    const state = scenario();
    for (const index of [0, 1, 3].slice(0, outsiders))
      state.mogis[1].participants[index] = {
        ...state.mogis[1].participants[index],
        loungeName: `Other ${index}`,
        ign: `Other ${index}`,
      };
    const result = ingestCaptureReview(state, "b").mogis[1];
    assert.equal(result.captureReview?.items[0].separation, outsiders === 3 ? "Mogi A" : undefined);
    assert.equal(result.captures?.length ?? 0, outsiders === 3 ? 0 : 1);
  }
});

test("a finished mogi does not compete with the destination; discarding a race returns it to comparison", () => {
  const state = scenario();
  state.mogis[1].participants = state.mogis[1].participants.map((person) => ({
    ...person,
    loungeName: `Other ${person.id}`,
    ign: `Other ${person.id}`,
  }));
  state.mogis[0].races = Array.from({ length: 12 }, (_, i) => ({
    id: `r${i}`,
    number: i + 1,
    origin: "manual",
    placements: state.mogis[0].participants.map((person) => person.id),
  }));
  assert.equal(ingestCaptureReview(state, "b").mogis[1].captures?.length, 1);
  state.mogis[0] = {
    ...state.mogis[0],
    races: state.mogis[0].races.map((race, i) => (i === 11 ? { ...race, status: "discarded" } : race)),
  };
  assert.equal(ingestCaptureReview(state, "b").mogis[1].captureReview?.items[0].separation, "Mogi A");
});

test("confirmed synonyms count for both rosters regardless of the current IGN", () => {
  const state = scenario();
  state.mogis[1].participants = state.mogis[1].participants.map((person) => ({
    ...person,
    loungeName: `Other ${person.id}`,
    ign: `Other ${person.id}`,
  }));
  const learned = state.mogis[0];
  learned.captures = [
    {
      ...state.mogis[1].captureReview!.items[0].recognition!,
      id: "earlier",
      original: new Blob(),
      reviewedAt: "",
      reviewedPlacements: [],
      rows: igns.map((text, i) => ({ text, confidence: 100, uncertain: true, suggestedParticipantId: `a${i}` })),
      nameAssociations: learned.participants.map((person) => ({ participantId: person.id, ign: person.ign })),
    },
  ];
  learned.participants = learned.participants.map((person) => ({ ...person, ign: person.loungeName }));
  assert.equal(ingestCaptureReview(state, "b").mogis[1].captureReview?.items[0].separation, "Mogi A");
  // The destination also recognizes the same readings as its own people.
  state.mogis[1].captures = [
    {
      ...learned.captures[0],
      id: "destination-earlier",
      nameAssociations: state.mogis[1].participants.map((person, i) => ({ participantId: person.id, ign: igns[i] })),
    },
  ];
  assert.equal(ingestCaptureReview(state, "b").mogis[1].captureReview, undefined);
});

test("a separate image opens the queue and counts in the header even without a race", () => {
  const state = scenario();
  state.mogis[1].captureReview!.items[0].separation = "Mogi A";
  assert.equal(mogiQuestions(state.mogis[1])[0]?.kind, "image");
  assert.deepEqual(mogiOverview(state.mogis[1]).action, { kind: "questions", count: 1 });
});

test("the destination decision precedes questions for existing races", () => {
  const state = scenario(),
    mogi = state.mogis[1];
  mogi.captureReview!.items[0].separation = "Mogi A";
  mogi.races = [
    { id: "earlier-race", number: 1, origin: "manual", placements: mogi.participants.map((person) => person.id) },
  ];
  mogi.captures = [
    {
      ...mogi.captureReview!.items[0].recognition!,
      id: "earlier",
      original: new Blob(),
      reviewedAt: "",
      reviewedPlacements: [],
      stage: "context",
      context: { phase: "after", raceId: "earlier-race" },
      rows: [{ text: "Unknown", confidence: 60, uncertain: true, suggestedParticipantId: "b0" }],
      nameAssociations: [{ participantId: null }],
    },
  ];
  assert.deepEqual(
    mogiQuestions(mogi).map((question) => question.kind),
    ["image", "name"],
  );
  assert.deepEqual(mogiOverview(mogi).action, { kind: "questions", count: 2 });
});

test("accepting the separate image ingests it at the destination despite the roster conflict", () => {
  const state = scenario();
  state.mogis[1].participants = state.mogis[1].participants.map((person) => ({
    ...person,
    loungeName: `Other ${person.id}`,
    ign: `Other ${person.id}`,
  }));
  const separated = ingestCaptureReview(state, "b");
  assert.equal(separated.mogis[1].captureReview?.items[0].separation, "Mogi A");
  const accepted = answerImageQuestion(separated, "b", "image:item", "yes");
  assert.equal(accepted.mogis[1].captureReview, undefined);
  assert.equal(accepted.mogis[1].captures?.[0].id, "capture");
  assert.equal(accepted.sharedReceipts?.length, 0);
});

test("refusing the separate image discards only the received file and its question", () => {
  const state = scenario();
  state.mogis[1].captureReview!.items[0].separation = "Mogi A";
  state.sharedReceipts![0].files.push({ ...state.sharedReceipts![0].files[0], id: "unrelated" });
  const result = answerImageQuestion(state, "b", "image:item", "no");
  assert.equal(result.mogis[1].captureReview, undefined);
  assert.equal(result.mogis[1].captures, undefined);
  assert.deepEqual(
    result.sharedReceipts?.flatMap((receipt) => receipt.files.map((file) => file.id)),
    ["unrelated"],
  );
  assert.equal(result.sourceUndo, undefined);
  assert.equal(answerImageQuestion(result, "b", "image:item", "yes"), result);
});

test("a capture draft may precede the race, but a manual edit requires an existing race", async () => {
  const { reviewDraftProblem } = await import("./capture-review.ts");
  const { raceDraftProblem } = await import("./race-review.ts");
  const mogi = scenario().mogis[1],
    item = mogi.captureReview!.items[0];
  const fields = {
    placements: mogi.participants.map((person) => person.id),
    absentParticipantIds: [],
    reviewed: false,
  };
  item.draft = {
    version: 1,
    purpose: "capture",
    sourceFileId: "file",
    raceId: "new-race",
    number: 1,
    baseSignature: null,
    fields,
    updatedAt: "2026-10-29T00:00:00.000Z",
  };
  assert.equal(await reviewDraftProblem(mogi, item), undefined);
  assert.equal(
    await raceDraftProblem(mogi, { ...item.draft, purpose: "manual", sourceFileId: undefined }),
    "race-changed",
  );
});

test("known numbering does not automatically accept a size suggested by rows", () => {
  const state = scenario(),
    mogi = state.mogis[1],
    item = mogi.captureReview!.items[0];
  item.numberKnown = true;
  item.recognition!.rows = mogi.participants.map((person) => ({
    text: person.ign,
    confidence: 100,
    uncertain: false,
    suggestedParticipantId: person.id,
  }));
  item.recognition!.interpretation = {
    version: 1,
    screen: "finishOrderAdded",
    origin: "visual",
    represented: 11,
    representedBy: "rows",
    positions: [],
    movementRows: [],
    reasons: [],
  };
  const result = ingestCaptureReview(state, mogi.id).mogis[1];
  assert.equal(
    result.races.some((race) => race.status === "confirmed"),
    false,
  );
  assert.equal(result.captures![0].stage, "context");
});
