"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * A capsule bar for a measured share of a whole, such as storage used against the quota.
 * The fill scales from the leading edge through `--meter-value`, so no inline style or arbitrary width is needed.
 */
export function Meter({
  value,
  max,
  label,
  valueText,
}: {
  value: number;
  max: number;
  label: string;
  valueText: string;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  // A used share stays visible even when it rounds to nothing.
  const shown = fraction > 0 ? Math.max(fraction, 0.01) : 0;
  useLayoutEffect(() => {
    fill.current?.style.setProperty("--meter-value", String(shown));
  }, [shown]);
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuetext={valueText}
      className="block h-2 overflow-hidden rounded-full bg-foreground/10"
    >
      <span ref={fill} className="meter-fill block h-full rounded-full bg-primary" />
    </span>
  );
}
