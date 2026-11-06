import { participantsForOccurrence } from "@mkw/engine";

import type { Mogi, TrackerState } from "@/lib/mogi/types";

import { validateCoverage } from "./coverage-validation.ts";
import type {
  AnalysisRecord,
  AssistanceRecord,
  CaptureRecord,
  CaptureReviewRecord,
  GameEvidenceRecord,
  GameValueRecord,
  MogiRecord,
  OrderReviewRecord,
  RaceDraftRecord,
  RaceRecord,
  RecognitionRecord,
  ReconstructionRecord,
  ReviewItemRecord,
  SequenceRecord,
  TrackerRecord,
} from "./schema.ts";
import {
  compressedImageIssue,
  ensure,
  gameReading,
  groupSourceIssue,
  HISTORY_KEYS,
  hypothesis,
  integer,
  isRecord,
  pointsValue,
  refs,
  removedSequence,
  reportedOriginIssue,
  text,
  totalValue,
  trackerSchema,
} from "./schema.ts";

/**
 * Restore validation. `trackerSchema` checks every record's own shape; the passes below check
 * what records say about each other — players, races, screenshots, pending files — in the order
 * restore has always reported them. Each failure throws the restore error copy.
 */

const fail = (message: string): never => {
  throw new Error(message);
};

export function object(value: unknown, label: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(`${label}: missing or invalid object.`);
}

/** Compression changes stored bytes, while the fingerprint keeps identifying the source file. */
export function validateCompressedImage(image: Record<string, unknown>, original: unknown): void {
  const message = compressedImageIssue(image, original);
  if (message) fail(message);
}

/** Identifiers that must each name a distinct known record. */
function known(ids: readonly string[], records: Set<string>, label: string): readonly string[] {
  if (new Set(ids).size !== ids.length || ids.some((id) => !records.has(id)))
    fail(`${label}: missing or duplicate reference.`);
  return ids;
}

interface Context {
  people: Set<string>;
  /** Screenshots a record may cite: live ones and those with a removal record. */
  sourceIds: Set<string>;
  captures: Map<string, CaptureRecord>;
  raceIds: Set<string>;
}

export function validateTracker(value: unknown): asserts value is TrackerState {
  ensure(trackerSchema, value);
  // The schema keeps every field as stored; the reference checks read the record itself.
  const tracker = value as TrackerRecord;
  const pendingIds = new Set(tracker.sharedReceipts?.flatMap((receipt) => receipt.files.map((file) => file.id)) ?? []);
  const claimedReviewFiles = new Set<string>();
  const mogiIds = new Set(tracker.mogis.map((mogi) => mogi.id));
  if (tracker.activeMogiId !== null && (typeof tracker.activeMogiId !== "string" || !mogiIds.has(tracker.activeMogiId)))
    fail("Active mogi not found.");
  for (const mogi of tracker.mogis) validateMogi(mogi, pendingIds, claimedReviewFiles);
  if (tracker.sourceUndo !== undefined) validateSourceUndo(tracker, claimedReviewFiles);
}

function validateMogi(mogi: MogiRecord, pendingIds: Set<string>, claimedReviewFiles: Set<string>) {
  const people = new Set(mogi.participants.map((person) => person.id));
  const roots = mogi.participants.filter((person) => person.slotId === undefined || person.slotId === person.id);
  const rootIds = new Set(roots.map((person) => person.id));
  const teams = mogi.teams ?? [];
  const teamIds = new Set(teams.map((team) => team.id));
  for (const person of mogi.participants) {
    if (person.teamId !== undefined && !teamIds.has(person.teamId)) fail("Player's team not found.");
    if (person.slotId !== undefined && !rootIds.has(person.slotId)) fail("Participation slot not found.");
  }
  if (mogi.format !== "FFA") {
    const size = Number(mogi.format[0]);
    if (
      teams.length !== 12 / size ||
      teams.some((team) => roots.filter((person) => person.teamId === team.id).length > size)
    )
      fail("Inconsistent team distribution.");
  }
  const captures = mogi.captures ?? [];
  const captureIds = new Set(captures.map((capture) => capture.id));
  for (const capture of captures) {
    known(capture.reviewedPlacements, people, "Reviewed associations");
    validateRecognition(capture, people);
  }
  const deletedCaptureIds = new Set<string>();
  for (const id of mogi.deletedCaptureIds ?? []) {
    if (captureIds.has(id) || deletedCaptureIds.has(id)) fail("Invalid screenshot removal record.");
    deletedCaptureIds.add(id);
  }
  const raceIds = new Set(mogi.races.map((race) => race.id));
  const context: Context = {
    people,
    sourceIds: new Set([...captureIds, ...deletedCaptureIds]),
    captures: new Map(captures.map((capture) => [capture.id, capture])),
    raceIds,
  };
  for (const capture of captures)
    if (capture.context?.raceId !== undefined && !raceIds.has(String(capture.context.raceId)))
      fail("Context race not found.");
  if (mogi.sequence !== undefined) validateSequence(mogi.sequence, captureIds, raceIds, people);
  if (mogi.coverage !== undefined) validateCoverage(mogi.coverage, mogi as unknown as Mogi, context.sourceIds);
  if (mogi.raceDraft !== undefined) {
    validateRaceDraft(mogi.raceDraft, people, raceIds, pendingIds, captureIds);
    validateDraftSource(mogi.raceDraft, context.captures.get(String(mogi.raceDraft.sourceCaptureId)));
  }
  if (mogi.captureReview !== undefined)
    validateCaptureReview(
      mogi.captureReview,
      people,
      raceIds,
      pendingIds,
      captureIds,
      claimedReviewFiles,
      context.captures,
    );
  if (mogi.orderReview !== undefined) validateOrderReview(mogi.orderReview, raceIds, people);
  if (mogi.assistance !== undefined) validateAssistance(mogi.assistance, context);
  validateRaces(mogi, context);
  validateSubstitutions(mogi, rootIds, raceIds);
  validateSegments(mogi);
  const slotOf = slotFor(mogi);
  for (const [slot, person] of Object.entries(mogi.creditedParticipantIds ?? {}))
    if (!rootIds.has(slot) || typeof person !== "string" || !people.has(person) || slotOf(person) !== slot)
      fail("Inconsistent credited player.");
}

