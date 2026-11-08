import type { Screen } from "@mkw/engine";
import {
  hasScreenInterpretation,
  isScreen,
  nativePlacementPoints,
  numericTextValue,
  screenProperties,
  tracks,
} from "@mkw/engine";
import * as v from "valibot";

import { MAX_BACKUP_ITEMS } from "./limits.ts";

/**
 * Persisted shapes of a backup `state`, one schema per record. A schema checks what its record
 * holds by itself: types, bounds, closed lists and rules between its own fields. References to
 * other records (players, races, sources) are checked afterwards in `validation.ts`.
 *
 * Messages are the restore error copy: `${label}: invalid text.` and its siblings name the field,
 * and restore shows the first failure in declaration order. Unknown fields pass through.
 */

type Message = string | undefined;
type Guard = (value: Record<string, unknown>) => Message;

/** Stop at the first failure: its message is the one restore shows. */
const FIRST = { abortEarly: true } as const;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The first failure's message, or nothing when `value` matches. */
export function issue(schema: v.GenericSchema, value: unknown): Message {
  const result = v.safeParse(schema, value, FIRST);
  return result.success ? undefined : result.issues[0].message;
}
/** Throws the first failure's message, like the rest of restore. */
export function ensure<S extends v.GenericSchema>(schema: S, value: unknown): v.InferOutput<S> {
  const result = v.safeParse(schema, value, FIRST);
  if (!result.success) throw new Error(result.issues[0].message);
  return result.output;
}

/** A check written as a function that returns the failure's message, or nothing. */
function rule<T>(check: (value: T) => Message) {
  return v.rawCheck<T>(({ dataset, addIssue }) => {
    const message = dataset.typed ? check(dataset.value) : undefined;
    if (message) addIssue({ message });
  });
}

// ── Values ────────────────────────────────────────────────────────────────

export const text = (label: string, empty = false) => {
  const message = `${label}: invalid text.`;
  return v.pipe(
    v.string(message),
    v.check((value) => empty || !!value.trim(), message),
    v.maxLength(MAX_BACKUP_ITEMS, message),
  );
};
/** Text with a tighter length limit and its own message. */
const capped = (label: string, max: number, message: string, empty = false) =>
  v.pipe(text(label, empty), v.maxLength(max, message));

export const integer = (label: string, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const message = `${label}: invalid number.`;
  return v.pipe(v.number(message), v.safeInteger(message), v.minValue(min, message), v.maxValue(max, message));
};

const date = (label: string) =>
  v.pipe(
    text(label),
    v.check((value) => Number.isFinite(Date.parse(value)), `${label}: invalid date.`),
  );

/** A field a record may not carry. */
const never = (message: string) => v.optional(v.never(message));
/** A field read only by the reference checks, or only under a condition they decide. */
const later = () => v.optional(v.unknown());
/** Valid text first, then membership in a closed list. */
const textIn = <const T extends readonly string[]>(label: string, values: T, message: string) =>
  v.pipe(text(label), v.picklist(values, message));

export const SHA256 = /^[a-f0-9]{64}$/;
const hash = v.pipe(v.string("Invalid assistance review."), v.regex(SHA256, "Invalid assistance review."));
const signature = (message: string, max = 500000) =>
  v.pipe(v.string(message), v.minLength(1, message), v.maxLength(max, message));

// ── Structures ────────────────────────────────────────────────────────────

/**
 * A record of known fields that keeps unknown ones. `guard` sees the raw record before the
 * fields, for the few checks restore has always made first.
 */
function shape<const E extends v.ObjectEntries>(label: string, entries: E, guard?: Guard) {
  const invalid = `${label}: missing or invalid object.`;
  // A missing field fails with the message its schema gives `undefined`.
  const missing = (failure: v.BaseIssue<unknown>) =>
    issue(entries[failure.path?.[0]?.key as keyof E] ?? v.never(), undefined) ?? invalid;
  return v.pipe(
    v.custom<Record<string, unknown>>(isRecord, invalid),
    rule(guard ?? (() => undefined)),
    v.looseObject(entries, missing),
  );
}
const anyRecord = (label: string) =>
  v.custom<Record<string, unknown>>(isRecord, `${label}: missing or invalid object.`);

const list = <S extends v.GenericSchema>(label: string, item: S) => v.array(item, `${label}: missing or invalid list.`);
/** A bounded list: the limit is read before any item. */
const capList = <S extends v.GenericSchema>(label: string, item: S, max: number, message: string) =>
  v.pipe(
    list(label, v.unknown()),
    v.check((items) => items.length <= max, message),
    list(label, item),
  );

/** References by identifier; the checks against their records run later. */
export const refs = (label: string, item = label) => list(label, text(item));

/** A list of records whose `id`s are unique; `${label}: ID` names the identifier. */
const ids = <S extends v.GenericSchema<Record<string, unknown>, { id: string }>>(
  listLabel: string,
  label: string,
  item: S,
) =>
  v.pipe(
    list(listLabel, item),
    v.check((items) => new Set(items.map((entry) => entry.id)).size === items.length, `${label}: duplicate IDs.`),
  );
const idOf = (label: string) => ({ id: text(`${label}: ID`) });

/** A plain object whose values all match `value`; its keys are checked against records later. */
function dict<S extends v.GenericSchema>(label: string, value: S) {
  return v.pipe(
    anyRecord(label),
    rule((record: Record<string, unknown>) => {
      for (const item of Object.values(record)) {
        const message = issue(value, item);
        if (message) return message;
      }
    }),
  ) as v.GenericSchema<Record<string, unknown>, Record<string, v.InferOutput<S>>>;
}

// ── Images and readings ───────────────────────────────────────────────────

const MAX_TIME = 8640000000000000;
const photoTiming = {
  receivedAt: v.optional(integer("Screenshot received", 0, MAX_TIME)),
  pastedAt: v.optional(integer("Screenshot pasted", 0, MAX_TIME)),
  photoMoment: v.optional(
    shape("Photo moment", {
      at: integer("Photo moment", -MAX_TIME, MAX_TIME),
      source: v.picklist(["exif", "switch-name", "pasted", "file-date"], "Photo moment: invalid source."),
    }),
  ),
};

/** The first rule a compressed image breaks; `original` is its stored bytes, if any. */
export function compressedImageIssue(image: Record<string, unknown>, original: unknown): Message {
  if (image.compressedFrom === undefined) return;
  const source = image.compressedFrom;
  if (!isRecord(source)) return "Compressed screenshot source: missing or invalid object.";
  if (
    typeof source.sha256 !== "string" ||
    !SHA256.test(source.sha256) ||
    !Number.isSafeInteger(source.size) ||
    (source.size as number) <= 0
  )
    return "Invalid compressed screenshot source.";
  if (original !== null && (!(original instanceof Blob) || original.type !== "image/webp"))
    return "A compressed screenshot must be WebP.";
  if (image.fingerprint !== undefined && image.fingerprint !== source.sha256)
    return "A screenshot fingerprint doesn't match its compressed source.";
}
const compressedFrom = v.optional(v.unknown());

const region = (label: string, x: string, y: string, width: string, height: string, outside: string) =>
  v.pipe(
    shape(label, {
      x: integer(x, 0, 1919),
      y: integer(y, 0, 1079),
      width: integer(width, 1, 1920),
      height: integer(height, 1, 1080),
    }),
    v.check((box) => box.x + box.width <= 1920 && box.y + box.height <= 1080, outside),
  );
