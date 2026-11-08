import { withBase } from "@/lib/base-path";
import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * MKW Lounge emoji; the abbreviation names the track for screen reader users. Two sizes, each with its own radius
 * on the image itself, so the art is clipped: 24 inline in a text row (`rounded-sm`), 44 where the symbol stands on
 * its own, as a grid cell, a column header or a row's leading artwork (`rounded-lg`).
 */
export function TrackIcon({ track, size = 24 }: { track: { short: string }; size?: 24 | 44 }) {
  return (
    <img
      src={withBase(`/tracks/${track.short}.webp`)}
      alt={track.short === "item-box" ? "Item Box" : track.short}
      loading="lazy"
      width={size}
      height={size}
      className={cn("shrink-0 object-cover", size === 24 ? "size-6 rounded-sm" : "size-11 rounded-lg")}
    />
  );
}
