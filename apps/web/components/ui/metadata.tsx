import type { ReactNode } from "react";

import { Badge } from "@/vendor/shadcn/ui/badge";

export function MetadataGroup({ children }: { children: ReactNode }) {
  return <span className="flex min-w-0 flex-wrap items-start gap-2">{children}</span>;
}

export function MetadataBadge({
  label,
  children,
  tone = "neutral",
}: {
  label?: string;
  children: ReactNode;
  tone?: "neutral" | "attention" | "conflict";
}) {
  return (
    <Badge
      variant={tone === "conflict" ? "destructive" : tone === "attention" ? "default" : "secondary"}
      className="h-auto min-h-5 max-w-full min-w-0 shrink whitespace-normal text-left wrap-anywhere"
    >
      {label ? (
        <span>
          {label}: {children}
        </span>
      ) : (
        children
      )}
    </Badge>
  );
}
