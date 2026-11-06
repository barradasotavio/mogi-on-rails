"use client";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function SettingsSection({
  title,
  children,
  status,
}: {
  title: string;
  children: ReactNode;
  status?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card className="mb-4">
        <CardHeader>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="h-auto min-h-11 w-full justify-between whitespace-normal text-left">
              <span>
                {title}
                {status && <> · {status}</>}
              </span>
              <ChevronDown aria-hidden="true" className="shrink-0" />
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent forceMount hidden={!open}>
          <CardContent>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
