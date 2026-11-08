import { withBase } from "@/lib/base-path";
import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * MKW Lounge emoji; the abbreviation names the track for screen reader users. Three sizes, each with its own radius
 * on the image itself, so the art is clipped: 24 inline in a text row (`rounded-sm`), 32 as a picker row's leading
 * artwork (`rounded-md`), 44 where the symbol stands on its own, as a grid cell, a column header or a Tracks row's
 * artwork (`rounded-lg`).
 */
const sizes = { 24: "size-6 rounded-sm", 32: "size-8 rounded-md", 44: "size-11 rounded-lg" } as const;

export function TrackIcon({ track, size = 24 }: { track: { short: string }; size?: keyof typeof sizes }) {
  return (
    <img
      src={withBase(`/tracks/${track.short}.webp`)}
      alt={track.short === "item-box" ? "Item Box" : track.short}
      loading="lazy"
      width={size}
      height={size}
      className={cn("shrink-0 object-cover", sizes[size])}
    />
  );
}