/** Name and track regions stop at the first edge they cross: past the right edge, the height is never read. */
const edgeRegion = (label: string, x: string, y: string, width: string, height: string, outside: string) =>
  v.pipe(
    shape(label, { x: integer(x, 0, 1919), y: integer(y, 0, 1079), width: integer(width, 1, 1920), height: later() }),
    rule((box) =>
      box.x + box.width > 1920
        ? outside
        : (issue(integer(height, 1, 1080), box.height) ?? (box.y + Number(box.height) > 1080 ? outside : undefined)),
    ),
  ) as v.GenericSchema<unknown, { x: number; y: number; width: number; height: number }>;

const MISMATCH = "Numeric value does not match the observed text.";
const matchesText = (part: { text: string; value: number | null }, addition: boolean) =>
  part.value === null || numericTextValue(part.text, addition) === part.value;
const numericPart = (addition: boolean) => ({
  text: text("Numeric text", true),
  confidence: integer("Numeric confidence", 0, 100),
  value: v.nullable(integer("Numeric value", 0, addition ? 99 : 9999)),
});

/** One OCR crop of a number; `addition` readings are the "+N" column. */
const numericReading = (addition: boolean) => {
  const { text: crop, confidence, value } = numericPart(addition);
  return v.pipe(
    shape("Numeric reading", {
      text: crop,
      confidence,
      uncertain: v.boolean("Invalid numeric uncertainty."),
      value,
      location: region(
        "Numeric location",
        "Location x",
        "Location y",
        "Numeric width",
        "Numeric height",
        "Numeric crop is outside the normalized screenshot.",
      ),
      alternatives: v.optional(
        list(
          "Alternative readings",
          v.pipe(
            shape("Alternative reading", numericPart(addition)),
            v.check((part) => matchesText(part, addition), MISMATCH),
          ),
        ),
      ),
    }),
    v.check((reading) => matchesText(reading, addition), MISMATCH),
    v.check(
      (reading) => reading.value !== null || reading.uncertain,
      "A missing numeric value cannot be marked as certain.",
    ),
  );
};

// ── Answers ───────────────────────────────────────────────────────────────

const nameAssociations = v.pipe(
  list(
    "Name associations",
    v.pipe(
      shape("Name association", {
        participantId: v.nullable(text("Associated player")),
        origin: v.optional(v.literal("deduced", "Invalid name associations.")),
        unlinked: v.optional(v.boolean("Invalid name associations.")),
        ign: v.optional(capped("Accepted IGN spelling", 80, "Accepted IGN spelling exceeds 80 characters.", true)),
      }),
      v.check((answer) => !answer.unlinked || answer.participantId === null, "Invalid name associations."),
    ),
  ),
  v.check((answers) => answers.length <= 12, "Invalid name associations."),
);

const numericAnswer = {
  row: integer("Answer row", 1, 12),
  field: v.literal("right", "Invalid or duplicate numeric answer."),
  value: integer("Reported total", 0, 9999),
};
const distinctRows = (answers: { row: number }[]) =>
  new Set(answers.map((answer) => answer.row)).size === answers.length;
const DUPLICATE_ROW = "Invalid or duplicate numeric answer.";
const numericAnswers = v.pipe(
  list("Numeric answers", shape("Numeric answer", numericAnswer)),
  v.check((answers) => distinctRows(answers), DUPLICATE_ROW),
);
const numericDeductions = v.pipe(
  list("Numeric answers", shape("Numeric answer", { ...numericAnswer, origin: later() })),
  v.check((answers) => distinctRows(answers), DUPLICATE_ROW),
  v.check((answers) => answers.every((answer) => answer.origin === "deduced"), "Invalid deduced number."),
);
const groupTotalAnswers = v.pipe(
  list(
    "Reported group totals",
    shape("Reported group total", { group: integer("Reported group", 1, 12), value: integer("Group total", 0, 99999) }),
  ),
  v.check(
    (answers) => new Set(answers.map((answer) => answer.group)).size === answers.length,
    "Duplicate reported group.",
  ),
);
const nextTrackAnswer = capped("Reported next track name", 120, "Invalid reported next track name.");

/** Answers about an image must point at rows or groups that image shows. */
export function groupSourceIssue(fields: Record<string, unknown>, capture: Record<string, unknown>): Message {
  const reading = capture.interpretation;
  const interpretation = isRecord(reading) ? reading : undefined;
  if (fields.nextTrackAnswer !== undefined) {
    if (reading && !interpretation) return "Track source: missing or invalid object.";
    if (!reading || screenProperties(interpretation?.screen as Screen)?.moment !== "before")
      return "Next track name has no before-race context.";
  }
  const count = Array.isArray(capture.rows) ? capture.rows.length : 12;
  const answers = (value: unknown) => (Array.isArray(value) && value.every(isRecord) ? value : []);
  if (Array.isArray(fields.nameAssociations) && fields.nameAssociations.length !== count)
    return "Associations do not match the source rows.";
  if (answers(fields.numericAnswers).some((answer) => Number(answer.row) > count)) return "Answer has no observed row.";
  if (fields.groupTotalAnswers === undefined) return;
  if (reading && !interpretation) return "Source interpretation: missing or invalid object.";
  const groups = interpretation?.groups;
  if (
    answers(fields.groupTotalAnswers).some((answer) => !Array.isArray(groups) || Number(answer.group) > groups.length)
  )
    return "Reported total has no observed group.";
}

// ── Screenshots ───────────────────────────────────────────────────────────

const interpretation = shape(
  "Screenshot interpretation",
  {
    version: v.literal(1, "Invalid screenshot interpretation."),
    screen: v.custom<Screen>(isScreen, "Invalid screenshot interpretation."),
    origin: v.picklist(["visual", "user"], "Invalid screenshot interpretation."),
    positions: list("Observed positions", numericReading(false)),
    nextTrack: v.optional(
      shape("Next track", {
        text: text("Next track reading", true),
        confidence: integer("Track confidence", 0, 100),
        uncertain: v.boolean("Invalid next track."),
        location: v.optional(
          edgeRegion(
            "Track region",
            "Track x",
            "Track y",
            "Track width",
            "Track height",
            "Track region is outside the screenshot.",
          ),
        ),
        alternatives: v.optional(
          list(
            "Alternative tracks",
            shape("Alternative track", {
              text: text("Alternative track", true),
              confidence: integer("Alternative track confidence", 0, 100),
            }),
          ),
        ),
      }),
    ),
    groups: v.optional(
      v.pipe(
        list(
          "Observed groups",
          shape("Observed group", {
            rows: v.pipe(
              list("Group rows", integer("Group row", 1, 12)),
              v.check((rows) => rows.length > 0, "Observed group is empty."),
            ),
            total: v.optional(numericReading(false)),
            label: v.optional(text("Group label")),
          }),
        ),
        v.check((groups) => {
          const rows = groups.flatMap((group) => group.rows);
          return new Set(rows).size === rows.length;
        }, "Row appears in multiple groups."),
      ),
    ),
    representedBy: later(),
    represented: v.optional(integer("Screenshot represented players", 10, 12)),
    currentScale: v.optional(integer("Screenshot points scale", 10, 12)),
    reasons: list("Interpretation basis", text("Interpretation basis")),
    movementRows: v.pipe(
      list("Standings movements", v.unknown()),
      v.check((rows) => new Set(rows).size === rows.length, "Duplicate movements."),
      list("Standings movements", integer("Movement row", 1, 12)),
    ),
  },
  (reading) => {
    if (reading.representedBy === undefined) return;
    if (reading.represented === undefined) return "Invalid represented players origin.";
    return issue(
      textIn("Represented players origin", ["scale", "vote", "rows", "user"], "Invalid represented players origin."),
      reading.representedBy,
    );
  },
);

