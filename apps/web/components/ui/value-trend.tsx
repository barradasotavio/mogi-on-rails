import { RaceBars } from "@/components/ui/race-bars";
import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * The one scale of every value chart (a track row's race bars and the track sheet's Over time): positions better or
 * worse than the player's average in that mogi, ±6 around zero. Fixed rather than fitted, so rows compare with one
 * another and with the sheet; a value beyond it stops at the frame's edge, with no marker.
 */
export const VALUE_DOMAIN = 6;

/** At least twelve slots, newest at the right, so a track with few races keeps the rows' frame. */
export const valueSlots = (values: number[], slots = 12) => [
  ...Array<null>(Math.max(0, slots - values.length)).fill(null),
  ...values,
];

/**
 * A track's value over time, oldest race first, in the rows' look: diverging race bars (`RaceBars` with
 * `domain`) on the ±6 scale, and the running Typical +/− (median) as a line over them, so improvement after
 * practice shows as the line climbing. Hover or drag reads a race. The race list below carries the numbers, so
 * the chart is hidden from assistive technology.
 */
export function ValueTrend({
  races,
  label,
  className,
}: {
  races: { value: number; running: number }[];
  label: (value: number, index: number) => string;
  className?: string;
}) {
  const slots = valueSlots(races.map((race) => race.value));
  const offset = slots.length - races.length;
  const y = (value: number) => 50 - (Math.max(-VALUE_DOMAIN, Math.min(VALUE_DOMAIN, value)) / VALUE_DOMAIN) * 50;
  const line = races.map((race, index) => `${offset + index + 0.5},${y(race.running)}`).join(" ");
  return (
    <div aria-hidden="true" className={cn("value-trend", className)}>
      <span className="flex flex-col justify-between text-right text-xs leading-none tabular-nums text-muted-foreground">
        <span>+{VALUE_DOMAIN}</span>
        <span>0</span>
        <span>−{VALUE_DOMAIN}</span>
      </span>
      <div className="relative min-w-0 text-muted-foreground">
        <RaceBars values={slots} domain={VALUE_DOMAIN} label={(value, index) => label(value, index - offset)} fill />
        {races.length > 1 && (
          <svg
            viewBox={`0 0 ${slots.length} 100`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
          >
            <polyline
              points={line}
              fill="none"
              className="stroke-foreground"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
