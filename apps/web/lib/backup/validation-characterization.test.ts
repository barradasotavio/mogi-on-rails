/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures are untyped JSON that the validator receives as `unknown`. */
/**
 * Characterization of `validateTracker` before its rewrite on a schema library: every accept/reject
 * decision and the exact message of each rejection. Fixtures are built here; none comes from a backup.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_BACKUP_ITEMS } from "./limits.ts";
import { object, validateCompressedImage, validateTracker } from "./validation.ts";

type J = any;
const AT = "2026-10-28T00:00:00.000Z";
const H = "a".repeat(64),
  H2 = "b".repeat(64),
  H3 = "c".repeat(64);
const POINTS = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const P = Array.from({ length: 12 }, (_, i) => `p${i}`);
/** Active at physical race 3 onward: s1 replaces p0. */
const P3 = ["s1", ...P.slice(1)];
const png = () => new Blob(["png"], { type: "image/png" });
const webp = () => new Blob(["webp"], { type: "image/webp" });
const box = () => ({ x: 100, y: 100, width: 50, height: 50 });
const reading = (text: string, value: number | null, extra: J = {}) => ({
  text,
  value,
  confidence: 99,
  uncertain: value === null,
  location: box(),
  ...extra,
});
const manual = (value: number, extra: J = {}) => ({ value, origin: "manual", ...extra });

// ---------------------------------------------------------------------------------------------
// Valid states

/** Optional structures absent: the `undefined` branches. */
function minimal(): J {
  return {
    version: 1,
    activeMogiId: null,
    mogis: [
      {
        id: "m",
        name: "Mogi",
        format: "FFA",
        createdAt: AT,
        races: [],
        participants: P.map((id) => ({ id, loungeName: id, ign: id })),
      },
    ],
  };
}

function hypothesis(placements = P3) {
  return { results: [{ raceId: "r6", represented: 12, placements: [...placements], absentParticipantIds: [] }] };
}
function fact(id: string, position: number | "absent" = 1) {
  return { id, raceId: "r6", participantId: "p1", position, origin: "user", createdAt: AT, updatedAt: AT };
}
const stats = () => ({ nodes: 1, contexts: 1, tuples: 1, elapsedMs: 1, cancelled: false });
/** Normal, boundary and reported-origin equations. */
function equations() {
  const base = { participantId: "p1", session: "s", segment: "seg", targetIndices: [0], known: 0 };
  return [
    {
      ...base,
      fromRaceId: "r1",
      toRaceId: "r3",
      fromNumber: 1,
      toNumber: 3,
      gain: 8,
      older: manual(10),
      newer: manual(30),
      current: manual(12),
    },
    {
      ...base,
      boundary: true,
      fromCaptureId: "c1",
      toCaptureId: "c2",
      knownRaceIds: ["r1"],
      fromNumber: 1,
      toNumber: 2,
      gain: 10,
      older: manual(10, { sourceCaptureId: "c1", sourceRow: 1, sourceField: "right" }),
      newer: manual(20, { sourceCaptureId: "c2", sourceRow: 1, sourceField: "right" }),
    },
    {
      ...base,
      boundary: true,
      originFact: { kind: "confirmed-origin", answer: "zero-valid-12", captureId: "c2", signature: "sig" },
      toCaptureId: "c2",
      fromNumber: 0,
      toNumber: 1,
      gain: 20,
      older: manual(0),
      newer: manual(20, { sourceCaptureId: "c2", sourceRow: 1, sourceField: "right" }),
    },
  ];
}
function analysis(): J {
  return {
    status: "unique",
    inputSignature: H,
    sourceSignature: H,
    createdAt: AT,
    message: "m",
    orderVerified: true,
    complete: true,
    facts: [fact("fact1")],
    targetRaceIds: ["r6"],
    hypotheses: [hypothesis()],
    sourceCaptureIds: ["c1", "c2"],
    knownRaces: [
      {
        raceId: "r1",
        number: 1,
        represented: 11,
        discarded: false,
        placements: P.slice(0, 11),
        absentParticipantIds: ["p11"],
        nativePoints: { p0: 15 },
        nativePointOrigins: { p0: "modeled" },
      },
    ],
    equations: equations(),
    stats: stats(),
  };
}
function assistance(): J {
  const ambiguous = {
    ...analysis(),
    status: "ambiguous",
    inputSignature: H2,
    complete: false,
    orderVerified: false,
    facts: [],
    hypotheses: [hypothesis(), hypothesis([...P3].reverse())],
    sourceCaptureIds: [],
    knownRaces: [],
    equations: [],
  };
  return {
    id: "assist",
    targetRaceIds: ["r6"],
    facts: [fact("fact1")],
    factHistory: [{ action: "remove", at: AT, fact: fact("fact0", "absent") }],
    skipped: { signature: H, keys: ["r6:p1"] },
    analysis: analysis(),
    confirmed: { at: AT, inputSignature: H, kind: "unique", hypothesis: hypothesis() },
    history: [
      { analysis: ambiguous, confirmed: { at: AT, inputSignature: H2, kind: "user", hypothesis: hypothesis() } },
    ],
  };
}
/** Reconstruction proved by its sources (`fromRaceId`/`toRaceId`), without boundary analysis. */
function reconstruction(): J {
  return {
    status: "unique",
    createdAt: AT,
    targetNumber: 3,
    message: "m",
    inputSignature: "sig",
    fromRaceId: "r3",
    toRaceId: "r5",
    session: "s",
    sourceCaptureIds: ["c1"],
    placements: [...P3],
    absentParticipantIds: [],
    represented: 12,
    orderBasis: "unique",
    knownRaces: [{ raceId: "r1", number: 1, represented: 12, discarded: false, nativePoints: { p0: 15 } }],
    anchors: [
      {
        participantId: "p1",
        segment: "seg",
        known: 0,
        gain: 8,
        older: manual(10),
        newer: manual(30),
        current: manual(12),
      },
    ],
  };
}
/** Reconstruction proved by boundary analysis. */
function boundaryReconstruction(): J {
  return {
    status: "unique",
    createdAt: AT,
    targetNumber: 4,
    message: "m",
    inputSignature: "sig",
    sourceCaptureIds: ["c1", "c2"],
    placements: [...P3],
    absentParticipantIds: [],
    represented: 12,
    knownRaces: [],
    anchors: [],
    boundaryAnalysis: {
      status: "unique",
      inputSignature: H,
      sourceSignature: H,
      createdAt: AT,
      message: "m",
      orderVerified: true,
      complete: true,
      facts: [],
      targetRaceIds: ["r5"],
      sourceCaptureIds: ["c2", "c1"],
      knownRaces: [],
      equations: [],
      stats: stats(),
      hypotheses: [{ results: [{ raceId: "r5", represented: 12, placements: [...P3], absentParticipantIds: [] }] }],
    },
  };
}
function c1(): J {
  return {
    id: "c1",
    fileName: "c1.png",
    width: 1920,
    height: 1080,
    original: png(),
    stage: "finish-order-confirmed",
    reviewedAt: AT,
    reviewedPlacements: ["p0"],
    lastModified: 5,
    receivedAt: 1,
    pastedAt: 2,
    photoMoment: { at: 0, source: "exif" },
    fingerprint: H3,
    numericStageSuggestion: "animation",
    possibleAbsentParticipantIds: ["p11"],
    unreadableRowNumbers: [12],
    interpretation: {
      version: 1,
      screen: "finishOrderAdded",
      origin: "visual",
      positions: P.map((_, i) => reading(String(i + 1), i + 1)),
      movementRows: [1],
      reasons: ["r"],
      represented: 12,
      representedBy: "scale",
      currentScale: 12,
      groups: [{ rows: [1, 2], total: reading("30", 30), label: "A" }],
    },
    rows: P.map((id, i) => ({
      text: id,
      confidence: 90,
      uncertain: false,
      suggestedParticipantId: id,
      ...(i === 0 ? { location: box(), bounds: box(), alternatives: [{ text: "x", confidence: 1 }] } : {}),
    })),
    nameAssociations: P.map((id, i) =>
      i === 11 ? { participantId: null, unlinked: true } : { participantId: id, ign: id, origin: "deduced" },
    ),
    numericRows: P.map((_, i) => ({
      row: i + 1,
      right: reading(String(100 - i), 100 - i, { alternatives: [{ text: "1", value: 1, confidence: 1 }] }),
      addition: reading(`+${POINTS[i]}`, POINTS[i]),
    })),
    numericAnswers: [{ row: 1, field: "right", value: 99 }],
    groupTotalAnswers: [{ group: 1, value: 30 }],
    numericDeductions: [{ row: 2, field: "right", value: 98, origin: "deduced" }],
  };
}
/** Compressed WebP context screenshot before r4, with a next-track reading and a context draft. */
function c2(): J {
  return {
    id: "c2",
    fileName: "c2.webp",
    width: 1920,
    height: 1080,
    original: webp(),
    compressedFrom: { sha256: H2, size: 100 },
    fingerprint: H2,
    stage: "context",
    context: { phase: "before", raceId: "r4" },
    reviewedAt: AT,
    reviewedPlacements: [],
    interpretation: {
      version: 1,
      screen: "twoColumns",
      origin: "user",
      positions: [],
      movementRows: [],
      reasons: [],
      nextTrack: {
        text: "Crown City",
        confidence: 80,
        uncertain: true,
        location: box(),
        alternatives: [{ text: "CC", confidence: 10 }],
      },
    },
    rows: [
      { text: "a", confidence: 1, uncertain: true, suggestedParticipantId: "p0" },
      { text: "b", confidence: 1, uncertain: true, suggestedParticipantId: "p1" },
    ],
    contextDraft: {
      placements: [],
      absentParticipantIds: [],
      reviewed: false,
      rawOverrides: {},
      nextTrackAnswer: "Crown City",
      nameAssociations: [{ participantId: "p0", ign: "Alias" }, { participantId: null }],
      numericAnswers: [{ row: 1, field: "right", value: 5 }],
    },
  };
}
/** Bytes freed (`original: null`), after-race context without an interpretation. */
function c3(): J {
  return {
    id: "c3",
    fileName: "c3.png",
    width: 10,
    height: 10,
    original: null,
    stage: "context",
    context: { phase: "after" },
    reviewedAt: AT,
    reviewedPlacements: [],
    rows: [],
  };
}
function sequence(): J {
  return {
    version: 1,
    inputSignature: "sig",
    projectedRaceIds: ["r1"],
    associations: [{ captureId: "c1", raceId: "r3" }],
    conflict: "x",
    roomAnalysis: {
      origin: "deduced",
      sessions: [{ id: "s", captureIds: ["c1"], reopening: false, start: 1, candidates: [1] }],
      captures: [
        {
          captureId: "c1",
          sessionId: "s",
          j: 0,
          number: 1,
          suggestion: 1,
          placements: ["p0"],
          conflictRows: [1],
          values: [{ row: 1, value: 10, origin: "deduced" }],
          segments: [{ participantId: "p0", anchor: true, id: "seg" }],
        },
      ],
      conflicts: [],
      order: { sessionIds: ["s"], captureIds: ["c1"] },
    },
    origins: [{ captureId: "c1", answer: "zero-valid-12", signature: "sig" }],
    numbers: [
      { captureId: "c1", number: 1, physicalNumber: 1, phase: "after" },
      { captureId: "c2", number: null, phase: "before" },
    ],
    links: [
      {
        fromCaptureId: "c1",
        toCaptureId: "c2",
        signature: "sig",
        continuity: "reset",
        validity: "counted",
        people: [{ participantId: "p0", answer: "stable" }],
      },
    ],
    relations: [
      {
        fromCaptureId: "c1",
        toCaptureId: "c2",
        completedSteps: 1,
        stableParticipantIds: ["p0"],
        resetParticipantIds: [],
        unknownParticipantIds: [],
      },
    ],
    occurrences: [
      { id: "r3", raceId: "r3", captureIds: ["c1"], aliases: ["alias"], number: 1, physicalNumber: 3 },
      { id: "o2", captureIds: ["c2"], aliases: [] },
    ],
    gaps: [
      { id: "g", fromId: "r3", toId: "o2", sourceCaptureIds: ["c1", "c2"], order: "forward", count: 2, validCount: 1 },
    ],
  };
}
function interval(historical = false): J {
  return {
    id: historical ? "old" : "iv",
    signature: "sig",
    adjustment: "native-12",
    sourceCaptureIds: [historical ? "cDel" : "c1"],
    fromOccurrenceId: "zero:c1",
    toOccurrenceId: "r3",
    validRaceNumbers: [1],
    values: P3.map((participantId, i) => ({ participantId, slotId: P[i], raw: POINTS[i], adjusted: POINTS[i] })),
  };
}
const blankFields = (extra: J = {}) => ({
  placements: [],
  absentParticipantIds: [],
  reviewed: false,
  rawOverrides: {},
  ...extra,
});
function captureReview(): J {
  return {
    version: 1,
    id: "rev",
    currentItemId: "i1",
    items: [
      {
        id: "i1",
        source: { fileId: "f1" },
        number: 1,
        numberKnown: true,
        association: "new",
        status: "ready",
        discarded: false,
        duplicate: "dup",
        error: "err",
        recognition: { ...c3(), id: "rec1", original: undefined, reviewedAt: undefined, reviewedPlacements: undefined },
        draft: {
          version: 1,
          purpose: "capture",
          raceId: "i1",
          number: 6,
          updatedAt: AT,
          baseSignature: null,
          sourceFileId: "f1",
          fields: blankFields(),
        },
      },
      {
        id: "i2",
        source: { captureId: "c3" },
        number: 2,
        association: "r3",
        status: "saved",
        recognition: {
          id: "c3",
          fileName: "c3.png",
          width: 10,
          height: 10,
          stage: "context",
          context: { phase: "after" },
          rows: [],
        },
      },
      {
        id: "i3",
        source: { captureId: "c2" },
        number: 3,
        numberKnown: false,
        association: "",
        status: "waiting",
        separation: "Other mogi",
        discarded: true,
      },
    ],
  };
}
function captureUndo(): J {
  return {
    id: "undo",
    mogiId: "m",
    fileId: "f2",
    capture: {
      id: "cDel",
      fileName: "d.webp",
      width: 10,
      height: 10,
      stage: "context",
      context: { phase: "after", raceId: "r3" },
      reviewedAt: AT,
      reviewedPlacements: [],
      rows: [],
      compressedFrom: { sha256: H, size: 4 },
      fingerprint: H,
    },
    sequence: {
      numbers: [{ captureId: "cDel", number: 2, phase: "after" }],
      links: [],
      origins: [{ captureId: "cDel", answer: "unknown", signature: "sig" }],
    },
    raceDraft: {
      version: 1,
      purpose: "capture",
      raceId: "r3",
      number: 2,
      updatedAt: AT,
      baseSignature: H,
      sourceCaptureId: "cDel",
      fields: blankFields(),
    },
    races: [{ id: "r3", origin: "observed", status: "pending", placements: [], captureIds: ["cDel"] }],
  };
}
function reviewUndo(): J {
  return {
    id: "undo",
    mogiId: "m",
    fileId: "f2",
    races: [],
    reviewItem: { id: "ri", source: { fileId: "f2" }, number: 1, association: "new", status: "waiting" },
    raceDraft: {
      version: 1,
      purpose: "capture",
      raceId: "fresh",
      number: 7,
      updatedAt: AT,
      baseSignature: null,
      sourceFileId: "f2",
      fields: blankFields(),
    },
  };
}

/** FFA mogi with every optional structure the validator reads, and a capture removal to undo. */
function rich(): J {
  const participants: J[] = P.map((id) => ({ id, loungeName: `L ${id}`, ign: `I ${id}`, ignOrigin: "learned" }));
  participants.push(
    { id: "s1", slotId: "p0", loungeName: "Sub", ign: "Sub", ignOrigin: "explicit" },
    { id: "s5", slotId: "p5", loungeName: "Sub 5", ign: "Sub 5" },
  );
  return {
    version: 1,
    activeMogiId: "m",
    loungeName: "Me",
    loungeNames: ["Me", "Alt"],
    trackOrder: { by: "total", count: "minus" },
    unknownRootField: { kept: true },
    sharedReceipts: [
      {
        id: "rcpt",
        receivedAt: AT,
        source: "gallery",
        rejections: ["bad.gif"],
        files: [
          {
            id: "f1",
            name: "a.png",
            mimeType: "image/png",
            lastModified: 0,
            original: png(),
            receivedAt: 1,
            pastedAt: 2,
            photoMoment: { at: -5, source: "switch-name" },
          },
          { id: "f2", name: "b.webp", mimeType: "image/webp", lastModified: 0, original: webp() },
        ],
      },
    ],
    sourceUndo: captureUndo(),
    mogis: [
      {
        id: "m",
        name: "Mogi",
        format: "FFA",
        createdAt: AT,
        sourceRevision: 0,
        submissionTier: "",
        originalList: "list",
        participants,
        // Listed out of entry order: the validator sorts them by entry.
        substitutions: [
          { id: "sub5", slotId: "p5", outgoingParticipantId: "p5", incomingParticipantId: "s5", fromRace: 7 },
          {
            id: "sub1",
            slotId: "p0",
            outgoingParticipantId: "p0",
            incomingParticipantId: "s1",
            fromRace: 3,
            fromRaceId: "r3",
            fromPhysicalNumber: 3,
            previousFromRaces: [2],
          },
        ],
        creditedParticipantIds: { p0: "s1" },
        captures: [c1(), c2(), c3()],
        deletedCaptureIds: ["cDel"],
        races: [
          {
            id: "r1",
            origin: "manual",
            number: 1,
            physicalNumber: 1,
            track: "MBC",
            placements: [...P],
            absentParticipantIds: [],
            nativePoints: { p0: 15 },
            nativePointOrigins: { p0: "manual" },
          },
          { id: "r2", origin: "observed", status: "discarded", physicalNumber: 2, placements: [...P] },
          {
            id: "r3",
            origin: "observed",
            status: "confirmed",
            number: 2,
            physicalNumber: 3,
            placements: P3.slice(0, 11),
            absentParticipantIds: ["p11"],
            captureIds: ["c1"],
            gameEvidence: {
              stage: "post-race",
              session: "s",
              verified: true,
              rowAssociations: { c1: [...P] },
              readings: {
                p1: {
                  segment: "seg",
                  useAsAnchor: true,
                  current: manual(12),
                  cumulative: {
                    value: 99,
                    origin: "observed",
                    sourceCaptureId: "c1",
                    sourceRow: 2,
                    sourceField: "right",
                  },
                },
              },
            },
            gameEvidenceHistory: [
              { changedAt: AT, evidence: { stage: "unknown", session: "s", verified: false, readings: {} } },
            ],
            participationHistory: [
              {
                changedAt: AT,
                reason: "why",
                result: { id: "r3", origin: "observed", status: "pending", placements: [] },
              },
            ],
            sourceRemovalHistory: [
              {
                removedAt: AT,
                captureId: "cDel",
                result: { id: "r3", origin: "observed", status: "pending", placements: [], captureIds: ["cDel"] },
              },
            ],
          },
          {
            id: "r4",
            origin: "reconstructed",
            status: "pending",
            number: 3,
            physicalNumber: 4,
            placements: [],
            participationReview: "check",
            reconstruction: reconstruction(),
            reconstructionHistory: [
              { ...reconstruction(), status: "stale", represented: undefined, fromRaceId: undefined },
            ],
          },
          {
            id: "r5",
            origin: "reconstructed",
            status: "pending",
            number: 4,
            physicalNumber: 5,
            placements: [],
            reconstruction: boundaryReconstruction(),
          },
          {
            id: "r6",
            origin: "reconstructed",
            status: "pending",
            number: 5,
            physicalNumber: 6,
            placements: [],
            assistedGroupId: "assist",
          },
        ],
        sequence: sequence(),
        coverage: { version: 1, intervals: [interval()], history: [{ reason: "why", contribution: interval(true) }] },
        raceDraft: {
          version: 1,
          purpose: "manual",
          raceId: "draft",
          number: 6,
          updatedAt: AT,
          baseSignature: null,
          fields: {
            placements: ["p0"],
            absentParticipantIds: ["p1"],
            reviewed: true,
            rawOverrides: { p0: "15" },
            nameAssociations: [{ participantId: "p0" }],
            groupTotalAnswers: [{ group: 1, value: 10 }],
            numericAnswers: [{ row: 1, field: "right", value: 10 }],
          },
        },
        captureReview: captureReview(),
        orderReview: {
          acceptedAt: AT,
          inputSignature: "sig",
          raceIds: ["r1", "r3"],
          basis: "unique",
          unresolvedRaceIds: ["r4"],
          gaps: [
            {
              fromRaceId: "r1",
              toRaceId: "r3",
              anchors: [{ participantId: "p1", olderTotal: 10, newerTotal: 30, current: 12, intermediateGain: 8 }],
            },
          ],
        },
        assistance: assistance(),
      },
    ],
  };
}

/** Team format with tags, a capture race draft, and a review item removal to undo. */
function teams(format: "2v2" | "3v3" = "2v2"): J {
  const s = rich(),
    mogi = s.mogis[0],
    size = Number(format[0]);
  mogi.format = format;
  mogi.teams = Array.from({ length: 12 / size }, (_, i) => ({
    id: `t${i}`,
    name: `Team ${i}`,
    ...(i === 0 ? { tag: "" } : { tag: "ABCDE" }),
  }));
  for (const [i, person] of mogi.participants.entries()) person.teamId = `t${Math.floor((i % 12) / size)}`;
  mogi.raceDraft = {
    version: 1,
    purpose: "capture",
    raceId: "r4",
    number: 3,
    updatedAt: AT,
    baseSignature: H,
    sourceCaptureId: "c2",
    fields: blankFields({
      nextTrackAnswer: "Crown City",
      nameAssociations: [{ participantId: "p0" }, { participantId: null }],
    }),
  };
  s.sourceUndo = reviewUndo();
  return s;
}

const validStates: [string, () => J][] = [
  ["minimal", minimal],
  ["rich FFA with capture undo", rich],
  ["2v2 with capture draft and review undo", () => teams("2v2")],
  ["3v3", () => teams("3v3")],
];

test("valid states are accepted", () => {
  for (const [name, build] of validStates) assert.doesNotThrow(() => validateTracker(build()), name);
});

// ---------------------------------------------------------------------------------------------
// Harness

