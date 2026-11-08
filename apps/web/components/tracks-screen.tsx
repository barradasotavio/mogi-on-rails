"use client";

import { ordinal, RECENT_MOGIS, type TrackRace, type TrackStanding, trackStandings } from "@mkw/engine";
import { ArrowLeft, ArrowUpDown, Flag, Route, UserRound } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { mogiTitle } from "@/components/mogi-overview";
import { TrackIcon } from "@/components/track-icon";
import { ContentUnavailable } from "@/components/ui/content-unavailable";
import { FloatingBar } from "@/components/ui/floating-bar";
import { GlassButton } from "@/components/ui/glass-button";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { MetadataBadge } from "@/components/ui/metadata";
import { MogiScrollBody } from "@/components/ui/mogi-scroll-body";
import { RaceBars } from "@/components/ui/race-bars";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { SidebarToggle, Toolbar } from "@/components/ui/toolbar";
import { VALUE_DOMAIN, valueSlots, ValueTrend } from "@/components/ui/value-trend";
import type { Mogi } from "@/lib/mogi/types";
import { type Count, orderTracks, sameTrackOrder, type SortBy, type TrackOrder } from "@/lib/track-order";
import { cn } from "@/vendor/shadcn/lib/utils";

/** The Sort panel's two sections, as Finder's view options: what to measure, and which races it counts. */
const sortBys: { value: SortBy; label: string }[] = [
  { value: "typical", label: "Typical" },
  { value: "total", label: "Total" },
  { value: "races", label: "Races" },
];
const counts: { value: Count; label: string; short: string }[] = [
  { value: "both", label: "Plus/Minus", short: "+/−" },
  { value: "plus", label: "Plus Only", short: "Plus" },
  { value: "minus", label: "Minus Only", short: "Minus" },
];
/** The list's measure, named once as its section title: "Typical +/−", "Total Minus", "Races". */
const measureName = (by: SortBy, count: Count) =>
  by === "races"
    ? "Races"
    : `${sortBys.find((entry) => entry.value === by)!.label} ${counts.find((entry) => entry.value === count)!.short}`;
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * One decimal with its sign, a true minus for losses: "+2.4", "−1.3", "0.0". Halves round away from zero, with a
 * hair of tolerance, so a sum that floating point keeps as 3.7499… still reads "+3.8".
 */
export function signedPlaces(value: number) {
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * 10 + 1e-9)) / 10;
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded < 0 ? `−${Math.abs(rounded).toFixed(1)}` : "0.0";
}
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const valueInk = (value: number) =>
  value > 0 ? "text-movement-up-foreground" : value < 0 ? "text-movement-down" : "text-muted-foreground";
const WINDOW = `Counts your last ${RECENT_MOGIS} mogis.`;
/** A race's reading in the bars: its place among the track's races and its value. */
const raceLabel = (value: number, index: number) => `Race ${index + 1} · ${signedPlaces(value)}`;

/**
 * Tracks: how each track goes for you, from your finish in every counted race against your own average in that
 * mogi (`trackStandings`), over your last `RECENT_MOGIS` mogis. A destination beside the mogis, with the same
 * controls as the mogi screen: the toolbar on regular, the floating bar on compact, and in either a glass Sort item
 * that opens the sort panel. One list of every track; a row opens its races in a sheet. It opens in the saved default
 * order, which Make Default in the panel replaces; any other choice lasts for the visit.
 */
