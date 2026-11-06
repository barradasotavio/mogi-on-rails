"use client";

import { PanelLeft } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { GlassButton } from "@/components/ui/glass-button";
import { useSizeClass } from "@/components/ui/size-class";
import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * The regular toolbar, as in macOS: a 52px band across the top of the content column, with the leading group
 * (sidebar toggle, title) at the start and the trailing one (actions, then the one `tint` action) at the end.
 * It has the content's background at rest and turns to glass with a hard edge once content scrolls under it
 * (`toolbar` in globals.css; the scroller declares the timeline, an ancestor carries `toolbar-scope`). Under
 * Window Controls Overlay it is the title bar band: it clears the window controls, centres smaller controls
 * on their line, stays opaque and its background drags the window. On compact the floating bar takes over and the toolbar is not mounted at all,
 * because its title repeats the compact header's; it appears only with loaded data, after first paint.
 */
export function Toolbar({
  leading,
  trailing,
  className,
  ...props
}: Omit<ComponentProps<"nav">, "children"> & {
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  if (useSizeClass() !== "regular") return null;
  // The row carries the margins, so the toolbar's container width is the column's, as the content's is.
  return (
    <nav
      className={cn(
        "toolbar toolbar-controls pointer-events-auto absolute inset-x-0 top-0 z-30 hidden md:block",
        className,
      )}
      {...props}
    >
      <div className="toolbar-row flex h-full items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">{leading}</div>
        {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
      </div>
    </nav>
  );
}

/** Title and optional subtitle of the screen, at the toolbar's leading edge. */
export function ToolbarTitle({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="toolbar-title min-w-0">
      <h1 data-mogi-title tabIndex={-1} className="truncate text-base font-semibold leading-tight outline-none">
        {title}
      </h1>
      {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/**
 * Shows or hides the sidebar, as in Notes on iPad and Mac. Docked open, the sidebar holds it (Hide Mogis) and the
 * toolbar's disappears (`toolbar-sidebar-toggle`), so it "jumps" between them. Floating, the toolbar's stays
 * in place and reads Hide Mogis while the sidebar is shown (`expanded`); the band leaves it clickable.
 */
export function SidebarToggle({
  placement,
  expanded = false,
  onClick,
}: {
  placement: "toolbar" | "sidebar";
  expanded?: boolean;
  onClick: () => void;
}) {
  const hides = placement === "sidebar" || expanded;
  return (
    <GlassButton
      shape="circle"
      data-show-mogis
      aria-label={hides ? "Hide Mogis" : "Show Mogis"}
      aria-expanded={placement === "toolbar" ? expanded : undefined}
      className={placement === "toolbar" ? "toolbar-sidebar-toggle" : undefined}
      onClick={onClick}
    >
      <PanelLeft aria-hidden="true" />
    </GlassButton>
  );
}

/** The mogi's title: in the toolbar on regular, at the top of the content on compact; only one is shown. */
export const visibleMogiTitle = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-mogi-title]")).find(
    (title) => title.getClientRects().length > 0,
  ) ?? null;