/** [case name, single change, exact message]; the state is `rich()` unless a builder is given. */
type Case = [name: string, change: (s: J) => void, message: string, build?: () => J];
const ACCEPTED = "(accepted)";
function outcome(state: J): string {
  try {
    validateTracker(state);
    return ACCEPTED;
  } catch (error) {
    assert.ok(error instanceof Error);
    return error.message;
  }
}
/** Reports every mismatch at once, so a rewrite sees all changed messages in one run. */
function expectAll(cases: Case[]) {
  const mismatches = cases.flatMap(([name, change, message, build = rich]) => {
    const state = build();
    change(state);
    const actual = outcome(state);
    return actual === message ? [] : [`${name}: expected ${JSON.stringify(message)}, got ${JSON.stringify(actual)}`];
  });
  assert.deepEqual(mismatches, []);
}
const mg = (s: J) => s.mogis[0];
const cap = (s: J, id: string) => mg(s).captures.find((c: J) => c.id === id);
const race = (s: J, id: string) => mg(s).races.find((r: J) => r.id === id);
const file = (s: J, i = 0) => s.sharedReceipts[0].files[i];
const nr = (s: J) => cap(s, "c1").numericRows[0].right;
const interp = (s: J) => cap(s, "c1").interpretation;
const track = (s: J) => cap(s, "c2").interpretation.nextTrack;
const row0 = (s: J) => cap(s, "c1").rows[0];
const ev = (s: J) => race(s, "r3").gameEvidence;
const rd = (s: J) => ev(s).readings.p1;
const seq = (s: J) => mg(s).sequence;
const room = (s: J) => seq(s).roomAnalysis;
const roomCap = (s: J) => room(s).captures[0];
const recon = (s: J) => race(s, "r4").reconstruction;
const boundary = (s: J) => race(s, "r5").reconstruction.boundaryAnalysis;
const asst = (s: J) => mg(s).assistance;
const an = (s: J) => asst(s).analysis;
const eq = (s: J, i: number) => an(s).equations[i];
const known = (s: J) => an(s).knownRaces[0];
const hyp = (s: J) => an(s).hypotheses[0].results[0];
const review = (s: J) => mg(s).captureReview;
const item = (s: J, i: number) => review(s).items[i];
const order = (s: J) => mg(s).orderReview;
const anchor = (s: J) => order(s).gaps[0].anchors[0];
const draft = (s: J) => mg(s).raceDraft;
const undo = (s: J) => s.sourceUndo;
const many = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
/** A Blob that reports a size without allocating it. */
const sized = (size: number, type: string) => Object.defineProperty(new Blob(["x"], { type }), "size", { value: size });
const MB = 1024 * 1024;
const long = (n: number) => "x".repeat(n);
const swap = (target: J, values: J) => Object.assign(target, values);

// ---------------------------------------------------------------------------------------------
// Accept path: edges, unknown extensions, no mutation

test("values on the inside edge of each representative bound are accepted", () => {
  expectAll(
    (
      [
        [
          "receivedAt at the maximum date",
          (s) => {
            file(s).receivedAt = 8640000000000000;
          },
        ],
        [
          "photo moment at the minimum date",
          (s) => {
            file(s).photoMoment.at = -8640000000000000;
          },
        ],
        [
          "received image at exactly 25 MB",
          (s) => {
            file(s).original = sized(25 * MB, "image/png");
          },
        ],
        [
          "32 images in one submission",
          (s) => {
            s.sharedReceipts[0].files.push(
              ...many(30, (i) => ({ id: `x${i}`, name: "n", mimeType: "image/png", lastModified: 0, original: png() })),
            );
          },
        ],
        [
          "mogi name at MAX_BACKUP_ITEMS characters",
          (s) => {
            mg(s).name = long(MAX_BACKUP_ITEMS);
          },
        ],
        [
          "Lounge name at 80 characters",
          (s) => {
            s.loungeName = long(80);
            s.loungeNames = many(20, (i) => `${i}`.padEnd(80, "x"));
          },
        ],
        [
          "whitespace tier (empty allowed)",
          (s) => {
            mg(s).submissionTier = "   ";
          },
        ],
        [
          "race status null reads as confirmed",
          (s) => {
            race(s, "r1").status = null;
          },
        ],
        [
          "physical position 999",
          (s) => {
            race(s, "r6").physicalNumber = 999;
          },
        ],
        [
          "15 in-game points",
          (s) => {
            race(s, "r1").nativePoints = { p0: 15, p1: 0 };
          },
        ],
        [
          "numeric crop touching the right and bottom edge",
          (s) => {
            swap(nr(s).location, { x: 1870, y: 1030, width: 50, height: 50 });
          },
        ],
        [
          "confidence 100 and 0",
          (s) => {
            nr(s).confidence = 100;
            row0(s).confidence = 0;
          },
        ],
        [
          "empty numeric text with a null value",
          (s) => {
            swap(nr(s), { text: "", value: null, uncertain: true });
          },
        ],
        [
          "capture without original bytes keeps its compressed source",
          (s) => {
            cap(s, "c2").original = null;
          },
        ],
        [
          "context capture with twelve rows",
          (s) => {
            cap(s, "c3").rows = many(12, (i) => ({
              text: "",
              confidence: 1,
              uncertain: false,
              suggestedParticipantId: P[i],
            }));
          },
        ],
        [
          "next track answer at 120 characters",
          (s) => {
            draft(s).fields.nextTrackAnswer = long(120);
          },
          teams,
        ],
        [
          "valid count equal to the physical count",
          (s) => {
            seq(s).gaps[0].validCount = 2;
          },
        ],
        [
          "drafts without legacy in-game points",
          (s) => {
            delete draft(s).fields.rawOverrides;
            delete cap(s, "c2").contextDraft.rawOverrides;
          },
        ],
        [
          "empty edited points and accepted IGN spelling",
          (s) => {
            draft(s).fields.rawOverrides = { p0: "" };
            draft(s).fields.nameAssociations = [{ participantId: "p0", ign: "" }];
          },
        ],
        [
          "2v2 roots without a team",
          (s) => {
            for (const person of mg(s).participants) delete person.teamId;
          },
          teams,
        ],
      ] as [string, (s: J) => void, (() => J)?][]
    ).map(([name, change, build]) => [name, change, ACCEPTED, build]),
  );
});

const IDENTITY_MAPS = new Set([
  "nativePoints",
  "nativePointOrigins",
  "rawOverrides",
  "creditedParticipantIds",
  "rowAssociations",
  "readings",
]);
/** Adds an unknown field to every record that is not an identity-keyed map. */
function extend(value: J, key = ""): void {
  if (Array.isArray(value)) return value.forEach((entry) => extend(entry));
  if (!value || typeof value !== "object" || value instanceof Blob) return;
  for (const [field, entry] of Object.entries(value)) extend(entry, field);
  if (!IDENTITY_MAPS.has(key)) value.futureExtension = { nested: [1, "two"] };
}
/** JSON view with each Blob replaced by its index in `blobs`, so identity is compared separately. */
function snapshot(state: J) {
  const blobs: Blob[] = [];
  const json = JSON.stringify(state, (_, value) => (value instanceof Blob ? `blob#${blobs.push(value) - 1}` : value));
  return { json, blobs };
}

test("unknown extensions on every record are accepted, and validation never changes its input", () => {
  for (const [name, build] of validStates) {
    const state = build();
    extend(state);
    const before = snapshot(state);
    assert.equal(outcome(state), ACCEPTED, name);
    const after = snapshot(state);
    assert.equal(after.json, before.json, name);
    assert.equal(after.blobs.length, before.blobs.length, name);
    after.blobs.forEach((blob, i) => assert.equal(blob, before.blobs[i], name));
  }
});

// ---------------------------------------------------------------------------------------------
// Reject path: one change each, exact message

const receipt = (s: J) => s.sharedReceipts[0];
test("validateTracker: root, pending images and Lounge names", () => {
  expectAll([
    ["null root", () => {}, "Tracker data: missing or invalid object.", () => null],
    ["array root", () => {}, "Tracker data: missing or invalid object.", () => []],
    ["string root", () => {}, "Tracker data: missing or invalid object.", () => "state"],
    [
      "version 2",
      (s) => {
        s.version = 2;
      },
      "Unsupported data version. Update the app before restoring.",
    ],
    [
      "version as text",
      (s) => {
        s.version = "1";
      },
      "Unsupported data version. Update the app before restoring.",
    ],
    [
      "version missing",
      (s) => {
        delete s.version;
      },
      "Unsupported data version. Update the app before restoring.",
    ],
    [
      "receipts not a list",
      (s) => {
        s.sharedReceipts = {};
      },
      "Pending screenshots: missing or invalid list.",
    ],
    [
      "receipt not an object",
      (s) => {
        s.sharedReceipts = [null];
      },
      "Received submissions: missing or invalid object.",
    ],
    [
      "receipt without ID",
      (s) => {
        delete receipt(s).id;
      },
      "Received submissions: ID: invalid text.",
    ],
    [
      "receipt with blank ID",
      (s) => {
        receipt(s).id = " ";
      },
      "Received submissions: ID: invalid text.",
    ],
    [
      "duplicate receipt IDs",
      (s) => {
        s.sharedReceipts.push({ ...receipt(s), files: [] });
      },
      "Received submissions: duplicate IDs.",
    ],
    [
      "more than MAX_BACKUP_ITEMS receipts",
      (s) => {
        s.sharedReceipts = many(MAX_BACKUP_ITEMS + 1, (i) => ({ id: `r${i}` }));
      },
      "Too many pending submissions.",
    ],
    [
      "receipt date missing",
      (s) => {
        delete receipt(s).receivedAt;
      },
      "Submission date: invalid text.",
    ],
    [
      "receipt date not a date",
      (s) => {
        receipt(s).receivedAt = "not a date";
      },
      "Submission date: invalid date.",
    ],
    [
      "receipt origin camera",
      (s) => {
        receipt(s).source = "camera";
      },
      "Unsupported submission origin.",
    ],
    [
      "receipt origin null",
      (s) => {
        receipt(s).source = null;
      },
      "Unsupported submission origin.",
    ],
    [
      "receipt files not a list",
      (s) => {
        receipt(s).files = "f";
      },
      "Received files: missing or invalid list.",
    ],
    [
      "33 files in a receipt",
      (s) => {
        receipt(s).files = many(33, () => ({}));
      },
      "Too many screenshots in one submission.",
    ],
    [
      "file not an object",
      (s) => {
        receipt(s).files[0] = [];
      },
      "Received screenshot: missing or invalid object.",
    ],
    [
      "file without ID",
      (s) => {
        file(s).id = "";
      },
      "Screenshot ID: invalid text.",
    ],
    [
      "file ID repeated in another receipt",
      (s) => {
        s.sharedReceipts.push({ id: "r2", receivedAt: AT, rejections: [], files: [{ ...file(s) }] });
      },
      "Duplicate received screenshot.",
    ],
    [
      "file name empty",
      (s) => {
        file(s).name = "";
      },
      "File name: invalid text.",
    ],
    [
      "file name too long",
      (s) => {
        file(s).name = long(MAX_BACKUP_ITEMS + 1);
      },
      "File name: invalid text.",
    ],
    [
      "file date negative",
      (s) => {
        file(s).lastModified = -1;
      },
      "File date: invalid number.",
    ],
    [
      "file date fractional",
      (s) => {
        file(s).lastModified = 1.5;
      },
      "File date: invalid number.",
    ],
    [
      "file date unsafe integer",
      (s) => {
        file(s).lastModified = 2 ** 53;
      },
      "File date: invalid number.",
    ],
    [
      "file date as text",
      (s) => {
        file(s).lastModified = "0";
      },
      "File date: invalid number.",
    ],
    [
      "receivedAt above the maximum date",
      (s) => {
        file(s).receivedAt = 8640000000000001;
      },
      "Screenshot received: invalid number.",
    ],
    [
      "receivedAt null",
      (s) => {
        file(s).receivedAt = null;
      },
      "Screenshot received: invalid number.",
    ],
    [
      "pastedAt negative",
      (s) => {
        file(s).pastedAt = -1;
      },
      "Screenshot pasted: invalid number.",
    ],
    [
      "photo moment not an object",
      (s) => {
        file(s).photoMoment = 5;
      },
      "Photo moment: missing or invalid object.",
    ],
    [
      "photo moment below the minimum date",
      (s) => {
        file(s).photoMoment.at = -8640000000000001;
      },
      "Photo moment: invalid number.",
    ],
    [
      "photo moment source download",
      (s) => {
        file(s).photoMoment.source = "download";
      },
      "Photo moment: invalid source.",
    ],
    [
      "mime type missing",
      (s) => {
        delete file(s).mimeType;
      },
      "Screenshot type: invalid text.",
    ],
    [
      "mime type gif",
      (s) => {
        file(s).mimeType = "image/gif";
        file(s).original = new Blob(["g"], { type: "image/gif" });
      },
      "Invalid received screenshot.",
    ],
    [
      "original not a Blob",
      (s) => {
        file(s).original = "png";
      },
      "Invalid received screenshot.",
    ],
    [
      "original type differs from mime type",
      (s) => {
        file(s).original = webp();
      },
      "Invalid received screenshot.",
    ],
    [
      "original empty",
      (s) => {
        file(s).original = new Blob([], { type: "image/png" });
      },
      "Invalid received screenshot.",
    ],
    [
      "original above 25 MB",
      (s) => {
        file(s).original = sized(25 * MB + 1, "image/png");
      },
      "Invalid received screenshot.",
    ],
    [
      "receipt above 100 MB",
      (s) => {
        receipt(s).files = many(5, (i) => ({
          id: `big${i}`,
          name: "n",
          mimeType: "image/png",
          lastModified: 0,
          original: sized(25 * MB, "image/png"),
        }));
      },
      "Received submission exceeds 100 MB.",
    ],
    [
      "rejections not a list",
      (s) => {
        delete receipt(s).rejections;
      },
      "Rejected files: missing or invalid list.",
    ],
    [
      "33 rejections",
      (s) => {
        receipt(s).rejections = many(33, () => "r");
      },
      "Invalid rejections.",
    ],
    [
      "blank rejection",
      (s) => {
        receipt(s).rejections = [" "];
      },
      "Rejection: invalid text.",
    ],
    [
      "mogis not a list",
      (s) => {
        s.mogis = {};
      },
      "Mogis: missing or invalid list.",
    ],
    [
      "mogi not an object",
      (s) => {
        s.mogis = ["m"];
      },
      "Mogis: missing or invalid object.",
    ],
    [
      "mogi without ID",
      (s) => {
        mg(s).id = 5;
      },
      "Mogis: ID: invalid text.",
    ],
    [
      "duplicate mogi IDs",
      (s) => {
        s.mogis.push(minimal().mogis[0]);
      },
      "Mogis: duplicate IDs.",
    ],
    [
      "active mogi unknown",
      (s) => {
        s.activeMogiId = "other";
      },
      "Active mogi not found.",
    ],
    [
      "active mogi undefined (only null means none)",
      (s) => {
        delete s.activeMogiId;
      },
      "Active mogi not found.",
    ],
    [
      "Lounge name empty",
      (s) => {
        s.loungeName = "";
      },
      "Your Lounge name: invalid text.",
    ],
    [
      "Lounge name of 81 characters",
      (s) => {
        s.loungeName = long(81);
      },
      "Your Lounge name is too long.",
    ],
    [
      "Lounge names not a list",
      (s) => {
        s.loungeNames = "Me";
      },
      "Your Lounge names: missing or invalid list.",
    ],
    [
      "21 Lounge names",
      (s) => {
        s.loungeNames = many(21, (i) => `n${i}`);
      },
      "Too many Lounge names.",
    ],
    [
      "Lounge names entry not text",
      (s) => {
        s.loungeNames = [5];
      },
      "Your Lounge name: invalid text.",
    ],
    [
      "Lounge names entry of 81 characters",
      (s) => {
        s.loungeNames = [long(81)];
      },
      "Your Lounge name is too long.",
    ],
    [
      "Unknown track order",
      (s) => {
        s.trackOrder = { by: "best", count: "both" };
      },
      "Invalid track order.",
    ],
  ]);
});

test("validateTracker: mogi, roster, teams, substitutions and credit", () => {
  expectAll([
    [
      "name blank",
      (s) => {
        mg(s).name = "  ";
      },
      "Mogi name: invalid text.",
    ],
    [
      "name above MAX_BACKUP_ITEMS",
      (s) => {
        mg(s).name = long(MAX_BACKUP_ITEMS + 1);
      },
      "Mogi name: invalid text.",
    ],
    [
      "source revision negative",
      (s) => {
        mg(s).sourceRevision = -1;
      },
      "Source revision: invalid number.",
    ],
    [
      "date not a date",
      (s) => {
        mg(s).createdAt = "yesterday";
      },
      "Mogi date: invalid date.",
    ],
    [
      "format 4v4",
      (s) => {
        mg(s).format = "4v4";
      },
      "Unsupported format.",
    ],
    [
      "format missing",
      (s) => {
        delete mg(s).format;
      },
      "Unsupported format.",
    ],
    [
      "tier not text",
      (s) => {
        mg(s).submissionTier = 5;
      },
      "Tier: invalid text.",
    ],
    [
      "original list empty",
      (s) => {
        mg(s).originalList = "";
      },
      "Original list: invalid text.",
    ],
    [
      "players not a list",
      (s) => {
        delete mg(s).participants;
      },
      "Players: missing or invalid list.",
    ],
    [
      "player not an object",
      (s) => {
        mg(s).participants[0] = "p0";
      },
      "Players: missing or invalid object.",
    ],
    [
      "duplicate player IDs",
      (s) => {
        mg(s).participants[1].id = "p0";
      },
      "Players: duplicate IDs.",
    ],
    [
      "teams not a list",
      (s) => {
        mg(s).teams = {};
      },
      "Teams: missing or invalid list.",
    ],
    [
      "team not an object",
      (s) => {
        mg(s).teams[0] = null;
      },
      "Teams: missing or invalid object.",
      teams,
    ],
    [
      "duplicate team IDs",
      (s) => {
        mg(s).teams[1].id = "t0";
      },
      "Teams: duplicate IDs.",
      teams,
    ],
    [
      "team name empty",
      (s) => {
        mg(s).teams[0].name = "";
      },
      "Team name: invalid text.",
      teams,
    ],
    [
      "team tag of 6 characters",
      (s) => {
        mg(s).teams[1].tag = "ABCDEF";
      },
      "Team tag: invalid text.",
      teams,
    ],
    [
      "team tag not text",
      (s) => {
        mg(s).teams[1].tag = 5;
      },
      "Team tag: invalid text.",
      teams,
    ],
    [
      "eleven roster slots",
      (s) => {
        mg(s).participants.splice(11, 1);
      },
      "The roster must contain twelve original participation slots.",
    ],
    [
      "thirteen roster slots",
      (s) => {
        delete mg(s).participants[12].slotId;
      },
      "The roster must contain twelve original participation slots.",
    ],
    [
      "Lounge name empty",
      (s) => {
        mg(s).participants[3].loungeName = "";
      },
      "Lounge name: invalid text.",
    ],
    [
      "IGN missing",
      (s) => {
        delete mg(s).participants[3].ign;
      },
      "IGN: invalid text.",
    ],
    [
      "IGN origin unknown",
      (s) => {
        mg(s).participants[3].ignOrigin = "guessed";
      },
      "Invalid IGN origin.",
    ],
    [
      "player team not text",
      (s) => {
        mg(s).participants[3].teamId = 5;
      },
      "Player's team: invalid text.",
    ],
    [
      "player team unknown",
      (s) => {
        mg(s).participants[3].teamId = "t9";
      },
      "Player's team not found.",
    ],
    [
      "player slot not text",
      (s) => {
        mg(s).participants[12].slotId = 5;
      },
      "Player's slot: invalid text.",
    ],
    [
      "player slot unknown",
      (s) => {
        mg(s).participants[12].slotId = "zz";
      },
      "Participation slot not found.",
    ],
    [
      "player slot is a substitute",
      (s) => {
        mg(s).participants[13].slotId = "s1";
      },
      "Participation slot not found.",
    ],
    [
      "2v2 with five teams",
      (s) => {
        mg(s).teams.pop();
        for (const p of mg(s).participants) if (p.teamId === "t5") delete p.teamId;
      },
      "Inconsistent team distribution.",
      teams,
    ],
    [
      "2v2 with three roots in a team",
      (s) => {
        mg(s).participants[2].teamId = "t0";
      },
      "Inconsistent team distribution.",
      teams,
    ],
    [
      "3v3 with six teams",
      (s) => {
        mg(s).teams.push({ id: "t4", name: "x" }, { id: "t5", name: "y" });
      },
      "Inconsistent team distribution.",
      () => teams("3v3"),
    ],
    [
      "FFA with teams keeps no distribution check",
      (s) => {
        mg(s).teams = [{ id: "t0", name: "x" }];
      },
      ACCEPTED,
    ],
    [
      "substitutions not a list",
      (s) => {
        mg(s).substitutions = {};
      },
      "Substitutions: missing or invalid list.",
    ],
    [
      "substitution not an object",
      (s) => {
        mg(s).substitutions[0] = 1;
      },
      "Substitutions: missing or invalid object.",
    ],
    [
      "duplicate substitution IDs",
      (s) => {
        mg(s).substitutions[0].id = "sub1";
      },
      "Substitutions: duplicate IDs.",
    ],
    [
      "substituted slot empty",
      (s) => {
        mg(s).substitutions[1].slotId = "";
      },
      "Substituted slot: invalid text.",
    ],
    [
      "outgoing player missing",
      (s) => {
        delete mg(s).substitutions[1].outgoingParticipantId;
      },
      "Outgoing player: invalid text.",
    ],
    [
      "incoming player missing",
      (s) => {
        delete mg(s).substitutions[1].incomingParticipantId;
      },
      "Incoming player: invalid text.",
    ],
    [
      "entry occurrence not text",
      (s) => {
        mg(s).substitutions[1].fromRaceId = 5;
      },
      "Entry occurrence: invalid text.",
    ],
    [
      "entry occurrence unknown",
      (s) => {
        mg(s).substitutions[1].fromRaceId = "zz";
      },
      "Entry occurrence not found.",
    ],
    [
      "physical boundary 1000",
      (s) => {
        mg(s).substitutions[1].fromPhysicalNumber = 1000;
      },
      "Physical boundary: invalid number.",
    ],
    [
      "entry race 0",
      (s) => {
        mg(s).substitutions[1].fromRace = 0;
      },
      "Entry race: invalid number.",
    ],
    [
      "entry race missing even with a physical boundary",
      (s) => {
        delete mg(s).substitutions[1].fromRace;
      },
      "Entry race: invalid number.",
    ],
    [
      "boundary differs from the entry occurrence",
      (s) => {
        mg(s).substitutions[1].fromPhysicalNumber = 4;
      },
      "Inconsistent participation boundary.",
    ],
    [
      "entry occurrence without a physical boundary",
      (s) => {
        delete mg(s).substitutions[1].fromPhysicalNumber;
      },
      "Inconsistent participation boundary.",
    ],
    [
      "incoming player from another slot",
      (s) => {
        mg(s).substitutions[1].incomingParticipantId = "p1";
      },
      "Inconsistent substitution history.",
    ],
    [
      "outgoing equals incoming",
      (s) => {
        mg(s).substitutions[0].incomingParticipantId = "p5";
      },
      "Inconsistent substitution history.",
    ],
    [
      "slot that is not a root",
      (s) => {
        mg(s).substitutions[0].slotId = "s5";
      },
      "Inconsistent substitution history.",
    ],
    [
      "second entry not after the first",
      (s) => {
        mg(s).substitutions.push({
          id: "sub9",
          slotId: "p5",
          outgoingParticipantId: "s5",
          incomingParticipantId: "p5",
          fromRace: 7,
        });
      },
      "Inconsistent substitution history.",
    ],
    [
      "previous entries not a list",
      (s) => {
        mg(s).substitutions[1].previousFromRaces = 2;
      },
      "Previous entries: missing or invalid list.",
    ],
    [
      "previous entry 0",
      (s) => {
        mg(s).substitutions[1].previousFromRaces = [0];
      },
      "Previous entry: invalid number.",
    ],
    [
      "credit not an object",
      (s) => {
        mg(s).creditedParticipantIds = [];
      },
      "Participation credit: missing or invalid object.",
    ],
    [
      "credit to another slot's player",
      (s) => {
        mg(s).creditedParticipantIds = { p0: "p1" };
      },
      "Inconsistent credited player.",
    ],
    [
      "credit for a non-root slot",
      (s) => {
        mg(s).creditedParticipantIds = { s1: "s1" };
      },
      "Inconsistent credited player.",
    ],
    [
      "credit not text",
      (s) => {
        mg(s).creditedParticipantIds = { p0: 1 };
      },
      "Inconsistent credited player.",
    ],
  ]);
});

