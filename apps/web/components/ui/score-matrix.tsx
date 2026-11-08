"use client";

import { Fragment, type ReactNode, useLayoutEffect, useRef } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";

type ScoreRow = { id: string; name: string; rank: number | null; total: number | null; values: ReactNode[] };
type Column = {
  number: number;
  state: string;
  label: string;
  total: ReactNode;
  complete: boolean;
  icon?: ReactNode;
  onOpen: () => void;
};

/**
 * Opaque table: position, name and total pinned on the left and the twelve races scrolling horizontally.
 *
 * In the compact container, the 16 px sit in the first pinned column and the trailing spacer. In the wide
 * presentation, the container itself has side margins. When there is spare width, only the races grow.
 * `surface` is the color under the table, which the pinned columns repeat to cover what scrolls.
 *
 * Questions never change a column's background or number. A background is rounded only where it ends inside
 * the visible area. On a team row, the name cell shows only the label, with no number badge.
 */
export function ScoreMatrix({
  columns,
  groups,
  total,
  surface = "background",
}: {
  columns: Column[];
  groups: (ScoreRow & { members: ScoreRow[] })[];
  total: number | null;
  surface?: "background" | "popover";
}) {
  const teams = groups.some((group) => group.name);
  const current = columns.filter((column) => column.state === "counted").at(-1)?.number;
  const scroller = useRef<HTMLDivElement>(null);
  // Opens with the last counted race in view, before the first paint.
  useLayoutEffect(() => {
    const element = scroller.current;
    const cell = element?.querySelector<HTMLElement>("[data-current]");
    if (element && cell)
      element.scrollLeft = Math.max(0, cell.offsetLeft + cell.offsetWidth - element.clientWidth + 16);
  }, [current]);
  const opaque = surface === "popover" ? "bg-popover after:from-popover" : "bg-background after:from-background";
  // The Total column closes the pinned part with the divider and a short shadow over what scrolls, starting after the divider.
  // The shadow shows only while the races are scrolled under it (`matrix-edge`).
  const edge =
    "matrix-edge border-r border-r-rule after:pointer-events-none after:absolute after:inset-y-0 after:-right-4.25 after:w-4 after:bg-linear-to-r after:to-transparent";
  const fixed = (team: boolean, ...extra: (string | false)[]) =>
    cn("sticky z-10", team ? "bg-muted after:from-muted" : opaque, ...extra);
  const highlight = (number: number, team = false) => !team && number === current && "bg-muted/70";
  const teamBorder = "border-y border-rule";
  // In the wide presentation, the team band ends rounded at the last race. Rounding clips the cell's own background,
  // so the band becomes a pseudo-element and the cell paints what sits behind the corner: the column highlight, if current.
  const cap = (number: number) =>
    cn(
      "@[45rem]:relative @[45rem]:isolate @[45rem]:border-0",
      number === current ? "@[45rem]:bg-muted/70" : "@[45rem]:bg-transparent",
      "@[45rem]:before:absolute @[45rem]:before:inset-0 @[45rem]:before:-z-10 @[45rem]:before:rounded-r-lg @[45rem]:before:border-y @[45rem]:before:border-r @[45rem]:before:border-rule @[45rem]:before:bg-muted",
    );
  const row = (person: ScoreRow, team = false, firstMember = false) => (
    <tr key={person.id} className={cn("h-8", team && "font-semibold")}>
      <td
        className={fixed(
          team,
          "left-0 pl-4 @[45rem]:pl-3",
          team ? cn(teamBorder, "@[45rem]:rounded-l-lg @[45rem]:border-l") : !firstMember && "border-t border-rule",
          !team && "text-muted-foreground",
        )}
      >
        {teams && !team ? "" : (person.rank ?? "—")}
      </td>
      <th
        scope={team ? "rowgroup" : "row"}
        className={fixed(
          team,
          "left-11 max-w-28 pr-2 text-left",
          team ? teamBorder : !firstMember && "border-t border-rule",
          !team && "font-normal",
        )}
      >
        <span className="block truncate">{person.name}</span>
      </th>
      <td
        className={fixed(
          team,
          "left-39 pr-3 text-right font-semibold",
          team ? teamBorder : !firstMember && "border-t border-rule",
          edge,
        )}
      >
        {person.total ?? "—"}
      </td>
      {person.values.map((value, i) => (
        <td
          key={i}
          className={cn(
            "min-w-12 text-center",
            team
              ? cn(teamBorder, "bg-muted", i === columns.length - 1 && cap(columns[i].number))
              : !firstMember && "border-t border-rule",
            highlight(columns[i].number, team),
            value === "·" && "text-muted-foreground/40",
          )}
        >
          {value}
        </td>
      ))}
      <td
        aria-hidden="true"
        className={cn(
          team
            ? cn(teamBorder, "bg-muted @[45rem]:border-0 @[45rem]:bg-transparent")
            : !firstMember && "border-t border-rule",
        )}
      />
    </tr>
  );
  const spacer = (key: string) => (
    <tr key={key} aria-hidden="true" className="h-3">
      <td className={fixed(false, "left-0")} />
      <td className={fixed(false, "left-11")} />
      <td className={fixed(false, "left-39", edge)} />
      {columns.map((column) => (
        <td key={column.number} className={cn(highlight(column.number))} />
      ))}
      <td />
    </tr>
  );
  return (
    <div className="@container">
      <div ref={scroller} className="matrix-scroller overflow-x-auto @[45rem]:mx-4">
        <table
          aria-label="Mogi table"
          className="w-max min-w-full border-separate border-spacing-0 text-sm tabular-nums"
        >
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th
                className={fixed(
                  false,
                  "left-0 w-11 min-w-11 max-w-11 pl-4 text-left @[45rem]:pl-3 align-top font-medium",
                )}
              >
                #
              </th>
              <th className={fixed(false, "left-11 w-28 min-w-28 max-w-28 text-left align-top font-medium")}>
                {teams ? "Team" : "Player"}
              </th>
              <th
                className={fixed(false, "left-39 w-11 min-w-11 max-w-11 pr-3 text-right align-top font-medium", edge)}
              >
                Total
              </th>
              {columns.map((column) => (
                <th
                  key={column.number}
                  data-current={column.number === current || undefined}
                  className={cn(
                    "w-1/12 min-w-12 px-0.5 pb-1 align-top font-medium",
                    highlight(column.number),
                    column.number === current && "rounded-t-lg",
                  )}
                >
                  <button
                    type="button"
                    data-race-column={column.number}
                    aria-label={column.label}
                    disabled={column.state === "future" || column.state === "unseen" || column.state === "reading"}
                    onClick={column.onOpen}
                    className={cn(
                      "flex h-16 w-full flex-col items-center justify-start gap-0.5 rounded-md leading-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      column.state !== "future" && column.state !== "unseen" && "text-foreground active:bg-muted",
                    )}
                  >
                    <span className="text-sm/4">{column.number}</span>
                    {column.icon ?? <span className="size-11" />}
                  </button>
                </th>
              ))}
              <th aria-hidden="true" className="w-4 min-w-4 @[45rem]:w-0 @[45rem]:min-w-0" />
            </tr>
          </thead>
          <tbody>
            {groups.map((group, index) => (
              <Fragment key={group.id}>
                {teams && index > 0 && spacer(`space-${group.id}`)}
                {teams && row(group, true)}
                {group.members.map((person, index) => row(person, false, teams && index === 0))}
              </Fragment>
            ))}
          </tbody>
          {/* Check: each race hands out 82 points; all 12, 984. A different sum shows in red. */}
          <tfoot>
            {spacer("before-total")}
            <tr className="font-semibold *:py-3">
              <td className={fixed(false, "left-0 border-t-2 border-foreground")} />
              <th scope="row" className={fixed(false, "left-11 border-t-2 border-foreground text-left")}>
                Total
              </th>
              <td className={fixed(false, "left-39 border-t-2 border-foreground pr-3 text-right", edge)}>
                {total ?? "—"}
              </td>
              {columns.map((column) => (
                <td
                  key={column.number}
                  className={cn(
                    "border-t-2 border-foreground text-center",
                    highlight(column.number),
                    column.number === current && "rounded-b-lg",
                    column.total === "·" && "font-normal text-muted-foreground/40",
                    column.complete && column.total !== 82 && "text-destructive",
                  )}
                >
                  {column.total}
                </td>
              ))}
              <td aria-hidden="true" className="border-t-2 border-foreground" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
