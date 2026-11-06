import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * The compact bottom controls: glass buttons floating over the content inside the safe area, with the
 * leading control at the start and the trailing ones at the end. On regular the toolbar takes over.
 */
export function FloatingBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="toolbar"
      className={cn(
        "floating-bar pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-2 px-4 md:hidden",
        className,
      )}
      {...props}
    />
  );
}
