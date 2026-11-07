import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";
import { Input as OriginalInput } from "@/vendor/shadcn/ui/input";

/**
 * `filled` is the field inside sheets: 44px, muted, no border, as an iOS text field.
 * `inline` is a field in a list row's trail, short enough to clear the row's dividers, as iOS Settings' inline fields.
 */
export function Input({
  variant = "default",
  className,
  ...props
}: ComponentProps<typeof OriginalInput> & { variant?: "default" | "filled" | "inline" }) {
  return (
    <OriginalInput
      className={cn(
        variant === "filled" && "h-11 rounded-xl border-transparent bg-muted px-3 shadow-none dark:bg-muted",
        variant === "inline" && "h-8 rounded-lg border-transparent bg-muted px-3 shadow-none dark:bg-muted",
        className,
      )}
      {...props}
    />
  );
}
