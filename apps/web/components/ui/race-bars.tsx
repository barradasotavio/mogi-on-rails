"use client";

import { type PointerEvent, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * Twelve thin bars, one per race, for a row's points race by race, in the row's colour (`currentColor`).
 * A race not counted yet is a short faint stub, so the twelve slots hold still; the last counted race is in
 * full colour and the earlier ones lighter. Heights scale from the bottom through `--bar-value` (0 to 1), as
 * Meter does, so no inline style is needed.
 * Reading a value, "Race N · P" above its bar: the pointer hovers a slot (each is as tall as the strip); a
 * finger drags across the strip, as on the iPhone's Stocks and Health charts, and lifting it hides the label.
 * The strip only lets vertical panning through, so a horizontal drag reads instead of scrolling.
 * A finger on the strip only reads: the tap that ends it doesn't reach a row the strip sits in.
 * Pointer only; the row's accessible name and the table carry the numbers, so the strip is hidden from
 * assistive technology.
 * With `domain`, the bars diverge from a zero line across the middle instead: up in `--value-gain` for a value
 * above zero, down in `--value-loss` below it, each half reaching `domain` (a larger value stops at the edge).
 * `label` words a slot's reading; `fill` makes the strip take its container's size.
 */
export function RaceBars({
  values,
  max = 0,
  domain,
  label,
  fill = false,
  className,
}: {
  values: (number | null)[];
  max?: number;
  domain?: number;
  label?: (value: number, index: number) => string;
  fill?: boolean;
  className?: string;
}) {
  const bars = useRef<HTMLSpanElement>(null);
  const [touched, setTouched] = useState<number | null>(null);
  const reading = useRef(false);
  useLayoutEffect(() => {
    bars.current?.querySelectorAll<HTMLElement>("[data-bar]").forEach((bar, index) => {
      const value = values[index];
      const scale = domain ?? max;
      bar.style.setProperty(
        "--bar-value",
        String(
          value === null || value === undefined || scale <= 0
            ? 0
            : Math.max(0.08, Math.min(1, Math.abs(value) / scale)),
        ),
      );
    });
  }, [values, max, domain]);
  const last = values.findLastIndex((value) => value !== null);
  const read = (event: PointerEvent<HTMLSpanElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.min(
      values.length - 1,
      Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * values.length)),
    );
    setTouched(values[index] === null ? null : index);
  };
  return (
    <span
      ref={bars}
      aria-hidden="true"
      data-reading={touched === null ? undefined : ""}
      data-diverging={domain === undefined ? undefined : ""}
      data-fill={fill ? "" : undefined}
      className={cn("race-bars", className)}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        reading.current = true;
        read(event);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse" && event.currentTarget.hasPointerCapture(event.pointerId)) read(event);
      }}
      onPointerUp={() => setTouched(null)}
      onPointerCancel={() => setTouched(null)}
      onClick={(event) => {
        if (reading.current) event.stopPropagation();
        reading.current = false;
      }}
    >
      {values.map((value, index) => (
        <span
          key={index}
          data-bar
          data-empty={value === null ? "" : undefined}
          data-last={index === last ? "" : undefined}
          data-touched={index === touched ? "" : undefined}
          data-tone={
            domain === undefined || value === null ? undefined : value > 0 ? "gain" : value < 0 ? "loss" : "zero"
          }
          data-label={value === null ? undefined : label ? label(value, index) : `Race ${index + 1} · ${value}`}
        />
      ))}
    </span>
  );
}