const nameRegion = edgeRegion(
  "Name region",
  "Name x",
  "Name y",
  "Name width",
  "Name height",
  "Name region is outside the screenshot.",
);
const recognizedRow = shape("Recognized row", {
  text: text("Recognized name", true),
  confidence: integer("OCR confidence", 0, 100),
  location: v.optional(nameRegion),
  bounds: v.optional(nameRegion),
  alternatives: v.optional(
    list(
      "Alternative names",
      shape("Alternative name", {
        text: text("Alternative name", true),
        confidence: integer("Alternative confidence", 0, 100),
      }),
    ),
  ),
  uncertain: v.boolean("Invalid recognized association."),
  suggestedParticipantId: text("Recognized player"),
});

/** What OCR and review recorded about one image, stored or still under review. */
const recognition = {
  ...photoTiming,
  context: v.optional(
    shape("Screenshot context", {
      phase: v.picklist(["before", "after", "event-final"], "Invalid context phase."),
      raceId: v.optional(text("Context race")),
    }),
  ),
  contextDraft: v.optional(
    shape("Context draft", {
      nameAssociations: v.optional(nameAssociations),
      numericAnswers: v.optional(numericAnswers),
      groupTotalAnswers: v.optional(groupTotalAnswers),
      nextTrackAnswer: v.optional(nextTrackAnswer),
      placements: refs("Context draft identities"),
      absentParticipantIds: refs("Context draft absences"),
      reviewed: v.boolean("Invalid context draft."),
      // Legacy hand-entered in-game points: still accepted so old data opens, never read.
      rawOverrides: v.optional(anyRecord("Context draft adjustments")),
    }),
  ),
  lastModified: v.optional(integer("Screenshot date", 0)),
  numericDeductions: v.optional(numericDeductions),
  nameAssociations: v.optional(nameAssociations),
  interpretation: v.optional(interpretation),
  numericAnswers: v.optional(numericAnswers),
  groupTotalAnswers: v.optional(groupTotalAnswers),
  nextTrackAnswer: v.optional(nextTrackAnswer),
  fileName: text("File name"),
  width: integer("Screenshot width", 1),
  height: integer("Screenshot height", 1),
  stage: v.picklist(["finish-order-confirmed", "context"], "Unsupported screenshot stage."),
  rows: list("Recognized rows", recognizedRow),
  fingerprint: v.optional(v.pipe(text("Screenshot fingerprint"), v.regex(SHA256, "Invalid screenshot fingerprint."))),
  numericStageSuggestion: v.optional(
    textIn("Numeric stage suggestion", ["points-only", "animation", "unverified"], "Invalid numeric stage suggestion."),
  ),
  numericRows: v.optional(
    list(
      "Numeric rows",
      shape("Numeric row", {
        row: integer("Numeric row", 1, 12),
        right: numericReading(false),
        addition: numericReading(true),
      }),
    ),
  ),
  possibleAbsentParticipantIds: v.optional(refs("Possibly absent players")),
  unreadableRowNumbers: v.optional(list("Unread rows", integer("Unread row", 1, 12))),
};
type Recognition = v.InferOutput<ReturnType<typeof shape<typeof recognition>>>;

/** The image's moment and screen, which restore has always read before its fields. */
function screenGuard(capture: Record<string, unknown>): Message {
  if (isRecord(capture.context)) {
    const context = capture.context;
    if (!["before", "after", "event-final"].includes(String(context.phase))) return "Invalid context phase.";
    if (context.raceId !== undefined) {
      const message = issue(text("Context race"), context.raceId);
      if (message) return message;
    }
    if (capture.stage !== "context") return "Context cannot declare a finish order.";
    if (capture.interpretation && !isRecord(capture.interpretation))
      return "Context interpretation: missing or invalid object.";
    const screen = isRecord(capture.interpretation) ? capture.interpretation.screen : undefined;
    const moment = isScreen(screen) ? screenProperties(screen).moment : undefined;
    if (moment ? context.phase !== moment : context.phase === "before")
      return "Context phase does not match the screenshot.";
  }
  const draft = isRecord(capture.contextDraft) ? groupSourceIssue(capture.contextDraft, capture) : undefined;
  if (draft) return draft;
  const reading = capture.interpretation;
  const observedRows = Array.isArray(capture.rows) ? capture.rows.length : 12;
  if (
    isRecord(reading) &&
    (reading.version !== 1 ||
      !hasScreenInterpretation(reading, observedRows) ||
      !["visual", "user"].includes(String(reading.origin)))
  )
    return "Invalid screenshot interpretation.";
}

/** Rules between an image's own fields; most depend on how many rows it shows. */
function screenshotIssue(capture: Recognition): Message {
  const observedRows = capture.rows.length;
  if (capture.numericDeductions?.some((deduction) => deduction.row > observedRows)) return "Invalid deduced number.";
  if (capture.nameAssociations && capture.nameAssociations.length !== observedRows) return "Invalid name associations.";
  if (capture.interpretation?.groups?.some((group) => group.rows.some((row) => row > observedRows)))
    return "Group row: invalid number.";
  const source = groupSourceIssue(capture, capture);
  if (source) return source;
  const finishOrder =
    capture.context === undefined &&
    (!capture.interpretation || screenProperties(capture.interpretation.screen).order === "finishOrder");
  if (capture.rows.length > 12 || (finishOrder && capture.rows.length !== 12)) return "Invalid observed row count.";
  if (capture.numericRows) {
    if (capture.numericRows.length !== observedRows) return "Numeric screenshot must preserve twelve rows.";
    const seen = new Set<number>();
    for (const { row } of capture.numericRows) {
      if (row > observedRows) return "Numeric row: invalid number.";
      if (seen.has(row)) return "Duplicate numeric row.";
      seen.add(row);
    }
  }
  if (capture.interpretation?.currentScale !== undefined) {
    if (!capture.numericRows) return "Native scale rows: missing or invalid list.";
    const scale = nativePlacementPoints(capture.interpretation.currentScale);
    for (let n = 0; n < scale.length; n++) {
      const addition = capture.numericRows.find((row) => row.row === n + 1)?.addition;
      if (!addition || addition.uncertain || addition.value !== scale[n])
        return "Readings do not support the full points scale.";
    }
  }
}

function screenshot<const E extends v.ObjectEntries>(label: string, entries: E, guard?: Guard) {
  return v.pipe(
    shape(label, { ...entries, ...recognition }, (capture) => guard?.(capture) ?? screenGuard(capture)),
    rule((capture) => screenshotIssue(capture as unknown as Recognition)),
  );
}

