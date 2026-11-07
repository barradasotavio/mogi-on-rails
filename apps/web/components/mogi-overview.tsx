"use client";
import {
  individualStandings,
  inferTeamTags,
  loungeSubmission,
  type MogiOverviewActivity,
  mogiPlayerChanges,
  type MogiRacePosition,
  pointsFor,
  raceTotal,
  raceTrack,
  resultCoverage,
  teamLabel,
  teamStandings,
  tiedLeaders,
} from "@mkw/engine";
import { ArrowDown, ArrowUp, CircleHelp, Crown, Loader2, Minus, SquareTerminal } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { ActionScope } from "@/components/ui/action-error";
import { CopyButton } from "@/components/ui/copy-button";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { MetadataBadge } from "@/components/ui/metadata";
import { RaceBars } from "@/components/ui/race-bars";
import { RaceTile } from "@/components/ui/race-tile";
import { ScoreMatrix } from "@/components/ui/score-matrix";
import { TileButton } from "@/components/ui/tile-button";
import { tablePng } from "@/lib/mogi/exports";
import { mogiOverview } from "@/lib/mogi/questions";
import { assertTrackerCurrent } from "@/lib/mogi/storage";
import type { Mogi, Race } from "@/lib/mogi/types";
import { cn } from "@/vendor/shadcn/lib/utils";

import type { PlayerShortcut } from "./mogi-players";
import { playerInk, teamInk } from "./team-mark";
import { TrackIcon } from "./track-icon";

export const mogiTitle = (mogi: Mogi) => `Mogi Tier ${mogi.submissionTier?.trim() || "—"}`;
/** Format and progress, under the title: "Race N of 12", the player count before the first race, or "Finished". */
export const mogiProgress = (mogi: Mogi, { finished, count }: { finished: boolean; count: number }) =>
  `${mogi.format} · ${finished ? "Finished" : count ? `Race ${count} of 12` : "12 players"}`;