export function TracksScreen({
  mogis,
  loungeNames,
  defaultOrder,
  busy,
  onMakeDefault,
  voteShown,
  onVoteShown,
  visible,
  controlsContainer,
  mogisShown,
  onShowMogis,
  onBack,
  onChooseName,
}: {
  mogis: Mogi[];
  loungeNames: string[];
  defaultOrder: TrackOrder;
  busy: boolean;
  onMakeDefault: (order: TrackOrder) => void;
  voteShown: boolean;
  onVoteShown: (shown: boolean) => void;
  visible: boolean;
  controlsContainer: HTMLElement | null;
  mogisShown: boolean;
  onShowMogis: () => void;
  onBack: () => void;
  onChooseName: () => void;
}) {
  const [sortBy, setSortBy] = useState<SortBy>(defaultOrder.by);
  const [count, setCount] = useState<Count>(defaultOrder.count);
  const [open, setOpen] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  const namesKey = loungeNames.join("\n");
  // State is loaded once and replaced on each save, so this recomputes only when the mogis or the names change.
  const standings = useMemo(() => trackStandings(mogis, namesKey ? namesKey.split("\n") : []), [mogis, namesKey]);
  const names = standings.loungeNames;
  const [shown, setShown] = useState<TrackStanding | null>(null);
  const selected = standings.tracks.find((entry) => entry.track.short === open) ?? shown;
  const select = (standing: TrackStanding) => {
    setShown(standing);
    setOpen(standing.track.short);
  };
  const hasTracks = standings.tracks.length > 0;
  // Its label never collapses (no `toolbar-label`): it is the toolbar's only item. The symbol is a size down from
  // the glass default, since the arrows' tall glyph outweighs the label at 20px.
  const sort = (density: "toolbar" | "default") =>
    hasTracks && (
      <GlassButton density={density} className="[&_svg]:size-4" onClick={() => setSorting(true)}>
        <ArrowUpDown aria-hidden="true" />
        Sort
      </GlassButton>
    );
  const known = names.some((name) =>
    mogis.some((mogi) =>
      mogi.participants.some((person) => person.loungeName.trim().toLowerCase() === name.toLowerCase()),
    ),
  );
  const empty = !mogis.length
    ? {
        icon: <Flag />,
        title: "No Mogis Yet",
        description: "Tracks compares your finish on each track once your mogis have races with tracks.",
      }
    : !names.length
      ? {
          icon: <UserRound />,
          title: "Choose Your Lounge Name",
          description: "Tracks needs your Lounge name to know which player is you.",
          action: "Set Lounge Name",
        }
      : !known
        ? {
            icon: <UserRound />,
            title: `No Races for ${names.join(" or ")}`,
            description:
              names.length > 1
                ? "No mogi has a player with these Lounge names."
                : "No mogi has a player with this Lounge name.",
            action: "Change Lounge Name",
          }
        : !hasTracks
          ? {
              icon: <Route />,
              title: "No Tracks Yet",
              description: "None of your counted races has a track. Choose them in each mogi's Tracks list.",
            }
          : null;
  return (
    <section className={cn("@container relative", empty ? "h-full" : "min-h-full")}>
      {visible &&
        controlsContainer &&
        createPortal(
          <>
            <Toolbar
              aria-label="Tracks actions"
              leading={<SidebarToggle placement="toolbar" expanded={mogisShown} onClick={onShowMogis} />}
              trailing={sort("toolbar")}
            />
            <FloatingBar className="mx-auto max-w-xl" aria-label="Tracks actions">
              <GlassButton shape="circle" aria-label="Back" onClick={onBack}>
                <ArrowLeft aria-hidden="true" />
              </GlassButton>
              {sort("default")}
            </FloatingBar>
          </>,
          controlsContainer,
        )}
      {empty ? (
        <div className="flex h-full flex-col md:toolbar-clearance">
          <h1 data-mogi-title tabIndex={-1} className="sr-only">
            Tracks
          </h1>
          <ContentUnavailable
            icon={empty.icon}
            title={empty.title}
            description={empty.description}
            actions={empty.action && <GlassButton onClick={onChooseName}>{empty.action}</GlassButton>}
          />
        </div>
      ) : (
        <MogiScrollBody>
          <header className="px-4">
            <h1
              data-mogi-title
              tabIndex={-1}
              className="text-xl font-semibold outline-none md:text-3xl md:font-bold md:tracking-tight"
            >
              Tracks
            </h1>
            <p className="mt-1 text-sm text-muted-foreground md:text-base">
              {plural(standings.mogis, "mogi")} · {plural(standings.races, "race")}
            </p>
            {standings.olderMogis > 0 && <p className="mt-1 text-sm text-muted-foreground md:text-base">{WINDOW}</p>}
          </header>
          <TrackList tracks={standings.tracks} sortBy={sortBy} count={count} onSelect={select} />
        </MogiScrollBody>
      )}
      {/* View options, as Finder's and Photos' sort: a choice reorders the list behind at once and the panel stays
        open until its close button or a tap outside. */}
      {visible && (
        <Sheet kind="menu" height="fit" blocksUpdates={false} open={sorting} onOpenChange={setSorting} title="Sort">
          <div className="section-stack">
            <ListGroup title="Sort by">
              <List>
                {sortBys.map((entry) => (
                  <ListRow
                    key={entry.value}
                    accessory={entry.value === sortBy ? "check" : undefined}
                    buttonProps={{ "aria-current": entry.value === sortBy ? ("true" as const) : undefined }}
                    onSelect={() => setSortBy(entry.value)}
                  >
                    {entry.label}
                  </ListRow>
                ))}
              </List>
            </ListGroup>
            {/* Races counts every race, so the count has nothing to choose there. */}
            <ListGroup title="Count">
              <List>
                {counts.map((entry) => (
                  <ListRow
                    key={entry.value}
                    disabled={sortBy === "races"}
                    accessory={entry.value === count ? "check" : undefined}
                    buttonProps={{ "aria-current": entry.value === count ? ("true" as const) : undefined }}
                    onSelect={() => setCount(entry.value)}
                  >
                    {entry.label}
                  </ListRow>
                ))}
              </List>
            </ListGroup>
            {/* The current choice becomes the order Tracks opens in and the mogi screen's Vote follows. */}
            <List>
              <ListRow
                action="primary"
                disabled={busy || sameTrackOrder({ by: sortBy, count }, defaultOrder)}
                onSelect={() => onMakeDefault({ by: sortBy, count })}
              >
                Make Default
              </ListRow>
            </List>
            {/* The mogi screen's Vote follows this order, so whether it shows is set here too. */}
            <List>
              <ListRow
                trail={
                  <Switch
                    aria-labelledby="tracks-vote-shown"
                    disabled={busy}
                    checked={voteShown}
                    onCheckedChange={onVoteShown}
                  />
                }
              >
                <span id="tracks-vote-shown">Show Vote on Mogis</span>
              </ListRow>
            </List>
          </div>
        </Sheet>
      )}
      {visible && (
        <TrackSheet
          standing={selected}
          mogis={mogis}
          open={!!open}
          onOpenChange={(next) => {
            if (!next) setOpen(null);
          }}
        />
      )}
    </section>
  );
}