/** A screenshot stored in a mogi. `original` is null after freeing space. */
const capture = screenshot(
  "Screenshots",
  {
    ...idOf("Screenshots"),
    original: v.nullable(
      v.pipe(
        v.instance(Blob, "Original screenshot is missing."),
        v.check((blob) => blob.size > 0, "Original screenshot is missing."),
      ),
    ),
    compressedFrom,
    reviewedAt: date("Screenshot review date"),
    reviewedPlacements: refs("Reviewed associations"),
  },
  (capture) => compressedImageIssue(capture, capture.original),
);

/** A removed screenshot kept for undo; its bytes wait with the pending file. */
const removedCapture = screenshot("Removed screenshot", {
  id: text("Removed screenshot ID"),
  reviewedAt: date("Removed review"),
  reviewedPlacements: refs("Removed names"),
  compressedFrom,
  original: never("Duplicate original in removal."),
});

const pendingOnly = "Pending recognition is not a confirmed screenshot.";
/** OCR of an image still under review: no bytes and no review yet. */
const pendingRecognition = screenshot("Pending recognition", {
  id: text("Pending screenshot"),
  original: never(pendingOnly),
  reviewedAt: never(pendingOnly),
  reviewedPlacements: never(pendingOnly),
});

// ── Pending images ────────────────────────────────────────────────────────

const receivedImage = v.pipe(
  shape("Received screenshot", {
    id: text("Screenshot ID"),
    name: text("File name"),
    lastModified: integer("File date"),
    ...photoTiming,
    mimeType: text("Screenshot type"),
    original: v.instance(Blob, "Invalid received screenshot."),
  }),
  v.check(
    (file) =>
      ["image/png", "image/jpeg", "image/webp"].includes(file.mimeType) &&
      file.original.type === file.mimeType &&
      file.original.size > 0 &&
      file.original.size <= 25 * 1024 * 1024,
    "Invalid received screenshot.",
  ),
);
const receipts = v.pipe(
  ids(
    "Pending screenshots",
    "Received submissions",
    shape("Received submissions", idOf("Received submissions")),
  ) as v.GenericSchema<unknown, unknown[]>,
  v.check((items) => items.length <= MAX_BACKUP_ITEMS, "Too many pending submissions."),
  ids(
    "Pending screenshots",
    "Received submissions",
    shape("Received submissions", {
      ...idOf("Received submissions"),
      receivedAt: date("Submission date"),
      source: v.optional(v.literal("gallery", "Unsupported submission origin.")),
      files: v.pipe(
        capList("Received files", receivedImage, 32, "Too many screenshots in one submission."),
        v.check(
          (files) => files.reduce((total, file) => total + file.original.size, 0) <= 100 * 1024 * 1024,
          "Received submission exceeds 100 MB.",
        ),
      ),
      rejections: capList("Rejected files", text("Rejection"), 32, "Invalid rejections."),
    }),
  ),
  v.check((items) => {
    const files = items.flatMap((item) => item.files.map((file) => file.id));
    return new Set(files).size === files.length;
  }, "Duplicate received screenshot."),
);

// ── Numeric evidence ──────────────────────────────────────────────────────

/** One in-game number; an observed one names the screenshot row it was read from. */
const gameValue = (max: number) =>
  shape("Game value", {
    value: integer("Game value", 0, max),
    origin: textIn("Numeric origin", ["observed", "manual", "deduced"], "Invalid numeric origin."),
    sourceCaptureId: v.optional(text("Numeric source")),
    sourceRow: v.optional(integer("Numeric source row", 1, 12)),
    sourceField: v.optional(textIn("Numeric source field", ["right", "addition"], "Invalid numeric source field.")),
  });
export const pointsValue = gameValue(15);
export const totalValue = gameValue(9999);
export const gameReading = shape("Reading by identity", {
  segment: text("Numeric segment"),
  useAsAnchor: v.boolean("Invalid anchor choice."),
  current: v.optional(pointsValue),
  cumulative: v.optional(totalValue),
});
export type GameValueRecord = v.InferOutput<typeof totalValue>;

const gameEvidence = v.pipe(
  shape("Numeric evidence", {
    stage: textIn(
      "Numeric stage",
      ["unknown", "points-only", "animation", "pre-addition", "post-race"],
      "Invalid numeric stage.",
    ),
    session: text("Numeric session"),
    verified: v.boolean("Invalid final totals confirmation."),
    rowAssociations: v.optional(dict("Numeric row associations", refs("Numeric row identities"))),
    /** Checked per player in `validation.ts`: the player is read before the reading. */
    readings: anyRecord("Readings by identity"),
  }),
  v.check((evidence) => !evidence.verified || evidence.stage === "post-race", "Invalid final totals confirmation."),
);
export type GameEvidenceRecord = v.InferOutput<typeof gameEvidence>;

const conclusion = ["unique", "ambiguous", "conflict", "insufficient", "incomplete", "stale"] as const;

// ── Assisted reconstruction ───────────────────────────────────────────────

const fact = {
  raceId: text("Fact race"),
  participantId: text("Fact player"),
  position: v.custom<number | "absent">(
    (value) => value === "absent" || v.is(integer("", 1, 12), value),
    "Known position: invalid number.",
  ),
  origin: v.literal("user", "Invalid fact origin."),
  createdAt: date("Fact creation"),
  updatedAt: date("Fact review"),
};
const facts = (listLabel: string, label: string, tooMany: string) =>
  v.pipe(
    list(listLabel, v.unknown()),
    v.check((items) => items.length <= 4096, tooMany),
    ids(listLabel, label, shape(label, { ...idOf(label), ...fact })),
  );

export const hypothesis = shape("Hypothesis", {
  results: list(
    "Hypothesis results",
    shape("Hypothesis result", {
      raceId: text("Hypothesis occurrence"),
      represented: integer("Hypothesis represented players", 10, 12),
      placements: refs("Hypothesis placements"),
      absentParticipantIds: refs("Hypothesis absent players"),
    }),
  ),
});

const knownContribution = shape("Assisted known race", {
  raceId: text("Native source"),
  number: integer("Native occurrence", 1),
  represented: integer("Native represented players", 10, 12),
  discarded: v.boolean("Invalid native discard."),
  placements: refs("Known placements"),
  absentParticipantIds: refs("Known absences"),
  nativePoints: dict("Native contribution", integer("Native contribution", 0, 15)),
  nativePointOrigins: anyRecord("Native origins"),
});

/** A boundary equation joins two screenshots; only a boundary may carry a reported origin. */
function equationGuard(equation: Record<string, unknown>): Message {
  if (equation.originFact !== undefined && equation.boundary !== true)
    return "Reported origin has no boundary equation.";
  if (equation.boundary === undefined) return;
  if (
    equation.boundary !== true ||
    equation.current !== undefined ||
    equation.fromRaceId !== undefined ||
    equation.toRaceId !== undefined
  )
    return "Invalid boundary equation.";
}

/** A reported origin starts at zero from the screenshot the user confirmed; its source exists. */
export function reportedOriginIssue(
  equation: Record<string, unknown>,
  origin: Record<string, unknown>,
  older: Record<string, unknown>,
): Message {
  if (
    origin.kind !== "confirmed-origin" ||
    origin.answer !== "zero-valid-12" ||
    origin.captureId !== equation.toCaptureId ||
    equation.fromCaptureId !== undefined ||
    equation.fromNumber !== 0 ||
    older.value !== 0 ||
    older.origin !== "manual" ||
    older.sourceCaptureId !== undefined ||
    older.sourceRow !== undefined ||
    older.sourceField !== undefined
  )
    return "Invalid reported equation origin.";
  if (typeof origin.signature !== "string" || !origin.signature || origin.signature.length > 500000)
    return "Invalid reported origin signature.";
}