const slotFor = (mogi: MogiRecord) => (id: string) => {
  const person = mogi.participants.find((entry) => entry.id === id);
  return person?.slotId ?? person?.id;
};

function validateRaces(mogi: MogiRecord, context: Context) {
  const physicalNumbers = new Set<number>(),
    numbers = new Set<number>(),
    associated = new Set<string>();
  let counted = 0;
  mogi.races.forEach((race, index) => {
    validateRace(race, context, false);
    if (race.physicalNumber !== undefined) {
      if (physicalNumbers.has(race.physicalNumber)) fail("Duplicate physical position.");
      physicalNumbers.add(race.physicalNumber);
    }
    if (race.assistedGroupId !== undefined) {
      const group = object(mogi.assistance, "Assisted race group") as AssistanceRecord;
      if (
        race.origin !== "reconstructed" ||
        race.assistedGroupId !== group.id ||
        !group.targetRaceIds.includes(race.id)
      )
        fail("Race reconstruction group not found.");
    }
    const number = race.number ?? index + 1;
    if (race.status !== "discarded") {
      if (numbers.has(number)) fail("Duplicate occurrence number.");
      numbers.add(number);
    }
    if ((race.status ?? "confirmed") === "confirmed") counted++;
    for (const id of race.captureIds ?? []) {
      if (associated.has(id)) fail("A screenshot is associated with more than one race.");
      associated.add(id);
    }
  });
  if (counted > 12) fail("More than twelve races counted.");
}

/** Each slot hands over to one replacement at a time, in race order. */
function validateSubstitutions(mogi: MogiRecord, rootIds: Set<string>, raceIds: Set<string>) {
  const people = new Set(mogi.participants.map((person) => person.id));
  const slotOf = slotFor(mogi);
  const boundary = (sub: { fromPhysicalNumber?: number; fromRace: number }) => sub.fromPhysicalNumber ?? sub.fromRace;
  const transitions = new Map<string, { race: number; active: string }>();
  for (const sub of [...(mogi.substitutions ?? [])].sort((a, b) => boundary(a) - boundary(b))) {
    if (sub.fromRaceId !== undefined && !raceIds.has(sub.fromRaceId)) fail("Entry occurrence not found.");
    if (
      sub.fromRaceId !== undefined &&
      (sub.fromPhysicalNumber === undefined ||
        mogi.races.find((race) => race.id === sub.fromRaceId)?.physicalNumber !== sub.fromPhysicalNumber)
    )
      fail("Inconsistent participation boundary.");
    const number = boundary(sub);
    const previous = transitions.get(sub.slotId) ?? { race: 0, active: sub.slotId };
    if (
      !rootIds.has(sub.slotId) ||
      !people.has(sub.outgoingParticipantId) ||
      !people.has(sub.incomingParticipantId) ||
      slotOf(sub.outgoingParticipantId) !== sub.slotId ||
      slotOf(sub.incomingParticipantId) !== sub.slotId ||
      sub.outgoingParticipantId === sub.incomingParticipantId ||
      number <= previous.race ||
      previous.active !== sub.outgoingParticipantId
    )
      fail("Inconsistent substitution history.");
    transitions.set(sub.slotId, { race: number, active: sub.incomingParticipantId });
  }
}

