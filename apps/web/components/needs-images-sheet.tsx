"use client";
import type { MogiNeedsImagesReason, MogiRacePosition } from "@mkw/engine";
import { ImagePlus } from "lucide-react";

import { GlassButton } from "@/components/ui/glass-button";
import { Sheet } from "@/components/ui/sheet";

const reasons: Record<MogiNeedsImagesReason, string> = {
  "fewer-players": "This race had fewer than 12 players, so its points can't be worked out from later totals.",
  "no-later-totals": "No screenshot shows enough of this race to work out its points.",
};

/**
 * Reason for a ghost race and its two ways out: images, or the result typed by hand when no image
 * can prove the race (Enter Result opens Edit Result with every place empty).
 */
export function NeedsImagesSheet({
  position,
  busy = false,
  onOpenChange,
  onAddImages,
  onEnterResult,
  onCloseAutoFocus,
}: {
  position: MogiRacePosition | null;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onAddImages: () => void;
  onEnterResult: (position: MogiRacePosition) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const reason = position?.needsImages?.reason ?? "no-later-totals";
  return (
    <Sheet
      kind="detail"
      height="fit"
      open={!!position}
      onOpenChange={onOpenChange}
      title={position ? `Race ${position.number} Needs a Screenshot` : ""}
      onCloseAutoFocus={onCloseAutoFocus}
      footer={
        <div className="flex flex-col gap-2">
          <GlassButton shape="pill" tint className="w-full" onClick={onAddImages}>
            <ImagePlus aria-hidden="true" />
            Add Screenshots
          </GlassButton>
          <GlassButton
            shape="pill"
            className="w-full"
            disabled={busy}
            onClick={() => {
              if (position) onEnterResult(position);
            }}
          >
            Enter Result
          </GlassButton>
        </div>
      }
    >
      <p className="pb-4 text-center text-muted-foreground">{reasons[reason]}</p>
    </Sheet>
  );
}
