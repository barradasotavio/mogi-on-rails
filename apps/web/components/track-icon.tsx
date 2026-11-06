import { withBase } from "@/lib/base-path";
import { cn } from "@/vendor/shadcn/lib/utils";

/** MKW Lounge emoji; the abbreviation names the track for screen reader users. */
export function TrackIcon({ track, size = 24 }: { track: { short: string }; size?: 24 | 32 | "row" }) {
  // "row": leading artwork as tall as its row (`ListRow` `media`), square and rounded like the app's other thumbnails.
  return (
    <img
      src={withBase(`/tracks/${track.short}.webp`)}
      alt={track.short === "item-box" ? "Item Box" : track.short}
      loading="lazy"
      width={size === "row" ? 48 : size}
      height={size === "row" ? 48 : size}
      className={cn(
        "shrink-0",
        size === 24
          ? "size-6 object-contain"
          : size === 32
            ? "size-8 object-contain"
            : "aspect-square h-full rounded-md object-cover",
      )}
    />
  );
}
