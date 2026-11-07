/** Pure domain entry: plain data in and out. Browser recognition lives in `./browser.ts`. */

// Shared records
export type {
  Assistance,
  AssistanceAnalysis,
  AssistanceEquation,
  AssistedResult,
  Capture,
  CaptureRow,
  CaptureSequence,
  GameEvidence,
  GameReading,
  GameValue,
  GroupTotalAnswer,
  IntervalContribution,
  Mogi,
  MogiFormat,
  NameAssociation,
  NumericAnswer,
  OrderAnchor,
  OrderGap,
  OrderReview,
  Participant,
  PhotoMoment,
  PositionFact,
  ProvenCoverage,
  Race,
  RaceReviewFields,
  Reconstruction,
  ReconstructionHypothesis,
  SequenceGap,
  SequenceLink,
  SequenceOccurrence,
  Substitution,
  Team,
} from "./domain/types.ts";

// Captures: game screens, readings and accepted evidence
export { captureBoundaryValues } from "./domain/capture/capture-boundary.ts";
export { applyCaptureContext, contextPhase } from "./domain/capture/capture-context.ts";
export {
  acceptedCaptureEvidence,
  captureNumericQuestions,
  reconcileCaptureEvidence,
} from "./domain/capture/capture-evidence.ts";
export {
  type CaptureInterpretation,
  type CaptureNumericRow,
  type CaptureObservation,
  type NumericReading,
  numericTextValue,
} from "./domain/capture/observations.ts";
export { captureRowBounds } from "./domain/capture/row-bounds.ts";
export {
  hasScreenInterpretation,
  isScreen,
  momentLabels,
  momentOffset,
  type Screen,
  screenProperties,
  screens,
} from "./domain/capture/screens.ts";
export { observedGroupTotal, observedMemberTotal, teamCaptureQuestions } from "./domain/capture/team-evidence.ts";

// Names
export { changeIgn } from "./domain/names/change-ign.ts";
export { answerNameQuestion, nameAssociationsForCapture } from "./domain/names/name-answers.ts";
export { participantSynonyms, unlinkSynonym } from "./domain/names/synonyms.ts";

// Participation
export { mogiOriginalList } from "./domain/participation/mogi-original-list.ts";
export {
  correctSubstitutionBoundary,
  participantsForOccurrence,
  participantsForRace,
  participationMembers,
  participationSlot,
  pendingCreditSlots,
  physicalNumberForValid,
  prepareRaceForReview,
  registerSubstitution,
  requireParticipationReview,
  rosterSlots,
} from "./domain/participation/participation.ts";
export { inferTeamTags, teamLabel, type TeamTag } from "./domain/participation/team-tags.ts";

// Sequence
export {
  captureExplanation,
  type CaptureExplanationStep,
  type RuleCode,
} from "./domain/sequence/capture-explanation.ts";
export { reconcileSequence, sequenceInputSignature } from "./domain/sequence/sequence.ts";
export { sourcePairSignature } from "./domain/sequence/source-pair-signature.ts";

// Reconstruction
export {
  assistanceTargets,
  confirmAssistance,
  setAssistanceAnalysis,
  solveAssistance,
} from "./domain/reconstruction/assistance.ts";
export { type CoverageConflict, coverageProjection, normalizeCoverage } from "./domain/reconstruction/coverage.ts";
export { changePositionFact, type FactInput, skipQuestion } from "./domain/reconstruction/known-positions.ts";
export { analyzeOrder, orderGaps, orderingInputSignature } from "./domain/reconstruction/ordering.ts";
export { applyReconstruction, reconstructOne } from "./domain/reconstruction/reconstruction.ts";
export { normalizeReconstructions } from "./domain/reconstruction/revalidation.ts";

// Clarification questions
export { analyzeCaptures } from "./domain/questions/capture-analysis.ts";
export {
  type MogiQuestion,
  mogiQuestions,
  type NameQuestion,
  ordinal,
  type PointsQuestion,
} from "./domain/questions/mogi-questions.ts";
export { answerMogiQuestion, type MogiQuestionAnswer } from "./domain/questions/question-answers.ts";
export { captureNeedsClarification } from "./domain/questions/questions.ts";
export { applySequenceAnswer, type SequenceAnswer } from "./domain/questions/sequence-answer.ts";

// Scoring
export { creditSuggestion, reopenCreditQuestion } from "./domain/scoring/credit.ts";
export { nativePlacementPoints } from "./domain/scoring/native-points.ts";
export { placementPoints, pointsFor } from "./domain/scoring/points.ts";
export {
  countedRaces,
  individualStandings,
  materializePendingGaps,
  nextRaceNumber,
  raceNumber,
  racePhysicalNumber,
  raceTotal,
  type ResultBlockers,
  resultCoverage,
  teamStandings,
} from "./domain/scoring/scoring.ts";
export { loungeSubmission } from "./domain/scoring/submission.ts";

// Mogi
export {
  type MogiNeedsImagesReason,
  mogiOverview,
  type MogiOverviewActivity,
  mogiPlayerChanges,
  type MogiRacePosition,
} from "./domain/mogi/mogi-overview.ts";
export { raceNumbers, teamSizes } from "./domain/mogi/mogi-rules.ts";
export { mogiSummary, tiedLeaders } from "./domain/mogi/mogi-summary.ts";
export { applyReviewedRace, initialRaceReview, reviewedRace, withdrawManualResult } from "./domain/mogi/race-review.ts";

// Tracks
export {
  defaultLoungeName,
  RECENT_MOGIS,
  type TrackRace,
  type TrackStanding,
  trackStandings,
  UNSTABLE_MIN_RACES,
  UNSTABLE_REACH,
} from "./domain/tracks/track-standings.ts";
export { matchTrack, raceTrack, type Track, tracks } from "./domain/tracks/tracks.ts";
