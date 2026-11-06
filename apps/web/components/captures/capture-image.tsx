"use client";
import { ImageOff } from "lucide-react";
import { useEffect, useRef } from "react";

import { CaptureViewer, CaptureViewerTrigger } from "@/components/ui/capture-viewer";

/** A screenshot at full width; a tap opens it in the viewer. */
export function CaptureImage({
  original,
  alt = "Original result screenshot",
  label,
  width,
  height,
}: {
  original: Blob | null;
  alt?: string;
  label?: string;
  /** Reserves the image's space, so its loading doesn't lay out what follows again. */
  width?: number;
  height?: number;
}) {
  return (
    <CaptureViewer images={[{ original, alt, label }]}>
      <CaptureViewerTrigger>
        {original ? (
          <Screenshot original={original} alt={alt} width={width} height={height} />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
            Screenshot deleted to free space.
          </div>
        )}
      </CaptureViewerTrigger>
    </CaptureViewer>
  );
}

/** The screenshot itself at full width, for a `CaptureViewerTrigger` of a viewer with several images. */
export function Screenshot({
  original,
  alt,
  width,
  height,
}: {
  original: Blob;
  alt: string;
  width?: number;
  height?: number;
}) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(original);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [original]);
  return <img ref={image} alt={alt} width={width} height={height} className="h-auto w-full rounded-lg border" />;
}

/** Local thumbnail, its URL released when the row leaves the list. Decorative: the row already names the image. */
export function CaptureThumbnail({ original }: { original: Blob | null }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!original) return;
    const url = URL.createObjectURL(original);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [original]);
  if (!original) return <ImageOff aria-hidden="true" className="h-10 w-14 shrink-0 text-muted-foreground" />;
  return <img ref={image} alt="" className="h-10 w-14 shrink-0 rounded-md object-cover" />;
}