/** A confirmed result names only players active in its participation segment. Restore revalidates proofs and ignores the legacy completion marker. */
function validateSegments(mogi: MogiRecord) {
  for (const race of mogi.races) {
    if (
      (race.status ?? "confirmed") !== "confirmed" &&
      (race.status !== "discarded" || !race.placements.length || race.participationReview)
    )
      continue;
    if (race.participationReview) fail("A result awaiting review was marked as confirmed.");
    const active = new Set(
      participantsForOccurrence(mogi as unknown as Mogi, race as unknown as Mogi["races"][number]).map(
        (person) => person.id,
      ),
    );
    if ([...race.placements, ...(race.absentParticipantIds ?? [])].some((id) => !active.has(id)))
      fail("A confirmed result uses an identity outside its participation segment.");
  }
}

function validateRace(race: RaceRecord, context: Context, historical: boolean): void {
  const placements = known(race.placements, context.people, "Placements");
  const absent =
    race.absentParticipantIds === undefined ? [] : known(race.absentParticipantIds, context.people, "Absent players");
  if (placements.length > 12 || absent.length > 12 || placements.some((id) => absent.includes(id)))
    fail("Inconsistent placements and absences.");
  const status = race.status ?? "confirmed";
  if (
    status !== "pending" &&
    !(status === "discarded" && !placements.length) &&
    (placements.length < 10 || placements.length + absent.length !== 12 || absent.length > 2)
  )
    fail("Incomplete or invalid confirmed result.");
  for (const entry of race.sourceRemovalHistory ?? []) {
    if (!context.sourceIds.has(entry.captureId)) fail("Removed historical source not found.");
    if (!Array.isArray(entry.result.captureIds)) fail("Previous result sources: missing or invalid list.");
    if (!(entry.result.captureIds as string[]).includes(entry.captureId)) fail("Inconsistent removal history.");
    validateRace(entry.result as RaceRecord, context, true);
  }
  if (race.captureIds !== undefined && !historical)
    known(race.captureIds, new Set(context.captures.keys()), "Race screenshots");
  for (const id of Object.keys(race.nativePoints ?? {}))
    if (!context.people.has(id)) fail("In-game points: player not found.");
  for (const id of Object.keys(race.nativePointOrigins ?? {}))
    if (!context.people.has(id)) fail("Invalid in-game points origin.");
  if (race.reconstruction !== undefined) validateReconstruction(race.reconstruction, context);
  for (const past of race.reconstructionHistory ?? []) validateReconstruction(past, context);
  if (race.gameEvidence !== undefined) validateGameEvidence(race.gameEvidence, context);
  for (const item of race.gameEvidenceHistory ?? []) validateGameEvidence(item.evidence, context);
  for (const item of race.participationHistory ?? []) validateRace(item.result as RaceRecord, context, true);
}

// ── Screenshots ───────────────────────────────────────────────────────────

function validateNameAssociations(answers: RecognitionRecord["nameAssociations"], people: Set<string>) {
  const seen = new Set<string>();
  for (const answer of answers ?? []) {
    if (answer.participantId === null) continue;
    if (!people.has(answer.participantId) || seen.has(answer.participantId))
      fail("Invalid or duplicate name association.");
    seen.add(answer.participantId);
  }
}

function validateRecognition(capture: RecognitionRecord, people: Set<string>) {
  if (capture.contextDraft !== undefined) {
    validateNameAssociations(capture.contextDraft.nameAssociations, people);
    known(capture.contextDraft.placements, people, "Context draft identities");
    known(capture.contextDraft.absentParticipantIds, people, "Context draft absences");
  }
  validateNameAssociations(capture.nameAssociations, people);
  if (capture.rows.some((row) => !people.has(row.suggestedParticipantId))) fail("Invalid recognized association.");
  if (capture.possibleAbsentParticipantIds !== undefined)
    known(capture.possibleAbsentParticipantIds, people, "Possibly absent players");
}

function validateRaceDraft(
  draft: RaceDraftRecord,
  people: Set<string>,
  raceIds: Set<string>,
  pendingIds: Set<string>,
  captureIds: Set<string>,
) {
  if (draft.baseSignature !== null ? !raceIds.has(draft.raceId) : false) fail("Draft's source race not found.");
  if (draft.baseSignature === null && raceIds.has(draft.raceId)) fail("Edit origin is missing.");
  if (draft.sourceFileId !== undefined && !pendingIds.has(draft.sourceFileId)) fail("Draft file not found.");
  if (draft.sourceCaptureId !== undefined && !captureIds.has(draft.sourceCaptureId))
    fail("Draft screenshot not found.");
  const placements = known(draft.fields.placements, people, "Draft placements");
  const absent = known(draft.fields.absentParticipantIds, people, "Draft absent players");
  if (placements.length + absent.length > 12 || absent.some((id) => placements.includes(id)))
    fail("Invalid draft fields.");
  validateNameAssociations(draft.fields.nameAssociations, people);
  for (const id of Object.keys(draft.fields.rawOverrides)) if (!people.has(id)) fail("Invalid draft points.");
}