/** An equation between two totals; a `boundary` one joins two screenshots instead of two races. */
const equation = v.pipe(
  shape(
    "Assisted equation",
    {
      participantId: text("Equation identity"),
      boundary: later(),
      originFact: later(),
      knownRaceIds: later(),
      fromCaptureId: later(),
      toCaptureId: later(),
      fromRaceId: later(),
      toRaceId: later(),
      session: text("Equation session"),
      segment: text("Equation segment"),
      fromNumber: integer("Previous occurrence", 0),
      toNumber: integer("Following occurrence", 1),
      targetIndices: v.pipe(
        list("Equation terms", integer("Gap index", 0)),
        v.check((indices) => indices.length > 0 && new Set(indices).size === indices.length, "Invalid equation terms."),
      ),
      known: integer("Known in-game gains", 0, 9999),
      gain: integer("Intermediate gain", -30000, 9999),
      older: later(),
      newer: later(),
      current: later(),
    },
    equationGuard,
  ),
  v.check(
    (equation) => equation.originFact !== undefined || equation.fromNumber >= 1,
    "Previous occurrence: invalid number.",
  ),
);

/** One run of the assisted solver. A boundary proof runs as a group of its own, so its targets and facts carry the group's labels. */
const analysis = (targetsLabel: string, factsList: ReturnType<typeof facts>) =>
  v.pipe(
    shape("Assisted analysis", {
      status: textIn("Assistance status", conclusion, "Invalid assistance status."),
      inputSignature: hash,
      sourceSignature: hash,
      createdAt: date("Assisted analysis date"),
      message: text("Assistance conclusion"),
      orderVerified: v.boolean("Invalid assistance completeness."),
      complete: v.boolean("Invalid assistance completeness."),
      facts: factsList,
      targetRaceIds: refs(targetsLabel),
      hypotheses: capList("Assisted hypotheses", hypothesis, 4, "Too many hypothesis examples."),
      sourceCaptureIds: refs("Assisted sources"),
      knownRaces: v.pipe(
        list("Assisted contributions", knownContribution),
        v.check(
          (known) => new Set(known.map((race) => race.raceId)).size === known.length,
          "Duplicate native contribution.",
        ),
      ),
      equations: capList("Assisted equations", equation, 20000, "Too many equations."),
      stats: shape("Analysis metrics", {
        nodes: integer("Assistance metric", 0),
        contexts: integer("Assistance metric", 0),
        tuples: integer("Assistance metric", 0),
        elapsedMs: integer("Assistance metric", 0),
        cancelled: v.boolean("Invalid assistance cancellation."),
      }),
    }),
    v.check(
      (a) =>
        !(
          (a.status === "unique" && (!a.complete || !a.orderVerified || a.hypotheses.length !== 1)) ||
          (a.status === "conflict" && (!a.complete || a.hypotheses.length)) ||
          (a.status === "ambiguous" && a.hypotheses.length < 2)
        ),
      "Inconsistent assistance conclusion.",
    ),
  );
const assistedAnalysis = analysis(
  "Assisted occurrences",
  facts("Analysis facts", "Analysis facts", "Too many facts in the analysis."),
);
const boundaryAnalysis = analysis("Assisted gaps", facts("Known facts", "Facts", "Too many facts."));
export type AnalysisRecord = v.InferOutput<typeof assistedAnalysis>;

const confirmation = shape("Assisted confirmation", {
  at: date("Hypothesis confirmation"),
  inputSignature: hash,
  kind: later(),
  hypothesis: later(),
});

const assistance = shape(
  "Assisted reconstruction",
  {
    id: text("Assisted group"),
    targetRaceIds: refs("Assisted gaps"),
    facts: facts("Known facts", "Facts", "Too many facts."),
    factHistory: capList(
      "Fact history",
      shape("Fact event", {
        action: textIn("Fact action", ["add", "edit", "remove"], "Invalid fact action."),
        at: date("Fact date"),
        fact: shape("Position fact", { id: text("Fact ID"), ...fact }),
      }),
      100,
      "Fact history exceeds the limit.",
    ),
    skipped: v.optional(
      shape("Unknown questions", {
        signature: hash,
        keys: capList("Skipped questions", text("Skipped question"), 4096, "Too many skipped questions."),
      }),
    ),
    analysis: v.optional(assistedAnalysis),
    confirmed: v.optional(confirmation),
    history: capList(
      "Assistance history",
      shape("Assistance history", { analysis: assistedAnalysis, confirmed: v.optional(confirmation) }),
      10,
      "Too much assistance history.",
    ),
  },
  (group) =>
    group.analysis === undefined && group.confirmed !== undefined ? "Confirmation has no analysis." : undefined,
);
export type AssistanceRecord = v.InferOutput<typeof assistance>;

// ── Reconstruction ────────────────────────────────────────────────────────

const reconstruction = v.pipe(
  shape("Reconstruction", {
    status: textIn("Reconstruction state", conclusion, "Invalid reconstruction state."),
    createdAt: date("Reconstruction date"),
    targetNumber: integer("Reconstructed occurrence", 1),
    message: text("Reconstruction conclusion"),
    inputSignature: signature("Invalid reconstruction review.", 1000000),
    fromRaceId: v.optional(text("Reconstruction source")),
    toRaceId: v.optional(text("Reconstruction source")),
    session: v.optional(text("Reconstruction session")),
    sourceCaptureIds: refs("Reconstruction screenshots"),
    placements: refs("Reconstructed placements"),
    absentParticipantIds: refs("Reconstructed absences"),
    represented: v.optional(integer("Reconstructed represented players", 10, 12)),
    boundaryAnalysis: v.optional(v.pipe(anyRecord("Boundary proof"), boundaryAnalysis)),
    orderBasis: v.optional(textIn("Reconstruction basis", ["unique", "manual"], "Invalid reconstruction basis.")),
    knownRaces: list(
      "Known races",
      shape("Known race", {
        raceId: text("Known source"),
        number: integer("Known number", 1),
        represented: integer("Known represented players", 10, 12),
        discarded: v.boolean("Invalid known discard."),
        nativePoints: dict("Known in-game points", integer("Known in-game points", 0, 15)),
      }),
    ),
    anchors: capList(
      "Reconstruction anchors",
      shape("Reconstructed anchor", {
        participantId: text("Reconstructed identity"),
        segment: text("Reconstructed segment"),
        known: integer("Known gains", 0, 9999),
        gain: integer("Reconstructed gain", -9999, 9999),
        older: later(),
        newer: later(),
        current: later(),
      }),
      12,
      "Too many anchors.",
    ),
  }),
);
export type ReconstructionRecord = v.InferOutput<typeof reconstruction>;

// ── Races ─────────────────────────────────────────────────────────────────

export const HISTORY_KEYS = [
  "sourceRemovalHistory",
  "participationHistory",
  "reconstructionHistory",
  "gameEvidenceHistory",
] as const;