/** Every track in one list, every track alike whatever its race count, in `orderTracks` order, "—" with no race on the chosen side. */
function TrackList({
  tracks,
  sortBy,
  count,
  onSelect,
}: {
  tracks: TrackStanding[];
  sortBy: SortBy;
  count: Count;
  onSelect: (standing: TrackStanding) => void;
}) {
  const ordered = orderTracks(tracks, { by: sortBy, count });
  const measure = measureName(sortBy, count);
  // The measure's name titles the list, leading like every section title, as iOS Settings › Battery titles its
  // list by app over trailing percentages; each value keeps the name for screen readers.
  return (
    <ListGroup inset title={measure}>
      <List aria-label="Tracks">
        {ordered.map(({ standing, value }) => (
          <TrackRow
            key={standing.track.short}
            standing={standing}
            sortBy={sortBy}
            measure={measure}
            value={value}
            onSelect={onSelect}
          />
        ))}
      </List>
    </ListGroup>
  );
}

function TrackRow({
  standing,
  sortBy,
  measure,
  value,
  onSelect,
}: {
  standing: TrackStanding;
  sortBy: SortBy;
  measure: string;
  value: number | null;
  onSelect: (standing: TrackStanding) => void;
}) {
  // The last twelve counted races, newest at the right; a slot's label counts from the track's first race.
  const shown = standing.races
    .filter((race) => race.recent)
    .slice(-12)
    .map((race) => race.value);
  const first = standing.races.length - 12;
  const chart = (
    <span className="text-muted-foreground">
      <RaceBars
        values={valueSlots(shown)}
        domain={VALUE_DOMAIN}
        label={(entry, index) => raceLabel(entry, first + index)}
      />
    </span>
  );
  const main = (
    <Measure
      value={sortBy === "races" ? String(standing.recent) : value === null ? "—" : signedPlaces(value)}
      name={measure}
      ink={sortBy === "races" || value === null ? undefined : valueInk(value)}
    />
  );
  // The column heading names the number. The symbol is leading artwork as tall as the row. Compact: the name and
  // badge, then the race count leading and the chart and value trailing under them. Regular: the chart and value in
  // the trail. Sorted by Races, the number is the race count, so the second line leaves it out.
  return (
    <ListRow
      accessory="chevron"
      wrap
      onSelect={() => onSelect(standing)}
      media={<TrackIcon track={standing.track} size="row" />}
      description={
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{sortBy !== "races" && plural(standing.recent, "race")}</span>
          <span className="flex shrink-0 items-center gap-2 md:hidden">
            {chart}
            {main}
          </span>
        </span>
      }
      trail={
        <span className="hidden items-center gap-4 md:flex">
          {chart}
          {main}
        </span>
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{standing.track.name}</span>
        {standing.unstable && (
          <span className="shrink-0">
            <MetadataBadge>Unstable</MetadataBadge>
          </span>
        )}
      </span>
    </ListRow>
  );
}

/** A row's main number, its measure named to screen readers only: the section title names it on screen. */
function Measure({ value, name, ink = "text-foreground" }: { value: string; name: string; ink?: string }) {
  return (
    <span className="min-w-13 text-right">
      <span className="sr-only">{name} </span>
      <span className={cn("font-medium", ink)}>{value}</span>
    </span>
  );
}

/** A track's six measures: Typical and Total, each over every race (+/−), the plus races and the minus races. */
const measureRows = (standing: TrackStanding) => [
  { label: "Typical", values: [standing.typical, standing.typicalPlus, standing.typicalMinus] },
  { label: "Total", values: [standing.cost, standing.totalPlus, standing.totalMinus] },
];
const measureColumns = ["+/−", "Plus", "Minus"];
/** A measure in the sheet: signed and coloured, "—" with no race on that side. */
const MeasureValue = ({ value }: { value: number | null }) =>
  value === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className={cn("font-medium", valueInk(value))}>{signedPlaces(value)}</span>
  );