test("validateTracker: capture records, removals and race ordering", () => {
  expectAll([
    [
      "captures not a list",
      (s) => {
        mg(s).captures = {};
      },
      "Screenshots: missing or invalid list.",
    ],
    [
      "capture not an object",
      (s) => {
        mg(s).captures[0] = null;
      },
      "Screenshots: missing or invalid object.",
    ],
    [
      "duplicate capture IDs",
      (s) => {
        cap(s, "c2").id = "c1";
      },
      "Screenshots: duplicate IDs.",
    ],
    [
      "original undefined (only null means freed)",
      (s) => {
        delete cap(s, "c1").original;
      },
      "Original screenshot is missing.",
    ],
    [
      "original empty",
      (s) => {
        cap(s, "c1").original = new Blob([], { type: "image/png" });
      },
      "Original screenshot is missing.",
    ],
    [
      "original not a Blob",
      (s) => {
        cap(s, "c1").original = "bytes";
      },
      "Original screenshot is missing.",
    ],
    [
      "compressed source not an object",
      (s) => {
        cap(s, "c2").compressedFrom = "x";
      },
      "Compressed screenshot source: missing or invalid object.",
    ],
    [
      "compressed source hash uppercase",
      (s) => {
        cap(s, "c2").compressedFrom.sha256 = "A".repeat(64);
      },
      "Invalid compressed screenshot source.",
    ],
    [
      "compressed source size 0",
      (s) => {
        cap(s, "c2").compressedFrom.size = 0;
      },
      "Invalid compressed screenshot source.",
    ],
    [
      "compressed PNG",
      (s) => {
        cap(s, "c2").original = png();
      },
      "A compressed screenshot must be WebP.",
    ],
    [
      "fingerprint differs from the compressed source",
      (s) => {
        cap(s, "c2").fingerprint = H;
      },
      "A screenshot fingerprint doesn't match its compressed source.",
    ],
    [
      "review date missing",
      (s) => {
        delete cap(s, "c1").reviewedAt;
      },
      "Screenshot review date: invalid text.",
    ],
    [
      "review date not a date",
      (s) => {
        cap(s, "c1").reviewedAt = "soon";
      },
      "Screenshot review date: invalid date.",
    ],
    [
      "reviewed associations not a list",
      (s) => {
        delete cap(s, "c1").reviewedPlacements;
      },
      "Reviewed associations: missing or invalid list.",
    ],
    [
      "reviewed associations unknown player",
      (s) => {
        cap(s, "c1").reviewedPlacements = ["zz"];
      },
      "Reviewed associations: missing or duplicate reference.",
    ],
    [
      "reviewed associations repeated",
      (s) => {
        cap(s, "c1").reviewedPlacements = ["p0", "p0"];
      },
      "Reviewed associations: missing or duplicate reference.",
    ],
    [
      "removed screenshots not a list",
      (s) => {
        mg(s).deletedCaptureIds = "cDel";
      },
      "Removed screenshots: missing or invalid list.",
    ],
    [
      "removed screenshot empty",
      (s) => {
        mg(s).deletedCaptureIds = [""];
      },
      "Removed screenshot: invalid text.",
    ],
    [
      "removed screenshot still live",
      (s) => {
        mg(s).deletedCaptureIds.push("c1");
      },
      "Invalid screenshot removal record.",
    ],
    [
      "removed screenshot repeated",
      (s) => {
        mg(s).deletedCaptureIds.push("cDel");
      },
      "Invalid screenshot removal record.",
    ],
    [
      "races not a list",
      (s) => {
        delete mg(s).races;
      },
      "Races: missing or invalid list.",
    ],
    [
      "race not an object",
      (s) => {
        mg(s).races[0] = 1;
      },
      "Races: missing or invalid object.",
    ],
    [
      "race without ID",
      (s) => {
        race(s, "r1").id = "";
      },
      "Races: ID: invalid text.",
    ],
    [
      "duplicate race IDs",
      (s) => {
        race(s, "r2").id = "r1";
      },
      "Races: duplicate IDs.",
    ],
    [
      "context race unknown",
      (s) => {
        cap(s, "c3").context.raceId = "zz";
      },
      "Context race not found.",
    ],
    [
      "duplicate physical position",
      (s) => {
        race(s, "r2").physicalNumber = 1;
      },
      "Duplicate physical position.",
    ],
    [
      "assisted group on a manual race",
      (s) => {
        race(s, "r1").assistedGroupId = "assist";
      },
      "Race reconstruction group not found.",
    ],
    [
      "assisted group with another ID",
      (s) => {
        race(s, "r6").assistedGroupId = "other";
      },
      "Race reconstruction group not found.",
    ],
    [
      "assisted group not targeting the race",
      (s) => {
        race(s, "r4").assistedGroupId = "assist";
      },
      "Race reconstruction group not found.",
    ],
    [
      "assisted group without assistance",
      (s) => {
        delete mg(s).assistance;
      },
      "Assisted race group: missing or invalid object.",
    ],
    [
      "duplicate occurrence number",
      (s) => {
        race(s, "r3").number = 1;
      },
      "Duplicate occurrence number.",
    ],
    [
      "number defaults to list position",
      (s) => {
        delete race(s, "r1").number;
        race(s, "r3").number = 1;
      },
      "Duplicate occurrence number.",
    ],
    [
      "discarded races may repeat a number",
      (s) => {
        race(s, "r2").number = 1;
      },
      ACCEPTED,
    ],
    [
      "screenshot shared by two races",
      (s) => {
        race(s, "r4").captureIds = ["c1"];
      },
      "A screenshot is associated with more than one race.",
    ],
    [
      "thirteen confirmed races",
      (s) => {
        mg(s).races = many(13, (i) => ({ id: `r${i}`, origin: "manual", number: i + 1, placements: [...P] }));
      },
      "More than twelve races counted.",
      minimal,
    ],
    [
      "confirmed race awaiting review",
      (s) => {
        race(s, "r1").participationReview = "check";
      },
      "A result awaiting review was marked as confirmed.",
    ],
    [
      "discarded race with placements awaiting review is skipped",
      (s) => {
        race(s, "r2").participationReview = "check";
      },
      ACCEPTED,
    ],
    [
      "confirmed race with the substitute before entry",
      (s) => {
        race(s, "r1").placements = [...P3];
      },
      "A confirmed result uses an identity outside its participation segment.",
    ],
    [
      "discarded race with the substitute before entry",
      (s) => {
        race(s, "r2").placements = [...P3];
      },
      "A confirmed result uses an identity outside its participation segment.",
    ],
    [
      "confirmed race absent player outside the segment",
      (s) => {
        race(s, "r3").absentParticipantIds = ["p0"];
      },
      "A confirmed result uses an identity outside its participation segment.",
    ],
  ]);
});

test("validateRace: identity, result, sources and histories", () => {
  const removal = (s: J) => race(s, "r3").sourceRemovalHistory[0];
  const history = (s: J) => race(s, "r3").participationHistory[0];
  expectAll([
    [
      "track unknown",
      (s) => {
        race(s, "r1").track = "Crown City";
      },
      "Invalid race track.",
    ],
    [
      "track null",
      (s) => {
        race(s, "r1").track = null;
      },
      "Invalid race track.",
    ],
    [
      "origin not text",
      (s) => {
        race(s, "r1").origin = 5;
      },
      "Race origin: invalid text.",
    ],
    [
      "origin automatic",
      (s) => {
        race(s, "r1").origin = "automatic";
      },
      "Race origin is unsupported in this version.",
    ],
    [
      "physical position 0",
      (s) => {
        race(s, "r1").physicalNumber = 0;
      },
      "Physical position: invalid number.",
    ],
    [
      "physical position 1000",
      (s) => {
        race(s, "r6").physicalNumber = 1000;
      },
      "Physical position: invalid number.",
    ],
    [
      "occurrence number 0",
      (s) => {
        race(s, "r1").number = 0;
      },
      "Occurrence number: invalid number.",
    ],
    [
      "status unknown",
      (s) => {
        race(s, "r1").status = "done";
      },
      "Invalid race status.",
    ],
    [
      "status not text",
      (s) => {
        race(s, "r1").status = 1;
      },
      "Invalid race status.",
    ],
    [
      "placements not a list",
      (s) => {
        delete race(s, "r1").placements;
      },
      "Placements: missing or invalid list.",
    ],
    [
      "placement unknown",
      (s) => {
        race(s, "r1").placements[0] = "zz";
      },
      "Placements: missing or duplicate reference.",
    ],
    [
      "placement not text",
      (s) => {
        race(s, "r1").placements[0] = 0;
      },
      "Placements: invalid text.",
    ],
    [
      "absent player unknown",
      (s) => {
        race(s, "r3").absentParticipantIds = ["zz"];
      },
      "Absent players: missing or duplicate reference.",
    ],
    [
      "placed and absent",
      (s) => {
        race(s, "r3").absentParticipantIds = ["p1"];
      },
      "Inconsistent placements and absences.",
    ],
    [
      "thirteen placements",
      (s) => {
        race(s, "r1").placements.push("s1");
      },
      "Inconsistent placements and absences.",
    ],
    [
      "nine placements",
      (s) => {
        race(s, "r1").placements.splice(9);
        race(s, "r1").absentParticipantIds = ["p9", "p10", "p11"];
      },
      "Incomplete or invalid confirmed result.",
    ],
    [
      "eleven placements without absences",
      (s) => {
        race(s, "r1").placements.pop();
      },
      "Incomplete or invalid confirmed result.",
    ],
    [
      "pending race accepts any placements",
      (s) => {
        race(s, "r6").placements = ["p0"];
      },
      ACCEPTED,
    ],
    [
      "removal history not a list",
      (s) => {
        race(s, "r3").sourceRemovalHistory = {};
      },
      "Results without sources: missing or invalid list.",
    ],
    [
      "removal entry not an object",
      (s) => {
        race(s, "r3").sourceRemovalHistory = [1];
      },
      "Result without a source: missing or invalid object.",
    ],
    [
      "removal date invalid",
      (s) => {
        removal(s).removedAt = "x";
      },
      "Source removal: invalid date.",
    ],
    [
      "removed source empty",
      (s) => {
        removal(s).captureId = "";
      },
      "Removed source: invalid text.",
    ],
    [
      "removed source unknown",
      (s) => {
        removal(s).captureId = "zz";
      },
      "Removed historical source not found.",
    ],
    [
      "removal result missing",
      (s) => {
        delete removal(s).result;
      },
      "Previous source result: missing or invalid object.",
    ],
    [
      "removal result manual",
      (s) => {
        removal(s).result.origin = "manual";
      },
      "Inconsistent removal history.",
    ],
    [
      "removal result of another race",
      (s) => {
        removal(s).result.id = "r1";
      },
      "Inconsistent removal history.",
    ],
    [
      "removal result with nested history",
      (s) => {
        removal(s).result.gameEvidenceHistory = [];
      },
      "Inconsistent removal history.",
    ],
    [
      "removal result not citing the source",
      (s) => {
        removal(s).result.captureIds = ["c1"];
      },
      "Inconsistent removal history.",
    ],
    [
      "removal result sources missing",
      (s) => {
        delete removal(s).result.captureIds;
      },
      "Previous result sources: missing or invalid list.",
    ],
    [
      "historical screenshots not a list",
      (s) => {
        history(s).result.captureIds = "c1";
      },
      "Historical screenshots: missing or invalid list.",
    ],
    [
      "historical screenshot not text",
      (s) => {
        history(s).result.captureIds = [1];
      },
      "Historical screenshot: invalid text.",
    ],
    [
      "historical screenshot need not exist",
      (s) => {
        history(s).result.captureIds = ["gone"];
      },
      ACCEPTED,
    ],
    [
      "race screenshot unknown",
      (s) => {
        race(s, "r3").captureIds = ["cDel"];
      },
      "Race screenshots: missing or duplicate reference.",
    ],
    [
      "in-game points not an object",
      (s) => {
        race(s, "r1").nativePoints = [15];
      },
      "In-game points: missing or invalid object.",
    ],
    [
      "in-game points unknown player",
      (s) => {
        race(s, "r1").nativePoints = { zz: 1 };
      },
      "In-game points: player not found.",
    ],
    [
      "in-game points 16",
      (s) => {
        race(s, "r1").nativePoints = { p0: 16 };
      },
      "In-game points: invalid number.",
    ],
    [
      "in-game points origin not an object",
      (s) => {
        race(s, "r1").nativePointOrigins = "manual";
      },
      "In-game points origin: missing or invalid object.",
    ],
    [
      "in-game points origin unknown",
      (s) => {
        race(s, "r1").nativePointOrigins = { p0: "ocr" };
      },
      "Invalid in-game points origin.",
    ],
    [
      "in-game points origin unknown player",
      (s) => {
        race(s, "r1").nativePointOrigins = { zz: "manual" };
      },
      "Invalid in-game points origin.",
    ],
    [
      "reconstruction history not a list",
      (s) => {
        race(s, "r4").reconstructionHistory = {};
      },
      "Reconstruction history: missing or invalid list.",
    ],
    [
      "reconstructed without provenance",
      (s) => {
        delete race(s, "r6").assistedGroupId;
      },
      "Reconstruction has no provenance.",
    ],
    [
      "numeric history not a list",
      (s) => {
        race(s, "r3").gameEvidenceHistory = {};
      },
      "Numeric history: missing or invalid list.",
    ],
    [
      "numeric history entry not an object",
      (s) => {
        race(s, "r3").gameEvidenceHistory = [null];
      },
      "Numeric history: missing or invalid object.",
    ],
    [
      "numeric history date invalid",
      (s) => {
        race(s, "r3").gameEvidenceHistory[0].changedAt = "x";
      },
      "Numeric review date: invalid date.",
    ],
    [
      "participation review not text",
      (s) => {
        race(s, "r4").participationReview = true;
      },
      "Participation review: invalid text.",
    ],
    [
      "participation history not a list",
      (s) => {
        race(s, "r3").participationHistory = {};
      },
      "Participation history: missing or invalid list.",
    ],
    [
      "participation history entry not an object",
      (s) => {
        race(s, "r3").participationHistory = ["x"];
      },
      "Participation history: missing or invalid object.",
    ],
    [
      "participation history date missing",
      (s) => {
        delete history(s).changedAt;
      },
      "History date: invalid text.",
    ],
    [
      "participation history reason blank",
      (s) => {
        history(s).reason = " ";
      },
      "History reason: invalid text.",
    ],
    [
      "participation history result missing",
      (s) => {
        delete history(s).result;
      },
      "Historical result: missing or invalid object.",
    ],
    [
      "participation history of another race",
      (s) => {
        history(s).result.id = "r1";
      },
      "Invalid identity or recursion in history.",
    ],
    [
      "participation history nested",
      (s) => {
        history(s).result.participationHistory = [];
      },
      "Invalid identity or recursion in history.",
    ],
    [
      "participation history result validated as a race",
      (s) => {
        history(s).result.status = "confirmed";
      },
      "Incomplete or invalid confirmed result.",
    ],
  ]);
});

test("validateGameEvidence", () => {
  expectAll([
    [
      "evidence not an object",
      (s) => {
        race(s, "r3").gameEvidence = 1;
      },
      "Numeric evidence: missing or invalid object.",
    ],
    [
      "stage not text",
      (s) => {
        ev(s).stage = 1;
      },
      "Numeric stage: invalid text.",
    ],
    [
      "stage unknown",
      (s) => {
        ev(s).stage = "final";
      },
      "Invalid numeric stage.",
    ],
    [
      "session empty",
      (s) => {
        ev(s).session = "";
      },
      "Numeric session: invalid text.",
    ],
    [
      "verified not boolean",
      (s) => {
        ev(s).verified = "yes";
      },
      "Invalid final totals confirmation.",
    ],
    [
      "verified before post-race",
      (s) => {
        ev(s).stage = "animation";
      },
      "Invalid final totals confirmation.",
    ],
    [
      "row associations not an object",
      (s) => {
        ev(s).rowAssociations = [];
      },
      "Numeric row associations: missing or invalid object.",
    ],
    [
      "row associations unknown source",
      (s) => {
        ev(s).rowAssociations = { zz: [...P] };
      },
      "Numeric association source not found.",
    ],
    [
      "row associations unknown player",
      (s) => {
        ev(s).rowAssociations.c1[0] = "zz";
      },
      "Numeric row identities: missing or duplicate reference.",
    ],
    [
      "row associations of eleven rows",
      (s) => {
        ev(s).rowAssociations.c1.pop();
      },
      "Numeric associations must preserve twelve rows.",
    ],
    [
      "readings not an object",
      (s) => {
        delete ev(s).readings;
      },
      "Readings by identity: missing or invalid object.",
    ],
    [
      "reading for an unknown player",
      (s) => {
        ev(s).readings = { zz: {} };
      },
      "Numeric identity not found.",
    ],
    [
      "reading not an object",
      (s) => {
        ev(s).readings = { p1: 1 };
      },
      "Reading by identity: missing or invalid object.",
    ],
    [
      "reading segment empty",
      (s) => {
        rd(s).segment = "";
      },
      "Numeric segment: invalid text.",
    ],
    [
      "anchor choice not boolean",
      (s) => {
        rd(s).useAsAnchor = 1;
      },
      "Invalid anchor choice.",
    ],
    [
      "game value not an object",
      (s) => {
        rd(s).current = 12;
      },
      "Game value: missing or invalid object.",
    ],
    [
      "current value 16",
      (s) => {
        rd(s).current.value = 16;
      },
      "Game value: invalid number.",
    ],
    [
      "cumulative value 10000",
      (s) => {
        rd(s).cumulative = manual(10000);
      },
      "Game value: invalid number.",
    ],
    [
      "origin not text",
      (s) => {
        rd(s).current.origin = 1;
      },
      "Numeric origin: invalid text.",
    ],
    [
      "origin unknown",
      (s) => {
        rd(s).current.origin = "ocr";
      },
      "Invalid numeric origin.",
    ],
    [
      "observed value without source",
      (s) => {
        rd(s).current.origin = "observed";
      },
      "Numeric source: invalid text.",
    ],
    [
      "manual value with a partial source",
      (s) => {
        rd(s).current.sourceRow = 1;
      },
      "Numeric source: invalid text.",
    ],
    [
      "source unknown",
      (s) => {
        rd(s).cumulative.sourceCaptureId = "zz";
      },
      "Numeric source not found and has no removal record.",
    ],
    [
      "source row 13",
      (s) => {
        rd(s).cumulative.sourceRow = 13;
      },
      "Numeric source row: invalid number.",
    ],
    [
      "source field missing",
      (s) => {
        delete rd(s).cumulative.sourceField;
      },
      "Numeric source field: invalid text.",
    ],
    [
      "source field left",
      (s) => {
        rd(s).cumulative.sourceField = "left";
      },
      "Invalid numeric source field.",
    ],
    [
      "observed total from the addition",
      (s) => {
        rd(s).cumulative.sourceField = "addition";
      },
      "Numeric source field does not represent a total.",
    ],
    [
      "verified row associated with another player",
      (s) => {
        ev(s).rowAssociations.c1.reverse();
      },
      "Numeric source is associated with another identity; review pending.",
    ],
    [
      "observed value differs from the reading",
      (s) => {
        rd(s).cumulative.value = 50;
      },
      "Numeric source does not match the observed value.",
    ],
    [
      "observed source without numeric rows",
      (s) => {
        delete cap(s, "c1").numericRows;
        delete interp(s).currentScale;
      },
      "Numeric source rows: missing or invalid list.",
    ],
    [
      "observed value from a removed source is not compared",
      (s) => {
        swap(rd(s).cumulative, { sourceCaptureId: "cDel", value: 1 });
        delete ev(s).rowAssociations;
      },
      ACCEPTED,
    ],
  ]);
});

