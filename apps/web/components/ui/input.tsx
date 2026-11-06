import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";
import { Input as OriginalInput } from "@/vendor/shadcn/ui/input";

/** `filled` is the field inside sheets: 44px, muted, no border, as an iOS text field. */
export function Input({
  variant = "default",
  className,
  ...props
}: ComponentProps<typeof OriginalInput> & { variant?: "default" | "filled" }) {
  return (
    <OriginalInput
      className={cn(
        variant === "filled" && "h-11 rounded-xl border-transparent bg-muted px-3 shadow-none dark:bg-muted",
        className,
      )}
      {...props}
    />
  );
}
