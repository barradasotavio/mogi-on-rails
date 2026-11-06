"use client";

import { Ghost, Pencil } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";

type RaceTileState = "counted" | "pending" | "questions" | "needs-images" | "reading" | "future";

// One period of the road's dashes, a dash and its gap, is 25/60 of the tile's width (`--race-dash`); the road
// covers one in this long.
const drivePeriod = 450;
const dashPeriodOf = (road: HTMLElement) => ((road.parentElement?.clientWidth ?? 60) * 25) / 60;
const dashes = (offset: number) => ({ backgroundPosition: `50% ${offset}px, 0 0, 0 0` });

/**
 * The finish line: two rows of checks along a slight arc, 2px higher at the centre. Each check's lower edge
 * follows the curve, so the checks bend with it; the top row reaches the tile's top edge.
 */
const finishLine = (() => {
  const width = 60,
    size = 6,
    sag = 2;
  const arc = (x: number) => sag * ((x - width / 2) / (width / 2)) ** 2;
  const edge = (x0: number, x1: number, y: number) => {
    const mid = (x0 + x1) / 2;
    return `Q${mid} ${2 * (arc(mid) + y) - ((arc(x0) + arc(x1)) / 2 + y)} ${x1} ${arc(x1) + y}`;
  };
  return {
    viewBox: `0 0 ${width} ${2 * size + sag}`,
    cells: [0, 1].flatMap((row) =>
      Array.from({ length: width / size }, (_, column) => {
        const x0 = column * size,
          x1 = x0 + size,
          top = row * size,
          bottom = top + size;
        const upper = row === 0 ? `M${x0} 0 L${x1} 0` : `M${x0} ${arc(x0) + top} ${edge(x0, x1, top)}`;
        return {
          key: `${row}-${column}`,
          dark: (row + column) % 2 === 1,
          d: `${upper} L${x1} ${arc(x1) + bottom} ${edge(x1, x0, bottom)} Z`,
        };
      }),
    ),
  };
})();

/**
 * Grid target; the touch area also covers the gap between tiles. A tile is a road seen from the driver's seat:
 * - reading: the road goes by, with no number and no finish line yet;
 * - counted: the finish line reached at the top, the number under it, the road still behind it. When a race
 *   counts while it is on screen, the road brakes from where it was and the finish line arrives;
 * - questions: "?" in place of the number; needs images: Ghost in a dashed outline, which sets it apart from
 *   future without relying on color.
 * An edit in progress adds a pencil in the corner without changing the state; the accessible name says "Edit in progress".
 * A pencil instead of an "Editing" label, which doesn't fit a 52 px tile at 375 px next to "?" or Ghost.
 */
export function RaceTile({
  state,
  editing = false,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { state: RaceTileState; editing?: boolean }) {
  const road = useRef<HTMLSpanElement>(null);
  const drive = useRef<Animation | null>(null);
  const previous = useRef(state);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const element = road.current;
    const from = previous.current;
    previous.current = state;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!element || still) return;
    if (state === "reading") {
      if (!drive.current)
        drive.current = element.animate([dashes(0), dashes(dashPeriodOf(element))], {
          duration: drivePeriod,
          iterations: Infinity,
        });
      return;
    }
    const running = drive.current;
    drive.current = null;
    if (!running) return;
    // Brake from where the dashes are, at the speed they had: an ease-out over twice the distance's driving time
    // starts at that speed. It stops on a whole period, which looks the same as the road at rest.
    const dashPeriod = dashPeriodOf(element);
    const offset = ((Number(running.currentTime ?? 0) % drivePeriod) / drivePeriod) * dashPeriod;
    running.cancel();
    if (from !== "reading" || state !== "counted") return;
    const stop = Math.ceil((offset + dashPeriod * 0.4) / dashPeriod) * dashPeriod;
    element.animate([dashes(offset), dashes(stop)], {
      duration: (2 * (stop - offset)) / (dashPeriod / drivePeriod),
      easing: "cubic-bezier(.33, .66, .66, 1)",
    });
    setArrived(true);
    const done = setTimeout(() => setArrived(false), 1200);
    return () => clearTimeout(done);
  }, [state]);
  useEffect(() => () => drive.current?.cancel(), []);
  return (
    <button
      type="button"
      data-race-state={state}
      data-arrived={arrived ? "" : undefined}
      className={cn(
        "race-tile relative flex items-center justify-center overflow-hidden text-base font-bold tabular-nums outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 md:text-lg",
        state === "counted" && "bg-foreground text-background",
        (state === "reading" || state === "pending") && "bg-muted text-muted-foreground",
        state === "questions" && "bg-primary text-xl text-primary-foreground",
        state === "needs-images" &&
          "border-[1.5px] border-dashed border-muted-foreground/70 bg-transparent bg-none text-muted-foreground",
        state === "future" && "bg-muted text-muted-foreground/60",
        className,
      )}
      {...props}
    >
      <span ref={road} data-race-road aria-hidden="true" />
      {state === "counted" && (
        <svg data-race-finish viewBox={finishLine.viewBox} aria-hidden="true">
          {finishLine.cells.map((cell) => (
            <path key={cell.key} d={cell.d} data-dark={cell.dark ? "" : undefined} />
          ))}
        </svg>
      )}
      <span data-race-label>
        {state === "questions" ? (
          "?"
        ) : state === "needs-images" ? (
          <Ghost aria-hidden="true" data-race-badge="needs-images" className="size-5" />
        ) : (
          children
        )}
      </span>
      {editing && (
        <Pencil aria-hidden="true" data-race-badge="editing" className="absolute right-1.5 top-1.5 z-10 size-3" />
      )}
    </button>
  );
}