test("validateNumericReading", () => {
  expectAll([
    [
      "reading not an object",
      (s) => {
        cap(s, "c1").numericRows[0].right = null;
      },
      "Numeric reading: missing or invalid object.",
    ],
    [
      "text not text",
      (s) => {
        nr(s).text = 100;
      },
      "Numeric text: invalid text.",
    ],
    [
      "confidence 101",
      (s) => {
        nr(s).confidence = 101;
      },
      "Numeric confidence: invalid number.",
    ],
    [
      "confidence negative",
      (s) => {
        nr(s).confidence = -1;
      },
      "Numeric confidence: invalid number.",
    ],
    [
      "uncertainty not boolean",
      (s) => {
        nr(s).uncertain = "no";
      },
      "Invalid numeric uncertainty.",
    ],
    [
      "value undefined (only null means unread)",
      (s) => {
        delete nr(s).value;
      },
      "Numeric value: invalid number.",
    ],
    [
      "right value 10000",
      (s) => {
        swap(nr(s), { text: "10000", value: 10000 });
      },
      "Numeric value: invalid number.",
    ],
    [
      "addition value 100",
      (s) => {
        swap(cap(s, "c1").numericRows[0].addition, { text: "+100", value: 100 });
      },
      "Numeric value: invalid number.",
    ],
    [
      "value differs from text",
      (s) => {
        nr(s).text = "12";
      },
      "Numeric value does not match the observed text.",
    ],
    [
      "addition without plus sign",
      (s) => {
        cap(s, "c1").numericRows[0].addition.text = "15";
      },
      "Numeric value does not match the observed text.",
    ],
    [
      "missing value marked certain",
      (s) => {
        swap(nr(s), { value: null, uncertain: false });
      },
      "A missing numeric value cannot be marked as certain.",
    ],
    [
      "location not an object",
      (s) => {
        delete nr(s).location;
      },
      "Numeric location: missing or invalid object.",
    ],
    [
      "location x 1920",
      (s) => {
        nr(s).location.x = 1920;
      },
      "Location x: invalid number.",
    ],
    [
      "location y 1080",
      (s) => {
        nr(s).location.y = 1080;
      },
      "Location y: invalid number.",
    ],
    [
      "width 0",
      (s) => {
        nr(s).location.width = 0;
      },
      "Numeric width: invalid number.",
    ],
    [
      "height 1081",
      (s) => {
        nr(s).location.height = 1081;
      },
      "Numeric height: invalid number.",
    ],
    [
      "crop past the right edge",
      (s) => {
        swap(nr(s).location, { x: 1871, width: 50 });
      },
      "Numeric crop is outside the normalized screenshot.",
    ],
    [
      "crop past the bottom edge",
      (s) => {
        swap(nr(s).location, { y: 1031, height: 50 });
      },
      "Numeric crop is outside the normalized screenshot.",
    ],
    [
      "alternatives not a list",
      (s) => {
        nr(s).alternatives = {};
      },
      "Alternative readings: missing or invalid list.",
    ],
    [
      "alternative not an object",
      (s) => {
        nr(s).alternatives = ["1"];
      },
      "Alternative reading: missing or invalid object.",
    ],
    [
      "alternative value differs from text",
      (s) => {
        nr(s).alternatives[0].value = 2;
      },
      "Numeric value does not match the observed text.",
    ],
    [
      "alternative confidence missing",
      (s) => {
        delete nr(s).alternatives[0].confidence;
      },
      "Numeric confidence: invalid number.",
    ],
    [
      "observed position reading",
      (s) => {
        interp(s).positions[0].value = 2;
      },
      "Numeric value does not match the observed text.",
    ],
    [
      "group total reading",
      (s) => {
        interp(s).groups[0].total = {};
      },
      "Numeric text: invalid text.",
    ],
  ]);
});

test("validateCaptureRecognition: context, drafts, rows and numeric rows", () => {
  const ctxDraft = (s: J) => cap(s, "c2").contextDraft;
  const validRow = (i: number) => ({ text: "", confidence: 1, uncertain: false, suggestedParticipantId: P[i % 12] });
  expectAll([
    [
      "capture photo moment source",
      (s) => {
        cap(s, "c1").photoMoment.source = "x";
      },
      "Photo moment: invalid source.",
    ],
    [
      "capture receivedAt fractional",
      (s) => {
        cap(s, "c1").receivedAt = 0.5;
      },
      "Screenshot received: invalid number.",
    ],
    [
      "context not an object",
      (s) => {
        cap(s, "c3").context = "after";
      },
      "Screenshot context: missing or invalid object.",
    ],
    [
      "context phase unknown",
      (s) => {
        cap(s, "c3").context.phase = "during";
      },
      "Invalid context phase.",
    ],
    [
      "context race not text",
      (s) => {
        cap(s, "c3").context.raceId = 3;
      },
      "Context race: invalid text.",
    ],
    [
      "context on a finish-order screenshot",
      (s) => {
        cap(s, "c1").context = { phase: "after" };
      },
      "Context cannot declare a finish order.",
    ],
    [
      "context interpretation not an object",
      (s) => {
        cap(s, "c3").interpretation = "x";
      },
      "Context interpretation: missing or invalid object.",
    ],
    [
      "before phase without a screen",
      (s) => {
        cap(s, "c3").context.phase = "before";
      },
      "Context phase does not match the screenshot.",
    ],
    [
      "after phase on a before screen",
      (s) => {
        cap(s, "c2").context.phase = "after";
      },
      "Context phase does not match the screenshot.",
    ],
    [
      "context draft not an object",
      (s) => {
        cap(s, "c2").contextDraft = [];
      },
      "Context draft: missing or invalid object.",
    ],
    [
      "context draft associations not matching rows",
      (s) => {
        ctxDraft(s).nameAssociations.push({ participantId: "p2" });
      },
      "Associations do not match the source rows.",
    ],
    [
      "context draft answer on an unseen row",
      (s) => {
        ctxDraft(s).numericAnswers[0].row = 3;
      },
      "Answer has no observed row.",
    ],
    [
      "context draft group total without groups",
      (s) => {
        ctxDraft(s).groupTotalAnswers = [{ group: 1, value: 1 }];
      },
      "Reported total has no observed group.",
    ],
    [
      "context draft next track after the race",
      (s) => {
        cap(s, "c3").contextDraft = blankFields({ nextTrackAnswer: "CC" });
      },
      "Next track name has no before-race context.",
    ],
    [
      "context draft next track with an interpretation that is not an object",
      (s) => {
        cap(s, "c3").contextDraft = blankFields({ nextTrackAnswer: "CC" });
        delete cap(s, "c3").context;
        cap(s, "c3").interpretation = "x";
      },
      "Track source: missing or invalid object.",
    ],
    [
      "context draft group total with an interpretation that is not an object",
      (s) => {
        cap(s, "c3").contextDraft = blankFields({ groupTotalAnswers: [{ group: 1, value: 1 }] });
        delete cap(s, "c3").context;
        cap(s, "c3").interpretation = 1;
      },
      "Source interpretation: missing or invalid object.",
    ],
    [
      "context draft placements missing",
      (s) => {
        delete ctxDraft(s).placements;
      },
      "Context draft identities: missing or invalid list.",
    ],
    [
      "context draft absence unknown",
      (s) => {
        ctxDraft(s).absentParticipantIds = ["zz"];
      },
      "Context draft absences: missing or duplicate reference.",
    ],
    [
      "context draft reviewed missing",
      (s) => {
        delete ctxDraft(s).reviewed;
      },
      "Invalid context draft.",
    ],
    [
      "screenshot date negative",
      (s) => {
        cap(s, "c1").lastModified = -1;
      },
      "Screenshot date: invalid number.",
    ],
    [
      "deductions not a list",
      (s) => {
        cap(s, "c1").numericDeductions = {};
      },
      "Numeric answers: missing or invalid list.",
    ],
    [
      "deduction row 13",
      (s) => {
        cap(s, "c1").numericDeductions[0].row = 13;
      },
      "Answer row: invalid number.",
    ],
    [
      "deduction without deduced origin",
      (s) => {
        delete cap(s, "c1").numericDeductions[0].origin;
      },
      "Invalid deduced number.",
    ],
    [
      "deduction on an unseen row",
      (s) => {
        cap(s, "c2").numericDeductions = [{ row: 3, field: "right", value: 1, origin: "deduced" }];
      },
      "Invalid deduced number.",
    ],
    [
      "name associations not a list",
      (s) => {
        cap(s, "c1").nameAssociations = {};
      },
      "Name associations: missing or invalid list.",
    ],
    [
      "name associations not one per row",
      (s) => {
        cap(s, "c1").nameAssociations.pop();
      },
      "Invalid name associations.",
    ],
    [
      "name association not an object",
      (s) => {
        cap(s, "c1").nameAssociations[0] = "p0";
      },
      "Name association: missing or invalid object.",
    ],
    [
      "name association player undefined (only null means none)",
      (s) => {
        delete cap(s, "c1").nameAssociations[0].participantId;
      },
      "Associated player: invalid text.",
    ],
    [
      "name association player unknown",
      (s) => {
        cap(s, "c1").nameAssociations[0].participantId = "zz";
      },
      "Invalid or duplicate name association.",
    ],
    [
      "name association player repeated",
      (s) => {
        cap(s, "c1").nameAssociations[1].participantId = "p0";
      },
      "Invalid or duplicate name association.",
    ],
    [
      "name association origin unknown",
      (s) => {
        cap(s, "c1").nameAssociations[0].origin = "user";
      },
      "Invalid name associations.",
    ],
    [
      "name association unlinked not boolean",
      (s) => {
        cap(s, "c1").nameAssociations[11].unlinked = 1;
      },
      "Invalid name associations.",
    ],
    [
      "name association unlinked with a player",
      (s) => {
        cap(s, "c1").nameAssociations[0].unlinked = true;
      },
      "Invalid name associations.",
    ],
    [
      "accepted IGN not text",
      (s) => {
        cap(s, "c1").nameAssociations[0].ign = 1;
      },
      "Accepted IGN spelling: invalid text.",
    ],
    [
      "accepted IGN of 81 characters",
      (s) => {
        cap(s, "c1").nameAssociations[0].ign = long(81);
      },
      "Accepted IGN spelling exceeds 80 characters.",
    ],
    [
      "numeric answers not a list",
      (s) => {
        cap(s, "c1").numericAnswers = 1;
      },
      "Numeric answers: missing or invalid list.",
    ],
    [
      "numeric answer not an object",
      (s) => {
        cap(s, "c1").numericAnswers = [1];
      },
      "Numeric answer: missing or invalid object.",
    ],
    [
      "numeric answer row 0",
      (s) => {
        cap(s, "c1").numericAnswers[0].row = 0;
      },
      "Answer row: invalid number.",
    ],
    [
      "numeric answer field addition",
      (s) => {
        cap(s, "c1").numericAnswers[0].field = "addition";
      },
      "Invalid or duplicate numeric answer.",
    ],
    [
      "numeric answer row repeated",
      (s) => {
        cap(s, "c1").numericAnswers.push({ row: 1, field: "right", value: 1 });
      },
      "Invalid or duplicate numeric answer.",
    ],
    [
      "numeric answer value 10000",
      (s) => {
        cap(s, "c1").numericAnswers[0].value = 10000;
      },
      "Reported total: invalid number.",
    ],
    [
      "numeric answer on an unseen row",
      (s) => {
        cap(s, "c2").numericAnswers = [{ row: 3, field: "right", value: 1 }];
      },
      "Answer has no observed row.",
    ],
    [
      "group answers not a list",
      (s) => {
        cap(s, "c1").groupTotalAnswers = {};
      },
      "Reported group totals: missing or invalid list.",
    ],
    [
      "group answer not an object",
      (s) => {
        cap(s, "c1").groupTotalAnswers = [null];
      },
      "Reported group total: missing or invalid object.",
    ],
    [
      "group answer group 13",
      (s) => {
        cap(s, "c1").groupTotalAnswers[0].group = 13;
      },
      "Reported group: invalid number.",
    ],
    [
      "group answer repeated",
      (s) => {
        cap(s, "c1").groupTotalAnswers.push({ group: 1, value: 2 });
      },
      "Duplicate reported group.",
    ],
    [
      "group answer value 100000",
      (s) => {
        cap(s, "c1").groupTotalAnswers[0].value = 100000;
      },
      "Group total: invalid number.",
    ],
    [
      "group answer for an unseen group",
      (s) => {
        cap(s, "c1").groupTotalAnswers[0].group = 2;
      },
      "Reported total has no observed group.",
    ],
    [
      "file name missing",
      (s) => {
        delete cap(s, "c1").fileName;
      },
      "File name: invalid text.",
    ],
    [
      "width 0",
      (s) => {
        cap(s, "c1").width = 0;
      },
      "Screenshot width: invalid number.",
    ],
    [
      "height missing",
      (s) => {
        delete cap(s, "c1").height;
      },
      "Screenshot height: invalid number.",
    ],
    [
      "stage unknown",
      (s) => {
        cap(s, "c1").stage = "pending";
      },
      "Unsupported screenshot stage.",
    ],
    [
      "rows not a list",
      (s) => {
        cap(s, "c3").rows = {};
      },
      "Recognized rows: missing or invalid list.",
    ],
    [
      "thirteen rows",
      (s) => {
        cap(s, "c3").rows = many(13, validRow);
      },
      "Invalid observed row count.",
    ],
    [
      "finish order with eleven rows",
      (s) => {
        const c = cap(s, "c1");
        c.rows.pop();
        delete c.nameAssociations;
        delete c.numericRows;
        delete c.interpretation;
        delete c.numericAnswers;
        delete c.groupTotalAnswers;
        delete c.numericDeductions;
        race(s, "r3").gameEvidence = undefined;
      },
      "Invalid observed row count.",
    ],
    [
      "row not an object",
      (s) => {
        cap(s, "c1").rows[1] = 1;
      },
      "Recognized row: missing or invalid object.",
    ],
    [
      "row text not text",
      (s) => {
        row0(s).text = null;
      },
      "Recognized name: invalid text.",
    ],
    [
      "row confidence 101",
      (s) => {
        row0(s).confidence = 101;
      },
      "OCR confidence: invalid number.",
    ],
    [
      "row location not an object",
      (s) => {
        row0(s).location = 1;
      },
      "Name region: missing or invalid object.",
    ],
    [
      "row bounds x 1920",
      (s) => {
        row0(s).bounds.x = 1920;
      },
      "Name x: invalid number.",
    ],
    [
      "row bounds y -1",
      (s) => {
        row0(s).bounds.y = -1;
      },
      "Name y: invalid number.",
    ],
    [
      "row location width 0",
      (s) => {
        row0(s).location.width = 0;
      },
      "Name width: invalid number.",
    ],
    [
      "row location height 0",
      (s) => {
        row0(s).location.height = 0;
      },
      "Name height: invalid number.",
    ],
    [
      "row region past the edge",
      (s) => {
        swap(row0(s).location, { x: 1900, width: 21 });
      },
      "Name region is outside the screenshot.",
    ],
    [
      "row region past the edge skips the height check",
      (s) => {
        swap(row0(s).location, { x: 1900, width: 21, height: 0 });
      },
      "Name region is outside the screenshot.",
    ],
    [
      "row alternatives not a list",
      (s) => {
        row0(s).alternatives = "x";
      },
      "Alternative names: missing or invalid list.",
    ],
    [
      "row alternative not an object",
      (s) => {
        row0(s).alternatives = ["x"];
      },
      "Alternative name: missing or invalid object.",
    ],
    [
      "row alternative text missing",
      (s) => {
        delete row0(s).alternatives[0].text;
      },
      "Alternative name: invalid text.",
    ],
    [
      "row alternative confidence 101",
      (s) => {
        row0(s).alternatives[0].confidence = 101;
      },
      "Alternative confidence: invalid number.",
    ],
    [
      "row uncertainty not boolean",
      (s) => {
        row0(s).uncertain = null;
      },
      "Invalid recognized association.",
    ],
    [
      "row uncertainty checked before the player text",
      (s) => {
        row0(s).uncertain = null;
        row0(s).suggestedParticipantId = 1;
      },
      "Invalid recognized association.",
    ],
    [
      "row player not text",
      (s) => {
        row0(s).suggestedParticipantId = 1;
      },
      "Recognized player: invalid text.",
    ],
    [
      "row player unknown",
      (s) => {
        row0(s).suggestedParticipantId = "zz";
      },
      "Invalid recognized association.",
    ],
    [
      "fingerprint empty",
      (s) => {
        cap(s, "c1").fingerprint = "";
      },
      "Screenshot fingerprint: invalid text.",
    ],
    [
      "fingerprint not a hash",
      (s) => {
        cap(s, "c1").fingerprint = "abc";
      },
      "Invalid screenshot fingerprint.",
    ],
    [
      "stage suggestion not text",
      (s) => {
        cap(s, "c1").numericStageSuggestion = 1;
      },
      "Numeric stage suggestion: invalid text.",
    ],
    [
      "stage suggestion post-race",
      (s) => {
        cap(s, "c1").numericStageSuggestion = "post-race";
      },
      "Invalid numeric stage suggestion.",
    ],
    [
      "numeric rows not a list",
      (s) => {
        cap(s, "c1").numericRows = {};
      },
      "Numeric rows: missing or invalid list.",
    ],
    [
      "eleven numeric rows",
      (s) => {
        cap(s, "c1").numericRows.pop();
      },
      "Numeric screenshot must preserve twelve rows.",
    ],
    [
      "numeric row not an object",
      (s) => {
        cap(s, "c1").numericRows[0] = 1;
      },
      "Numeric row: missing or invalid object.",
    ],
    [
      "numeric row number 13",
      (s) => {
        cap(s, "c1").numericRows[0].row = 13;
      },
      "Numeric row: invalid number.",
    ],
    [
      "numeric row repeated",
      (s) => {
        cap(s, "c1").numericRows[1].row = 1;
      },
      "Duplicate numeric row.",
    ],
    [
      "points scale not read",
      (s) => {
        swap(cap(s, "c1").numericRows[0].addition, { text: "+14", value: 14 });
      },
      "Readings do not support the full points scale.",
    ],
    [
      "points scale uncertain",
      (s) => {
        cap(s, "c1").numericRows[0].addition.uncertain = true;
      },
      "Readings do not support the full points scale.",
    ],
    [
      "points scale without numeric rows",
      (s) => {
        delete cap(s, "c1").numericRows;
      },
      "Native scale rows: missing or invalid list.",
    ],
    [
      "possibly absent unknown",
      (s) => {
        cap(s, "c1").possibleAbsentParticipantIds = ["zz"];
      },
      "Possibly absent players: missing or duplicate reference.",
    ],
    [
      "unread rows not a list",
      (s) => {
        cap(s, "c1").unreadableRowNumbers = 12;
      },
      "Unread rows: missing or invalid list.",
    ],
    [
      "unread row 13",
      (s) => {
        cap(s, "c1").unreadableRowNumbers = [13];
      },
      "Unread row: invalid number.",
    ],
  ]);
});

test("validateCaptureInterpretation", () => {
  expectAll([
    [
      "not an object",
      (s) => {
        cap(s, "c1").interpretation = [];
      },
      "Screenshot interpretation: missing or invalid object.",
    ],
    [
      "version 2",
      (s) => {
        interp(s).version = 2;
      },
      "Invalid screenshot interpretation.",
    ],
    [
      "origin unknown",
      (s) => {
        interp(s).origin = "ocr";
      },
      "Invalid screenshot interpretation.",
    ],
    [
      "screen unknown",
      (s) => {
        interp(s).screen = "results";
      },
      "Invalid screenshot interpretation.",
    ],
    [
      "legacy order key",
      (s) => {
        interp(s).order = "finishOrder";
      },
      "Invalid screenshot interpretation.",
    ],
    [
      "positions not one per row",
      (s) => {
        interp(s).positions.pop();
      },
      "Invalid screenshot interpretation.",
    ],
    [
      "position reading not an object",
      (s) => {
        interp(s).positions[0] = 1;
      },
      "Numeric reading: missing or invalid object.",
    ],
    [
      "next track not an object",
      (s) => {
        cap(s, "c2").interpretation.nextTrack = "CC";
      },
      "Next track: missing or invalid object.",
    ],
    [
      "next track text not text",
      (s) => {
        track(s).text = 1;
      },
      "Next track reading: invalid text.",
    ],
    [
      "next track confidence 101",
      (s) => {
        track(s).confidence = 101;
      },
      "Track confidence: invalid number.",
    ],
    [
      "next track uncertainty not boolean",
      (s) => {
        delete track(s).uncertain;
      },
      "Invalid next track.",
    ],
    [
      "next track region not an object",
      (s) => {
        track(s).location = [];
      },
      "Track region: missing or invalid object.",
    ],
    [
      "next track x 1920",
      (s) => {
        track(s).location.x = 1920;
      },
      "Track x: invalid number.",
    ],
    [
      "next track y 1080",
      (s) => {
        track(s).location.y = 1080;
      },
      "Track y: invalid number.",
    ],
    [
      "next track width 0",
      (s) => {
        track(s).location.width = 0;
      },
      "Track width: invalid number.",
    ],
    [
      "next track height 0",
      (s) => {
        track(s).location.height = 0;
      },
      "Track height: invalid number.",
    ],
    [
      "next track region past the edge",
      (s) => {
        swap(track(s).location, { y: 1060, height: 21 });
      },
      "Track region is outside the screenshot.",
    ],
    [
      "next track region past the right edge skips the height check",
      (s) => {
        swap(track(s).location, { x: 1900, width: 21, height: 0 });
      },
      "Track region is outside the screenshot.",
    ],
    [
      "next track alternatives not a list",
      (s) => {
        track(s).alternatives = "CC";
      },
      "Alternative tracks: missing or invalid list.",
    ],
    [
      "next track alternative not an object",
      (s) => {
        track(s).alternatives = [1];
      },
      "Alternative track: missing or invalid object.",
    ],
    [
      "next track alternative text missing",
      (s) => {
        delete track(s).alternatives[0].text;
      },
      "Alternative track: invalid text.",
    ],
    [
      "next track alternative confidence -1",
      (s) => {
        track(s).alternatives[0].confidence = -1;
      },
      "Alternative track confidence: invalid number.",
    ],
    [
      "groups not a list",
      (s) => {
        interp(s).groups = {};
      },
      "Observed groups: missing or invalid list.",
    ],
    [
      "group not an object",
      (s) => {
        interp(s).groups = [1];
      },
      "Observed group: missing or invalid object.",
    ],
    [
      "group rows not a list",
      (s) => {
        delete interp(s).groups[0].rows;
      },
      "Group rows: missing or invalid list.",
    ],
    [
      "group rows empty",
      (s) => {
        interp(s).groups[0].rows = [];
      },
      "Observed group is empty.",
    ],
    [
      "group row 13",
      (s) => {
        interp(s).groups[0].rows = [13];
      },
      "Group row: invalid number.",
    ],
    [
      "row in two groups",
      (s) => {
        interp(s).groups.push({ rows: [2] });
      },
      "Row appears in multiple groups.",
    ],
    [
      "group label empty",
      (s) => {
        interp(s).groups[0].label = "";
      },
      "Group label: invalid text.",
    ],
    [
      "represented origin without represented players",
      (s) => {
        delete interp(s).represented;
      },
      "Invalid represented players origin.",
    ],
    [
      "represented origin unknown",
      (s) => {
        interp(s).representedBy = "ocr";
      },
      "Invalid represented players origin.",
    ],
    [
      "represented origin not text",
      (s) => {
        interp(s).representedBy = 1;
      },
      "Represented players origin: invalid text.",
    ],
    [
      "represented players 9",
      (s) => {
        interp(s).represented = 9;
      },
      "Screenshot represented players: invalid number.",
    ],
    [
      "represented players 13",
      (s) => {
        interp(s).represented = 13;
      },
      "Screenshot represented players: invalid number.",
    ],
    [
      "points scale 13",
      (s) => {
        interp(s).currentScale = 13;
      },
      "Screenshot points scale: invalid number.",
    ],
    [
      "points scale on a before screen",
      (s) => {
        cap(s, "c2").interpretation.currentScale = 12;
      },
      "Invalid screenshot interpretation.",
    ],
    [
      "reasons not a list",
      (s) => {
        delete interp(s).reasons;
      },
      "Interpretation basis: missing or invalid list.",
    ],
    [
      "reason empty",
      (s) => {
        interp(s).reasons = [""];
      },
      "Interpretation basis: invalid text.",
    ],
    [
      "movements not a list",
      (s) => {
        delete interp(s).movementRows;
      },
      "Standings movements: missing or invalid list.",
    ],
    [
      "movement repeated",
      (s) => {
        interp(s).movementRows = [1, 1];
      },
      "Duplicate movements.",
    ],
    [
      "movement row 13",
      (s) => {
        interp(s).movementRows = [13];
      },
      "Movement row: invalid number.",
    ],
    [
      "movement on a before screen",
      (s) => {
        cap(s, "c2").interpretation.movementRows = [1];
      },
      "Invalid screenshot interpretation.",
    ],
  ]);
});