/** A draft's answers must fit the image it came from; without one it has no next track. */
function validateDraftSource(draft: RaceDraftRecord, source: Record<string, unknown> | undefined) {
  if (source) {
    const message = groupSourceIssue(draft.fields, source);
    if (message) fail(message);
  } else if (draft.fields.nextTrackAnswer !== undefined) fail("Next track name has no screenshot source.");
}

function validateCaptureReview(
  review: Pick<CaptureReviewRecord, "items" | "currentItemId">,
  people: Set<string>,
  raceIds: Set<string>,
  pendingIds: Set<string>,
  captureIds: Set<string>,
  claimedFiles: Set<string>,
  captures: Map<string, CaptureRecord>,
) {
  if (!review.items.some((item) => item.id === review.currentItemId)) fail("Invalid review cursor.");
  const sources = new Set<string>();
  for (const item of review.items as ReviewItemRecord[]) {
    const { association } = item;
    if (association !== "" && association !== "new" && !raceIds.has(association)) fail("Review race not found.");
    const pending = item.source.fileId !== undefined;
    const id = String(pending ? item.source.fileId : item.source.captureId);
    if (item.status === "saved" && item.numberKnown === false && !captures.get(id)?.context)
      fail("Race number is not yet known.");
    if (!(pending ? pendingIds : captureIds).has(id)) fail("Review screenshot not found.");
    if (sources.has(id) || (pending && claimedFiles.has(id))) fail("Duplicate review screenshot.");
    if (pending) claimedFiles.add(id);
    sources.add(id);
    if (item.status === "saved" && (pending || (!raceIds.has(association) && !captures.get(id)?.context)))
      fail("Invalid review confirmation.");
    if (item.recognition !== undefined) {
      validateRecognition(item.recognition, people);
      if (!pending && item.recognition.id !== id) fail("Invalid screenshot recognition.");
    }
    if (item.draft !== undefined) {
      const draft = item.draft;
      validateRaceDraft(draft, people, raceIds, pendingIds, captureIds);
      validateDraftSource(draft, item.recognition ?? captures.get(id));
      if (
        draft.purpose !== "capture" ||
        (pending ? draft.sourceFileId : draft.sourceCaptureId) !== id ||
        draft.raceId !== (association === "new" || association === "" ? item.id : association)
      )
        fail("Inconsistent screenshot draft.");
    }
  }
}

// ── Sequence and order ────────────────────────────────────────────────────

/** Source references, including sequences without images. */
function validateSequence(
  sequence: SequenceRecord,
  captureIds: Set<string>,
  raceIds: Set<string>,
  people: Set<string>,
) {
  if (sequence.projectedRaceIds !== undefined) known(sequence.projectedRaceIds, raceIds, "Projected races");
  const derived = new Set<string>();
  for (const entry of sequence.associations ?? []) {
    if (!captureIds.has(entry.captureId) || derived.has(entry.captureId) || !raceIds.has(String(entry.raceId)))
      fail("Invalid or duplicate derived association.");
    derived.add(entry.captureId);
  }
  const room = sequence.roomAnalysis;
  if (room !== undefined) {
    const sessionIds = new Set(room.sessions.map((session) => session.id));
    for (const session of room.sessions) known(session.captureIds, captureIds, "Room sources");
    const roomSources = new Set<string>();
    for (const entry of room.captures) {
      if (
        !captureIds.has(entry.captureId) ||
        roomSources.has(entry.captureId) ||
        !sessionIds.has(String(entry.sessionId))
      )
        fail("Invalid room source.");
      roomSources.add(entry.captureId);
      if (entry.placements !== undefined) known(entry.placements, people, "Deduced placements");
      if (entry.segments.some((segment) => !people.has(String(segment.participantId)))) fail("Invalid room segment.");
    }
    known(room.conflicts, captureIds, "Room conflicts");
    if (room.order !== undefined) {
      known(room.order.sessionIds, sessionIds, "Unordered rooms");
      known(room.order.captureIds, captureIds, "Unordered sources");
    }
  }
  const origins = new Set<string>();
  for (const fact of sequence.origins ?? []) {
    if (!captureIds.has(fact.captureId) || origins.has(fact.captureId)) fail("Invalid or duplicate origin fact.");
    origins.add(fact.captureId);
  }
  const numbered = new Set<string>();
  for (const fact of sequence.numbers) {
    if (!captureIds.has(fact.captureId) || numbered.has(fact.captureId)) fail("Number source not found or duplicated.");
    numbered.add(fact.captureId);
  }
  const linked = new Set<string>();
  for (const link of sequence.links) {
    const pair = `${link.fromCaptureId}:${link.toCaptureId}`;
    if (!captureIds.has(link.fromCaptureId) || !captureIds.has(link.toCaptureId) || linked.has(pair))
      fail("Invalid or duplicate relation sources.");
    linked.add(pair);
    const continuity = new Set<string>();
    for (const fact of link.people ?? []) {
      if (!people.has(fact.participantId) || continuity.has(fact.participantId)) fail("Invalid individual continuity.");
      continuity.add(fact.participantId);
    }
  }
  for (const relation of sequence.relations) {
    known([relation.fromCaptureId, relation.toCaptureId], captureIds, "Physical boundaries");
    const identities = new Set<string>();
    for (const person of [
      ...relation.stableParticipantIds,
      ...relation.resetParticipantIds,
      ...relation.unknownParticipantIds,
    ]) {
      if (!people.has(person) || identities.has(person)) fail("Invalid or duplicate relation identity.");
      identities.add(person);
    }
  }
  const occurrences = sequence.occurrences;
  const occurrenceIds = new Set(occurrences.map((occurrence) => occurrence.id));
  const sources = new Set<string>(),
    aliases = new Set<string>();
  for (const occurrence of occurrences) {
    const ids = known(occurrence.captureIds, captureIds, "Occurrence sources");
    if (!ids.length || ids.some((id) => sources.has(id))) fail("Physical source not found or duplicated.");
    ids.forEach((id) => sources.add(id));
    for (const alias of occurrence.aliases) {
      if (occurrenceIds.has(alias) || aliases.has(alias)) fail("Duplicate physical identity.");
      aliases.add(alias);
    }
    if (
      occurrence.raceId !== undefined &&
      (occurrence.raceId !== occurrence.id || !raceIds.has(String(occurrence.raceId)))
    )
      fail("Invalid physical race identity.");
  }
  for (const gap of sequence.gaps)
    if (
      gap.fromId === gap.toId ||
      !occurrenceIds.has(gap.fromId) ||
      !occurrenceIds.has(gap.toId) ||
      known(gap.sourceCaptureIds, captureIds, "Gap sources").length !== 2
    )
      fail("Invalid gap boundaries.");
}