/** A snapshot's identity and origin, which restore has always read before its fields. */
function snapshotGuard(race: Record<string, unknown>): Message {
  for (const entry of Array.isArray(race.sourceRemovalHistory) ? race.sourceRemovalHistory : []) {
    const previous = isRecord(entry) ? entry.result : undefined;
    // Sources the result no longer cites are read after the removed source itself, unless they are not even text.
    if (!isRecord(previous)) continue;
    const unreadable =
      Array.isArray(previous.captureIds) && previous.captureIds.some((id: unknown) => !v.is(text(""), id));
    if (
      HISTORY_KEYS.some((key) => previous[key] !== undefined) ||
      previous.id !== race.id ||
      previous.origin !== "observed" ||
      (unreadable && !(previous.captureIds as unknown[]).includes(entry.captureId))
    )
      return "Inconsistent removal history.";
  }
  for (const entry of Array.isArray(race.participationHistory) ? race.participationHistory : []) {
    const result = isRecord(entry) ? entry.result : undefined;
    if (isRecord(result) && (result.id !== race.id || result.participationHistory !== undefined))
      return "Invalid identity or recursion in history.";
  }
}

interface RaceKind<I> {
  label: string;
  /** The identifier is checked by the list, or by the snapshot's owner. */
  id: I;
  /** Snapshots cite screenshots that may be gone, so their sources are only text. */
  historical: boolean;
  /** History a snapshot may not nest, and the message for nesting it. */
  forbid?: { keys: readonly string[]; message: string };
  /** Snapshots kept in the history this kind may nest. */
  removed?: Snapshot;
  changed?: Snapshot;
}
type Snapshot = v.GenericSchema<Record<string, unknown>, Record<string, unknown>>;

/** One race result, live or a snapshot in its history. Snapshots nest one level at most. */
function race<I extends v.GenericSchema>({ label, id, historical, forbid, removed, changed }: RaceKind<I>) {
  const allows = (key: string) => !forbid?.keys.includes(key);
  const nested = <S extends v.GenericSchema>(key: string, schema: S) =>
    allows(key) ? v.optional(schema) : never(forbid!.message);
  return v.pipe(
    shape(
      label,
      {
        id,
        track: v.optional(
          v.picklist(
            tracks.map((track) => track.short),
            "Invalid race track.",
          ),
        ),
        origin: textIn(
          "Race origin",
          ["manual", "observed", "reconstructed"],
          "Race origin is unsupported in this version.",
        ),
        physicalNumber: v.optional(integer("Physical position", 1, 999)),
        number: v.optional(integer("Occurrence number", 1)),
        status: v.optional(v.nullable(v.picklist(["confirmed", "pending", "discarded"], "Invalid race status."))),
        placements: refs("Placements"),
        absentParticipantIds: v.optional(refs("Absent players")),
        sourceRemovalHistory: nested(
          "sourceRemovalHistory",
          list(
            "Results without sources",
            shape("Result without a source", {
              removedAt: date("Source removal"),
              captureId: text("Removed source"),
              result: removed ? v.pipe(anyRecord("Previous source result"), removed) : v.never(),
            }),
          ),
        ),
        captureIds: v.optional(
          historical ? refs("Historical screenshots", "Historical screenshot") : refs("Race screenshots"),
        ),
        nativePoints: v.optional(dict("In-game points", integer("In-game points", 0, 15))),
        // "manual" is legacy and read-only: current races are re-modeled on load.
        nativePointOrigins: v.optional(
          dict("In-game points origin", v.picklist(["modeled", "manual"], "Invalid in-game points origin.")),
        ),
        reconstruction: v.optional(reconstruction),
        reconstructionHistory: nested("reconstructionHistory", list("Reconstruction history", reconstruction)),
        assistedGroupId: later(),
        gameEvidence: v.optional(gameEvidence),
        gameEvidenceHistory: nested(
          "gameEvidenceHistory",
          list(
            "Numeric history",
            shape("Numeric history", { changedAt: date("Numeric review date"), evidence: gameEvidence }),
          ),
        ),
        participationReview: v.optional(text("Participation review")),
        participationHistory: nested(
          "participationHistory",
          list(
            "Participation history",
            shape("Participation history", {
              changedAt: date("History date"),
              reason: text("History reason"),
              result: changed ? v.pipe(anyRecord("Historical result"), changed) : v.never(),
            }),
          ),
        ),
      },
      snapshotGuard,
    ),
    v.check(
      (race) =>
        race.origin !== "reconstructed" || race.reconstruction !== undefined || race.assistedGroupId !== undefined,
      "Reconstruction has no provenance.",
    ),
  );
}
const removedResult = race({
  label: "Previous source result",
  id: later(),
  historical: true,
  forbid: { keys: HISTORY_KEYS, message: "Inconsistent removal history." },
});
const changedResult = race({
  label: "Historical result",
  id: later(),
  historical: true,
  removed: removedResult,
  forbid: { keys: ["participationHistory"], message: "Invalid identity or recursion in history." },
});
const liveRace = race({
  label: "Races",
  id: text("Races: ID"),
  historical: false,
  removed: removedResult,
  changed: changedResult,
});
export type RaceRecord = v.InferOutput<typeof liveRace>;

// ── Drafts and review ─────────────────────────────────────────────────────

/** A draft cites a pending file or a stored screenshot only when it came from an image. */
function draftSourceGuard(draft: Record<string, unknown>): Message {
  if (draft.version !== 1 || typeof draft.purpose !== "string" || !["manual", "capture"].includes(draft.purpose))
    return;
  const file = draft.sourceFileId !== undefined,
    capture = draft.sourceCaptureId !== undefined;
  if (draft.purpose === "manual" ? file || capture : file === capture) return "Invalid draft screenshot origin.";
}

const raceDraft = v.pipe(
  shape(
    "Race draft",
    {
      version: v.literal(1, "Invalid draft version or origin."),
      purpose: textIn("Draft origin", ["manual", "capture"], "Invalid draft version or origin."),
      raceId: text("Draft race"),
      number: integer("Draft number", 1),
      updatedAt: date("Draft date"),
      baseSignature: v.nullable(v.pipe(text("Edit origin"), v.regex(SHA256, "Invalid edit origin."))),
      sourceFileId: v.optional(text("Draft file")),
      sourceCaptureId: v.optional(text("Draft screenshot")),
      fields: v.pipe(
        shape("Draft fields", {
          placements: refs("Draft placements"),
          absentParticipantIds: refs("Draft absent players"),
          reviewed: v.boolean("Invalid draft fields."),
          nameAssociations: v.optional(nameAssociations),
          groupTotalAnswers: v.optional(groupTotalAnswers),
          numericAnswers: v.optional(numericAnswers),
          nextTrackAnswer: v.optional(nextTrackAnswer),
          // Legacy hand-entered in-game points: still accepted so old drafts open, never read.
          rawOverrides: v.optional(
            v.pipe(
              anyRecord("Draft points"),
              v.check((raw) => Object.keys(raw).length <= 12, "Too many points in the draft."),
              dict("Draft points", text("Edited points", true)),
            ),
          ),
        }),
      ),
    },
    draftSourceGuard,
  ),
  v.check(
    (draft) => draft.fields.nextTrackAnswer === undefined || draft.purpose === "capture",
    "Next track name has no screenshot source.",
  ),
);
export type RaceDraftRecord = v.InferOutput<typeof raceDraft>;