/**
 * The six measures as a 2×3 grid, rows Typical and Total, columns +/−, Plus and Minus: two rows compare plus with
 * minus at a glance, where two grouped lists took eight rows. Usual range and Worst / best follow in the same list,
 * so the group's title "Positions" names the unit of every value once.
 */
function MeasureGrid({ standing }: { standing: TrackStanding }) {
  // List rows draw the dividers; each cell keeps one width so the columns line up under their names, and screen
  // readers hear each value with its column ("Typical, +/− +3.8, Plus +4.0, Minus −5.4").
  const cells = (content: (column: string, index: number) => ReactNode) => (
    <span className="flex">
      {measureColumns.map((column, index) => (
        <span key={column} className="w-16">
          {content(column, index)}
        </span>
      ))}
    </span>
  );
  return (
    <List aria-label="Positions">
      <ListRow aria-hidden="true" trail={<span className="text-sm">{cells((column) => column)}</span>}>
        {null}
      </ListRow>
      {measureRows(standing).map((row) => (
        <ListRow
          key={row.label}
          trail={cells((column, index) => (
            <>
              <span className="sr-only">{column} </span>
              <MeasureValue value={row.values[index]} />
            </>
          ))}
        >
          {row.label}
        </ListRow>
      ))}
      <ListRow trail={`${signedPlaces(standing.lowerQuartile)} to ${signedPlaces(standing.upperQuartile)}`}>
        Usual range
      </ListRow>
      <ListRow trail={`${signedPlaces(standing.worst)} / ${signedPlaces(standing.best)}`}>Worst / best</ListRow>
    </List>
  );
}

function TrackSheet({
  standing,
  mogis,
  open,
  onOpenChange,
}: {
  standing: TrackStanding | null;
  mogis: Mogi[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!standing) return null;
  const recent = standing.races.filter((race) => race.recent);
  const older = standing.races.filter((race) => !race.recent);
  const raceRows = (races: TrackRace[]) => (
    <List>
      {[...races].reverse().map((race) => {
        const mogi = mogis.find((entry) => entry.id === race.mogiId);
        return (
          <ListRow
            key={`${race.mogiId}:${race.raceId}`}
            description={`${date.format(new Date(race.createdAt))} · ${race.format} · Race ${race.raceNumber}`}
            trail={
              <>
                <span>
                  {ordinal(race.place)} · {plural(race.points, "pt")}
                </span>
                <span className={cn("w-11 font-medium", valueInk(race.value))}>{signedPlaces(race.value)}</span>
              </>
            }
          >
            {mogi ? mogiTitle(mogi) : race.mogiName}
          </ListRow>
        );
      })}
    </List>
  );
  return (
    <Sheet kind="detail" blocksUpdates={false} open={open} onOpenChange={onOpenChange} title={standing.track.name}>
      <>
        <ListGroup title="Positions">
          <MeasureGrid standing={standing} />
        </ListGroup>
        <ListGroup note={older.length ? WINDOW : undefined}>
          <List aria-label="Summary">
            <ListRow trail={older.length ? `${recent.length} of ${standing.races.length}` : standing.races.length}>
              Counted
            </ListRow>
          </List>
        </ListGroup>
        <ListGroup title="Over time">
          <ValueTrend
            races={recent.map((race) => ({ value: race.value, running: race.runningTypical ?? race.value }))}
            label={(value, index) => raceLabel(value, older.length + index)}
          />
        </ListGroup>
        <ListGroup title="Races">{raceRows(recent)}</ListGroup>
        {older.length > 0 && <ListGroup title="Older races (not counted)">{raceRows(older)}</ListGroup>}
      </>
    </Sheet>
  );
}
