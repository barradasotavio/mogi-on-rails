"use client";

import { Screenshot } from "@/components/captures/capture-image";
import { CaptureViewer, CaptureViewerTrigger } from "@/components/ui/capture-viewer";
import { GlassButton } from "@/components/ui/glass-button";
import { Sheet } from "@/components/ui/sheet";
import { type KnownOriginal, repeatedImages } from "@/lib/images/gallery";

export interface PastedScreenshot {
  file: File;
  width?: number;
  height?: number;
  /** Already stored: null in this mogi, else the other mogi's name. */
  repeated?: string | null;
}
/** A paste carries its time, which stands for the photo's; images from a watched folder keep their own dates. */
export interface Paste {
  shots: PastedScreenshot[];
  pastedAt?: number;
}

/** Reads what the sheet shows before it opens, so it opens at its size: dimensions and repetition. */
export async function inspectPaste(files: File[], known: KnownOriginal[], pastedAt?: number): Promise<Paste> {
  const repeated = await repeatedImages(files, known);
  const shots = await Promise.all(
    files.map(async (file, index) => {
      try {
        const bitmap = await createImageBitmap(file);
        const { width, height } = bitmap;
        bitmap.close();
        return { file, width, height, repeated: repeated[index] };
      } catch {
        // Intake rejects it with its own message on Add to Mogi.
        return { file, repeated: repeated[index] };
      }
    }),
  );
  return { shots, pastedAt };
}

/**
 * Confirms what was on the clipboard, or what arrived in a watched folder, before it counts. Nothing is stored
 * until Add to Mogi, which hands the new screenshots to intake; a screenshot already stored is shown, says
 * where, and is not offered.
 */
export function PastedScreenshotsSheet({
  paste,
  busy,
  onAdd,
  onOpenChange,
  onCloseAutoFocus,
}: {
  paste: Paste | null;
  busy: boolean;
  onAdd: (files: File[], pastedAt?: number) => void;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const shots = paste?.shots ?? [];
  const many = shots.length > 1;
  const fresh = shots.filter((shot) => shot.repeated === undefined);
  // A paste has its time; images from a folder are new screenshots.
  const noun = paste?.pastedAt === undefined ? "New" : "Pasted";
  const alt = (index: number) => (many ? `${noun} screenshot ${index + 1}` : `${noun} screenshot`);
  return (
    <Sheet
      kind="modal"
      height={many ? "full" : "fit"}
      open={!!paste}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={many ? `${shots.length} ${noun} Screenshots` : `${noun} Screenshot`}
      footer={
        fresh.length > 0 && (
          <div className="flex flex-col gap-2">
            <GlassButton
              shape="pill"
              tint
              className="w-full"
              disabled={busy}
              onClick={() =>
                onAdd(
                  fresh.map((shot) => shot.file),
                  paste?.pastedAt,
                )
              }
            >
              Add to Mogi
            </GlassButton>
            <GlassButton shape="pill" className="w-full" onClick={() => onOpenChange(false)}>
              Cancel
            </GlassButton>
          </div>
        )
      }
    >
      <CaptureViewer
        images={shots.map((shot, index) => ({
          original: shot.file,
          alt: alt(index),
          label: many ? alt(index) : undefined,
        }))}
      >
        <div className="flex flex-col gap-4 pb-4">
          {/* A repeated image carries its note on itself, dimmed: a caption between images reads as either one's. */}
          {shots.map((shot, index) => (
            <figure key={index} className="relative">
              <CaptureViewerTrigger index={index} label={`Enlarge ${alt(index).toLowerCase()}`}>
                <span className={shot.repeated === undefined ? "block" : "block opacity-50"}>
                  <Screenshot original={shot.file} alt={alt(index)} width={shot.width} height={shot.height} />
                </span>
              </CaptureViewerTrigger>
              {shot.repeated !== undefined && (
                <figcaption className="pointer-events-none absolute inset-0 flex items-center justify-center p-3">
                  <span className="glass truncate rounded-full px-4 py-2 text-sm font-semibold">
                    Already in {shot.repeated ?? "this mogi"}
                  </span>
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </CaptureViewer>
    </Sheet>
  );
}
