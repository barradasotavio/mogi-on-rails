import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * 44px block on an opaque surface: the header action and every action of the same weight.
 * The same action keeps this size wherever it appears.
 */
export function TileButton({
  tone = "neutral",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { tone?: "neutral" | "primary" }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-medium outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "primary" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        className,
      )}
      {...props}
    />
  );
}
