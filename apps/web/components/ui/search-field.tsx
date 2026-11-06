"use client";

import { Search, X } from "lucide-react";

/** Search in a glass capsule, with a clear button once there is text. In a sheet it is the `search` slot. */
export function SearchField({
  value,
  onValueChange,
  placeholder,
  label = placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  label?: string;
}) {
  return (
    <div className="glass flex h-12 items-center gap-2 rounded-full pl-4 pr-1.5 text-muted-foreground">
      <Search className="size-5 shrink-0" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="search"
        className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear Search"
          onClick={() => onValueChange("")}
          className="flex size-9 items-center justify-center rounded-full bg-foreground/10 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