function validateOrderReview(review: OrderReviewRecord, raceIds: Set<string>, people: Set<string>) {
  const order = known(review.raceIds, raceIds, "Ordered occurrences");
  known(review.unresolvedRaceIds, raceIds, "Uncompared occurrences");
  for (const gap of review.gaps) {
    if (!order.includes(gap.fromRaceId) || order[order.indexOf(gap.fromRaceId) + 1] !== gap.toRaceId)
      fail("Invalid numeric interval reference.");
    const seen = new Set<string>();
    for (const anchor of gap.anchors) {
      if (!people.has(anchor.participantId) || seen.has(anchor.participantId))
        fail("Invalid or duplicate anchor identity.");
      seen.add(anchor.participantId);
    }
  }
}

// ── Numeric evidence ──────────────────────────────────────────────────────

/** An observed value must name a screenshot row, and match it when the screenshot is still stored. */
function validateGameValue(
  value: GameValueRecord,
  field: "current" | "cumulative",
  id: string,
  evidence: Pick<GameEvidenceRecord, "verified" | "rowAssociations">,
  context: Context,
) {
  if (
    value.sourceCaptureId === undefined &&
    value.sourceRow === undefined &&
    value.sourceField === undefined &&
    value.origin !== "observed"
  )
    return;
  const source = ensure(text("Numeric source"), value.sourceCaptureId);
  if (!context.sourceIds.has(source)) fail("Numeric source not found and has no removal record.");
  const row = ensure(integer("Numeric source row", 1, 12), value.sourceRow);
  const sourceField = value.sourceField ?? fail("Numeric source field: invalid text.");
  const observed = value.origin === "observed";
  if (field === "cumulative" && observed && sourceField !== "right")
    fail("Numeric source field does not represent a total.");
  const associations: Record<string, string[]> = evidence.rowAssociations ?? {};
  if (evidence.verified && observed && associations[source] !== undefined && associations[source][row - 1] !== id)
    fail("Numeric source is associated with another identity; review pending.");
  const capture = context.captures.get(source);
  if (capture && observed) {
    const numericRows = capture.numericRows ?? fail("Numeric source rows: missing or invalid list.");
    if (numericRows.find((entry) => entry.row === row)?.[sourceField].value !== value.value)
      fail("Numeric source does not match the observed value.");
  }
}

function validateGameEvidence(evidence: GameEvidenceRecord, context: Context) {
  for (const [source, ids] of Object.entries(evidence.rowAssociations ?? {})) {
    if (!context.sourceIds.has(source)) fail("Numeric association source not found.");
    const rows = context.captures.get(source)?.rows;
    if (known(ids, context.people, "Numeric row identities").length !== (Array.isArray(rows) ? rows.length : 12))
      fail("Numeric associations must preserve twelve rows.");
  }
  for (const [id, value] of Object.entries(evidence.readings)) {
    if (!context.people.has(id)) fail("Numeric identity not found.");
    const reading = ensure(gameReading, value);
    if (reading.current !== undefined) validateGameValue(reading.current, "current", id, evidence, context);
    if (reading.cumulative !== undefined) validateGameValue(reading.cumulative, "cumulative", id, evidence, context);
  }
}