/** One image in a review batch: a pending file or a stored screenshot. */
const reviewItem = (label: string, idLabel: string) =>
  v.pipe(
    shape(label, {
      id: text(idLabel),
      number: integer("Screenshot number", 1, 99),
      numberKnown: v.optional(v.boolean("Invalid number knowledge state.")),
      association: text("Screenshot association", true),
      status: textIn("Review stage", ["waiting", "ready", "failed", "cancelled", "saved"], "Invalid review stage."),
      separation: v.optional(text("Separation reason")),
      discarded: v.optional(v.boolean("Invalid review discard.")),
      source: v.pipe(
        shape("Review origin", { fileId: later(), captureId: later() }),
        v.check(
          (source) => (source.fileId !== undefined) !== (source.captureId !== undefined),
          "Invalid review origin.",
        ),
        rule((source) => issue(text("Review screenshot"), source.fileId ?? source.captureId)),
      ),
      recognition: v.optional(pendingRecognition),
      draft: v.optional(raceDraft),
      duplicate: v.optional(text("Duplicate warning")),
      error: v.optional(text("Recognition failure")),
    }),
    v.check(
      (item) => item.separation === undefined || item.status !== "saved",
      "A separate screenshot cannot be accepted.",
    ),
    v.check(
      (item) => item.recognition !== undefined || (item.status !== "ready" && item.status !== "saved"),
      "Review recognition is missing.",
    ),
  );
const removedReviewItem = reviewItem("Removed review", "Review screenshots: ID");
export type ReviewItemRecord = v.InferOutput<typeof removedReviewItem>;

const captureReview = shape("Screenshot review", {
  version: v.literal(1, "Invalid screenshot review version."),
  id: text("Review batch"),
  items: v.pipe(
    list("Review screenshots", v.unknown()),
    v.check((items) => items.length > 0 && items.length <= 32, "Invalid review screenshot count."),
    ids("Review screenshots", "Review screenshots", reviewItem("Review screenshots", "Review screenshots: ID")),
  ),
  currentItemId: text("Review cursor"),
});
export type CaptureReviewRecord = v.InferOutput<typeof captureReview>;

// ── Screenshot sequence ───────────────────────────────────────────────────

const sequenceSignature = signature("Invalid sequence signature.");
const totalsOrigins = list(
  "Totals origin",
  shape("Totals origin", {
    captureId: text("Origin source"),
    answer: v.picklist(["zero-valid-12", "unknown"], "Invalid or duplicate origin fact."),
    signature: sequenceSignature,
  }),
);
const reportedNumbers = list(
  "Reported numbers",
  shape("Reported number", {
    captureId: text("Number source"),
    physicalNumber: v.optional(integer("Source physical position", 1, 999)),
    number: v.nullable(integer("Reported number", 1, 99)),
    phase: v.picklist(["before", "after", "event-final"], "Invalid number phase."),
  }),
);
const links = list(
  "Screenshot relations",
  v.pipe(
    shape(
      "Relation",
      {
        fromCaptureId: text("Previous source"),
        toCaptureId: text("Next source"),
        signature: sequenceSignature,
        continuity: v.optional(v.picklist(["continuous-12", "reset", "unknown"], "Invalid continuity.")),
        people: v.optional(
          list(
            "Individual continuity",
            shape("Individual continuity", {
              participantId: text("Continuity identity"),
              answer: v.picklist(["stable", "reset", "unknown"], "Invalid individual continuity."),
            }),
          ),
        ),
        validity: v.optional(v.picklist(["counted", "discarded", "unknown"], "Invalid validity.")),
      },
      (link) =>
        link.fromCaptureId === link.toCaptureId && v.is(text(""), link.fromCaptureId)
          ? "Invalid or duplicate relation sources."
          : undefined,
    ),
  ),
);

const roomAnalysis = shape("Room analysis", {
  origin: v.literal("deduced", "Invalid room analysis origin."),
  sessions: ids(
    "Room sessions",
    "Room sessions",
    shape("Room sessions", {
      ...idOf("Room sessions"),
      captureIds: refs("Room sources"),
      reopening: v.boolean("Invalid room reopening."),
      start: v.optional(integer("Room start", 1, 99)),
      candidates: v.optional(list("Room candidates", integer("Room candidate", 1, 99))),
    }),
  ),
  captures: list(
    "Room screenshots",
    shape("Room screenshot", {
      captureId: text("Room source"),
      sessionId: later(),
      j: v.optional(integer("Room coordinate", 0, 99)),
      number: v.optional(integer("Deduced number", 1, 99)),
      suggestion: v.optional(integer("Suggested number", 1, 99)),
      placements: v.optional(refs("Deduced placements")),
      conflictRows: v.optional(list("Conflicting rows", integer("Conflicting row", 1, 12))),
      values: list(
        "Deduced readings",
        shape("Deduced reading", {
          row: integer("Deduced row", 1, 12),
          value: integer("Deduced points", 0, 9999),
          origin: v.literal("deduced", "Invalid deduced origin."),
        }),
      ),
      segments: list(
        "Room segments",
        shape("Room segment", {
          participantId: later(),
          anchor: v.boolean("Invalid room segment."),
          id: text("Numeric segment"),
        }),
      ),
    }),
  ),
  conflicts: refs("Room conflicts"),
  order: v.optional(
    shape("Room order", { sessionIds: refs("Unordered rooms"), captureIds: refs("Unordered sources") }),
  ),
});

const gap = v.pipe(
  shape("Gaps", {
    ...idOf("Gaps"),
    fromId: text("Gap boundary"),
    toId: text("Gap boundary"),
    sourceCaptureIds: refs("Gap sources"),
    order: later(),
    count: later(),
    validCount: later(),
  }),
  rule((gap) => {
    if (!["forward", "unknown"].includes(String(gap.order)) || (gap.order === "unknown" && gap.count !== undefined))
      return "Invalid gap order.";
    if (gap.count !== undefined) {
      const message = issue(integer("Physical count", 1, 99), gap.count);
      if (message) return message;
    }
    if (gap.validCount === undefined) return;
    if (gap.count === undefined) return "Counted amount has no known physical count.";
    return issue(integer("Counted amount", 0, Number(gap.count)), gap.validCount);
  }),
);

const sequence = shape("Screenshot sequence", {
  version: v.literal(1, "Invalid sequence version."),
  inputSignature: sequenceSignature,
  projectedRaceIds: v.optional(refs("Projected races")),
  associations: v.optional(
    list("Derived associations", shape("Derived association", { captureId: text("Derived source"), raceId: later() })),
  ),
  roomAnalysis: v.optional(roomAnalysis),
  conflict: v.optional(text("Sequence conflict")),
  origins: v.optional(totalsOrigins),
  numbers: reportedNumbers,
  links,
  relations: list(
    "Proven physical relations",
    shape("Physical relation", {
      fromCaptureId: text("Physical boundaries"),
      toCaptureId: text("Physical boundaries"),
      completedSteps: integer("Physical distance", 0, 99),
      stableParticipantIds: refs("Relation identities", "Relation identity"),
      resetParticipantIds: refs("Relation identities", "Relation identity"),
      unknownParticipantIds: refs("Relation identities", "Relation identity"),
    }),
  ),
  occurrences: ids(
    "Physical occurrences",
    "Physical occurrences",
    shape("Physical occurrences", {
      ...idOf("Physical occurrences"),
      physicalNumber: v.optional(integer("Occurrence physical position", 1, 999)),
      captureIds: refs("Occurrence sources"),
      aliases: refs("Reconciled identities", "Reconciled identity"),
      number: v.optional(integer("Counted number", 1, 99)),
      raceId: later(),
    }),
  ),
  gaps: ids("Gaps", "Gaps", gap),
});
export type SequenceRecord = v.InferOutput<typeof sequence>;