test("validateSequence and validateCoverage", () => {
  const link = (s: J) => seq(s).links[0];
  const relation = (s: J) => seq(s).relations[0];
  const occurrence = (s: J) => seq(s).occurrences[0];
  const gap = (s: J) => seq(s).gaps[0];
  const coverage = (s: J) => mg(s).coverage;
  expectAll([
    [
      "not an object",
      (s) => {
        mg(s).sequence = [];
      },
      "Screenshot sequence: missing or invalid object.",
    ],
    [
      "version 2",
      (s) => {
        seq(s).version = 2;
      },
      "Invalid sequence version.",
    ],
    [
      "signature empty",
      (s) => {
        seq(s).inputSignature = "";
      },
      "Invalid sequence signature.",
    ],
    [
      "signature of 500001 characters",
      (s) => {
        seq(s).inputSignature = long(500001);
      },
      "Invalid sequence signature.",
    ],
    [
      "projected race unknown",
      (s) => {
        seq(s).projectedRaceIds = ["zz"];
      },
      "Projected races: missing or duplicate reference.",
    ],
    [
      "associations not a list",
      (s) => {
        seq(s).associations = {};
      },
      "Derived associations: missing or invalid list.",
    ],
    [
      "association not an object",
      (s) => {
        seq(s).associations = [1];
      },
      "Derived association: missing or invalid object.",
    ],
    [
      "association source not text",
      (s) => {
        seq(s).associations[0].captureId = 1;
      },
      "Derived source: invalid text.",
    ],
    [
      "association race unknown",
      (s) => {
        seq(s).associations[0].raceId = "zz";
      },
      "Invalid or duplicate derived association.",
    ],
    [
      "association source repeated",
      (s) => {
        seq(s).associations.push({ captureId: "c1", raceId: "r1" });
      },
      "Invalid or duplicate derived association.",
    ],
    [
      "room analysis not an object",
      (s) => {
        seq(s).roomAnalysis = 1;
      },
      "Room analysis: missing or invalid object.",
    ],
    [
      "room analysis origin observed",
      (s) => {
        room(s).origin = "observed";
      },
      "Invalid room analysis origin.",
    ],
    [
      "room sessions not a list",
      (s) => {
        delete room(s).sessions;
      },
      "Room sessions: missing or invalid list.",
    ],
    [
      "room session not an object",
      (s) => {
        room(s).sessions = [1];
      },
      "Room sessions: missing or invalid object.",
    ],
    [
      "room sessions repeated",
      (s) => {
        room(s).sessions.push({ ...room(s).sessions[0] });
      },
      "Room sessions: duplicate IDs.",
    ],
    [
      "room session source unknown",
      (s) => {
        room(s).sessions[0].captureIds = ["zz"];
      },
      "Room sources: missing or duplicate reference.",
    ],
    [
      "room reopening not boolean",
      (s) => {
        delete room(s).sessions[0].reopening;
      },
      "Invalid room reopening.",
    ],
    [
      "room start 100",
      (s) => {
        room(s).sessions[0].start = 100;
      },
      "Room start: invalid number.",
    ],
    [
      "room candidates not a list",
      (s) => {
        room(s).sessions[0].candidates = 1;
      },
      "Room candidates: missing or invalid list.",
    ],
    [
      "room candidate 0",
      (s) => {
        room(s).sessions[0].candidates = [0];
      },
      "Room candidate: invalid number.",
    ],
    [
      "room screenshots not a list",
      (s) => {
        delete room(s).captures;
      },
      "Room screenshots: missing or invalid list.",
    ],
    [
      "room screenshot not an object",
      (s) => {
        room(s).captures = [1];
      },
      "Room screenshot: missing or invalid object.",
    ],
    [
      "room screenshot source not text",
      (s) => {
        roomCap(s).captureId = 1;
      },
      "Room source: invalid text.",
    ],
    [
      "room screenshot session unknown",
      (s) => {
        roomCap(s).sessionId = "zz";
      },
      "Invalid room source.",
    ],
    [
      "room screenshot repeated",
      (s) => {
        room(s).captures.push({ ...roomCap(s) });
      },
      "Invalid room source.",
    ],
    [
      "room coordinate 100",
      (s) => {
        roomCap(s).j = 100;
      },
      "Room coordinate: invalid number.",
    ],
    [
      "room deduced number 0",
      (s) => {
        roomCap(s).number = 0;
      },
      "Deduced number: invalid number.",
    ],
    [
      "room suggestion 100",
      (s) => {
        roomCap(s).suggestion = 100;
      },
      "Suggested number: invalid number.",
    ],
    [
      "room placements unknown",
      (s) => {
        roomCap(s).placements = ["zz"];
      },
      "Deduced placements: missing or duplicate reference.",
    ],
    [
      "room conflict rows not a list",
      (s) => {
        roomCap(s).conflictRows = 1;
      },
      "Conflicting rows: missing or invalid list.",
    ],
    [
      "room conflict row 13",
      (s) => {
        roomCap(s).conflictRows = [13];
      },
      "Conflicting row: invalid number.",
    ],
    [
      "room readings not a list",
      (s) => {
        delete roomCap(s).values;
      },
      "Deduced readings: missing or invalid list.",
    ],
    [
      "room reading not an object",
      (s) => {
        roomCap(s).values = [1];
      },
      "Deduced reading: missing or invalid object.",
    ],
    [
      "room reading row 13",
      (s) => {
        roomCap(s).values[0].row = 13;
      },
      "Deduced row: invalid number.",
    ],
    [
      "room reading value 10000",
      (s) => {
        roomCap(s).values[0].value = 10000;
      },
      "Deduced points: invalid number.",
    ],
    [
      "room reading origin observed",
      (s) => {
        roomCap(s).values[0].origin = "observed";
      },
      "Invalid deduced origin.",
    ],
    [
      "room segments not a list",
      (s) => {
        delete roomCap(s).segments;
      },
      "Room segments: missing or invalid list.",
    ],
    [
      "room segment not an object",
      (s) => {
        roomCap(s).segments = [1];
      },
      "Room segment: missing or invalid object.",
    ],
    [
      "room segment player unknown",
      (s) => {
        roomCap(s).segments[0].participantId = "zz";
      },
      "Invalid room segment.",
    ],
    [
      "room segment anchor not boolean",
      (s) => {
        roomCap(s).segments[0].anchor = 1;
      },
      "Invalid room segment.",
    ],
    [
      "room segment ID empty",
      (s) => {
        roomCap(s).segments[0].id = "";
      },
      "Numeric segment: invalid text.",
    ],
    [
      "room conflicts unknown",
      (s) => {
        room(s).conflicts = ["zz"];
      },
      "Room conflicts: missing or duplicate reference.",
    ],
    [
      "room order not an object",
      (s) => {
        room(s).order = 1;
      },
      "Room order: missing or invalid object.",
    ],
    [
      "room order session unknown",
      (s) => {
        room(s).order.sessionIds = ["zz"];
      },
      "Unordered rooms: missing or duplicate reference.",
    ],
    [
      "room order source unknown",
      (s) => {
        room(s).order.captureIds = ["zz"];
      },
      "Unordered sources: missing or duplicate reference.",
    ],
    [
      "conflict empty",
      (s) => {
        seq(s).conflict = "";
      },
      "Sequence conflict: invalid text.",
    ],
    [
      "origins not a list",
      (s) => {
        seq(s).origins = {};
      },
      "Totals origin: missing or invalid list.",
    ],
    [
      "origin not an object",
      (s) => {
        seq(s).origins = [1];
      },
      "Totals origin: missing or invalid object.",
    ],
    [
      "origin source not text",
      (s) => {
        seq(s).origins[0].captureId = 1;
      },
      "Origin source: invalid text.",
    ],
    [
      "origin answer unknown",
      (s) => {
        seq(s).origins[0].answer = "yes";
      },
      "Invalid or duplicate origin fact.",
    ],
    [
      "origin signature empty",
      (s) => {
        seq(s).origins[0].signature = "";
      },
      "Invalid sequence signature.",
    ],
    [
      "numbers not a list",
      (s) => {
        delete seq(s).numbers;
      },
      "Reported numbers: missing or invalid list.",
    ],
    [
      "number not an object",
      (s) => {
        seq(s).numbers = [1];
      },
      "Reported number: missing or invalid object.",
    ],
    [
      "number source not text",
      (s) => {
        seq(s).numbers[0].captureId = 1;
      },
      "Number source: invalid text.",
    ],
    [
      "number source repeated",
      (s) => {
        seq(s).numbers[1].captureId = "c1";
      },
      "Number source not found or duplicated.",
    ],
    [
      "number physical position 0",
      (s) => {
        seq(s).numbers[0].physicalNumber = 0;
      },
      "Source physical position: invalid number.",
    ],
    [
      "number 100",
      (s) => {
        seq(s).numbers[0].number = 100;
      },
      "Reported number: invalid number.",
    ],
    [
      "number undefined (only null means unknown)",
      (s) => {
        delete seq(s).numbers[1].number;
      },
      "Reported number: invalid number.",
    ],
    [
      "number phase unknown",
      (s) => {
        seq(s).numbers[0].phase = "during";
      },
      "Invalid number phase.",
    ],
    [
      "links not a list",
      (s) => {
        delete seq(s).links;
      },
      "Screenshot relations: missing or invalid list.",
    ],
    [
      "link not an object",
      (s) => {
        seq(s).links = [1];
      },
      "Relation: missing or invalid object.",
    ],
    [
      "link start not text",
      (s) => {
        link(s).fromCaptureId = 1;
      },
      "Previous source: invalid text.",
    ],
    [
      "link end not text",
      (s) => {
        link(s).toCaptureId = 1;
      },
      "Next source: invalid text.",
    ],
    [
      "link to itself",
      (s) => {
        link(s).toCaptureId = "c1";
      },
      "Invalid or duplicate relation sources.",
    ],
    [
      "link repeated",
      (s) => {
        seq(s).links.push({ ...link(s) });
      },
      "Invalid or duplicate relation sources.",
    ],
    [
      "link signature missing",
      (s) => {
        delete link(s).signature;
      },
      "Invalid sequence signature.",
    ],
    [
      "link continuity unknown",
      (s) => {
        link(s).continuity = "maybe";
      },
      "Invalid continuity.",
    ],
    [
      "link people not a list",
      (s) => {
        link(s).people = {};
      },
      "Individual continuity: missing or invalid list.",
    ],
    [
      "link person not an object",
      (s) => {
        link(s).people = [1];
      },
      "Individual continuity: missing or invalid object.",
    ],
    [
      "link person not text",
      (s) => {
        link(s).people[0].participantId = 1;
      },
      "Continuity identity: invalid text.",
    ],
    [
      "link person answer unknown",
      (s) => {
        link(s).people[0].answer = "maybe";
      },
      "Invalid individual continuity.",
    ],
    [
      "link validity unknown",
      (s) => {
        link(s).validity = "maybe";
      },
      "Invalid validity.",
    ],
    [
      "relations not a list",
      (s) => {
        delete seq(s).relations;
      },
      "Proven physical relations: missing or invalid list.",
    ],
    [
      "relation not an object",
      (s) => {
        seq(s).relations = [1];
      },
      "Physical relation: missing or invalid object.",
    ],
    [
      "relation boundary unknown",
      (s) => {
        relation(s).fromCaptureId = "zz";
      },
      "Physical boundaries: missing or duplicate reference.",
    ],
    [
      "relation boundaries equal",
      (s) => {
        relation(s).toCaptureId = "c1";
      },
      "Physical boundaries: missing or duplicate reference.",
    ],
    [
      "relation distance 100",
      (s) => {
        relation(s).completedSteps = 100;
      },
      "Physical distance: invalid number.",
    ],
    [
      "relation identities not a list",
      (s) => {
        delete relation(s).resetParticipantIds;
      },
      "Relation identities: missing or invalid list.",
    ],
    [
      "relation identity not text",
      (s) => {
        relation(s).resetParticipantIds = [1];
      },
      "Relation identity: invalid text.",
    ],
    [
      "relation identity in two lists",
      (s) => {
        relation(s).resetParticipantIds = ["p0"];
      },
      "Invalid or duplicate relation identity.",
    ],
    [
      "occurrences not a list",
      (s) => {
        delete seq(s).occurrences;
      },
      "Physical occurrences: missing or invalid list.",
    ],
    [
      "occurrence not an object",
      (s) => {
        seq(s).occurrences = [1];
      },
      "Physical occurrences: missing or invalid object.",
    ],
    [
      "occurrences repeated",
      (s) => {
        seq(s).occurrences[1].id = "r3";
      },
      "Physical occurrences: duplicate IDs.",
    ],
    [
      "occurrence physical position 1000",
      (s) => {
        occurrence(s).physicalNumber = 1000;
      },
      "Occurrence physical position: invalid number.",
    ],
    [
      "occurrence source unknown",
      (s) => {
        occurrence(s).captureIds = ["zz"];
      },
      "Occurrence sources: missing or duplicate reference.",
    ],
    [
      "occurrence without sources",
      (s) => {
        occurrence(s).captureIds = [];
      },
      "Physical source not found or duplicated.",
    ],
    [
      "occurrence source shared",
      (s) => {
        seq(s).occurrences[1].captureIds = ["c1"];
      },
      "Physical source not found or duplicated.",
    ],
    [
      "occurrence aliases not a list",
      (s) => {
        delete occurrence(s).aliases;
      },
      "Reconciled identities: missing or invalid list.",
    ],
    [
      "occurrence alias not text",
      (s) => {
        occurrence(s).aliases = [1];
      },
      "Reconciled identity: invalid text.",
    ],
    [
      "occurrence alias is an occurrence",
      (s) => {
        occurrence(s).aliases = ["o2"];
      },
      "Duplicate physical identity.",
    ],
    [
      "occurrence counted number 100",
      (s) => {
        occurrence(s).number = 100;
      },
      "Counted number: invalid number.",
    ],
    [
      "occurrence race other than its ID",
      (s) => {
        seq(s).occurrences[1].raceId = "r3";
      },
      "Invalid physical race identity.",
    ],
    [
      "gaps not a list",
      (s) => {
        delete seq(s).gaps;
      },
      "Gaps: missing or invalid list.",
    ],
    [
      "gap not an object",
      (s) => {
        seq(s).gaps = [1];
      },
      "Gaps: missing or invalid object.",
    ],
    [
      "gaps repeated",
      (s) => {
        seq(s).gaps.push({ ...gap(s) });
      },
      "Gaps: duplicate IDs.",
    ],
    [
      "gap boundary not text",
      (s) => {
        gap(s).fromId = 1;
      },
      "Gap boundary: invalid text.",
    ],
    [
      "gap boundaries equal",
      (s) => {
        gap(s).toId = "r3";
      },
      "Invalid gap boundaries.",
    ],
    [
      "gap boundary unknown",
      (s) => {
        gap(s).toId = "zz";
      },
      "Invalid gap boundaries.",
    ],
    [
      "gap with one source",
      (s) => {
        gap(s).sourceCaptureIds = ["c1"];
      },
      "Invalid gap boundaries.",
    ],
    [
      "gap source unknown",
      (s) => {
        gap(s).sourceCaptureIds = ["c1", "zz"];
      },
      "Gap sources: missing or duplicate reference.",
    ],
    [
      "gap order unknown value",
      (s) => {
        gap(s).order = "backward";
      },
      "Invalid gap order.",
    ],
    [
      "gap of unknown order with a count",
      (s) => {
        gap(s).order = "unknown";
      },
      "Invalid gap order.",
    ],
    [
      "gap count 100",
      (s) => {
        gap(s).count = 100;
      },
      "Physical count: invalid number.",
    ],
    [
      "gap valid count without count",
      (s) => {
        delete gap(s).count;
      },
      "Counted amount has no known physical count.",
    ],
    [
      "gap valid count above count",
      (s) => {
        gap(s).validCount = 3;
      },
      "Counted amount: invalid number.",
    ],
    [
      "coverage version 2",
      (s) => {
        coverage(s).version = 2;
      },
      "Proven total: invalid data or references.",
    ],
    [
      "coverage interval total not 82 per race",
      (s) => {
        coverage(s).intervals[0].values[0].raw = 14;
        coverage(s).intervals[0].values[0].adjusted = 14;
      },
      "Proven total: invalid data or references.",
    ],
    [
      "coverage history from an unknown source",
      (s) => {
        coverage(s).history[0].contribution.sourceCaptureIds = ["zz"];
      },
      "Proven total: invalid data or references.",
    ],
  ]);
});

