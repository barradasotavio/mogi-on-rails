import {
  creditedParticipant,
  participationMembers,
  pendingCreditSlots,
  rosterSlots,
} from "../participation/participation.ts";
import type { Mogi, Race } from "../types.ts";

export { placementPoints, pointsFor } from "./points.ts";
import { raceNumbers } from "../mogi/mogi-rules.ts";
import { teamLabel } from "../participation/team-tags.ts";
import type { ClarificationQuestion } from "../questions/questions.ts";
import { contextQuestions } from "../questions/questions.ts";
import { coveragePrefix, coverageProjection } from "../reconstruction/coverage.ts";
import { pointsFor } from "./points.ts";

export interface ResultBlockers {
  /** A missing tier blocks submitting without changing the races' conclusion. */
  missingTier?: true;
  /** Planned race numbers still without proven common coverage. */
  pendingRaces: number[];
  /** Participation IDs with no total or with less coverage than the others. */
  unknownTotals: string[];
  /** Open question IDs; credit uses credit:<participation ID>. */
  openQuestions: { id: string; kind: ClarificationQuestion["kind"] | "credit" | "coverage" }[];
}

export function countedRaces(mogi: Mogi): Race[] {
  return mogi.races
    .filter((race) => (race.status ?? "confirmed") === "confirmed")
    .map((race) =>
      race.absentParticipantIds?.length
        ? {
            ...race,
            placements: [
              ...race.placements,
              ...race.absentParticipantIds.filter((id) => !race.placements.includes(id)),
            ],
          }
        : race,
    );
}

export function raceNumber(mogi: Mogi, race: Race): number {
  return race.number ?? mogi.races.findIndex((item) => item.id === race.id) + 1;
}

/** Native accumulated totals count every physical occurrence, including discarded results. */
export function racePhysicalNumber(mogi: Mogi, race: Race): number {
  return race.physicalNumber ?? raceNumber(mogi, race);
}

export function nextRaceNumber(mogi: Mogi): number {
  return (
    Math.max(0, ...mogi.races.filter((race) => race.status !== "discarded").map((race) => raceNumber(mogi, race))) + 1
  );
}

export function resultCoverage(mogi: Mogi) {
  const projection = coverageProjection(mogi);
  const included = projection.common;
  const pending = projection.pending;
  const established = new Set(projection.rows.flatMap((row) => row.numbers));
  const blockers: ResultBlockers = {
    pendingRaces: raceNumbers().filter((number) => !included.includes(number)),
    unknownTotals: projection.rows
      .filter(
        (row) =>
          (established.size > 0 && !row.numbers.length) ||
          [...established].some((number) => !row.numbers.includes(number)),
      )
      .map((row) => row.slotId),
    openQuestions: [
      ...contextQuestions(mogi)
        .filter((question) => question.mode === "pending")
        .map(({ id, kind }) => ({ id, kind })),
      ...pendingCreditSlots(mogi).map((slot) => ({ id: `credit:${slot.id}`, kind: "credit" as const })),
      ...(projection.unresolved || projection.conflicts.length ? [{ id: "coverage", kind: "coverage" as const }] : []),
    ],
  };
  const final =
    projection.complete &&
    !blockers.pendingRaces.length &&
    !blockers.unknownTotals.length &&
    !blockers.openQuestions.length;
  const detailPending = projection.detailPending
    .flatMap((interval) => interval.validRaceNumbers)
    .filter(
      (number, index, all) =>
        all.indexOf(number) === index && !countedRaces(mogi).some((race) => raceNumber(mogi, race) === number),
    );
  return {
    included,
    through: coveragePrefix(included),
    pending,
    complete: projection.complete,
    final,
    blockers,
    detailPending,
    conflicts: projection.conflicts,
    comparable: !projection.unequal,
  };
}

/** Competition ranks keep ties: 5, 5, 7. Unknown totals have no rank. */
function withTiedRanks<T extends { points: number | null; comparable: boolean }>(rows: T[]) {
  return rows.map((row) => ({
    ...row,
    rank:
      row.comparable && row.points !== null
        ? rows.findIndex((other) => other.comparable && other.points === row.points) + 1
        : null,
  }));
}

/** Rank participation totals from race one through the requested counted race. */
export function individualStandings(mogi: Mogi, options: { through?: number } = {}) {
  const projection = coverageProjection(mogi, { contiguous: true, through: options.through });
  // Participation totals require coverage from race one.
  // Zero is known only before any race has happened; missing results stay unknown.
  const started =
    mogi.races.some((race) => race.status !== "discarded") ||
    !!mogi.sequence?.occurrences.some((occurrence) => occurrence.number !== undefined);
  return withTiedRanks(
    rosterSlots(mogi)
      .map((participant) => {
        const row = projection.rows.find((row) => row.slotId === participant.id);
        return {
          ...creditedParticipant(mogi, participant),
          id: participant.id,
          teamId: participant.teamId,
          members: participationMembers(mogi, participant.id),
          points: row && (row.numbers.length || !started) ? row.points : null,
          coverage: row?.numbers ?? [],
          comparable: !projection.unequal && projection.common.length > 0,
        };
      })
      .sort(
        (a, b) =>
          (a.points === b.points ? 0 : a.points === null ? 1 : b.points === null ? -1 : b.points - a.points) ||
          a.loungeName.localeCompare(b.loungeName, "pt-BR", { numeric: true }),
      ),
  );
}

export function teamStandings(mogi: Mogi) {
  const individuals = individualStandings(mogi);
  return withTiedRanks(
    (mogi.teams ?? [])
      .map((team) => {
        const participants = individuals.filter((person) => person.teamId === team.id);
        const coverage =
          participants[0]?.coverage.filter((number) =>
            participants.every((person) => person.coverage.includes(number)),
          ) ?? [];
        return {
          ...team,
          name: teamLabel(mogi, team.id),
          participants,
          coverage,
          comparable: participants.length > 0 && participants.every((person) => person.comparable),
          points:
            !participants.length || participants.some((person) => person.points === null)
              ? null
              : participants.reduce((sum, person) => sum + person.points!, 0),
        };
      })
      .sort(
        (a, b) =>
          (a.points === b.points ? 0 : a.points === null ? 1 : b.points === null ? -1 : b.points - a.points) ||
          a.name.localeCompare(b.name, "pt-BR"),
      ),
  );
}

export { nativePlacementPoints } from "./native-points.ts";
export function raceTotal(race: Race): number {
  const participants = new Set([...race.placements, ...(race.absentParticipantIds ?? [])]);
  return [...participants].reduce((total, id) => total + pointsFor(race, id), 0);
}

/** Fill chronological placeholders without changing a caller's chosen range. */
export function materializePendingGaps(mogi: Mogi, races: Race[], through: number): Race[] {
  const numbered = races.map((r) => ({
    ...r,
    number: r.status === "discarded" ? r.number : (r.number ?? raceNumber(mogi, r)),
  }));
  for (let n = 1; n <= through; n++)
    if (!numbered.some((r) => r.status !== "discarded" && r.number === n))
      numbered.push({
        id: crypto.randomUUID(),
        number: n,
        status: "pending",
        origin: "observed",
        placements: [],
      });
  return numbered.sort((a, b) => (a.physicalNumber ?? a.number ?? 0) - (b.physicalNumber ?? b.number ?? 0));
}
