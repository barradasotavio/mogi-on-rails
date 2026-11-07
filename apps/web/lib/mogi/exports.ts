import {
  type CoverageConflict,
  coverageProjection,
  individualStandings,
  pendingCreditSlots,
  pointsFor,
  raceNumber,
  raceTrack,
  type ResultBlockers,
  resultCoverage,
  rosterSlots,
  teamLabel,
  teamStandings,
} from "@mkw/engine";

import { withBase } from "../base-path.ts";
import type { Mogi } from "./types";

/** The one state that keeps `!submit` unavailable, the first that applies; none when only the tier is missing (its field says so). */
export function submissionBlockerText(mogi: Mogi, blockers: ResultBlockers): string | null {
  const races = blockers.pendingRaces;
  if (races.length) return races.length === 1 ? `Waiting on race ${races[0]}` : `Waiting on ${races.length} races`;
  const totals = blockers.unknownTotals;
  if (totals.length === 1)
    return `Unknown total for ${rosterSlots(mogi).find((slot) => slot.id === totals[0])!.loungeName}`;
  if (totals.length) return `${totals.length} unknown totals`;
  const questions = blockers.openQuestions.length;
  if (questions) return `${questions} open ${questions === 1 ? "question" : "questions"}`;
  return null;
}

/** Shared image and text title, including proven races without detailed results. */
function tableTitle(mogi: Mogi): [string, string] {
  const coverage = resultCoverage(mogi);
  return [
    `Mogi Tier ${mogi.submissionTier?.trim() || "—"} · ${mogi.format}`,
    coverage.final ? "Final table" : `Table after race ${coverage.through} of 12`,
  ];
}

/** Presentation stays in the app; the engine identifies only the conflict type and scope. */
export function coverageConflictText(conflict: CoverageConflict): string {
  switch (conflict.kind) {
    case "overlapping-intervals":
      return "Overlapping intervals do not yet have a proven partition.";
    case "incompatible-totals":
      return "Screenshots of the same interval have incompatible totals.";
    case "detail-total-mismatch": {
      const numbers = conflict.raceNumbers;
      const label = numbers.length === 1 ? `Race ${numbers[0]}` : `Races ${numbers[0]}–${numbers.at(-1)}`;
      return `${label}: detailed results contradict the proven total.`;
    }
  }
}

export function sharingText(mogi: Mogi): string {
  const coverage = resultCoverage(mogi);
  const projection = coverageProjection(mogi);
  const included = coverage.included.filter((number) => number <= coverage.through);
  const creditPending = pendingCreditSlots(mogi);
  const incomplete =
    coverage.pending.length > 0 || !coverage.comparable || projection.unresolved || coverage.conflicts.length > 0;
  const summary = `${coverage.final ? "Final result" : incomplete ? "Incomplete partial result" : "Partial result"} · ${included.length}/12 counted`;
  const conflicts = coverage.conflicts.map(coverageConflictText);
  const details = [
    `Included: ${included.join(", ") || "none"}`,
    `Pending: ${coverage.pending.join(", ") || "none"}`,
    ...(coverage.detailPending.length ? [`Detail pending: ${coverage.detailPending.join(", ")}`] : []),
    ...(!coverage.comparable ? ["Coverage differs by participation; ranks are not comparable"] : []),
    ...(projection.unresolved ? ["Coverage or adjustments are not yet determined"] : []),
    ...conflicts,
    ...(creditPending.length ? [`Credit pending: ${creditPending.map((slot) => slot.loungeName).join(", ")}`] : []),
  ].join(" · ");
  const individual = individualStandings(mogi)
    .map(
      (p) =>
        `${p.rank ?? "—"}. ${p.loungeName} — ${p.points ?? "—"}${p.comparable ? "" : ` (${p.coverage.length}/12)`}${p.members.length > 1 ? ` (${p.members.map((person) => person.loungeName).join(" → ")})` : ""}`,
    )
    .join("\n");
  const labels = new Map((mogi.teams ?? []).map((team) => [team.id, teamLabel(mogi, team.id)]));
  const teams = teamStandings(mogi)
    .map(
      (team) =>
        `${team.rank ?? "—"}. ${labels.get(team.id) ?? ""} — ${team.points ?? "—"}${team.comparable ? "" : ` (${team.coverage.length}/12 in common)`}\n${team.participants.map((p) => `   ${p.loungeName} ${p.points ?? "—"}`).join("\n")}`,
    )
    .join("\n\n");
  return `${tableTitle(mogi).join("\n")}\n${summary}\n${details}\n\n${teams ? `Teams\n${teams}\n\n` : ""}Individual\n${individual}`;
}