test("validateRaceDraft, validateCaptureReview and validateOrderReview", () => {
  const fields = (s: J) => draft(s).fields;
  const i1Draft = (s: J) => item(s, 0).draft;
  expectAll([
    [
      "draft not an object",
      (s) => {
        mg(s).raceDraft = 1;
      },
      "Race draft: missing or invalid object.",
    ],
    [
      "draft version 2",
      (s) => {
        draft(s).version = 2;
      },
      "Invalid draft version or origin.",
    ],
    [
      "draft purpose unknown",
      (s) => {
        draft(s).purpose = "import";
      },
      "Invalid draft version or origin.",
    ],
    [
      "draft purpose not text",
      (s) => {
        draft(s).purpose = 1;
      },
      "Draft origin: invalid text.",
    ],
    [
      "draft race empty",
      (s) => {
        draft(s).raceId = "";
      },
      "Draft race: invalid text.",
    ],
    [
      "draft number 0",
      (s) => {
        draft(s).number = 0;
      },
      "Draft number: invalid number.",
    ],
    [
      "draft date invalid",
      (s) => {
        draft(s).updatedAt = "now";
      },
      "Draft date: invalid date.",
    ],
    [
      "edit origin undefined (only null means new)",
      (s) => {
        delete draft(s).baseSignature;
      },
      "Edit origin: invalid text.",
    ],
    [
      "edit origin not a hash",
      (s) => {
        draft(s).baseSignature = "abc";
      },
      "Invalid edit origin.",
    ],
    [
      "edit origin for an unknown race",
      (s) => {
        draft(s).baseSignature = H;
      },
      "Draft's source race not found.",
    ],
    [
      "new draft for an existing race",
      (s) => {
        draft(s).raceId = "r1";
      },
      "Edit origin is missing.",
    ],
    [
      "manual draft with an image",
      (s) => {
        draft(s).sourceCaptureId = "c1";
      },
      "Invalid draft screenshot origin.",
    ],
    [
      "capture draft without an image",
      (s) => {
        delete draft(s).sourceCaptureId;
      },
      "Invalid draft screenshot origin.",
      teams,
    ],
    [
      "capture draft with both images",
      (s) => {
        draft(s).sourceFileId = "f1";
      },
      "Invalid draft screenshot origin.",
      teams,
    ],
    [
      "capture draft file not text",
      (s) => {
        delete draft(s).sourceCaptureId;
        draft(s).sourceFileId = 1;
      },
      "Draft file: invalid text.",
      teams,
    ],
    [
      "capture draft file unknown",
      (s) => {
        delete draft(s).sourceCaptureId;
        draft(s).sourceFileId = "zz";
      },
      "Draft file not found.",
      teams,
    ],
    [
      "capture draft screenshot unknown",
      (s) => {
        draft(s).sourceCaptureId = "cDel";
      },
      "Draft screenshot not found.",
      teams,
    ],
    [
      "draft fields not an object",
      (s) => {
        draft(s).fields = [];
      },
      "Draft fields: missing or invalid object.",
    ],
    [
      "draft placement unknown",
      (s) => {
        fields(s).placements = ["zz"];
      },
      "Draft placements: missing or duplicate reference.",
    ],
    [
      "draft absence unknown",
      (s) => {
        fields(s).absentParticipantIds = ["zz"];
      },
      "Draft absent players: missing or duplicate reference.",
    ],
    [
      "draft placed and absent",
      (s) => {
        fields(s).absentParticipantIds = ["p0"];
      },
      "Invalid draft fields.",
    ],
    [
      "draft reviewed not boolean",
      (s) => {
        delete fields(s).reviewed;
      },
      "Invalid draft fields.",
    ],
    [
      "draft of thirteen players",
      (s) => {
        fields(s).placements = [...P];
        fields(s).absentParticipantIds = ["s1"];
      },
      "Invalid draft fields.",
    ],
    [
      "draft thirteen name associations",
      (s) => {
        fields(s).nameAssociations = many(13, () => ({ participantId: null }));
      },
      "Invalid name associations.",
    ],
    [
      "draft group answer repeated",
      (s) => {
        fields(s).groupTotalAnswers.push({ group: 1, value: 1 });
      },
      "Duplicate reported group.",
    ],
    [
      "draft numeric answer field",
      (s) => {
        fields(s).numericAnswers[0].field = "x";
      },
      "Invalid or duplicate numeric answer.",
    ],
    [
      "draft next track not text",
      (s) => {
        fields(s).nextTrackAnswer = 1;
      },
      "Reported next track name: invalid text.",
      teams,
    ],
    [
      "draft next track of 121 characters",
      (s) => {
        fields(s).nextTrackAnswer = long(121);
      },
      "Invalid reported next track name.",
      teams,
    ],
    [
      "manual draft with a next track",
      (s) => {
        fields(s).nextTrackAnswer = "CC";
      },
      "Next track name has no screenshot source.",
    ],
    [
      "draft points for thirteen keys",
      (s) => {
        fields(s).rawOverrides = Object.fromEntries(many(13, (i) => [`k${i}`, "1"] as const));
      },
      "Too many points in the draft.",
    ],
    [
      "draft points for an unknown player",
      (s) => {
        fields(s).rawOverrides = { zz: "1" };
      },
      "Invalid draft points.",
    ],
    [
      "draft points not text",
      (s) => {
        fields(s).rawOverrides = { p0: 15 };
      },
      "Edited points: invalid text.",
    ],
    [
      "capture draft next track from an after screen",
      (s) => {
        draft(s).sourceCaptureId = "c1";
        fields(s).nameAssociations = undefined;
      },
      "Next track name has no before-race context.",
      teams,
    ],
    [
      "capture draft associations not one per source row",
      (s) => {
        fields(s).nameAssociations.pop();
      },
      "Associations do not match the source rows.",
      teams,
    ],
    [
      "review not an object",
      (s) => {
        mg(s).captureReview = [];
      },
      "Screenshot review: missing or invalid object.",
    ],
    [
      "review version 2",
      (s) => {
        review(s).version = 2;
      },
      "Invalid screenshot review version.",
    ],
    [
      "review batch empty",
      (s) => {
        review(s).id = "";
      },
      "Review batch: invalid text.",
    ],
    [
      "review items not a list",
      (s) => {
        delete review(s).items;
      },
      "Review screenshots: missing or invalid list.",
    ],
    [
      "review without items",
      (s) => {
        review(s).items = [];
      },
      "Invalid review screenshot count.",
    ],
    [
      "review of 33 items",
      (s) => {
        review(s).items = many(33, (i) => ({ id: `x${i}` }));
      },
      "Invalid review screenshot count.",
    ],
    [
      "review item not an object",
      (s) => {
        review(s).items[2] = 1;
      },
      "Review screenshots: missing or invalid object.",
    ],
    [
      "review items repeated",
      (s) => {
        item(s, 2).id = "i1";
      },
      "Review screenshots: duplicate IDs.",
    ],
    [
      "review cursor not text",
      (s) => {
        review(s).currentItemId = 1;
      },
      "Review cursor: invalid text.",
    ],
    [
      "review cursor unknown",
      (s) => {
        review(s).currentItemId = "zz";
      },
      "Invalid review cursor.",
    ],
    [
      "review number 100",
      (s) => {
        item(s, 2).number = 100;
      },
      "Screenshot number: invalid number.",
    ],
    [
      "review number knowledge not boolean",
      (s) => {
        item(s, 2).numberKnown = "no";
      },
      "Invalid number knowledge state.",
    ],
    [
      "review association not text",
      (s) => {
        item(s, 2).association = null;
      },
      "Screenshot association: invalid text.",
    ],
    [
      "review association unknown",
      (s) => {
        item(s, 2).association = "zz";
      },
      "Review race not found.",
    ],
    [
      "review stage not text",
      (s) => {
        item(s, 2).status = 1;
      },
      "Review stage: invalid text.",
    ],
    [
      "review stage unknown",
      (s) => {
        item(s, 2).status = "done";
      },
      "Invalid review stage.",
    ],
    [
      "review separation empty",
      (s) => {
        item(s, 2).separation = "";
      },
      "Separation reason: invalid text.",
    ],
    [
      "review separation on a saved image",
      (s) => {
        item(s, 1).separation = "Other";
      },
      "A separate screenshot cannot be accepted.",
    ],
    [
      "review discard not boolean",
      (s) => {
        item(s, 2).discarded = "yes";
      },
      "Invalid review discard.",
    ],
    [
      "review origin not an object",
      (s) => {
        item(s, 2).source = "c2";
      },
      "Review origin: missing or invalid object.",
    ],
    [
      "review origin with file and screenshot",
      (s) => {
        item(s, 2).source.fileId = "f2";
      },
      "Invalid review origin.",
    ],
    [
      "review origin empty",
      (s) => {
        item(s, 2).source = {};
      },
      "Invalid review origin.",
    ],
    [
      "review origin not text",
      (s) => {
        item(s, 2).source = { captureId: 1 };
      },
      "Review screenshot: invalid text.",
    ],
    [
      "saved image of unknown number without context",
      (s) => {
        swap(item(s, 1), { source: { captureId: "c1" }, numberKnown: false });
      },
      "Race number is not yet known.",
    ],
    [
      "saved context image of unknown number",
      (s) => {
        item(s, 1).numberKnown = false;
      },
      ACCEPTED,
    ],
    [
      "review file unknown",
      (s) => {
        item(s, 0).source.fileId = "zz";
      },
      "Review screenshot not found.",
    ],
    [
      "review screenshot unknown",
      (s) => {
        item(s, 2).source.captureId = "cDel";
      },
      "Review screenshot not found.",
    ],
    [
      "review screenshot repeated",
      (s) => {
        item(s, 2).source.captureId = "c3";
      },
      "Duplicate review screenshot.",
    ],
    [
      "review file claimed by another mogi",
      (s) => {
        const other = minimal().mogis[0];
        other.id = "m2";
        other.captureReview = {
          version: 1,
          id: "x",
          currentItemId: "y",
          items: [{ id: "y", source: { fileId: "f1" }, number: 1, association: "new", status: "waiting" }],
        };
        s.mogis.unshift(other);
      },
      "Duplicate review screenshot.",
    ],
    [
      "saved pending file",
      (s) => {
        item(s, 0).status = "saved";
      },
      "Invalid review confirmation.",
    ],
    [
      "saved screenshot as a new race without context",
      (s) => {
        swap(item(s, 1), { source: { captureId: "c1" }, association: "new" });
      },
      "Invalid review confirmation.",
    ],
    [
      "recognition not an object",
      (s) => {
        item(s, 0).recognition = 1;
      },
      "Pending recognition: missing or invalid object.",
    ],
    [
      "recognition ID empty",
      (s) => {
        item(s, 0).recognition.id = "";
      },
      "Pending screenshot: invalid text.",
    ],
    [
      "recognition with original bytes",
      (s) => {
        item(s, 0).recognition.original = null;
      },
      "Pending recognition is not a confirmed screenshot.",
    ],
    [
      "recognition with a review date",
      (s) => {
        item(s, 0).recognition.reviewedAt = AT;
      },
      "Pending recognition is not a confirmed screenshot.",
    ],
    [
      "recognition validated as a screenshot",
      (s) => {
        item(s, 0).recognition.stage = "x";
        delete item(s, 0).recognition.context;
      },
      "Unsupported screenshot stage.",
    ],
    [
      "recognition of another screenshot",
      (s) => {
        item(s, 1).recognition.id = "c2";
      },
      "Invalid screenshot recognition.",
    ],
    [
      "ready without recognition",
      (s) => {
        delete item(s, 0).recognition;
      },
      "Review recognition is missing.",
    ],
    [
      "image draft validated as a draft",
      (s) => {
        i1Draft(s).purpose = "manual";
      },
      "Invalid draft screenshot origin.",
    ],
    [
      "image draft next track without a before screen",
      (s) => {
        i1Draft(s).fields.nextTrackAnswer = "CC";
      },
      "Next track name has no before-race context.",
    ],
    [
      "image draft next track without recognition or screenshot",
      (s) => {
        item(s, 0).status = "waiting";
        delete item(s, 0).recognition;
        i1Draft(s).fields.nextTrackAnswer = "CC";
      },
      "Next track name has no screenshot source.",
    ],
    [
      "image draft for another race",
      (s) => {
        i1Draft(s).raceId = "i2";
      },
      "Inconsistent screenshot draft.",
    ],
    [
      "image draft for another file",
      (s) => {
        i1Draft(s).sourceFileId = "f2";
      },
      "Inconsistent screenshot draft.",
    ],
    [
      "duplicate warning not text",
      (s) => {
        item(s, 0).duplicate = 1;
      },
      "Duplicate warning: invalid text.",
    ],
    [
      "recognition failure empty",
      (s) => {
        item(s, 0).error = "";
      },
      "Recognition failure: invalid text.",
    ],
    [
      "order review not an object",
      (s) => {
        mg(s).orderReview = 1;
      },
      "Sequence review: missing or invalid object.",
    ],
    [
      "order date invalid",
      (s) => {
        order(s).acceptedAt = "x";
      },
      "Sequence date: invalid date.",
    ],
    [
      "order signature empty",
      (s) => {
        order(s).inputSignature = "";
      },
      "Invalid sequence evidence identifier.",
    ],
    [
      "order signature of 1000001 characters",
      (s) => {
        order(s).inputSignature = long(1000001);
      },
      "Invalid sequence evidence identifier.",
    ],
    [
      "order race unknown",
      (s) => {
        order(s).raceIds = ["zz"];
      },
      "Ordered occurrences: missing or duplicate reference.",
    ],
    [
      "order basis not text",
      (s) => {
        order(s).basis = 1;
      },
      "Sequence basis: invalid text.",
    ],
    [
      "order basis unknown",
      (s) => {
        order(s).basis = "guess";
      },
      "Invalid sequence basis.",
    ],
    [
      "unresolved race unknown",
      (s) => {
        order(s).unresolvedRaceIds = ["zz"];
      },
      "Uncompared occurrences: missing or duplicate reference.",
    ],
    [
      "unresolved race also ordered",
      (s) => {
        order(s).unresolvedRaceIds = ["r1"];
      },
      "An ordered occurrence is also marked as not compared.",
    ],
    [
      "order gaps not a list",
      (s) => {
        delete order(s).gaps;
      },
      "Numeric intervals: missing or invalid list.",
    ],
    [
      "order gap not an object",
      (s) => {
        order(s).gaps = [1];
      },
      "Numeric interval: missing or invalid object.",
    ],
    [
      "order gap start not text",
      (s) => {
        order(s).gaps[0].fromRaceId = 1;
      },
      "Interval start: invalid text.",
    ],
    [
      "order gap end not text",
      (s) => {
        order(s).gaps[0].toRaceId = 1;
      },
      "Interval end: invalid text.",
    ],
    [
      "order gap not adjacent",
      (s) => {
        order(s).gaps[0].toRaceId = "r1";
      },
      "Invalid numeric interval reference.",
    ],
    [
      "order anchors not a list",
      (s) => {
        delete order(s).gaps[0].anchors;
      },
      "Interval anchors: missing or invalid list.",
    ],
    [
      "order anchor not an object",
      (s) => {
        order(s).gaps[0].anchors = [1];
      },
      "Anchor: missing or invalid object.",
    ],
    [
      "order anchor player not text",
      (s) => {
        anchor(s).participantId = 1;
      },
      "Anchor identity: invalid text.",
    ],
    [
      "order anchor player unknown",
      (s) => {
        anchor(s).participantId = "zz";
      },
      "Invalid or duplicate anchor identity.",
    ],
    [
      "order anchor player repeated",
      (s) => {
        order(s).gaps[0].anchors.push({ ...anchor(s) });
      },
      "Invalid or duplicate anchor identity.",
    ],
    [
      "order previous total 10000",
      (s) => {
        anchor(s).olderTotal = 10000;
      },
      "Previous total: invalid number.",
    ],
    [
      "order following total missing",
      (s) => {
        delete anchor(s).newerTotal;
      },
      "Following total: invalid number.",
    ],
    [
      "order anchor points 0",
      (s) => {
        anchor(s).current = 0;
      },
      "Anchor points: invalid number.",
    ],
    [
      "order anchor points 16",
      (s) => {
        anchor(s).current = 16;
      },
      "Anchor points: invalid number.",
    ],
    [
      "order intermediate gain negative",
      (s) => {
        anchor(s).intermediateGain = -1;
      },
      "Intermediate gain: invalid number.",
    ],
    [
      "order equation off by one",
      (s) => {
        anchor(s).intermediateGain = 9;
      },
      "Inconsistent numeric interval equation.",
    ],
  ]);
});

test("validateReconstruction", () => {
  const knownRace = (s: J) => recon(s).knownRaces[0];
  const rAnchor = (s: J) => recon(s).anchors[0];
  expectAll([
    [
      "not an object",
      (s) => {
        race(s, "r4").reconstruction = 1;
      },
      "Reconstruction: missing or invalid object.",
    ],
    [
      "history entry not an object",
      (s) => {
        race(s, "r4").reconstructionHistory = [1];
      },
      "Reconstruction: missing or invalid object.",
    ],
    [
      "state not text",
      (s) => {
        recon(s).status = 1;
      },
      "Reconstruction state: invalid text.",
    ],
    [
      "state unknown",
      (s) => {
        recon(s).status = "done";
      },
      "Invalid reconstruction state.",
    ],
    [
      "date invalid",
      (s) => {
        recon(s).createdAt = "x";
      },
      "Reconstruction date: invalid date.",
    ],
    [
      "target 0",
      (s) => {
        recon(s).targetNumber = 0;
      },
      "Reconstructed occurrence: invalid number.",
    ],
    [
      "conclusion empty",
      (s) => {
        recon(s).message = "";
      },
      "Reconstruction conclusion: invalid text.",
    ],
    [
      "review signature empty",
      (s) => {
        recon(s).inputSignature = "";
      },
      "Invalid reconstruction review.",
    ],
    [
      "source occurrence not text",
      (s) => {
        recon(s).fromRaceId = 1;
      },
      "Reconstruction source: invalid text.",
    ],
    [
      "source occurrence unknown",
      (s) => {
        recon(s).toRaceId = "zz";
      },
      "Source occurrence not found.",
    ],
    [
      "session empty",
      (s) => {
        recon(s).session = "";
      },
      "Reconstruction session: invalid text.",
    ],
    [
      "screenshot unknown",
      (s) => {
        recon(s).sourceCaptureIds = ["zz"];
      },
      "Reconstruction screenshots: missing or duplicate reference.",
    ],
    [
      "removed screenshot accepted as a source",
      (s) => {
        recon(s).sourceCaptureIds = ["cDel"];
      },
      ACCEPTED,
    ],
    [
      "placement unknown",
      (s) => {
        recon(s).placements[0] = "zz";
      },
      "Reconstructed placements: missing or duplicate reference.",
    ],
    [
      "absences not a list",
      (s) => {
        delete recon(s).absentParticipantIds;
      },
      "Reconstructed absences: missing or invalid list.",
    ],
    [
      "three absences",
      (s) => {
        swap(recon(s), { status: "stale", placements: P3.slice(0, 9), absentParticipantIds: P3.slice(9) });
      },
      "Inconsistent reconstructed absences.",
    ],
    [
      "placed and absent",
      (s) => {
        swap(recon(s), { status: "stale", absentParticipantIds: ["p1"] });
      },
      "Inconsistent reconstructed absences.",
    ],
    [
      "represented 9",
      (s) => {
        recon(s).represented = 9;
      },
      "Reconstructed represented players: invalid number.",
    ],
    [
      "unique with represented differing from placements",
      (s) => {
        recon(s).represented = 11;
      },
      "Incomplete unique reconstruction.",
    ],
    [
      "unique without a source pair",
      (s) => {
        delete recon(s).fromRaceId;
      },
      "Incomplete unique reconstruction.",
    ],
    [
      "unique from and to the same race",
      (s) => {
        recon(s).toRaceId = "r3";
      },
      "Incomplete unique reconstruction.",
    ],
    [
      "boundary proof not an object",
      (s) => {
        race(s, "r5").reconstruction.boundaryAnalysis = 1;
      },
      "Boundary proof: missing or invalid object.",
    ],
    [
      "boundary proof validated as an analysis",
      (s) => {
        boundary(s).complete = false;
      },
      "Inconsistent assistance conclusion.",
    ],
    [
      "boundary proof not unique",
      (s) => {
        boundary(s).status = "insufficient";
      },
      "Boundaries do not prove uniqueness.",
    ],
    [
      "boundary proof with other sources",
      (s) => {
        boundary(s).sourceCaptureIds = ["c1"];
      },
      "Inconsistent reconstruction proof.",
    ],
    [
      "boundary proof with another result",
      (s) => {
        boundary(s).hypotheses[0].results[0].placements.reverse();
      },
      "Inconsistent reconstruction proof.",
    ],
    [
      "basis not text",
      (s) => {
        recon(s).orderBasis = 1;
      },
      "Reconstruction basis: invalid text.",
    ],
    [
      "basis unknown",
      (s) => {
        recon(s).orderBasis = "guess";
      },
      "Invalid reconstruction basis.",
    ],
    [
      "known races not a list",
      (s) => {
        delete recon(s).knownRaces;
      },
      "Known races: missing or invalid list.",
    ],
    [
      "known race not an object",
      (s) => {
        recon(s).knownRaces = [1];
      },
      "Known race: missing or invalid object.",
    ],
    [
      "known race not text",
      (s) => {
        knownRace(s).raceId = 1;
      },
      "Known source: invalid text.",
    ],
    [
      "known race unknown",
      (s) => {
        knownRace(s).raceId = "zz";
      },
      "Known race not found or duplicated.",
    ],
    [
      "known race repeated",
      (s) => {
        recon(s).knownRaces.push({ ...knownRace(s) });
      },
      "Known race not found or duplicated.",
    ],
    [
      "known number 0",
      (s) => {
        knownRace(s).number = 0;
      },
      "Known number: invalid number.",
    ],
    [
      "known represented 13",
      (s) => {
        knownRace(s).represented = 13;
      },
      "Known represented players: invalid number.",
    ],
    [
      "known discard not boolean",
      (s) => {
        delete knownRace(s).discarded;
      },
      "Invalid known discard.",
    ],
    [
      "known points not an object",
      (s) => {
        delete knownRace(s).nativePoints;
      },
      "Known in-game points: missing or invalid object.",
    ],
    [
      "known points unknown player",
      (s) => {
        knownRace(s).nativePoints = { zz: 1 };
      },
      "Known in-game points: player not found.",
    ],
    [
      "known points 16",
      (s) => {
        knownRace(s).nativePoints = { p0: 16 };
      },
      "Known in-game points: invalid number.",
    ],
    [
      "anchors not a list",
      (s) => {
        delete recon(s).anchors;
      },
      "Reconstruction anchors: missing or invalid list.",
    ],
    [
      "thirteen anchors",
      (s) => {
        recon(s).anchors = many(13, () => ({}));
      },
      "Too many anchors.",
    ],
    [
      "anchor not an object",
      (s) => {
        recon(s).anchors = [1];
      },
      "Reconstructed anchor: missing or invalid object.",
    ],
    [
      "anchor player not text",
      (s) => {
        rAnchor(s).participantId = 1;
      },
      "Reconstructed identity: invalid text.",
    ],
    [
      "anchor player unknown",
      (s) => {
        rAnchor(s).participantId = "zz";
      },
      "Invalid reconstructed identity.",
    ],
    [
      "anchor player repeated",
      (s) => {
        recon(s).anchors.push({ ...rAnchor(s) });
      },
      "Invalid reconstructed identity.",
    ],
    [
      "anchor segment empty",
      (s) => {
        rAnchor(s).segment = "";
      },
      "Reconstructed segment: invalid text.",
    ],
    [
      "anchor known gains negative",
      (s) => {
        rAnchor(s).known = -1;
      },
      "Known gains: invalid number.",
    ],
    [
      "anchor gain 10000",
      (s) => {
        rAnchor(s).gain = 10000;
      },
      "Reconstructed gain: invalid number.",
    ],
    [
      "anchor value validated as game evidence",
      (s) => {
        rAnchor(s).current.value = 16;
      },
      "Game value: invalid number.",
    ],
    [
      "anchor previous total missing",
      (s) => {
        delete rAnchor(s).older;
      },
      "Previous total: missing or invalid object.",
    ],
    [
      "anchor new total missing",
      (s) => {
        delete rAnchor(s).newer;
      },
      "New total: missing or invalid object.",
    ],
    [
      "anchor current points missing",
      (s) => {
        delete rAnchor(s).current;
      },
      "Current points: missing or invalid object.",
    ],
    [
      "anchor equation off by one",
      (s) => {
        rAnchor(s).gain = 9;
      },
      "Inconsistent reconstructed equation.",
    ],
  ]);
});

