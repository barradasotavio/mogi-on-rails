"use client";

import { Check, ChevronRight } from "lucide-react";
import { type ComponentProps, createContext, type CSSProperties, type ReactNode, useContext } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * Grouped lists in the iOS style: title above, rows with dividers, note below. The title and spacing open a
 * section and rules only separate rows, so a list has no top or bottom rule (HIG plain list).
 * On glass the divider is translucent, since an opaque gray vanishes where the blurred background darkens.
 * Structural HTML in the internal layer rather than Item, whose card padding, border and rounding would all be overridden.
 */
export function ListGroup({
  title,
  actions,
  note,
  children,
  className,
  inset = false,
  headingInset = false,
  sidebar = false,
  ink = false,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
  inset?: boolean;
  headingInset?: boolean;
  sidebar?: boolean;
  /** The box is the ink (`ink-section`), so section spacing counts between visible ink; for the mogi screen. */
  ink?: boolean;
}) {
  return (
    <section className={cn(ink ? "ink-section" : !sidebar && "list-group", inset && "px-4", className)}>
      {title &&
        (actions ? (
          <div
            data-section-title
            className={cn(!ink && "section-title", "flex items-end justify-between gap-4", headingInset && "px-4")}
          >
            <h2 className="text-sm/4 font-medium text-muted-foreground">{title}</h2>
            {actions}
          </div>
        ) : (
          <h2
            data-section-title
            className={cn(
              !ink && "section-title",
              "text-sm/4 font-medium text-muted-foreground",
              sidebar ? "px-3" : headingInset && "px-4",
            )}
          >
            {title}
          </h2>
        ))}
      {children}
      {note && (
        <p className={cn("pt-2 text-sm text-muted-foreground", sidebar ? "px-3" : headingInset && "px-4")}>{note}</p>
      )}
    </section>
  );
}

/** Lists take the material of the surface around them: a sheet in glass makes its lists glass. */
export const ListMaterial = createContext<"plain" | "glass">("plain");

export function List({
  material: own,
  dividers = "item",
  tone = "default",
  sidebar = false,
  className,
  ...props
}: ComponentProps<"ul"> & {
  material?: "plain" | "glass";
  dividers?: "item" | "row";
  tone?: "default" | "muted";
  sidebar?: boolean;
}) {
  const inherited = useContext(ListMaterial);
  const material = own ?? inherited;
  return (
    <ul
      className={cn(
        sidebar
          ? "flex flex-col gap-0.5"
          : cn(
              dividers === "row"
                ? "[&>li+li>div]:border-t [&>li+li>div]:border-rule [&>li+li>button]:border-t [&>li+li>button]:border-rule"
                : "divide-y",
              material === "glass" ? "divide-foreground/10" : "divide-rule",
            ),
        tone === "muted" && "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

type Accessory = "chevron" | "check";

/**
 * One row anatomy: 24px lead column (rank, mark or selection), content with an optional second line,
 * right-aligned trail. A row with `onSelect` is a button; `accessory` closes the trail.
 * `action` turns the title into a command: primary or destructive color, without a chevron.
 * `media` takes the lead's place with a thumbnail and gives the row 8px of vertical inset; its slot is as tall as
 * the row, so artwork with `h-full` spans every line.
 * `span` makes the row as tall as that many plain rows, for rows that carry lines of their own,
 * such as a team over its players, so they line up with the plain rows beside them.
 */
export function ListRow({
  lead,
  media,
  trail,
  accessory,
  description,
  children,
  onSelect,
  disabled,
  buttonProps,
  sidebar = false,
  wrap = false,
  action,
  span = 1,
  after,
  className,
  ...props
}: Omit<ComponentProps<"li">, "onSelect"> & {
  lead?: ReactNode;
  media?: ReactNode;
  trail?: ReactNode;
  accessory?: Accessory;
  description?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  /** Rendered after the row's button, outside its accessible name, such as a copy action's live region. */
  after?: ReactNode;
  buttonProps?: Omit<ComponentProps<"button">, "children" | "className" | "onClick" | "disabled">;
  sidebar?: boolean;
  wrap?: boolean;
  action?: "primary" | "destructive";
  span?: number;
}) {
  const body = (
    <>
      {media !== undefined ? (
        <span className="flex shrink-0 items-center self-stretch">{media}</span>
      ) : (
        lead !== undefined && <span className="flex w-6 shrink-0 justify-start text-muted-foreground">{lead}</span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block",
            wrap ? "wrap-anywhere" : "truncate",
            action === "primary" && "text-link",
            action === "destructive" && "text-destructive",
          )}
        >
          {children}
        </span>
        {description && (
          <span className={cn("block text-sm text-muted-foreground", wrap ? "wrap-anywhere" : "truncate")}>
            {description}
          </span>
        )}
      </span>
      {(trail !== undefined || accessory) && (
        <span className="flex shrink-0 items-center gap-4 text-right text-muted-foreground">
          {trail}
          {accessory === "chevron" && <ChevronRight className="size-4" aria-hidden="true" />}
          {accessory === "check" && <Check className="size-4 text-link" aria-label="Selected" />}
        </span>
      )}
    </>
  );
  const double = span > 1;
  const row = cn(
    "flex w-full items-center gap-3 text-left tabular-nums",
    double ? "row-span-height" : "min-h-11",
    media !== undefined ? "py-2" : description && "py-1.5",
  );
  // Two-line and media rows start their ink 8px in, not 12px (`list-group`).
  // A spanning row is as tall as its plain rows and keeps their inset, so its dividers meet theirs.
  const height = double ? ({ "--row-span": span } as CSSProperties) : undefined;
  const inset = !double && (media !== undefined || description) ? "tight" : undefined;
  return (
    <li className={className} {...props}>
      {onSelect ? (
        <button
          {...buttonProps}
          data-row-inset={inset}
          type="button"
          onClick={onSelect}
          disabled={disabled}
          style={height}
          className={cn(
            row,
            "active:bg-muted disabled:opacity-50",
            sidebar &&
              "rounded-xl px-3 py-2 aria-[current=true]:bg-primary/12 aria-[current=true]:text-link aria-[current=true]:active:bg-primary/12",
          )}
        >
          {body}
        </button>
      ) : (
        <div data-row-inset={inset} style={height} className={cn(row, sidebar && "px-3")}>
          {body}
        </div>
      )}
      {after}
    </li>
  );
}