/** Score table from the approved glance prototype: preserved logical dimensions and a PNG at 2× scale. */
export async function tablePng(mogi: Mogi): Promise<Blob> {
  const coverage = resultCoverage(mogi);
  const teams = teamStandings(mogi);
  const labels = new Map((mogi.teams ?? []).map((team) => [team.id, teamLabel(mogi, team.id)]));
  const individual = individualStandings(mogi);
  const groups = teams.length ? teams : [{ id: "", name: "", rank: null, points: null, participants: individual }];
  const lines = groups.reduce((sum, group) => sum + group.participants.length + (teams.length ? 1 : 0), 0);
  const title = tableTitle(mogi);
  const numbers = Array.from({ length: 12 }, (_, index) => index + 1);
  const races = numbers.map((number) =>
    mogi.races.find((race) => race.status !== "discarded" && raceNumber(mogi, race) === number),
  );
  // A future race stays empty; a counted race without details stays unknown.
  const points = individual.map((person) =>
    numbers.map((number, index) => {
      const race = races[index];
      if (!race && !coverage.included.includes(number)) return undefined;
      if (!race || (race.status ?? "confirmed") !== "confirmed" || race.participationReview) return null;
      if (
        !person.members.some(
          (member) => race.placements.includes(member.id) || race.absentParticipantIds?.includes(member.id),
        )
      )
        return null;
      return person.members.reduce((sum, member) => sum + pointsFor(race, member.id), 0);
    }),
  );
  const sum = (values: (number | null | undefined)[]) =>
    values.every((value) => value === undefined)
      ? undefined
      : values.some((value) => value == null)
        ? null
        : values.reduce<number>((sum, value) => sum + value!, 0);
  const groupPoints = (members: typeof individual) =>
    numbers.map((_, index) =>
      sum(members.map((member) => points[individual.findIndex((person) => person.id === member.id)][index])),
    );
  const totals = groupPoints(individual);
  const total = sum(individual.map((person) => person.points));

  // Capture data before awaiting the font; the surface checks the signature on completion.
  const icons = await Promise.all(
    races.map(async (race, index) => {
      const track = race && raceTrack(mogi, race);
      if (!race && !coverage.included.includes(index + 1)) return null;
      const icon = new Image();
      icon.alt = track?.short ?? "Item Box";
      icon.src = withBase(`/tracks/${track?.short ?? "item-box"}.webp`);
      await icon.decode();
      return icon;
    }),
  );
  await document.fonts.ready;
  // The footer matches the wide table: 12 px above and below its 20 px line (`py-3`).
  const pad = 24,
    rank = 40,
    name = 168,
    totalWidth = 56,
    raceWidth = 44,
    row = 32,
    footer = 44,
    head = 96,
    thead = 72;
  const width = pad * 2 + rank + name + totalWidth + raceWidth * 12;
  const spaces = Math.max(0, groups.length - 1) * 12 + 12;
  const height = head + thead + lines * row + spaces + 2 + footer + pad;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("This browser couldn't draw the image. Use the sharing text.");
  c.scale(scale, scale);
  const theme = getComputedStyle(document.documentElement);
  const color = (token: string) => theme.getPropertyValue(`--${token}`).trim();
  const family = getComputedStyle(document.body).fontFamily;
  const font = (size: number, weight = 400) => {
    c.font = `${weight} ${size}px ${family}`;
  };
  const text = (value: string | number | null, x: number, y: number, align: CanvasTextAlign = "left", max?: number) => {
    c.textAlign = align;
    c.fillText(String(value ?? "—"), x, y, max);
  };
  c.fillStyle = color("background");
  c.fillRect(0, 0, width, height);
  c.textBaseline = "middle";
  c.fillStyle = color("foreground");
  font(22, 600);
  text(title[0], pad, 38);
  c.fillStyle = color("muted-foreground");
  font(15);
  text(title[1], pad, 66);

  const xName = pad + rank,
    xTotal = xName + name + totalWidth - 12,
    xRace = xName + name + totalWidth;
  const center = (number: number) => xRace + (number - 1) * raceWidth + raceWidth / 2;
  let y = head;
  const latest = coverage.through;
  if (latest && !coverage.final) {
    c.fillStyle = color("muted");
    c.beginPath();
    c.roundRect(xRace + (latest - 1) * raceWidth, y, raceWidth, height - y - pad, 10);
    c.fill();
  }
  c.fillStyle = color("muted-foreground");
  font(12, 500);
  text("#", pad, y + 18);
  text(teams.length ? "Team" : "Player", xName, y + 18);
  text("Total", xTotal, y + 18, "right");
  for (const number of numbers) {
    const known = !!races[number - 1] || coverage.included.includes(number);
    c.fillStyle = color(known ? "foreground" : "muted-foreground");
    font(14, 600);
    text(number, center(number), y + 18, "center");
    const icon = icons[number - 1];
    if (icon) c.drawImage(icon, center(number) - 16, y + 30, 32, 32);
  }
  y += thead;
  const rule = () => {
    c.fillStyle = color("rule");
    c.fillRect(pad, y, width - pad * 2, 1);
  };
  const cells = (values: (number | null | undefined)[], weight = 400) => {
    for (const [index, value] of values.entries()) {
      if (value === undefined) continue;
      c.fillStyle = color("foreground");
      font(14, weight);
      text(value, center(index + 1), y + row / 2, "center");
    }
  };
  for (const [groupIndex, group] of groups.entries()) {
    if (groupIndex > 0) y += 12;
    if (teams.length) {
      c.fillStyle = color("muted");
      c.beginPath();
      c.roundRect(pad + 0.5, y + 0.5, width - pad * 2 - 1, row - 1, 10);
      c.fill();
      c.strokeStyle = color("rule");
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = color("foreground");
      font(14, 700);
      text(group.rank, pad + 8, y + row / 2);
      text(group.points, xTotal, y + row / 2, "right");
      // As on the wide table, the team row carries only its label; rank already sits in the first column.
      text(labels.get(group.id) ?? "", xName, y + row / 2, "left", name - 8);
      cells(groupPoints(group.participants), 700);
      y += row;
    }
    for (const [memberIndex, person] of group.participants.entries()) {
      if (!teams.length || memberIndex > 0) rule();
      c.fillStyle = color("muted-foreground");
      font(14);
      if (!teams.length) text(person.rank, pad + 8, y + row / 2);
      c.fillStyle = color("foreground");
      text(person.loungeName, xName, y + row / 2, "left", name - 8);
      font(14, 700);
      text(person.points, xTotal, y + row / 2, "right");
      cells(points[individual.findIndex((row) => row.id === person.id)]);
      y += row;
    }
  }
  y += 12;
  c.fillStyle = color("foreground");
  c.fillRect(pad, y, width - pad * 2, 2);
  y += 2;
  font(14, 700);
  text("Total", xName, y + footer / 2);
  text(total ?? null, xTotal, y + footer / 2, "right");
  for (const [index, value] of totals.entries()) {
    if (value === undefined) continue;
    c.fillStyle = color(value !== null && value !== 82 ? "destructive" : "foreground");
    font(14, 700);
    text(value, center(index + 1), y + footer / 2, "center");
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This browser couldn't create the PNG."))),
      "image/png",
    ),
  );
}
