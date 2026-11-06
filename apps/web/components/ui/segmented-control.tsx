"use client";

import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * Segmented control in the HIG sense: a few mutually exclusive views of the same content; a sort order is a menu instead.
 * It is a control, so it is glass: one capsule (`glass`) with the chosen segment raised on the opaque background,
 * as on iOS. 44px tall in the floating bar and the toolbar, segments of equal width from regular; on compact each is
 * as wide as its label, so three fit beside Back at 375px. The choice is required,
 * so choosing the active segment again keeps it.
 */
export function SegmentedControl<Value extends string>({
  options,
  value,
  onValueChange,
  className,
  ...props
}: {
  options: { value: Value; label: ReactNode }[];
  value: Value;
  onValueChange: (value: Value) => void;
  className?: string;
  "aria-label": string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as Value);
      }}
      className={cn(
        "glass pointer-events-auto grid h-11 auto-cols-auto grid-flow-col md:auto-cols-fr rounded-full p-0.5",
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className="h-full min-w-16 rounded-full px-3 text-sm md:min-w-20 md:px-4 font-medium text-foreground outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=on]:bg-background data-[state=on]:shadow-sm"
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
