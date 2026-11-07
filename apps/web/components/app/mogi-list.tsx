import { mogiSummary, resultCoverage } from "@mkw/engine";
import { BookOpen, Route, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { List, ListGroup, ListRow } from "@/components/ui/list";
import type { RouteView } from "@/lib/mogi/route";
import type { Mogi } from "@/lib/mogi/types";

/** Destinations beside the mogis, above the groups. */
const destinations = [
  { view: "instructions", title: "Instructions", Icon: BookOpen },
  { view: "release-notes", title: "Release Notes", Icon: Sparkles },
  { view: "tracks", title: "Tracks", Icon: Route },
] as const;

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function MogiListRow({
  mogi,
  active,
  sidebar,
  onSelect,
}: {
  mogi: Mogi;
  active: boolean;
  sidebar: boolean;
  onSelect: (id: string) => void;
}) {
  const summary = mogiSummary(mogi);
  const buttonProps = { "data-mogi-id": mogi.id, "aria-current": active ? ("true" as const) : undefined };
  return (
    <ListRow
      sidebar={sidebar}
      buttonProps={buttonProps}
      onSelect={() => onSelect(mogi.id)}
      accessory={sidebar ? undefined : "chevron"}
      description={<span className="block whitespace-normal">{summary.text}</span>}
      trail={
        summary.final && (
          <time dateTime={mogi.createdAt} className="text-sm">
            {date.format(new Date(mogi.createdAt))}
          </time>
        )
      }
    >
      <span className="font-medium">
        Mogi Tier {mogi.submissionTier?.trim() || "—"} · {mogi.format}
      </span>
    </ListRow>
  );
}

export function MogiList({
  mogis,
  activeId,
  view = null,
  onSelect,
  onView,
  sidebar = false,
}: {
  mogis: Mogi[];
  activeId: string | null;
  /** The destination showing: its row is the current one in the sidebar. */
  view?: RouteView | null;
  onSelect: (id: string) => void;
  onView: (view: RouteView) => void;
  sidebar?: boolean;
}) {
  const ordered = [...mogis]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((mogi) => ({ mogi, final: resultCoverage(mogi).final }));
  const inProgress = ordered.filter(({ final }) => !final);
  const previous = ordered.filter(({ final }) => final);
  return (
    <MogiListSections
      inProgress={inProgress}
      previous={previous}
      activeId={activeId}
      onSelect={onSelect}
      sidebar={sidebar}
      lead={
        <List sidebar={sidebar} aria-label="Destinations">
          {destinations.map(({ view: destination, title, Icon }) => (
            <ListRow
              key={destination}
              sidebar={sidebar}
              onSelect={() => onView(destination)}
              accessory={sidebar ? undefined : "chevron"}
              buttonProps={{ "aria-current": view === destination ? ("true" as const) : undefined }}
            >
              <span className="flex items-center gap-3">
                <Icon aria-hidden="true" className="size-5 text-link" />
                {title}
              </span>
            </ListRow>
          ))}
        </List>
      }
    />
  );
}

function MogiListSections({
  inProgress,
  previous,
  activeId,
  onSelect,
  sidebar,
  lead,
}: {
  inProgress: { mogi: Mogi; final: boolean }[];
  previous: { mogi: Mogi; final: boolean }[];
  activeId: string | null;
  onSelect: (id: string) => void;
  sidebar: boolean;
  lead: ReactNode;
}) {
  const rows = (entries: { mogi: Mogi; final: boolean }[]) => (
    <List sidebar={sidebar}>
      {entries.map(({ mogi }) => (
        <MogiListRow key={mogi.id} mogi={mogi} active={mogi.id === activeId} sidebar={sidebar} onSelect={onSelect} />
      ))}
    </List>
  );
  return (
    <div className="section-stack">
      {lead}
      {inProgress.length > 0 && (
        <ListGroup title="Current mogis" sidebar={sidebar}>
          {rows(inProgress)}
        </ListGroup>
      )}
      {previous.length > 0 && (
        <ListGroup title="Previous mogis" sidebar={sidebar}>
          {rows(previous)}
        </ListGroup>
      )}
    </div>
  );
}