/** A verified equation: newer total − older total − current points − known gains = gain. */
function validateEquationValues(
  item: { older?: unknown; newer?: unknown; current?: unknown; known: number; gain: number },
  id: string,
  context: Context,
  labels: { older: string; newer: string; current?: string; inconsistent: string },
) {
  const values: Partial<Record<"older" | "newer" | "current", GameValueRecord>> = {};
  for (const field of ["older", "newer", ...(labels.current ? (["current"] as const) : [])] as const) {
    if (item[field] === undefined) continue;
    const value = (values[field] = ensure(field === "current" ? pointsValue : totalValue, item[field]));
    validateGameValue(value, field === "current" ? "current" : "cumulative", id, { verified: true }, context);
  }
  const newer = values.newer ?? fail(`${labels.newer}: missing or invalid object.`);
  const older = values.older ?? fail(`${labels.older}: missing or invalid object.`);
  const current = labels.current ? (values.current ?? fail(`${labels.current}: missing or invalid object.`)).value : 0;
  if (newer.value - older.value - current - item.known !== item.gain) fail(labels.inconsistent);
}

function validateReconstruction(proof: ReconstructionRecord, context: Context) {
  for (const id of [proof.fromRaceId, proof.toRaceId])
    if (id !== undefined && !context.raceIds.has(id)) fail("Source occurrence not found.");
  known(proof.sourceCaptureIds, context.sourceIds, "Reconstruction screenshots");
  const placements = known(proof.placements, context.people, "Reconstructed placements");
  const absent = known(proof.absentParticipantIds, context.people, "Reconstructed absences");
  if (placements.length > 12 || absent.length > 2 || placements.some((id) => absent.includes(id)))
    fail("Inconsistent reconstructed absences.");
  if (
    proof.status === "unique" &&
    (proof.represented !== placements.length ||
      placements.length + absent.length !== 12 ||
      (!proof.boundaryAnalysis && (!proof.fromRaceId || !proof.toRaceId || proof.fromRaceId === proof.toRaceId)))
  )
    fail("Incomplete unique reconstruction.");
  const analysis = proof.boundaryAnalysis;
  if (analysis !== undefined) {
    validateAssistance(
      {
        id: "boundary-proof",
        targetRaceIds: analysis.targetRaceIds,
        facts: analysis.facts,
        factHistory: [],
        history: [],
        analysis,
      },
      context,
      "Assisted gaps",
    );
    if (proof.status === "unique" && (analysis.status !== "unique" || analysis.complete !== true))
      fail("Boundaries do not prove uniqueness.");
    if (
      analysis.targetRaceIds.length !== 1 ||
      JSON.stringify([...analysis.sourceCaptureIds].sort()) !== JSON.stringify([...proof.sourceCaptureIds].sort())
    )
      fail("Inconsistent reconstruction proof.");
    if (proof.status === "unique") {
      const result = analysis.hypotheses[0].results[0];
      if (
        JSON.stringify(result.placements) !== JSON.stringify(placements) ||
        JSON.stringify([...result.absentParticipantIds].sort()) !== JSON.stringify([...absent].sort()) ||
        result.represented !== proof.represented
      )
        fail("Inconsistent reconstruction proof.");
    }
  }
  const knownRaces = new Set<string>();
  for (const race of proof.knownRaces) {
    if (knownRaces.has(race.raceId) || !context.raceIds.has(race.raceId)) fail("Known race not found or duplicated.");
    knownRaces.add(race.raceId);
    for (const id of Object.keys(race.nativePoints))
      if (!context.people.has(id)) fail("Known in-game points: player not found.");
  }
  const seen = new Set<string>();
  for (const anchor of proof.anchors) {
    if (!context.people.has(anchor.participantId) || seen.has(anchor.participantId))
      fail("Invalid reconstructed identity.");
    seen.add(anchor.participantId);
    validateEquationValues(anchor, anchor.participantId, context, {
      older: "Previous total",
      newer: "New total",
      current: "Current points",
      inconsistent: "Inconsistent reconstructed equation.",
    });
  }
}

// ── Assisted reconstruction ───────────────────────────────────────────────

type Group = Pick<AssistanceRecord, "id" | "targetRaceIds" | "facts" | "factHistory" | "history" | "analysis"> &
  Partial<AssistanceRecord>;
type Hypothesis = AnalysisRecord["hypotheses"][number];

/** `represented` players are placed and the rest absent, never both. */
const agree = (represented: number, placements: readonly string[], absent: readonly string[]) =>
  placements.length === represented &&
  absent.length === 12 - represented &&
  !placements.some((id) => absent.includes(id));

