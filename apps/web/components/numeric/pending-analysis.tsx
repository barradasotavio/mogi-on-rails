"use client";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { settled } from "@/lib/settled";
export function PendingAnalysis({
  busy,
  onAnalyze,
}: {
  busy: boolean;
  onAnalyze: (cancelled: () => boolean) => Promise<void>;
}) {
  const stop = useRef(false);
  const [working, setWorking] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={busy || working}
        onClick={async () => {
          stop.current = false;
          setWorking(true);
          return settled(
            async () => {
              await onAnalyze(() => stop.current);
            },
            () => {
              setWorking(false);
            },
          );
        }}
      >
        Check Pending Races
      </Button>
      {working && (
        <>
          <p role="status" className="text-sm">
            Checking the available results…
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              stop.current = true;
            }}
          >
            Stop Checking
          </Button>
        </>
      )}
    </div>
  );
}
