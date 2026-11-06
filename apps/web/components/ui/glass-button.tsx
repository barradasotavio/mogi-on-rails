import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * Floating control in glass: a 48px pill for actions, or a 44px circle for icons (corner, toolbar, bottom bar).
 * `tint` is the primary action; the neutral one is everything else.
 * Its own component, not a Button variant: the vendored Button carries Vega's sizes and rings, which every glass use would override.
 */
export function GlassButton({
  tint = false,
  shape = "pill",
  density = "default",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  tint?: boolean;
  shape?: "pill" | "circle";
  density?: "default" | "toolbar";
}) {
  return (
    <button
      type={type}
      data-shape={shape}
      className={cn(
        "pointer-events-auto inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-5 [&_svg]:shrink-0",
        tint ? "glass-tint" : "glass text-foreground",
        shape === "pill" ? (density === "toolbar" ? "h-11 px-3 text-sm" : "h-12 px-5") : "size-11",
        className,
      )}
      {...props}
    />
  );
}

/** Capsule of glass circles, as in a toolbar: one material behind several controls. */
export function ToolbarGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="group"
      className={cn(
        "glass pointer-events-auto flex items-center rounded-full p-0.5 [&_button]:shadow-none [&_button]:bg-transparent [&_button]:backdrop-filter-none",
        className,
      )}
      {...props}
    />
  );
}