function validateHypothesis(value: Hypothesis, targets: readonly string[], people: Set<string>) {
  if (value.results.length !== targets.length) fail("Incomplete hypothesis.");
  const seen = new Set<string>();
  for (const result of value.results) {
    if (!targets.includes(result.raceId) || seen.has(result.raceId)) fail("Invalid hypothesis reference.");
    seen.add(result.raceId);
    const placements = known(result.placements, people, "Hypothesis placements");
    const absent = known(result.absentParticipantIds, people, "Hypothesis absent players");
    if (!agree(result.represented, placements, absent)) fail("Inconsistent hypothesis context.");
  }
}

/** `targetsLabel` names the target races: a boundary proof is read as a group of its own. */
function validateAssistance(group: Group, context: Context, targetsLabel = "Assisted gaps") {
  const { raceIds, people, sourceIds } = context;
  known(group.targetRaceIds, raceIds, targetsLabel);
  const fact = (value: { raceId: string; participantId: string }) => {
    known([value.raceId], raceIds, "Fact race");
    known([value.participantId], people, "Fact player");
  };
  group.facts.forEach(fact);
  group.factHistory.forEach((event) => fact(event.fact));
  for (const key of group.skipped?.keys ?? [])
    if (![...raceIds].some((race) => [...people].some((person) => key === `${race}:${person}`)))
      fail("Skipped question has no reference.");

  const analysis = (a: AnalysisRecord) => {
    a.facts.forEach(fact);
    const targets = known(a.targetRaceIds, raceIds, "Assisted occurrences");
    a.hypotheses.forEach((value) => validateHypothesis(value, targets, people));
    known(a.sourceCaptureIds, sourceIds, "Assisted sources");
    const knownIds = new Set<string>();
    for (const race of a.knownRaces) {
      known([race.raceId], raceIds, "Native source");
      knownIds.add(race.raceId);
      const placements = known(race.placements, people, "Known placements");
      const absent = known(race.absentParticipantIds, people, "Known absences");
      if (!agree(race.represented, placements, absent)) fail("Inconsistent native context.");
      for (const id of Object.keys(race.nativePoints))
        if (!people.has(id)) fail("Native contribution: player not found.");
      for (const [id, origin] of Object.entries(race.nativePointOrigins))
        if (!placements.includes(id) || !["modeled", "manual"].includes(String(origin))) fail("Invalid native origin.");
    }
    for (const equation of a.equations) {
      known([equation.participantId], people, "Equation identity");
      if (equation.boundary === undefined) {
        known(
          [ensure(text("Equation sources"), equation.fromRaceId), ensure(text("Equation sources"), equation.toRaceId)],
          raceIds,
          "Equation sources",
        );
      } else {
        if (equation.originFact !== undefined) {
          const origin = object(equation.originFact, "Reported equation origin"),
            older = object(equation.older, "Reported start");
          known([ensure(text("Reported origin source"), equation.toCaptureId)], sourceIds, "Reported origin source");
          const message = reportedOriginIssue(equation, origin, older);
          if (message) fail(message);
        } else {
          known(
            [
              ensure(text("Boundary sources"), equation.fromCaptureId),
              ensure(text("Boundary sources"), equation.toCaptureId),
            ],
            sourceIds,
            "Boundary sources",
          );
          if (object(equation.older, "Previous boundary").sourceCaptureId !== equation.fromCaptureId)
            fail("Boundary source does not match.");
        }
        if (
          equation.knownRaceIds !== undefined &&
          known(ensure(refs("Equation contributions"), equation.knownRaceIds), raceIds, "Equation contributions").some(
            (id) => !knownIds.has(id),
          )
        )
          fail("Known contribution has no provenance.");
        if (object(equation.newer, "Following boundary").sourceCaptureId !== equation.toCaptureId)
          fail("Boundary source does not match.");
      }
      if (equation.targetIndices.some((index) => index > targets.length - 1)) fail("Gap index: invalid number.");
      validateEquationValues(equation, equation.participantId, context, {
        older: "Previous total",
        newer: "Following total",
        current: equation.boundary ? undefined : "Current points",
        inconsistent: "Inconsistent assisted equation.",
      });
    }
    return a;
  };
  const confirmation = (c: NonNullable<AssistanceRecord["confirmed"]>, a: AnalysisRecord) => {
    if (
      ["stale", "conflict", "insufficient"].includes(a.status) ||
      c.inputSignature !== a.inputSignature ||
      !["user", "unique"].includes(ensure(text("Confirmation origin"), c.kind))
    )
      fail("Inconsistent assistance confirmation.");
    const confirmed = ensure(hypothesis, c.hypothesis);
    validateHypothesis(confirmed, a.targetRaceIds, people);
    const canonical = (value: Hypothesis) =>
      JSON.stringify(
        value.results.map((result) => [
          result.raceId,
          result.represented,
          result.placements,
          [...result.absentParticipantIds].sort(),
        ]),
      );
    if (!a.hypotheses.some((example) => canonical(example) === canonical(confirmed)))
      fail("Confirmed hypothesis is not among the examples.");
    if (c.kind === "unique" && a.status !== "unique") fail("Assisted uniqueness is not proven.");
  };
  if (group.analysis !== undefined) {
    const a = analysis(group.analysis);
    if (group.confirmed !== undefined) confirmation(group.confirmed, a);
  }
  for (const past of group.history) {
    const a = analysis(past.analysis);
    if (past.confirmed !== undefined) confirmation(past.confirmed, a);
  }
}