export function MogiOverview({
  mogi,
  resultMogi = mogi,
  activity,
  onRace,
  onTrack,
  onQuestions,
  onNeedsImages,
  onSaveSubmit,
  onConcurrentWrite,
  onStanding,
}: {
  mogi: Mogi;
  resultMogi?: Mogi;
  activity: MogiOverviewActivity;
  onRace: (race: Race) => void;
  onTrack: (race: Race) => void;
  onQuestions: (race?: Race) => void;
  onNeedsImages: (position: MogiRacePosition) => void;
  onSaveSubmit: () => void;
  onConcurrentWrite: () => void;
  /** A Standings row opens its player or team in Players. */
  onStanding?: (player: PlayerShortcut) => void;
}) {
  const overview = mogiOverview(resultMogi, activity);
  // Where the mogi is: the race being read, else the last counted one. A row that scrolls keeps it in view.
  const races = useRef<HTMLElement>(null);
  const current =
    overview.positions.find((position) => position.state === "reading")?.number ??
    overview.positions.findLast((position) => position.state === "counted")?.number;
  const scrolled = useRef(false);
  useEffect(() => {
    const row = races.current,
      tile = row?.querySelector<HTMLElement>(`[data-race-number="${current}"]`);
    if (!row || !tile || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({
      left:
        row.scrollLeft +
        tile.getBoundingClientRect().left -
        row.getBoundingClientRect().left -
        (row.clientWidth - tile.offsetWidth) / 2,
      behavior: scrolled.current ? "smooth" : "instant",
    });
    scrolled.current = true;
  }, [current]);
  const { action, count } = overview;
  const open = openPosition(mogi, onRace, onQuestions, onNeedsImages);
  const glance = mogiGlance(resultMogi);
  const editingRaceId = mogi.raceDraft?.raceId;
  // Race by race, as in the table: the standings' bars and each race's winner in Tracks. Points don't depend on
  // activity, so reading or saving a track doesn't recompute the standings.
  const table = tableRows(resultMogi, mogiOverview(resultMogi).positions);
  const summary = (race: Race) => {
    if (!race.placements.length) return <span className="text-muted-foreground/60">—</span>;
    const track = raceTrack(mogi, race);
    return track ? (
      <span className="flex min-w-0 items-center gap-2">
        <TrackIcon track={track} />
        <span className="truncate">{track.name}</span>
      </span>
    ) : (
      <span className="font-medium text-link">Log Track</span>
    );
  };
  return (
    <>
      <ActionScope inset>
        <header className="flex items-center justify-between gap-4 px-4 md:gap-6">
          <div className="min-w-0">
            <h1
              data-mogi-title
              tabIndex={-1}
              className="text-xl font-semibold outline-none md:text-3xl md:font-bold md:tracking-tight"
            >
              {mogiTitle(mogi)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground md:text-base">
              <span>{mogiProgress(mogi, overview)}</span>
              {glance && (
                <>
                  <span className="hidden md:inline"> · </span>
                  <span className="block font-medium text-foreground md:inline">{glance.lead}</span>
                </>
              )}
            </p>
          </div>
          {action.kind === "reading" && (
            <div
              role="status"
              className="flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-dashed border-border px-4 text-sm font-medium text-muted-foreground @[35rem]:w-56"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Reading {action.current} of {action.total}
            </div>
          )}
          {action.kind === "questions" && (
            <TileButton tone="primary" className="@[35rem]:w-56" onClick={() => onQuestions()}>
              <CircleHelp aria-hidden="true" />
              {action.count} {action.count === 1 ? "Question" : "Questions"}
            </TileButton>
          )}
          {action.kind === "copy-submit" && (
            <SubmitButton mogi={resultMogi} onSave={onSaveSubmit} onConcurrentWrite={onConcurrentWrite} />
          )}
          {action.kind === "copy-table" && (
            <CopyButton
              appearance="tile"
              className="@[35rem]:w-56"
              label="Copy Table"
              filename="mkw-table.png"
              content={tableImage(mogi)}
            />
          )}
        </header>
      </ActionScope>
      <span role="status" className="sr-only">
        {action.kind === "questions" ? `${action.count} ${action.count === 1 ? "question" : "questions"}` : ""}
      </span>
      <ActionScope inset>
        <ListGroup inset title="Races" className="md:mt-4">
          <section ref={races} aria-label="Races" className="race-grid">
            {overview.positions.map((position) => {
              // A race with an edit in progress always opens its sheet, where Resume and Discard live.
              const draftRace =
                editingRaceId && position.raceId === editingRaceId
                  ? mogi.races.find((race) => race.id === editingRaceId)
                  : undefined;
              const inert =
                !draftRace &&
                (position.state === "future" || position.state === "unseen" || position.state === "reading");
              return (
                <RaceTile
                  key={position.number}
                  state={position.state === "unseen" ? "future" : position.state}
                  editing={!!draftRace}
                  aria-label={`Race ${position.number} · ${stateLabel(position.state)}${draftRace ? " · Edit in progress" : ""}`}
                  data-race-number={position.number}
                  aria-disabled={inert}
                  tabIndex={inert ? -1 : undefined}
                  onClick={() => {
                    if (draftRace) onRace(draftRace);
                    else if (
                      position.state === "counted" ||
                      position.state === "pending" ||
                      position.state === "questions" ||
                      position.state === "needs-images"
                    )
                      open(position);
                  }}
                >
                  {position.number}
                </RaceTile>
              );
            })}
          </section>
        </ListGroup>
      </ActionScope>
      <div className="section-stack @[45rem]:grid @[45rem]:grid-cols-2 @[45rem]:items-start @[45rem]:gap-x-2">
        <MogiStandings mogi={resultMogi} count={count} table={table} onStanding={onStanding} />
        <ListGroup inset title="Tracks">
          <List dividers="row" aria-label="Tracks">
            {overview.positions.map((position, index) => {
              const { race, run } = raceShortcut(mogi, position, { onRace, onTrack, onQuestions, onNeedsImages });
              const available =
                position.state === "counted" ||
                position.state === "pending" ||
                position.state === "questions" ||
                position.state === "unseen" ||
                position.state === "needs-images";
              const winner = position.state === "counted" ? raceWinner(table, index) : null;
              // A row does what its table column does.
              return (
                <ListRow
                  key={position.number}
                  lead={position.number}
                  accessory={available ? "chevron" : undefined}
                  onSelect={available ? run : undefined}
                  trail={
                    winner && (
                      <MetadataBadge>
                        <span aria-label={`Won by ${winner.name}`} className="flex items-center gap-1">
                          <Crown aria-hidden="true" className="size-3" />
                          {winner.name}
                        </span>
                      </MetadataBadge>
                    )
                  }
                >
                  {position.state === "questions" && position.questionCount ? (
                    <span className="font-medium text-link">
                      {position.questionCount} {position.questionCount === 1 ? "question" : "questions"}
                    </span>
                  ) : position.state === "reading" ? (
                    <span className="text-muted-foreground">Reading…</span>
                  ) : position.state === "unseen" ? (
                    <span className="text-muted-foreground">Not seen</span>
                  ) : position.state === "needs-images" ? (
                    <span className="text-muted-foreground">Needs screenshots</span>
                  ) : race ? (
                    summary(race)
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </ListRow>
              );
            })}
          </List>
        </ListGroup>
      </div>
      <MogiTableSection
        mogi={mogi}
        resultMogi={resultMogi}
        activity={activity}
        onRace={onRace}
        onTrack={onTrack}
        onQuestions={onQuestions}
        onNeedsImages={onNeedsImages}
      />
      {mogi.races.some((race) => race.status === "discarded") && (
        <ListGroup inset title="Discarded">
          <List dividers="row" aria-label="Discarded">
            {mogi.races
              .filter((race) => race.status === "discarded")
              .map((race) => (
                <ListRow key={race.id} lead="—" accessory="chevron" onSelect={() => onRace(race)}>
                  {summary(race)}
                </ListRow>
              ))}
          </List>
        </ListGroup>
      )}
    </>
  );
}

type TableRows = ReturnType<typeof tableRows>;

/** Who scored most in a race: the team, or the player in FFA. */
function raceWinner({ rows }: TableRows, index: number) {
  const team = rows[0]?.id !== "all";
  const entries = team ? rows : (rows[0]?.members ?? []);
  const best = entries.reduce<(typeof entries)[number] | null>(
    (top, entry) =>
      typeof entry.values[index] === "number" &&
      (!top || (entry.values[index] as number) > (top.values[index] as number))
        ? entry
        : top,
    null,
  );
  return best && { id: best.id, name: best.name, team };
}

/** The gap to the rival just ahead; the leader has none. */
function gapLabel(points: (number | null)[], index: number) {
  const own = points[index],
    ahead = points[index - 1];
  if (index === 0 || own === null || ahead === null || ahead === undefined) return "";
  return ahead === own ? "0" : `−${ahead - own}`;
}

/**
 * Teams, or Players in FFA: one row anatomy for both. Rank, mark and name; the points race by race, the last
 * race in full colour; the gap to the rival just ahead; the total. A team's members follow on a second line
 * with their own points and movement. Scores and movement depend on result inputs, not on track labels.
 */
function MogiStandings({
  mogi,
  count,
  table,
  onStanding,
}: {
  mogi: Mogi;
  count: number;
  table: TableRows;
  onStanding?: (player: PlayerShortcut) => void;
}) {
  const players = individualStandings(mogi).sort((a, b) =>
    a.points === b.points
      ? mogi.participants.findIndex((p) => p.id === a.id) - mogi.participants.findIndex((p) => p.id === b.id)
      : 0,
  );
  const teams = mogi.format === "FFA" ? [] : teamStandings(mogi);
  const changes = mogiPlayerChanges(mogi);
  const perRace = Object.fromEntries(
    [...table.rows, ...table.rows.flatMap((row) => row.members)].map((row) => [
      row.id,
      row.values.map((value) => (typeof value === "number" ? value : null)),
    ]),
  );
  const values = (rows: { id: string }[]) => rows.flatMap((row) => perRace[row.id] ?? []).map((value) => value ?? 0);
  const movement = (id: string) => changes.find((entry) => entry.slotId === id)?.movement;
  const total = (index: number, points: (number | null)[]) => (
    <>
      <span className="w-8 text-xs text-muted-foreground">{gapLabel(points, index)}</span>
      <span className="w-8 font-semibold text-foreground">{points[index] ?? "—"}</span>
    </>
  );
  const change = (id: string) => {
    const value = movement(id);
    return value === undefined ? null : <Movement value={value} />;
  };
  const trail = (bars: ReactNode, index: number, points: (number | null)[]) => (
    <span className="flex items-center justify-end gap-2 md:gap-3">
      {count > 0 && bars}
      {total(index, points)}
    </span>
  );
  if (teams.length) {
    // A team's row spans as many plain rows as the team has players, so the teams line up with the twelve Tracks:
    // the team, then every player from top scorer down, each with points and movement. The bars, gap and total sit
    // at the end, as in a player's row.
    const max = Math.max(0, ...values(teams));
    const points = teams.map((team) => team.points);
    const tags = inferTeamTags(mogi);
    return (
      <ListGroup inset title="Standings">
        <List dividers="row" aria-label="Team standings">
          {teams.map((team, index) => {
            const ranked = [...team.participants].sort((a, b) => (b.points ?? -1) - (a.points ?? -1));
            const tag = tags.find((entry) => entry.teamId === team.id);
            return (
              <ListRow
                key={team.id}
                span={Math.max(2, Math.round(12 / teams.length))}
                lead={team.rank ?? "—"}
                accessory={onStanding && "chevron"}
                onSelect={onStanding && (() => onStanding({ kind: "team", id: team.id }))}
                trail={trail(
                  <span className={teamInk(mogi, team.id)}>
                    <RaceBars values={perRace[team.id] ?? []} max={max} />
                  </span>,
                  index,
                  points,
                )}
              >
                <span className="block truncate font-medium">Team {tag?.tag ?? tag?.number}</span>
                {ranked.map((person) => (
                  <span key={person.id} className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                    <span className="truncate">{person.loungeName}</span>{" "}
                    <span className="font-medium text-foreground">{person.points ?? "—"}</span>
                    {change(person.id)}
                  </span>
                ))}
              </ListRow>
            );
          })}
        </List>
      </ListGroup>
    );
  }
  const max = Math.max(0, ...values(players));
  const points = players.map((person) => person.points);
  // Players keep one line, so the twelve rows match the twelve Tracks; each player has a colour of the palette.
  return (
    <ListGroup inset title="Standings">
      <List dividers="row" aria-label="Player standings">
        {players.map((person, index) => (
          <ListRow
            key={person.id}
            lead={person.rank ?? "—"}
            accessory={onStanding && "chevron"}
            onSelect={onStanding && (() => onStanding({ kind: "person", id: person.id }))}
            trail={trail(
              <span className={playerInk(mogi.participants.findIndex((entry) => entry.id === person.id))}>
                <RaceBars values={perRace[person.id] ?? []} max={max} />
              </span>,
              index,
              points,
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{person.loungeName}</span>
              {change(person.id)}
            </span>
          </ListRow>
        ))}
      </List>
    </ListGroup>
  );
}

/** Rise or fall since the race before, or a dash when the rank held. */
function Movement({ value }: { value: number }) {
  if (!value)
    return (
      <span aria-label="No change" className="flex shrink-0 items-center text-muted-foreground/70">
        <Minus className="size-3" aria-hidden="true" />
      </span>
    );
  return (
    <span
      aria-label={`${value > 0 ? "Up" : "Down"} ${Math.abs(value)}`}
      className={cn(
        "flex shrink-0 items-center text-xs",
        value > 0 ? "text-movement-up-foreground" : "text-movement-down",
      )}
    >
      {value > 0 ? (
        <ArrowUp className="size-3" aria-hidden="true" />
      ) : (
        <ArrowDown className="size-3" aria-hidden="true" />
      )}
      {Math.abs(value)}
    </span>
  );
}

/** Who leads and by how much, for the header. Null before the first race. */
function mogiGlance(mogi: Mogi) {
  const through = resultCoverage(mogi).through;
  if (!through) return null;
  const teams = mogi.format === "FFA" ? [] : teamStandings(mogi);
  const entries = teams.length
    ? teams.map((team) => ({ name: teamLabel(mogi, team.id), points: team.points }))
    : individualStandings(mogi).map((person) => ({ name: person.loungeName, points: person.points }));
  const sorted = [...entries].sort((a, b) => (b.points ?? -1) - (a.points ?? -1));
  const [first, second] = sorted;
  if (first?.points === null || first?.points === undefined) return null;
  const margin = first.points - (second?.points ?? 0);
  return {
    lead:
      margin === 0 && second
        ? tiedLeaders(
            sorted.filter((entry) => entry.points === first.points).map((entry) => entry.name),
            teams.length ? "teams" : "players",
          )
        : `${first.name} ${through === 12 ? "won" : "leads"} by ${margin}`,
  };
}

const staleSubmit = new Error("The data changed.");

/** The final copy uses the same save-text path as the Export sheet. */
function SubmitButton({
  mogi,
  appearance = "tile",
  onSave,
  onConcurrentWrite,
}: {
  mogi: Mogi;
  appearance?: "tile" | "toolbar";
  onSave: () => void;
  onConcurrentWrite: () => void;
}) {
  const submission = loungeSubmission(mogi);
  const missingTier = !submission.available && submission.blockers.missingTier;
  const text = async () => {
    try {
      await assertTrackerCurrent();
    } catch {
      // Data changed in another window: the concurrency alert explains it; nothing is copied.
      onConcurrentWrite();
      throw staleSubmit;
    }
    const current = loungeSubmission(mogi);
    if (!current.available) throw staleSubmit;
    return current.text;
  };
  // Without the clipboard, Export opens on Save Text and says why.
  return (
    <CopyButton
      appearance={appearance}
      tone="primary"
      icon={SquareTerminal}
      className={appearance === "tile" ? "@[35rem]:w-56" : undefined}
      disabled={!submission.available}
      label={missingTier ? "Add the Tier to Submit" : "Copy !submit"}
      filename="mkw-submit.txt"
      content={{ kind: "text", text }}
      onCopyFailed={(cause) => {
        if (cause !== staleSubmit) onSave();
      }}
    />
  );
}

/** The table image, checking before and after that the mogi is still the current one. */
export function tableImage(mogi: Mogi) {
  return {
    kind: "image" as const,
    image: async () => {
      await assertTrackerCurrent();
      const image = await tablePng(mogi);
      await assertTrackerCurrent();
      return image;
    },
  };
}

/** Table title: the same on the page and in the Table sheet. */
export function tableTitle(mogi: Mogi) {
  const { count, finished } = mogiOverview(mogi);
  return finished ? "Final table" : count ? `Table after race ${count}` : "Table";
}

/** Full table: on the page from a 55rem container, and in the Table sheet below that. */
type MogiTableProps = {
  mogi: Mogi;
  resultMogi?: Mogi;
  activity?: MogiOverviewActivity;
  onRace: (race: Race) => void;
  onQuestions: (race?: Race) => void;
  onNeedsImages: (position: MogiRacePosition) => void;
  surface?: "background" | "popover";
  /** A race column opens its track picker. */
  onTrack: (race: Race) => void;
};

function MogiTableSection(props: MogiTableProps) {
  // Shown only in a wide container, on regular.
  return (
    <ListGroup headingInset title="Table" className="hidden @[55rem]:block">
      <MogiTable {...props} />
    </ListGroup>
  );
}

export function MogiTable(props: MogiTableProps) {
  const resultMogi = props.resultMogi ?? props.mogi;
  const positions = mogiOverview(resultMogi, props.activity).positions;
  const data = tableRows(resultMogi, positions);
  return <MogiTableView {...props} positions={positions} rows={data.rows} total={data.total} />;
}

/** Numeric cells have no dependency on the selected tracks or navigation callbacks. */
function tableRows(mogi: Mogi, positions: MogiRacePosition[]) {
  const individuals = individualStandings(mogi);
  const teams = mogi.format === "FFA" ? [] : teamStandings(mogi);
  const groups = teams.length ? teams : [{ id: "all", name: "", rank: null, points: 0, participants: individuals }];
  const raceOf = (position: MogiRacePosition) => mogi.races.find((race) => race.id === position.raceId);
  const values = (members: typeof individuals) =>
    positions.map((position) => {
      const race = raceOf(position);
      return position.state === "future"
        ? "·"
        : !race || race.status === "pending"
          ? "—"
          : members.reduce(
              (sum, person) => sum + person.members.reduce((total, member) => total + pointsFor(race, member.id), 0),
              0,
            );
    });
  return {
    rows: groups.map((group) => ({
      id: group.id,
      name: teamLabel(mogi, group.id),
      rank: group.rank,
      total: group.points,
      values: values(group.participants),
      members: group.participants.map((person) => ({
        id: person.id,
        name: person.loungeName,
        rank: person.rank,
        total: person.points,
        values: values([person]),
      })),
    })),
    total: individuals.some((person) => person.points === null)
      ? null
      : individuals.reduce((sum, person) => sum + (person.points ?? 0), 0),
  };
}

function MogiTableView({
  mogi,
  positions,
  rows,
  total,
  onRace,
  onTrack,
  onQuestions,
  onNeedsImages,
  surface,
}: MogiTableProps & {
  positions: MogiRacePosition[];
  rows: ReturnType<typeof tableRows>["rows"];
  total: number | null;
}) {
  const columns = positions.map((position) => {
    const { race, draft, picks, run } = raceShortcut(mogi, position, { onRace, onTrack, onQuestions, onNeedsImages });
    const track = race && raceTrack(mogi, race);
    const complete = position.state !== "future" && race?.status !== "pending" && !!race;
    return {
      number: position.number,
      state: position.state,
      complete,
      onOpen: run,
      label: picks
        ? `Race ${position.number} Track, ${track?.name ?? "No Track"}`
        : `Open race ${position.number} · ${stateLabel(position.state)}${draft ? " · Edit in progress" : ""}`,
      icon:
        position.state === "future" || position.state === "unseen" ? undefined : (
          <TrackIcon track={track ?? { short: "item-box" }} size={32} />
        ),
      total: position.state === "future" ? "·" : complete ? raceTotal(race!) : "—",
    };
  });
  return <ScoreMatrix surface={surface} columns={columns} groups={rows} total={total} />;
}

/** Accessible name of a position's state on the grid and in the table. */
function stateLabel(state: MogiRacePosition["state"]) {
  return state === "unseen" ? "Not seen" : state === "needs-images" ? "Needs screenshots" : state;
}

/**
 * What a race's table column and its Tracks row do, one handler so the two can't drift: a resolved race
 * chooses its track, an edit in progress opens its sheet, and the rest open what the progress tile opens.
 */
function raceShortcut(
  mogi: Mogi,
  position: MogiRacePosition,
  {
    onRace,
    onTrack,
    onQuestions,
    onNeedsImages,
  }: {
    onRace: (race: Race) => void;
    onTrack: (race: Race) => void;
    onQuestions: (race?: Race) => void;
    onNeedsImages: (position: MogiRacePosition) => void;
  },
) {
  const race = mogi.races.find((race) => race.id === position.raceId);
  const draft = !!race && mogi.raceDraft?.raceId === race.id;
  const picks = !!race && !draft && position.state === "counted";
  const open = openPosition(mogi, onRace, onQuestions, onNeedsImages);
  return { race, draft, picks, run: () => (picks ? onTrack(race) : draft ? onRace(race) : open(position)) };
}

/**
 * The races a sheet pages among: the siblings of what opened it. A race sheet pages among the races whose tile
 * opens a race sheet; a track picker, among the resolved races whose Tracks row or table column opens a picker.
 */
export function raceSiblings(mogi: Mogi, resultMogi: Mogi, kind: "race" | "track"): Race[] {
  return mogiOverview(resultMogi).positions.flatMap((position) => {
    const race = mogi.races.find((entry) => entry.id === position.raceId);
    if (!race) return [];
    const draft = mogi.raceDraft?.raceId === race.id;
    if (kind === "track") return !draft && position.state === "counted" ? [race] : [];
    return draft || position.state === "counted" || position.state === "pending" ? [race] : [];
  });
}

/** Tapping a race opens the race; a position with questions, the queue; a "!", the reason. */
function openPosition(
  mogi: Mogi,
  onRace: (race: Race) => void,
  onQuestions: (race?: Race) => void,
  onNeedsImages: (position: MogiRacePosition) => void,
) {
  return (position: MogiRacePosition) => {
    const race = mogi.races.find((race) => race.id === position.raceId);
    if (position.state === "needs-images") onNeedsImages(position);
    else if (position.state === "questions") onQuestions(race);
    else if (race) onRace(race);
    else onQuestions();
  };
}
