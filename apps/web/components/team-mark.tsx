import { inferTeamTags, type TeamTag } from "@mkw/engine";

import type { Mogi } from "@/lib/mogi/types";
import { cn } from "@/vendor/shadcn/lib/utils";

const teamColors = [
  "bg-team-1/15 text-team-1-foreground",
  "bg-team-2/15 text-team-2-foreground",
  "bg-team-3/20 text-team-3-foreground",
  "bg-team-4/15 text-team-4-foreground",
  "bg-team-5/15 text-team-5-foreground",
  "bg-team-6/15 text-team-6-foreground",
];

const teamInks = ["text-team-1", "text-team-2", "text-team-3", "text-team-4", "text-team-5", "text-team-6"];
/** The team's colour as text colour, for marks drawn in `currentColor` such as RaceBars. */
export function teamInk(mogi: Mogi, id?: string) {
  const team = inferTeamTags(mogi).find((team) => team.teamId === id);
  return team ? teamInks[(team.number - 1) % 6] : "text-muted-foreground";
}

const playerInks = [
  "text-player-1",
  "text-player-2",
  "text-player-3",
  "text-player-4",
  "text-player-5",
  "text-player-6",
  "text-player-7",
  "text-player-8",
  "text-player-9",
  "text-player-10",
  "text-player-11",
  "text-player-12",
];
/** One of twelve colours by the bot list's order, for players without a team (FFA); the first six are the team colours. */
export const playerInk = (index: number) => playerInks[index % 12];

/** Team label: the tag, or "Team N" by the bot list order. */
export const teamLabel = (team: Pick<TeamTag, "tag" | "number">) => team.tag ?? `Team ${team.number}`;
/** Accessible name of the mark, so it doesn't rely on color: "Team 2 · XO". */
export const teamAccessibleName = (team: Pick<TeamTag, "tag" | "number">) =>
  `Team ${team.number}${team.tag ? ` · ${team.tag}` : ""}`;

export function TeamMark({ mogi, id }: { mogi: Mogi; id?: string }) {
  const team = inferTeamTags(mogi).find((team) => team.teamId === id);
  if (!team) return null;
  return (
    <span
      aria-label={teamAccessibleName(team)}
      className={cn(
        "inline-flex h-5 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-semibold",
        teamColors[(team.number - 1) % 6],
      )}
    >
      {team.tag ?? team.number}
    </span>
  );
}