// ── Undo ──────────────────────────────────────────────────────────────────

/** Whether a backup would accept the tracker's source removal Undo. */
export function sourceUndoIsExportable(tracker: TrackerState): boolean {
  const claimed = tracker.mogis.flatMap(
    (mogi) => mogi.captureReview?.items.flatMap((item) => (item.source.fileId ? [item.source.fileId] : [])) ?? [],
  );
  try {
    validateSourceUndo(tracker as TrackerRecord, new Set(claimed));
    return true;
  } catch {
    return false;
  }
}

/** The last source removal, kept with its pending original so it can be undone. */
function validateSourceUndo(tracker: TrackerRecord, claimedReviewFiles: Set<string>) {
  const undo = tracker.sourceUndo!;
  // The identifier is read while searching, so an empty mogi list reports the mogi missing.
  const mogi = object(
    tracker.mogis.find((entry) => entry.id === ensure(text("Removal mogi"), undo.mogiId)),
    "Removal mogi",
  ) as MogiRecord;
  const fileId = undo.fileId;
  const file = tracker.sharedReceipts?.flatMap((receipt) => receipt.files).find((entry) => entry.id === fileId);
  if (
    !file ||
    claimedReviewFiles.has(fileId) ||
    tracker.mogis.some((entry) => entry.raceDraft?.sourceFileId === fileId)
  )
    fail("The original reserved for undo is missing or already under review.");
  const people = new Set(mogi.participants.map((person) => person.id));
  const captures = mogi.captures ?? [];
  const liveIds = new Set(captures.map((capture) => capture.id));
  const sourceIds = new Set([...liveIds, ...(mogi.deletedCaptureIds ?? [])]);
  const raceIds = new Set(mogi.races.map((race) => race.id));
  const capture = undo.capture;
  if (capture !== undefined) {
    if (liveIds.has(capture.id) || !sourceIds.has(capture.id)) fail("Removed screenshot has no removal record.");
    known(capture.reviewedPlacements, people, "Removed names");
    validateRecognition(capture, people);
    validateCompressedImage(capture, file!.original);
    if (capture.context?.raceId !== undefined && !raceIds.has(capture.context.raceId))
      fail("Removed context occurrence not found.");
    if (undo.sequence !== undefined) {
      const sequence = ensure(removedSequence, undo.sequence);
      validateSequence(
        { ...sequence, version: 1, inputSignature: "removed", relations: [], occurrences: [], gaps: [] },
        sourceIds,
        raceIds,
        people,
      );
      if (
        sequence.numbers.some((fact) => fact.captureId !== capture.id) ||
        sequence.links.some((link) => link.fromCaptureId !== capture.id && link.toCaptureId !== capture.id) ||
        sequence.origins?.some((fact) => fact.captureId !== capture.id)
      )
        fail("Removal contains answers from another source.");
    }
  } else {
    const item = undo.reviewItem!;
    validateCaptureReview(
      { currentItemId: item.id, items: [item] },
      people,
      raceIds,
      new Set([fileId]),
      liveIds,
      new Set(),
      new Map(captures.map((entry) => [entry.id, entry])),
    );
    if (item.source.fileId !== fileId) fail("The removed review's original does not match.");
  }
  if (undo.raceDraft !== undefined) {
    const draft = undo.raceDraft;
    validateRaceDraft(draft, people, raceIds, new Set([fileId]), sourceIds);
    if (
      draft.purpose !== "capture" ||
      (capture === undefined ? draft.sourceFileId !== fileId : draft.sourceCaptureId !== capture.id)
    )
      fail("Removal contains a draft from another source.");
  }
  for (const race of undo.races) {
    if (capture === undefined || !raceIds.has(race.id)) fail("Inconsistent historical removal reference.");
    if (!Array.isArray(race.captureIds)) fail("Reference sources: missing or invalid list.");
    if (!race.captureIds!.includes(capture!.id) || HISTORY_KEYS.some((key) => race[key] !== undefined))
      fail("Inconsistent historical removal reference.");
    validateRace(race as RaceRecord, { people, sourceIds, captures: new Map(), raceIds }, true);
  }
}