test("validateAssistance", () => {
  const f = (s: J) => asst(s).facts[0];
  const event = (s: J) => asst(s).factHistory[0];
  const origin = (s: J) => eq(s, 2).originFact;
  const confirmed = (s: J) => asst(s).confirmed;
  expectAll([
    [
      "not an object",
      (s) => {
        mg(s).assistance = [];
      },
      "Assisted reconstruction: missing or invalid object.",
    ],
    [
      "group ID empty",
      (s) => {
        asst(s).id = "";
      },
      "Assisted group: invalid text.",
    ],
    [
      "target race unknown",
      (s) => {
        asst(s).targetRaceIds = ["zz"];
      },
      "Assisted gaps: missing or duplicate reference.",
    ],
    [
      "facts not a list",
      (s) => {
        delete asst(s).facts;
      },
      "Known facts: missing or invalid list.",
    ],
    [
      "4097 facts",
      (s) => {
        asst(s).facts = many(4097, () => null);
      },
      "Too many facts.",
    ],
    [
      "fact not an object",
      (s) => {
        asst(s).facts = [1];
      },
      "Facts: missing or invalid object.",
    ],
    [
      "facts repeated",
      (s) => {
        asst(s).facts.push(fact("fact1"));
      },
      "Facts: duplicate IDs.",
    ],
    [
      "fact race not text",
      (s) => {
        f(s).raceId = 1;
      },
      "Fact race: invalid text.",
    ],
    [
      "fact race unknown",
      (s) => {
        f(s).raceId = "zz";
      },
      "Fact race: missing or duplicate reference.",
    ],
    [
      "fact player unknown",
      (s) => {
        f(s).participantId = "zz";
      },
      "Fact player: missing or duplicate reference.",
    ],
    [
      "fact position 13",
      (s) => {
        f(s).position = 13;
      },
      "Known position: invalid number.",
    ],
    [
      "fact origin deduced",
      (s) => {
        f(s).origin = "deduced";
      },
      "Invalid fact origin.",
    ],
    [
      "fact creation invalid",
      (s) => {
        f(s).createdAt = "x";
      },
      "Fact creation: invalid date.",
    ],
    [
      "fact review missing",
      (s) => {
        delete f(s).updatedAt;
      },
      "Fact review: invalid text.",
    ],
    [
      "fact history not a list",
      (s) => {
        delete asst(s).factHistory;
      },
      "Fact history: missing or invalid list.",
    ],
    [
      "101 fact events",
      (s) => {
        asst(s).factHistory = many(101, () => null);
      },
      "Fact history exceeds the limit.",
    ],
    [
      "fact event not an object",
      (s) => {
        asst(s).factHistory = [1];
      },
      "Fact event: missing or invalid object.",
    ],
    [
      "fact event action not text",
      (s) => {
        event(s).action = 1;
      },
      "Fact action: invalid text.",
    ],
    [
      "fact event action unknown",
      (s) => {
        event(s).action = "undo";
      },
      "Invalid fact action.",
    ],
    [
      "fact event date invalid",
      (s) => {
        event(s).at = "x";
      },
      "Fact date: invalid date.",
    ],
    [
      "fact event fact not an object",
      (s) => {
        event(s).fact = 1;
      },
      "Position fact: missing or invalid object.",
    ],
    [
      "fact event fact ID empty",
      (s) => {
        event(s).fact.id = "";
      },
      "Fact ID: invalid text.",
    ],
    [
      "skipped not an object",
      (s) => {
        asst(s).skipped = 1;
      },
      "Unknown questions: missing or invalid object.",
    ],
    [
      "skipped signature not a hash",
      (s) => {
        asst(s).skipped.signature = "x";
      },
      "Invalid assistance review.",
    ],
    [
      "skipped keys not a list",
      (s) => {
        delete asst(s).skipped.keys;
      },
      "Skipped questions: missing or invalid list.",
    ],
    [
      "4097 skipped keys",
      (s) => {
        asst(s).skipped.keys = many(4097, () => "");
      },
      "Too many skipped questions.",
    ],
    [
      "skipped key empty",
      (s) => {
        asst(s).skipped.keys = [""];
      },
      "Skipped question: invalid text.",
    ],
    [
      "skipped key without reference",
      (s) => {
        asst(s).skipped.keys = ["r6:zz"];
      },
      "Skipped question has no reference.",
    ],
    [
      "analysis not an object",
      (s) => {
        asst(s).analysis = 1;
      },
      "Assisted analysis: missing or invalid object.",
    ],
    [
      "analysis status not text",
      (s) => {
        an(s).status = 1;
      },
      "Assistance status: invalid text.",
    ],
    [
      "analysis status unknown",
      (s) => {
        an(s).status = "done";
      },
      "Invalid assistance status.",
    ],
    [
      "analysis input signature not a hash",
      (s) => {
        an(s).inputSignature = "x";
      },
      "Invalid assistance review.",
    ],
    [
      "analysis source signature missing",
      (s) => {
        delete an(s).sourceSignature;
      },
      "Invalid assistance review.",
    ],
    [
      "analysis date invalid",
      (s) => {
        an(s).createdAt = "x";
      },
      "Assisted analysis date: invalid date.",
    ],
    [
      "analysis conclusion empty",
      (s) => {
        an(s).message = "";
      },
      "Assistance conclusion: invalid text.",
    ],
    [
      "analysis order verification not boolean",
      (s) => {
        delete an(s).orderVerified;
      },
      "Invalid assistance completeness.",
    ],
    [
      "analysis facts not a list",
      (s) => {
        delete an(s).facts;
      },
      "Analysis facts: missing or invalid list.",
    ],
    [
      "4097 analysis facts",
      (s) => {
        an(s).facts = many(4097, () => null);
      },
      "Too many facts in the analysis.",
    ],
    [
      "analysis facts repeated",
      (s) => {
        an(s).facts.push(fact("fact1"));
      },
      "Analysis facts: duplicate IDs.",
    ],
    [
      "analysis target unknown",
      (s) => {
        an(s).targetRaceIds = ["zz"];
      },
      "Assisted occurrences: missing or duplicate reference.",
    ],
    [
      "hypotheses not a list",
      (s) => {
        delete an(s).hypotheses;
      },
      "Assisted hypotheses: missing or invalid list.",
    ],
    [
      "five hypotheses",
      (s) => {
        an(s).hypotheses = many(5, () => null);
      },
      "Too many hypothesis examples.",
    ],
    [
      "hypothesis not an object",
      (s) => {
        an(s).hypotheses = [1];
      },
      "Hypothesis: missing or invalid object.",
    ],
    [
      "hypothesis results not a list",
      (s) => {
        delete an(s).hypotheses[0].results;
      },
      "Hypothesis results: missing or invalid list.",
    ],
    [
      "hypothesis without results",
      (s) => {
        an(s).hypotheses[0].results = [];
      },
      "Incomplete hypothesis.",
    ],
    [
      "hypothesis result not an object",
      (s) => {
        an(s).hypotheses[0].results = [1];
      },
      "Hypothesis result: missing or invalid object.",
    ],
    [
      "hypothesis race not text",
      (s) => {
        hyp(s).raceId = 1;
      },
      "Hypothesis occurrence: invalid text.",
    ],
    [
      "hypothesis race not a target",
      (s) => {
        hyp(s).raceId = "r1";
      },
      "Invalid hypothesis reference.",
    ],
    [
      "hypothesis represented 9",
      (s) => {
        hyp(s).represented = 9;
      },
      "Hypothesis represented players: invalid number.",
    ],
    [
      "hypothesis placement unknown",
      (s) => {
        hyp(s).placements[0] = "zz";
      },
      "Hypothesis placements: missing or duplicate reference.",
    ],
    [
      "hypothesis absence unknown",
      (s) => {
        hyp(s).absentParticipantIds = ["zz"];
      },
      "Hypothesis absent players: missing or duplicate reference.",
    ],
    [
      "hypothesis represented differs from placements",
      (s) => {
        hyp(s).represented = 11;
      },
      "Inconsistent hypothesis context.",
    ],
    [
      "unique analysis incomplete",
      (s) => {
        an(s).complete = false;
      },
      "Inconsistent assistance conclusion.",
    ],
    [
      "conflict analysis with hypotheses",
      (s) => {
        an(s).status = "conflict";
      },
      "Inconsistent assistance conclusion.",
    ],
    [
      "ambiguous analysis with one hypothesis",
      (s) => {
        an(s).status = "ambiguous";
      },
      "Inconsistent assistance conclusion.",
    ],
    [
      "analysis source unknown",
      (s) => {
        an(s).sourceCaptureIds = ["zz"];
      },
      "Assisted sources: missing or duplicate reference.",
    ],
    [
      "contributions not a list",
      (s) => {
        delete an(s).knownRaces;
      },
      "Assisted contributions: missing or invalid list.",
    ],
    [
      "contribution not an object",
      (s) => {
        an(s).knownRaces = [1];
      },
      "Assisted known race: missing or invalid object.",
    ],
    [
      "contribution race not text",
      (s) => {
        known(s).raceId = 1;
      },
      "Native source: invalid text.",
    ],
    [
      "contribution race unknown",
      (s) => {
        known(s).raceId = "zz";
      },
      "Native source: missing or duplicate reference.",
    ],
    [
      "contribution repeated",
      (s) => {
        an(s).knownRaces.push({ ...known(s) });
      },
      "Duplicate native contribution.",
    ],
    [
      "contribution number 0",
      (s) => {
        known(s).number = 0;
      },
      "Native occurrence: invalid number.",
    ],
    [
      "contribution represented 9",
      (s) => {
        known(s).represented = 9;
      },
      "Native represented players: invalid number.",
    ],
    [
      "contribution discard not boolean",
      (s) => {
        known(s).discarded = 0;
      },
      "Invalid native discard.",
    ],
    [
      "contribution placement unknown",
      (s) => {
        known(s).placements[0] = "zz";
      },
      "Known placements: missing or duplicate reference.",
    ],
    [
      "contribution absence unknown",
      (s) => {
        known(s).absentParticipantIds = ["zz"];
      },
      "Known absences: missing or duplicate reference.",
    ],
    [
      "contribution represented differs from placements",
      (s) => {
        known(s).represented = 12;
      },
      "Inconsistent native context.",
    ],
    [
      "contribution points for an unknown player",
      (s) => {
        known(s).nativePoints = { zz: 1 };
      },
      "Native contribution: player not found.",
    ],
    [
      "contribution origins not an object",
      (s) => {
        delete known(s).nativePointOrigins;
      },
      "Native origins: missing or invalid object.",
    ],
    [
      "contribution origin for an absent player",
      (s) => {
        known(s).nativePointOrigins = { p11: "manual" };
      },
      "Invalid native origin.",
    ],
    [
      "equations not a list",
      (s) => {
        delete an(s).equations;
      },
      "Assisted equations: missing or invalid list.",
    ],
    [
      "20001 equations",
      (s) => {
        an(s).equations = many(20001, () => null);
      },
      "Too many equations.",
    ],
    [
      "equation not an object",
      (s) => {
        an(s).equations = [1];
      },
      "Assisted equation: missing or invalid object.",
    ],
    [
      "equation player not text",
      (s) => {
        eq(s, 0).participantId = 1;
      },
      "Equation identity: invalid text.",
    ],
    [
      "equation player unknown",
      (s) => {
        eq(s, 0).participantId = "zz";
      },
      "Equation identity: missing or duplicate reference.",
    ],
    [
      "origin fact on a race equation",
      (s) => {
        eq(s, 0).originFact = {};
      },
      "Reported origin has no boundary equation.",
    ],
    [
      "boundary false",
      (s) => {
        eq(s, 0).boundary = false;
      },
      "Invalid boundary equation.",
    ],
    [
      "boundary with current points",
      (s) => {
        eq(s, 1).current = manual(1);
      },
      "Invalid boundary equation.",
    ],
    [
      "boundary with source races",
      (s) => {
        eq(s, 1).toRaceId = "r3";
      },
      "Invalid boundary equation.",
    ],
    [
      "origin fact not an object",
      (s) => {
        eq(s, 2).originFact = 1;
      },
      "Reported equation origin: missing or invalid object.",
    ],
    [
      "origin start missing",
      (s) => {
        delete eq(s, 2).older;
      },
      "Reported start: missing or invalid object.",
    ],
    [
      "origin source unknown",
      (s) => {
        eq(s, 2).toCaptureId = "zz";
      },
      "Reported origin source: missing or duplicate reference.",
    ],
    [
      "origin kind unknown",
      (s) => {
        origin(s).kind = "guess";
      },
      "Invalid reported equation origin.",
    ],
    [
      "origin from another screenshot",
      (s) => {
        origin(s).captureId = "c1";
      },
      "Invalid reported equation origin.",
    ],
    [
      "origin start not zero",
      (s) => {
        eq(s, 2).older.value = 1;
      },
      "Invalid reported equation origin.",
    ],
    [
      "origin start with a source",
      (s) => {
        eq(s, 2).older.sourceRow = 1;
      },
      "Invalid reported equation origin.",
    ],
    [
      "origin from number 1",
      (s) => {
        eq(s, 2).fromNumber = 1;
      },
      "Invalid reported equation origin.",
    ],
    [
      "origin signature empty",
      (s) => {
        origin(s).signature = "";
      },
      "Invalid reported origin signature.",
    ],
    [
      "origin signature of 500001 characters",
      (s) => {
        origin(s).signature = long(500001);
      },
      "Invalid reported origin signature.",
    ],
    [
      "boundary source unknown",
      (s) => {
        eq(s, 1).fromCaptureId = "zz";
      },
      "Boundary sources: missing or duplicate reference.",
    ],
    [
      "boundary sources equal",
      (s) => {
        eq(s, 1).fromCaptureId = "c2";
      },
      "Boundary sources: missing or duplicate reference.",
    ],
    [
      "boundary previous not an object",
      (s) => {
        delete eq(s, 1).older;
      },
      "Previous boundary: missing or invalid object.",
    ],
    [
      "boundary previous from another source",
      (s) => {
        eq(s, 1).older.sourceCaptureId = "c2";
      },
      "Boundary source does not match.",
    ],
    [
      "boundary contribution unknown",
      (s) => {
        eq(s, 1).knownRaceIds = ["zz"];
      },
      "Equation contributions: missing or duplicate reference.",
    ],
    [
      "boundary contribution without provenance",
      (s) => {
        eq(s, 1).knownRaceIds = ["r3"];
      },
      "Known contribution has no provenance.",
    ],
    [
      "boundary following not an object",
      (s) => {
        delete eq(s, 1).newer;
      },
      "Following boundary: missing or invalid object.",
    ],
    [
      "boundary following from another source",
      (s) => {
        eq(s, 1).newer.sourceCaptureId = "c1";
      },
      "Boundary source does not match.",
    ],
    [
      "race equation source unknown",
      (s) => {
        eq(s, 0).toRaceId = "zz";
      },
      "Equation sources: missing or duplicate reference.",
    ],
    [
      "equation session empty",
      (s) => {
        eq(s, 0).session = "";
      },
      "Equation session: invalid text.",
    ],
    [
      "equation segment empty",
      (s) => {
        eq(s, 0).segment = "";
      },
      "Equation segment: invalid text.",
    ],
    [
      "race equation from number 0",
      (s) => {
        eq(s, 0).fromNumber = 0;
      },
      "Previous occurrence: invalid number.",
    ],
    [
      "equation to number 0",
      (s) => {
        eq(s, 0).toNumber = 0;
      },
      "Following occurrence: invalid number.",
    ],
    [
      "equation terms not a list",
      (s) => {
        delete eq(s, 0).targetIndices;
      },
      "Equation terms: missing or invalid list.",
    ],
    [
      "equation term outside the targets",
      (s) => {
        eq(s, 0).targetIndices = [1];
      },
      "Gap index: invalid number.",
    ],
    [
      "equation without terms",
      (s) => {
        eq(s, 0).targetIndices = [];
      },
      "Invalid equation terms.",
    ],
    [
      "equation known gains negative",
      (s) => {
        eq(s, 0).known = -1;
      },
      "Known in-game gains: invalid number.",
    ],
    [
      "equation gain below -30000",
      (s) => {
        eq(s, 0).gain = -30001;
      },
      "Intermediate gain: invalid number.",
    ],
    [
      "equation value validated as game evidence",
      (s) => {
        eq(s, 0).current.value = 16;
      },
      "Game value: invalid number.",
    ],
    [
      "equation previous total missing",
      (s) => {
        delete eq(s, 0).older;
      },
      "Previous total: missing or invalid object.",
    ],
    [
      "equation following total missing",
      (s) => {
        delete eq(s, 0).newer;
      },
      "Following total: missing or invalid object.",
    ],
    [
      "equation current points missing",
      (s) => {
        delete eq(s, 0).current;
      },
      "Current points: missing or invalid object.",
    ],
    [
      "equation off by one",
      (s) => {
        eq(s, 0).gain = 9;
      },
      "Inconsistent assisted equation.",
    ],
    [
      "metrics not an object",
      (s) => {
        delete an(s).stats;
      },
      "Analysis metrics: missing or invalid object.",
    ],
    [
      "metric negative",
      (s) => {
        an(s).stats.elapsedMs = -1;
      },
      "Assistance metric: invalid number.",
    ],
    [
      "cancellation not boolean",
      (s) => {
        delete an(s).stats.cancelled;
      },
      "Invalid assistance cancellation.",
    ],
    [
      "confirmation not an object",
      (s) => {
        asst(s).confirmed = 1;
      },
      "Assisted confirmation: missing or invalid object.",
    ],
    [
      "confirmation date invalid",
      (s) => {
        confirmed(s).at = "x";
      },
      "Hypothesis confirmation: invalid date.",
    ],
    [
      "confirmation signature not a hash",
      (s) => {
        confirmed(s).inputSignature = "x";
      },
      "Invalid assistance review.",
    ],
    [
      "confirmation of another analysis",
      (s) => {
        confirmed(s).inputSignature = H2;
      },
      "Inconsistent assistance confirmation.",
    ],
    [
      "confirmation of a stale analysis",
      (s) => {
        an(s).status = "stale";
      },
      "Inconsistent assistance confirmation.",
    ],
    [
      "confirmation origin not text",
      (s) => {
        confirmed(s).kind = 1;
      },
      "Confirmation origin: invalid text.",
    ],
    [
      "confirmation origin unknown",
      (s) => {
        confirmed(s).kind = "auto";
      },
      "Inconsistent assistance confirmation.",
    ],
    [
      "confirmed hypothesis validated",
      (s) => {
        confirmed(s).hypothesis = 1;
      },
      "Hypothesis: missing or invalid object.",
    ],
    [
      "confirmed hypothesis not an example",
      (s) => {
        confirmed(s).hypothesis = hypothesis([...P3].reverse());
      },
      "Confirmed hypothesis is not among the examples.",
    ],
    [
      "unique confirmation of an ambiguous analysis",
      (s) => {
        asst(s).history[0].confirmed.kind = "unique";
      },
      "Assisted uniqueness is not proven.",
    ],
    [
      "confirmation without analysis",
      (s) => {
        delete asst(s).analysis;
      },
      "Confirmation has no analysis.",
    ],
    [
      "history not a list",
      (s) => {
        delete asst(s).history;
      },
      "Assistance history: missing or invalid list.",
    ],
    [
      "eleven history entries",
      (s) => {
        asst(s).history = many(11, () => null);
      },
      "Too much assistance history.",
    ],
    [
      "history entry not an object",
      (s) => {
        asst(s).history = [1];
      },
      "Assistance history: missing or invalid object.",
    ],
    [
      "history analysis validated",
      (s) => {
        asst(s).history[0].analysis.message = "";
      },
      "Assistance conclusion: invalid text.",
    ],
  ]);
});

