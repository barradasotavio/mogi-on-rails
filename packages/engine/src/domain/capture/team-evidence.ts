import { rosterSlots } from "../participation/participation.ts";
import type { Capture, Mogi } from "../types.ts";
import { screenProperties } from "./screens.ts";

export interface TeamCaptureQuestion {
  group: number;
  kind: "numbers" | "sum" | "identities" | "team";
  message: string;
  rows: number[];
}
type NumericSource = Pick<Capture, "interpretation" | "numericRows" | "numericAnswers" | "groupTotalAnswers">;
export function observedGroupTotal(capture: NumericSource, group: number): number | undefined {
  const answer = capture.groupTotalAnswers?.find((answer) => answer.group === group);
  if (answer) return answer.value;
  const reading = capture.interpretation?.groups?.[group - 1]?.total;
  return reading && !reading.uncertain && reading.value !== null ? reading.value : undefined;
}
export function observedMemberTotal(capture: NumericSource, row: number): number | undefined {
  const answer = capture.numericAnswers?.find((answer) => answer.row === row);
  if (answer) return answer.value;
  const reading = capture.numericRows?.find((reading) => reading.row === row)?.right;
  return reading && !reading.uncertain && reading.value !== null ? reading.value : undefined;
}

/** Arithmetic is corroboration, never a rewrite of OCR or an inference of race number. */
export function consistentTeamRows(capture: NumericSource): number[] {
  if (!screenProperties(capture.interpretation?.screen)?.teamTotals) return [];
  return (capture.interpretation?.groups ?? []).flatMap((group, index) => {
    const total = observedGroupTotal(capture, index + 1);
    const values = group.rows.map((row) => observedMemberTotal(capture, row));
    if (total === undefined || values.some((value) => value === undefined)) return [];
    return values.reduce<number>((sum, value) => sum + value!, 0) === total ? group.rows : [];
  });
}

export function teamCaptureQuestions(mogi: Mogi, capture: Capture): TeamCaptureQuestion[] {
  if (!screenProperties(capture.interpretation?.screen)?.teamTotals) return [];
  const questions: TeamCaptureQuestion[] = [];
  const slots = rosterSlots(mogi);
  for (const [index, group] of (capture.interpretation?.groups ?? []).entries()) {
    const number = index + 1;
    const total = observedGroupTotal(capture, number);
    const values = group.rows.map((row) => observedMemberTotal(capture, row));
    const add = (kind: TeamCaptureQuestion["kind"], message: string) =>
      questions.push({ group: number, kind, message, rows: group.rows });
    if (total === undefined || values.some((value) => value === undefined))
      add("numbers", `Group ${number}: some numbers aren't settled yet. Check only the uncertain fields.`);
    else {
      const sum = values.reduce<number>((sum, value) => sum + value!, 0);
      if (sum !== total)
        add(
          "sum",
          `Group ${number}: the player totals add up to ${sum}, but the team total is ${total}. Which reading needs a fix?`,
        );
    }
    const ids = group.rows.map((row) =>
      capture.nameAssociations
        ? capture.nameAssociations[row - 1]?.participantId
        : capture.rows[row - 1]?.uncertain
          ? null
          : capture.rows[row - 1]?.suggestedParticipantId,
    );
    const people = ids.map((id) => mogi.participants.find((person) => person.id === id));
    if (people.some((person) => !person)) {
      add("identities", `Group ${number}: answer the pending names to compare the teams.`);
      continue;
    }
    const teamIds = new Set(people.map((person) => person!.teamId));
    const teamId = people[0]?.teamId;
    if (!teamId || teamIds.size !== 1 || slots.filter((person) => person.teamId === teamId).length !== people.length)
      add("team", `Group ${number}: these players aren't one Lounge team. Check the names; the mogi's teams are kept.`);
  }
  return questions;
}
