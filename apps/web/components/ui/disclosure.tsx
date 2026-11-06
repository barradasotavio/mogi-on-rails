"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "./button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

/** Keep drafts mounted while a section is collapsed. */
export function Disclosure({
  title,
  children,
  open,
  onOpenChange,
}: {
  title: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const expanded = open ?? localOpen;
  return (
    <Collapsible
      open={expanded}
      onOpenChange={(value) => {
        setLocalOpen(value);
        onOpenChange?.(value);
      }}
    >
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between whitespace-normal text-left">
          <span>{title}</span>
          <ChevronDown aria-hidden="true" className="shrink-0" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount hidden={!expanded}>
        <div className="space-y-3 py-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