/** Sequence answers removed with one screenshot. */
export const removedSequence = shape("Removed source answers", {
  origins: v.optional(totalsOrigins),
  numbers: reportedNumbers,
  links,
});
export type RemovedSequenceRecord = v.InferOutput<typeof removedSequence>;

// ── Order review ──────────────────────────────────────────────────────────

const orderReview = v.pipe(
  shape("Sequence review", {
    acceptedAt: date("Sequence date"),
    inputSignature: signature("Invalid sequence evidence identifier.", 1000000),
    raceIds: refs("Ordered occurrences"),
    basis: textIn("Sequence basis", ["unique", "manual"], "Invalid sequence basis."),
    unresolvedRaceIds: refs("Uncompared occurrences"),
    gaps: list(
      "Numeric intervals",
      shape("Numeric interval", {
        fromRaceId: text("Interval start"),
        toRaceId: text("Interval end"),
        anchors: list(
          "Interval anchors",
          v.pipe(
            shape("Anchor", {
              participantId: text("Anchor identity"),
              olderTotal: integer("Previous total", 0, 9999),
              newerTotal: integer("Following total", 0, 9999),
              current: integer("Anchor points", 1, 15),
              intermediateGain: integer("Intermediate gain", 0, 9999),
            }),
            v.check(
              (anchor) => anchor.newerTotal - anchor.olderTotal - anchor.current === anchor.intermediateGain,
              "Inconsistent numeric interval equation.",
            ),
          ),
        ),
      }),
    ),
  }),
  v.check(
    (review) => !review.unresolvedRaceIds.some((id) => review.raceIds.includes(id)),
    "An ordered occurrence is also marked as not compared.",
  ),
);
export type OrderReviewRecord = v.InferOutput<typeof orderReview>;

// ── Mogi and tracker ──────────────────────────────────────────────────────

const playerIds = ids("Players", "Players", shape("Players", idOf("Players")));
/** The original twelve players are the roster's participation slots; replacements name one. */
function rosterGuard(mogi: Record<string, unknown>): Message {
  const people = mogi.participants;
  if (!Array.isArray(people) || !v.is(playerIds, people)) return;
  if (people.filter((person) => person.slotId === undefined || person.slotId === person.id).length !== 12)
    return "The roster must contain twelve original participation slots.";
}

const mogi = shape(
  "Mogis",
  {
    ...idOf("Mogis"),
    name: text("Mogi name"),
    sourceRevision: v.optional(integer("Source revision", 0)),
    createdAt: date("Mogi date"),
    format: v.picklist(["FFA", "2v2", "3v3"], "Unsupported format."),
    submissionTier: v.optional(text("Tier", true)),
    originalList: v.optional(text("Original list")),
    participants: ids(
      "Players",
      "Players",
      shape("Players", {
        ...idOf("Players"),
        loungeName: text("Lounge name"),
        ign: text("IGN"),
        ignOrigin: v.optional(v.picklist(["fallback", "explicit", "learned"], "Invalid IGN origin.")),
        teamId: v.optional(text("Player's team")),
        slotId: v.optional(text("Player's slot")),
      }),
    ),
    teams: v.optional(
      ids(
        "Teams",
        "Teams",
        shape("Teams", {
          ...idOf("Teams"),
          name: text("Team name"),
          tag: v.optional(capped("Team tag", 5, "Team tag: invalid text.", true)),
        }),
      ),
    ),
    captures: v.optional(ids("Screenshots", "Screenshots", capture)),
    deletedCaptureIds: v.optional(refs("Removed screenshots", "Removed screenshot")),
    races: ids("Races", "Races", liveRace),
    sequence: v.optional(sequence),
    coverage: later(),
    raceDraft: v.optional(raceDraft),
    captureReview: v.optional(captureReview),
    orderReview: v.optional(orderReview),
    assistance: v.optional(assistance),
    substitutions: v.optional(
      ids(
        "Substitutions",
        "Substitutions",
        shape("Substitutions", {
          ...idOf("Substitutions"),
          slotId: text("Substituted slot"),
          outgoingParticipantId: text("Outgoing player"),
          incomingParticipantId: text("Incoming player"),
          fromRaceId: v.optional(text("Entry occurrence")),
          fromPhysicalNumber: v.optional(integer("Physical boundary", 1, 999)),
          fromRace: integer("Entry race", 1),
          previousFromRaces: v.optional(list("Previous entries", integer("Previous entry", 1))),
        }),
      ),
    ),
    creditedParticipantIds: v.optional(anyRecord("Participation credit")),
  },
  rosterGuard,
);
export type MogiRecord = v.InferOutput<typeof mogi>;

const loungeName = capped("Your Lounge name", 80, "Your Lounge name is too long.");

const sourceUndo = shape(
  "Removal to undo",
  {
    id: text("Removal ID"),
    /** Looked up among the mogis first; see `validation.ts`. */
    mogiId: later(),
    fileId: text("Removal original"),
    capture: v.optional(removedCapture),
    /** Read only with a removed screenshot; see `validation.ts`. */
    sequence: later(),
    reviewItem: v.optional(removedReviewItem),
    raceDraft: v.optional(raceDraft),
    races: v.pipe(
      ids(
        "Removal references",
        "Removal references",
        race({
          label: "Removal references",
          id: text("Removal references: ID"),
          historical: true,
          forbid: { keys: HISTORY_KEYS, message: "Inconsistent historical removal reference." },
        }),
      ),
      v.check((races) => races.length <= 1, "Too many races for one removal."),
    ),
  },
  (undo) => ((undo.capture === undefined) === (undo.reviewItem === undefined) ? "Invalid removal source." : undefined),
);
export type SourceUndoRecord = v.InferOutput<typeof sourceUndo>;

/** A backup's whole `state`, `version: 1`. */
export const trackerSchema = shape("Tracker data", {
  version: v.literal(1, "Unsupported data version. Update the app before restoring."),
  sharedReceipts: v.optional(receipts),
  mogis: ids("Mogis", "Mogis", mogi),
  activeMogiId: later(),
  loungeName: v.optional(loungeName),
  loungeNames: v.optional(capList("Your Lounge names", loungeName, 20, "Too many Lounge names.")),
  trackOrder: v.optional(
    shape("Track order", {
      by: textIn("Track order", ["typical", "total", "races"], "Invalid track order."),
      count: textIn("Track order", ["both", "plus", "minus"], "Invalid track order."),
    }),
  ),
  sourceUndo: v.optional(sourceUndo),
});
export type TrackerRecord = v.InferOutput<typeof trackerSchema>;
export type CaptureRecord = v.InferOutput<typeof capture>;
export type RecognitionRecord = Recognition;
