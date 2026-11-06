import type { CaptureExplanationStep } from "../capture-explanation.ts";
import type { RoomBoundary } from "./room-boundary.ts";
import type { RoomPair } from "./room-grouping.ts";
import type { RoomSequenceState, SelectedRoom } from "./room-start.ts";

const VECTOR_CONTINUITY_RULE: CaptureExplanationStep["rule"] = "race.vector-continuity";
const ANSWERED_NUMBER_RULE: CaptureExplanationStep["rule"] = "race.answered";
const PHOTO_TIME_RULE: CaptureExplanationStep["rule"] = "order.photo-time";
const REOPENING_RULES = { first: "race.reopen-first", later: "race.reopen-later" } as const satisfies Record<
  string,
  CaptureExplanationStep["rule"]
>;

export interface RoomExplanationContext {
  room: SelectedRoom;
  state: RoomSequenceState;
  compared: number;
  decreased: number;
  nodes: RoomBoundary[];
  pairs: RoomPair[];
  explanation: CaptureExplanationStep[];
  photoAnchor?: RoomBoundary;
  answeredOrderAnchor?: RoomBoundary;
}

export function roomCaptureSteps(
  boundary: RoomBoundary,
  number: number | undefined,
  context: RoomExplanationContext,
): CaptureExplanationStep[] {
  const { room, state, compared, decreased, nodes, pairs, explanation, answeredOrderAnchor } = context;
  const { group, start, reopening, reopeningBasis } = room;
  let steps: CaptureExplanationStep[] = [];
  if (number !== undefined)
    steps = [
      {
        kind: "race",
        subject: boundary.source.id,
        value: number,
        origin: boundary.answeredNumber === undefined ? "deduced" : "answered",
        rule:
          boundary.answeredNumber !== undefined
            ? ANSWERED_NUMBER_RULE
            : reopening
              ? boundary.localRace === 1
                ? REOPENING_RULES.first
                : REOPENING_RULES.later
              : VECTOR_CONTINUITY_RULE,
        evidence: {
          anchorCaptureId: state.anchorSource?.source.id,
          anchorNumber: state.leadingRaces,
          completedSteps: number - boundary.offset - state.leadingRaces,
          localRace: boundary.localRace,
          sessionStart: start,
          compared: compared,
          decreased,
          reopeningBasis,
        },
      },
    ];
  const same = group
    .slice(0, group.indexOf(boundary))
    .find(
      (other) =>
        other.offset === boundary.offset &&
        pairs.some(
          (pair) =>
            pair.distance === 0 &&
            ((nodes[pair.from] === other && nodes[pair.to] === boundary) ||
              (nodes[pair.to] === other && nodes[pair.from] === boundary)),
        ),
    );
  if (same) {
    const raceStep = explanation.find((step) => step.subject === same.source.id && step.kind === "race");
    steps = [
      ...(raceStep?.origin === "deduced" && boundary.answeredNumber === undefined
        ? [{ ...raceStep, subject: boundary.source.id }]
        : steps),
      {
        kind: "duplicate",
        subject: boundary.source.id,
        value: same.source.id,
        origin: "deduced",
        rule: "duplicate.same-vector",
        evidence: { anchorCaptureId: same.source.id },
      },
    ];
  }
  const photoAnchor = context.photoAnchor;
  if (photoAnchor) {
    const step: CaptureExplanationStep = {
      kind: "order",
      subject: boundary.source.id,
      value: photoAnchor.source.id,
      origin: "deduced",
      rule: PHOTO_TIME_RULE,
      evidence: {
        anchorCaptureId: photoAnchor.source.id,
        photoTime: boundary.time,
        previousTime: photoAnchor.time,
        photoTimeSource: photoAnchor.source.photoMoment?.source,
      },
    };
    steps = [
      ...steps.filter((step) => step.kind === "race"),
      step,
      ...steps.filter((step) => step.kind === "duplicate"),
    ];
  }
  if (answeredOrderAnchor) {
    const step: CaptureExplanationStep = {
      kind: "order",
      subject: boundary.source.id,
      value: answeredOrderAnchor.source.id,
      origin: "answered",
      rule: "order.answered",
      evidence: { anchorCaptureId: answeredOrderAnchor.source.id },
    };
    steps = [
      ...steps.filter((step) => step.kind === "race"),
      step,
      ...steps.filter((step) => step.kind === "duplicate"),
    ];
  }
  return steps;
}
