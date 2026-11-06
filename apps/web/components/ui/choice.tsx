"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { RadioGroup } from "@/vendor/shadcn/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/vendor/shadcn/ui/toggle-group";

type Choice<Value extends string> = { value: Value; label: ReactNode; disabled?: boolean };

// Radix lets a single group deselect its active item; a required choice ignores that empty value.
const keep =
  <Value extends string>(onValueChange: (value: Value) => void) =>
  (next: string) => {
    if (next) onValueChange(next as Value);
  };

/** Grid of numbers in single selection, such as a starting race: six 44px cells per row. */
export function ChoiceGrid<Value extends string>({
  options,
  value,
  onValueChange,
  ...props
}: {
  options: Choice<Value>[];
  value: Value;
  onValueChange: (value: Value) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      value={value}
      onValueChange={keep(onValueChange)}
      className="grid w-full grid-cols-6"
      {...props}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className="h-11 w-full rounded-xl bg-muted font-semibold tabular-nums hover:bg-muted data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Wrapped names in single selection, such as who a sub replaced. */
export function ChoiceChips<Value extends string>({
  options,
  value,
  onValueChange,
  ...props
}: {
  options: Choice<Value>[];
  value: Value | null;
  onValueChange: (value: Value) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={2}
      value={value ?? ""}
      onValueChange={keep(onValueChange)}
      className="w-full flex-wrap"
      {...props}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className="h-11 rounded-full bg-muted px-4 hover:bg-muted data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * Single choice as a grouped list: the radio in the lead column, the name, an optional trail such as
 * "Suggested". The whole row selects; arrow keys move between rows.
 */
export function ListRadioGroup<Value extends string>({
  options,
  value,
  onValueChange,
  ...props
}: {
  options: (Choice<Value> & { description?: ReactNode; trail?: ReactNode })[];
  value: Value;
  onValueChange: (value: Value) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onValueChange(next as Value)}
      className="gap-0 divide-y divide-rule"
      {...props}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="flex min-h-11 items-center gap-3 has-disabled:opacity-50 has-data-description:py-1.5"
        >
          <span className="flex w-6 shrink-0">
            <ListRadio value={option.value} disabled={option.disabled} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{option.label}</span>
            {option.description && (
              <span data-description className="block text-sm text-muted-foreground">
                {option.description}
              </span>
            )}
          </span>
          {option.trail !== undefined && <span className="shrink-0 text-sm text-muted-foreground">{option.trail}</span>}
        </label>
      ))}
    </RadioGroup>
  );
}

/**
 * List radio, as on iOS: 20px, a 2px ring and, when checked, a ring and dot in `link` (the tint as ink) with a
 * transparent gap between them that shows the surface below on any material.
 */
function ListRadio({ value, disabled }: { value: string; disabled?: boolean }) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      disabled={disabled}
      className="relative flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-rule outline-none after:absolute after:-inset-3 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=checked]:border-link"
    >
      <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-link" />
    </RadioGroupPrimitive.Item>
  );
}
