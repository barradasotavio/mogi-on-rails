"use client";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
export function SourceActions({
  label,
  busy,
  onRemove,
}: {
  label: string;
  busy: boolean;
  onRemove: () => Promise<boolean>;
}) {
  const [error, setError] = useState("");
  async function act(action: () => Promise<boolean>) {
    setError("");
    if (!(await action())) setError("Couldn't remove the screenshot. Review the latest data and try again.");
  }
  return (
    <div className="space-y-2">
      <Button
        variant="destructive-ghost"
        disabled={busy}
        aria-label={`Remove ${label}`}
        onClick={() => void act(onRemove)}
      >
        Remove Screenshot
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