test("validateTracker: source removal to undo", () => {
  const removed = (s: J) => undo(s).capture;
  expectAll([
    [
      "not an object",
      (s) => {
        s.sourceUndo = 1;
      },
      "Removal to undo: missing or invalid object.",
    ],
    [
      "ID empty",
      (s) => {
        undo(s).id = "";
      },
      "Removal ID: invalid text.",
    ],
    [
      "mogi not text",
      (s) => {
        undo(s).mogiId = 1;
      },
      "Removal mogi: invalid text.",
    ],
    [
      "mogi unknown",
      (s) => {
        undo(s).mogiId = "zz";
      },
      "Removal mogi: missing or invalid object.",
    ],
    [
      "mogi not text without mogis",
      (s) => {
        s.mogis = [];
        s.activeMogiId = null;
        undo(s).mogiId = 1;
      },
      "Removal mogi: missing or invalid object.",
    ],
    [
      "original not text",
      (s) => {
        undo(s).fileId = 1;
      },
      "Removal original: invalid text.",
    ],
    [
      "original unknown",
      (s) => {
        undo(s).fileId = "zz";
      },
      "The original reserved for undo is missing or already under review.",
    ],
    [
      "original without pending images",
      (s) => {
        delete s.sharedReceipts;
        delete mg(s).captureReview;
      },
      "The original reserved for undo is missing or already under review.",
    ],
    [
      "original under review",
      (s) => {
        undo(s).fileId = "f1";
      },
      "The original reserved for undo is missing or already under review.",
    ],
    [
      "original held by a race draft",
      (s) => {
        mg(s).raceDraft = { ...mg(s).raceDraft, purpose: "capture", sourceFileId: "f2" };
      },
      "The original reserved for undo is missing or already under review.",
    ],
    [
      "capture and review item",
      (s) => {
        undo(s).reviewItem = reviewUndo().reviewItem;
      },
      "Invalid removal source.",
    ],
    [
      "neither capture nor review item",
      (s) => {
        delete undo(s).capture;
      },
      "Invalid removal source.",
    ],
    [
      "capture not an object",
      (s) => {
        undo(s).capture = 1;
      },
      "Removed screenshot: missing or invalid object.",
    ],
    [
      "capture ID empty",
      (s) => {
        removed(s).id = "";
      },
      "Removed screenshot ID: invalid text.",
    ],
    [
      "capture still live",
      (s) => {
        removed(s).id = "c1";
      },
      "Removed screenshot has no removal record.",
    ],
    [
      "capture without removal record",
      (s) => {
        removed(s).id = "zz";
      },
      "Removed screenshot has no removal record.",
    ],
    [
      "capture review date missing",
      (s) => {
        delete removed(s).reviewedAt;
      },
      "Removed review: invalid text.",
    ],
    [
      "capture names unknown",
      (s) => {
        removed(s).reviewedPlacements = ["zz"];
      },
      "Removed names: missing or duplicate reference.",
    ],
    [
      "capture recognition validated",
      (s) => {
        removed(s).width = 0;
      },
      "Screenshot width: invalid number.",
    ],
    [
      "capture compressed source invalid",
      (s) => {
        removed(s).compressedFrom.size = -1;
      },
      "Invalid compressed screenshot source.",
    ],
    [
      "capture compressed while the original is PNG",
      (s) => {
        swap(file(s, 1), { mimeType: "image/png", original: png() });
      },
      "A compressed screenshot must be WebP.",
    ],
    [
      "capture with original bytes",
      (s) => {
        removed(s).original = webp();
      },
      "Duplicate original in removal.",
    ],
    [
      "capture with a null original",
      (s) => {
        removed(s).original = null;
      },
      "Duplicate original in removal.",
    ],
    [
      "capture context race unknown",
      (s) => {
        removed(s).context.raceId = "zz";
      },
      "Removed context occurrence not found.",
    ],
    [
      "sequence not an object",
      (s) => {
        undo(s).sequence = 1;
      },
      "Removed source answers: missing or invalid object.",
    ],
    [
      "sequence links missing",
      (s) => {
        delete undo(s).sequence.links;
      },
      "Screenshot relations: missing or invalid list.",
    ],
    [
      "sequence number from an unknown source",
      (s) => {
        undo(s).sequence.numbers[0].captureId = "zz";
      },
      "Number source not found or duplicated.",
    ],
    [
      "sequence number from another source",
      (s) => {
        undo(s).sequence.numbers[0].captureId = "c1";
      },
      "Removal contains answers from another source.",
    ],
    [
      "sequence link not touching the source",
      (s) => {
        undo(s).sequence.links = [{ fromCaptureId: "c1", toCaptureId: "c2", signature: "s" }];
      },
      "Removal contains answers from another source.",
    ],
    [
      "sequence origin from another source",
      (s) => {
        undo(s).sequence.origins[0].captureId = "c1";
      },
      "Removal contains answers from another source.",
    ],
    [
      "review item not an object",
      (s) => {
        undo(s).reviewItem = 1;
      },
      "Removed review: missing or invalid object.",
      teams,
    ],
    [
      "review item validated as a review",
      (s) => {
        undo(s).reviewItem.status = "done";
      },
      "Invalid review stage.",
      teams,
    ],
    [
      "review item of another file",
      (s) => {
        undo(s).reviewItem.source = { fileId: "f1" };
      },
      "Review screenshot not found.",
      teams,
    ],
    [
      "review item of a live screenshot",
      (s) => {
        undo(s).reviewItem.source = { captureId: "c1" };
      },
      "The removed review's original does not match.",
      teams,
    ],
    [
      "draft validated",
      (s) => {
        undo(s).raceDraft.version = 2;
      },
      "Invalid draft version or origin.",
    ],
    [
      "draft from another screenshot",
      (s) => {
        undo(s).raceDraft.sourceCaptureId = "c1";
      },
      "Removal contains a draft from another source.",
    ],
    [
      "review draft from a screenshot",
      (s) => {
        swap(undo(s).raceDraft, { sourceFileId: undefined, sourceCaptureId: "c1" });
      },
      "Removal contains a draft from another source.",
      teams,
    ],
    [
      "races not a list",
      (s) => {
        delete undo(s).races;
      },
      "Removal references: missing or invalid list.",
    ],
    [
      "race not an object",
      (s) => {
        undo(s).races = [1];
      },
      "Removal references: missing or invalid object.",
    ],
    [
      "races repeated",
      (s) => {
        undo(s).races.push({ ...undo(s).races[0] });
      },
      "Removal references: duplicate IDs.",
    ],
    [
      "two races",
      (s) => {
        undo(s).races.push({ ...undo(s).races[0], id: "r1" });
      },
      "Too many races for one removal.",
    ],
    [
      "race unknown",
      (s) => {
        undo(s).races[0].id = "zz";
      },
      "Inconsistent historical removal reference.",
    ],
    [
      "race not citing the removed screenshot",
      (s) => {
        undo(s).races[0].captureIds = ["c1"];
      },
      "Inconsistent historical removal reference.",
    ],
    [
      "race sources missing",
      (s) => {
        delete undo(s).races[0].captureIds;
      },
      "Reference sources: missing or invalid list.",
    ],
    [
      "race with history",
      (s) => {
        undo(s).races[0].participationHistory = [];
      },
      "Inconsistent historical removal reference.",
    ],
    [
      "race for a review item removal",
      (s) => {
        undo(s).races = [{ id: "r3", origin: "observed", status: "pending", placements: [], captureIds: [] }];
      },
      "Inconsistent historical removal reference.",
      teams,
    ],
    [
      "race validated as a race",
      (s) => {
        undo(s).races[0].status = "confirmed";
      },
      "Incomplete or invalid confirmed result.",
    ],
  ]);
});

test("validateCompressedImage and object, called directly", () => {
  const objectOf = (value: unknown) => object(value, "Label");
  const source = { sha256: H, size: 4 };
  const outcomeOf = (run: () => unknown) => {
    try {
      run();
      return ACCEPTED;
    } catch (error) {
      return (error as Error).message;
    }
  };
  const cases: [string, () => unknown, string][] = [
    [
      "no compressed source accepts anything",
      () => validateCompressedImage({ fingerprint: "x" }, "not a blob"),
      ACCEPTED,
    ],
    ["WebP bytes", () => validateCompressedImage({ compressedFrom: source, fingerprint: H }, webp()), ACCEPTED],
    ["freed bytes (null)", () => validateCompressedImage({ compressedFrom: source }, null), ACCEPTED],
    [
      "source null",
      () => validateCompressedImage({ compressedFrom: null }, webp()),
      "Compressed screenshot source: missing or invalid object.",
    ],
    [
      "hash too short",
      () => validateCompressedImage({ compressedFrom: { sha256: "a", size: 4 } }, webp()),
      "Invalid compressed screenshot source.",
    ],
    [
      "size fractional",
      () => validateCompressedImage({ compressedFrom: { sha256: H, size: 1.5 } }, webp()),
      "Invalid compressed screenshot source.",
    ],
    [
      "size as text",
      () => validateCompressedImage({ compressedFrom: { sha256: H, size: "4" } }, webp()),
      "Invalid compressed screenshot source.",
    ],
    [
      "bytes undefined (only null means freed)",
      () => validateCompressedImage({ compressedFrom: source }, undefined),
      "A compressed screenshot must be WebP.",
    ],
    [
      "bytes not a Blob",
      () => validateCompressedImage({ compressedFrom: source }, "webp"),
      "A compressed screenshot must be WebP.",
    ],
    [
      "JPEG bytes",
      () => validateCompressedImage({ compressedFrom: source }, new Blob(["j"], { type: "image/jpeg" })),
      "A compressed screenshot must be WebP.",
    ],
    [
      "empty WebP is not checked here",
      () => validateCompressedImage({ compressedFrom: source }, new Blob([], { type: "image/webp" })),
      ACCEPTED,
    ],
    [
      "fingerprint of the compressed bytes",
      () => validateCompressedImage({ compressedFrom: source, fingerprint: H2 }, webp()),
      "A screenshot fingerprint doesn't match its compressed source.",
    ],
    [
      "fingerprint null",
      () => validateCompressedImage({ compressedFrom: source, fingerprint: null }, webp()),
      "A screenshot fingerprint doesn't match its compressed source.",
    ],
    ["object of null", () => objectOf(null), "Label: missing or invalid object."],
    ["object of a list", () => objectOf([]), "Label: missing or invalid object."],
    ["object of a number", () => objectOf(0), "Label: missing or invalid object."],
    ["object of a record", () => objectOf({}), ACCEPTED],
  ];
  assert.deepEqual(
    cases.flatMap(([name, run, message]) => {
      const actual = outcomeOf(run);
      return actual === message ? [] : [`${name}: expected ${JSON.stringify(message)}, got ${JSON.stringify(actual)}`];
    }),
    [],
  );
  const record = { a: 1 };
  assert.equal(object(record, "Label"), record);
});

/** The remaining reachable label/suffix pairs, so each label keeps its exact wording. */
test("remaining label messages", () => {
  expectAll([
    [
      "player ID",
      (s) => {
        mg(s).participants[0].id = "";
      },
      "Players: ID: invalid text.",
    ],
    [
      "capture ID",
      (s) => {
        cap(s, "c1").id = 1;
      },
      "Screenshots: ID: invalid text.",
    ],
    [
      "team ID",
      (s) => {
        mg(s).teams[0].id = "";
      },
      "Teams: ID: invalid text.",
      teams,
    ],
    [
      "substitution ID",
      (s) => {
        mg(s).substitutions[0].id = "";
      },
      "Substitutions: ID: invalid text.",
    ],
    [
      "gap ID",
      (s) => {
        seq(s).gaps[0].id = "";
      },
      "Gaps: ID: invalid text.",
    ],
    [
      "occurrence ID",
      (s) => {
        seq(s).occurrences[0].id = "";
      },
      "Physical occurrences: ID: invalid text.",
    ],
    [
      "room session ID",
      (s) => {
        room(s).sessions[0].id = "";
      },
      "Room sessions: ID: invalid text.",
    ],
    [
      "review item ID",
      (s) => {
        item(s, 0).id = "";
      },
      "Review screenshots: ID: invalid text.",
    ],
    [
      "removal reference ID",
      (s) => {
        undo(s).races[0].id = "";
      },
      "Removal references: ID: invalid text.",
    ],
    [
      "fact ID",
      (s) => {
        asst(s).facts[0].id = "";
      },
      "Facts: ID: invalid text.",
    ],
    [
      "analysis fact ID",
      (s) => {
        an(s).facts[0].id = "";
      },
      "Analysis facts: ID: invalid text.",
    ],
    [
      "analysis fact not an object",
      (s) => {
        an(s).facts = [1];
      },
      "Analysis facts: missing or invalid object.",
    ],
    [
      "mogi date missing",
      (s) => {
        delete mg(s).createdAt;
      },
      "Mogi date: invalid text.",
    ],
    [
      "draft date missing",
      (s) => {
        delete draft(s).updatedAt;
      },
      "Draft date: invalid text.",
    ],
    [
      "history date invalid",
      (s) => {
        race(s, "r3").participationHistory[0].changedAt = "x";
      },
      "History date: invalid date.",
    ],
    [
      "source removal date missing",
      (s) => {
        delete race(s, "r3").sourceRemovalHistory[0].removedAt;
      },
      "Source removal: invalid text.",
    ],
    [
      "numeric review date missing",
      (s) => {
        delete race(s, "r3").gameEvidenceHistory[0].changedAt;
      },
      "Numeric review date: invalid text.",
    ],
    [
      "reconstruction date missing",
      (s) => {
        delete recon(s).createdAt;
      },
      "Reconstruction date: invalid text.",
    ],
    [
      "sequence date missing",
      (s) => {
        delete order(s).acceptedAt;
      },
      "Sequence date: invalid text.",
    ],
    [
      "confirmation date missing",
      (s) => {
        delete asst(s).confirmed.at;
      },
      "Hypothesis confirmation: invalid text.",
    ],
    [
      "fact creation missing",
      (s) => {
        delete asst(s).facts[0].createdAt;
      },
      "Fact creation: invalid text.",
    ],
    [
      "fact review invalid",
      (s) => {
        asst(s).facts[0].updatedAt = "x";
      },
      "Fact review: invalid date.",
    ],
    [
      "fact event date missing",
      (s) => {
        delete asst(s).factHistory[0].at;
      },
      "Fact date: invalid text.",
    ],
    [
      "analysis date missing",
      (s) => {
        delete an(s).createdAt;
      },
      "Assisted analysis date: invalid text.",
    ],
    [
      "removed review date invalid",
      (s) => {
        undo(s).capture.reviewedAt = "x";
      },
      "Removed review: invalid date.",
    ],
    [
      "absent players not a list",
      (s) => {
        race(s, "r3").absentParticipantIds = "p11";
      },
      "Absent players: missing or invalid list.",
    ],
    [
      "absent player not text",
      (s) => {
        race(s, "r3").absentParticipantIds = [11];
      },
      "Absent players: invalid text.",
    ],
    [
      "race screenshots not a list",
      (s) => {
        race(s, "r3").captureIds = "c1";
      },
      "Race screenshots: missing or invalid list.",
    ],
    [
      "race screenshot not text",
      (s) => {
        race(s, "r3").captureIds = [1];
      },
      "Race screenshots: invalid text.",
    ],
    [
      "reviewed association not text",
      (s) => {
        cap(s, "c1").reviewedPlacements = [0];
      },
      "Reviewed associations: invalid text.",
    ],
    [
      "possibly absent not a list",
      (s) => {
        cap(s, "c1").possibleAbsentParticipantIds = "p11";
      },
      "Possibly absent players: missing or invalid list.",
    ],
    [
      "possibly absent not text",
      (s) => {
        cap(s, "c1").possibleAbsentParticipantIds = [11];
      },
      "Possibly absent players: invalid text.",
    ],
    [
      "context draft identity unknown",
      (s) => {
        cap(s, "c2").contextDraft.placements = ["zz"];
      },
      "Context draft identities: missing or duplicate reference.",
    ],
    [
      "context draft identity not text",
      (s) => {
        cap(s, "c2").contextDraft.placements = [0];
      },
      "Context draft identities: invalid text.",
    ],
    [
      "context draft absences not a list",
      (s) => {
        delete cap(s, "c2").contextDraft.absentParticipantIds;
      },
      "Context draft absences: missing or invalid list.",
    ],
    [
      "context draft absence not text",
      (s) => {
        cap(s, "c2").contextDraft.absentParticipantIds = [0];
      },
      "Context draft absences: invalid text.",
    ],
    [
      "draft placements not a list",
      (s) => {
        delete draft(s).fields.placements;
      },
      "Draft placements: missing or invalid list.",
    ],
    [
      "draft placement not text",
      (s) => {
        draft(s).fields.placements = [0];
      },
      "Draft placements: invalid text.",
    ],
    [
      "draft absences not a list",
      (s) => {
        delete draft(s).fields.absentParticipantIds;
      },
      "Draft absent players: missing or invalid list.",
    ],
    [
      "draft absence not text",
      (s) => {
        draft(s).fields.absentParticipantIds = [0];
      },
      "Draft absent players: invalid text.",
    ],
    [
      "draft screenshot not text",
      (s) => {
        draft(s).sourceCaptureId = 1;
      },
      "Draft screenshot: invalid text.",
      teams,
    ],
    [
      "numeric row identities not a list",
      (s) => {
        race(s, "r3").gameEvidence.rowAssociations.c1 = "p0";
      },
      "Numeric row identities: missing or invalid list.",
    ],
    [
      "numeric row identity not text",
      (s) => {
        race(s, "r3").gameEvidence.rowAssociations.c1[0] = 0;
      },
      "Numeric row identities: invalid text.",
    ],
    [
      "projected races not a list",
      (s) => {
        seq(s).projectedRaceIds = "r1";
      },
      "Projected races: missing or invalid list.",
    ],
    [
      "projected race not text",
      (s) => {
        seq(s).projectedRaceIds = [1];
      },
      "Projected races: invalid text.",
    ],
    [
      "room sources not a list",
      (s) => {
        delete room(s).sessions[0].captureIds;
      },
      "Room sources: missing or invalid list.",
    ],
    [
      "room source not text",
      (s) => {
        room(s).sessions[0].captureIds = [1];
      },
      "Room sources: invalid text.",
    ],
    [
      "deduced placements not a list",
      (s) => {
        roomCap(s).placements = "p0";
      },
      "Deduced placements: missing or invalid list.",
    ],
    [
      "deduced placement not text",
      (s) => {
        roomCap(s).placements = [0];
      },
      "Deduced placements: invalid text.",
    ],
    [
      "room conflicts not a list",
      (s) => {
        delete room(s).conflicts;
      },
      "Room conflicts: missing or invalid list.",
    ],
    [
      "room conflict not text",
      (s) => {
        room(s).conflicts = [1];
      },
      "Room conflicts: invalid text.",
    ],
    [
      "unordered rooms not a list",
      (s) => {
        delete room(s).order.sessionIds;
      },
      "Unordered rooms: missing or invalid list.",
    ],
    [
      "unordered room not text",
      (s) => {
        room(s).order.sessionIds = [1];
      },
      "Unordered rooms: invalid text.",
    ],
    [
      "unordered sources not a list",
      (s) => {
        delete room(s).order.captureIds;
      },
      "Unordered sources: missing or invalid list.",
    ],
    [
      "unordered source not text",
      (s) => {
        room(s).order.captureIds = [1];
      },
      "Unordered sources: invalid text.",
    ],
    [
      "physical boundary not text",
      (s) => {
        seq(s).relations[0].fromCaptureId = 1;
      },
      "Physical boundaries: invalid text.",
    ],
    [
      "occurrence sources not a list",
      (s) => {
        delete seq(s).occurrences[0].captureIds;
      },
      "Occurrence sources: missing or invalid list.",
    ],
    [
      "occurrence source not text",
      (s) => {
        seq(s).occurrences[0].captureIds = [1];
      },
      "Occurrence sources: invalid text.",
    ],
    [
      "gap sources not a list",
      (s) => {
        delete seq(s).gaps[0].sourceCaptureIds;
      },
      "Gap sources: missing or invalid list.",
    ],
    [
      "gap source not text",
      (s) => {
        seq(s).gaps[0].sourceCaptureIds = ["c1", 2];
      },
      "Gap sources: invalid text.",
    ],
    [
      "ordered occurrences not a list",
      (s) => {
        delete order(s).raceIds;
      },
      "Ordered occurrences: missing or invalid list.",
    ],
    [
      "ordered occurrence not text",
      (s) => {
        order(s).raceIds = [1];
      },
      "Ordered occurrences: invalid text.",
    ],
    [
      "uncompared occurrences not a list",
      (s) => {
        delete order(s).unresolvedRaceIds;
      },
      "Uncompared occurrences: missing or invalid list.",
    ],
    [
      "uncompared occurrence not text",
      (s) => {
        order(s).unresolvedRaceIds = [1];
      },
      "Uncompared occurrences: invalid text.",
    ],
    [
      "reconstruction screenshots not a list",
      (s) => {
        delete recon(s).sourceCaptureIds;
      },
      "Reconstruction screenshots: missing or invalid list.",
    ],
    [
      "reconstruction screenshot not text",
      (s) => {
        recon(s).sourceCaptureIds = [1];
      },
      "Reconstruction screenshots: invalid text.",
    ],
    [
      "reconstructed placements not a list",
      (s) => {
        delete recon(s).placements;
      },
      "Reconstructed placements: missing or invalid list.",
    ],
    [
      "reconstructed placement not text",
      (s) => {
        recon(s).placements[0] = 1;
      },
      "Reconstructed placements: invalid text.",
    ],
    [
      "reconstructed absence unknown",
      (s) => {
        recon(s).absentParticipantIds = ["zz"];
      },
      "Reconstructed absences: missing or duplicate reference.",
    ],
    [
      "reconstructed absence not text",
      (s) => {
        recon(s).absentParticipantIds = [1];
      },
      "Reconstructed absences: invalid text.",
    ],
    [
      "assisted gaps not a list",
      (s) => {
        delete asst(s).targetRaceIds;
      },
      "Assisted gaps: missing or invalid list.",
    ],
    [
      "assisted gap not text",
      (s) => {
        asst(s).targetRaceIds = [6];
      },
      "Assisted gaps: invalid text.",
    ],
    [
      "fact player not text",
      (s) => {
        asst(s).facts[0].participantId = 1;
      },
      "Fact player: invalid text.",
    ],
    [
      "assisted occurrences not a list",
      (s) => {
        delete an(s).targetRaceIds;
      },
      "Assisted occurrences: missing or invalid list.",
    ],
    [
      "assisted occurrence not text",
      (s) => {
        an(s).targetRaceIds = [6];
      },
      "Assisted occurrences: invalid text.",
    ],
    [
      "hypothesis placements not a list",
      (s) => {
        delete hyp(s).placements;
      },
      "Hypothesis placements: missing or invalid list.",
    ],
    [
      "hypothesis placement not text",
      (s) => {
        hyp(s).placements[0] = 1;
      },
      "Hypothesis placements: invalid text.",
    ],
    [
      "hypothesis absences not a list",
      (s) => {
        delete hyp(s).absentParticipantIds;
      },
      "Hypothesis absent players: missing or invalid list.",
    ],
    [
      "hypothesis absence not text",
      (s) => {
        hyp(s).absentParticipantIds = [1];
      },
      "Hypothesis absent players: invalid text.",
    ],
    [
      "assisted sources not a list",
      (s) => {
        delete an(s).sourceCaptureIds;
      },
      "Assisted sources: missing or invalid list.",
    ],
    [
      "assisted source not text",
      (s) => {
        an(s).sourceCaptureIds = [1];
      },
      "Assisted sources: invalid text.",
    ],
    [
      "known placements not a list",
      (s) => {
        delete known(s).placements;
      },
      "Known placements: missing or invalid list.",
    ],
    [
      "known placement not text",
      (s) => {
        known(s).placements[0] = 1;
      },
      "Known placements: invalid text.",
    ],
    [
      "known absences not a list",
      (s) => {
        delete known(s).absentParticipantIds;
      },
      "Known absences: missing or invalid list.",
    ],
    [
      "known absence not text",
      (s) => {
        known(s).absentParticipantIds = [1];
      },
      "Known absences: invalid text.",
    ],
    [
      "native contribution not an object",
      (s) => {
        delete known(s).nativePoints;
      },
      "Native contribution: missing or invalid object.",
    ],
    [
      "native contribution 16",
      (s) => {
        known(s).nativePoints = { p0: 16 };
      },
      "Native contribution: invalid number.",
    ],
    [
      "reported origin source not text",
      (s) => {
        eq(s, 2).toCaptureId = 2;
      },
      "Reported origin source: invalid text.",
    ],
    [
      "boundary source not text",
      (s) => {
        eq(s, 1).fromCaptureId = 1;
      },
      "Boundary sources: invalid text.",
    ],
    [
      "equation contributions not a list",
      (s) => {
        eq(s, 1).knownRaceIds = "r1";
      },
      "Equation contributions: missing or invalid list.",
    ],
    [
      "equation contribution not text",
      (s) => {
        eq(s, 1).knownRaceIds = [1];
      },
      "Equation contributions: invalid text.",
    ],
    [
      "equation source not text",
      (s) => {
        eq(s, 0).fromRaceId = 1;
      },
      "Equation sources: invalid text.",
    ],
    [
      "removed names not a list",
      (s) => {
        delete undo(s).capture.reviewedPlacements;
      },
      "Removed names: missing or invalid list.",
    ],
    [
      "removed name not text",
      (s) => {
        undo(s).capture.reviewedPlacements = [1];
      },
      "Removed names: invalid text.",
    ],
  ]);
});
