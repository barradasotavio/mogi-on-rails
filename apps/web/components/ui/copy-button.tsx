"use client";

import { Check, Copy, Download, Image as ImageIcon, type LucideIcon } from "lucide-react";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";

import { GlassButton } from "@/components/ui/glass-button";
import { ListRow } from "@/components/ui/list";
import { TileButton } from "@/components/ui/tile-button";

export type CopyContent =
  { kind: "text"; text: () => string | Promise<string> } | { kind: "image"; image: () => Promise<Blob> };

/** How long a copy action shows "Copied" before it returns to its label. */
export const copiedDuration = 1500;

async function copy(content: CopyContent) {
  if (content.kind === "text") return navigator.clipboard.writeText(await content.text());
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
    throw new Error("This browser can't copy images.");
  // The promise goes straight into the ClipboardItem: Safari only accepts the write within the gesture.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": content.image() })]);
}

async function save(content: CopyContent, filename: string) {
  const blob =
    content.kind === "text" ? new Blob([await content.text()], { type: "text/plain" }) : await content.image();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The only path to the clipboard. `run` copies and shows "Copied" for 1.5 s; `status` is the polite
 * region that announces it, rendered beside the control (inside the sheet, so a modal never hides it).
 */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const run = async (content: CopyContent): Promise<{ ok: true } | { ok: false; cause: unknown }> => {
    clearTimeout(timer.current);
    try {
      await copy(content);
    } catch (cause) {
      setCopied(false);
      return { ok: false, cause };
    }
    setCopied(true);
    setAnnouncement("Copied");
    timer.current = window.setTimeout(() => {
      setCopied(false);
      setAnnouncement("");
    }, copiedDuration);
    return { ok: true };
  };
  const announce = (text: string) => setAnnouncement(text);
  const status = (
    <span role="status" className="sr-only">
      {announcement}
    </span>
  );
  return { copied, run, announce, status };
}

/** Every candidate label shares one grid cell, so swapping to "Copied" never changes the width. */
function StableLabel({ current, candidates }: { current: string; candidates: string[] }) {
  return (
    <span className="grid text-center">
      {[...new Set([current, ...candidates])].map((text) => (
        <span
          key={text}
          className={text === current ? "col-start-1 row-start-1" : "invisible col-start-1 row-start-1"}
          aria-hidden={text === current ? undefined : true}
        >
          {text}
        </span>
      ))}
    </span>
  );
}

const failureText = (content: CopyContent) =>
  content.kind === "image" ? "Couldn't copy the image. Use Save Image." : "Couldn't copy the text. Use Save Text.";

/**
 * A copy action: "Copied" with a check for 1.5 s, announced. If the browser can't copy, the same button
 * saves the file instead. `onFeedback` receives the failure sentence (`copyFailure` names what failed;
 * null when an attempt starts) so a surface can show it inline; without it, the button announces the
 * failure itself. `onCopyFailed`
 * replaces the switch to saving, for a control whose alternative lives elsewhere.
 */
export function CopyButton({
  content,
  label,
  filename,
  appearance = "glass",
  tone = "neutral",
  icon,
  iconOnly = false,
  className,
  disabled,
  initialAction = "copy",
  copyFailure,
  onFeedback,
  onCopyFailed,
  ref,
}: {
  content: CopyContent;
  label: string;
  filename: string;
  copyFailure?: string;
  appearance?: "glass" | "tile" | "toolbar";
  tone?: "neutral" | "primary";
  icon?: LucideIcon;
  iconOnly?: boolean;
  className?: string;
  disabled?: boolean;
  initialAction?: "copy" | "save";
  onFeedback?: (failure: string | null, cause?: unknown) => void;
  onCopyFailed?: (cause: unknown) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { copied, run, announce, status } = useCopy();
  const [saving, setSaving] = useState(initialAction === "save");
  const report = (failure: string, cause?: unknown) => {
    if (onFeedback) onFeedback(failure, cause);
    else announce(failure);
  };
  const act = async () => {
    onFeedback?.(null);
    if (saving) {
      try {
        await save(content, filename);
      } catch (cause) {
        report("Couldn't save the file. Try again.", cause);
      }
      return;
    }
    const result = await run(content);
    if (result.ok) return;
    if (onCopyFailed) {
      onCopyFailed(result.cause);
      return;
    }
    setSaving(true);
    report(copyFailure ?? failureText(content), result.cause);
  };
  const saveLabel = `Save ${content.kind === "image" ? "Image" : "Text"}`;
  const Icon = copied ? Check : saving ? Download : (icon ?? (content.kind === "image" ? ImageIcon : Copy));
  const text = copied ? "Copied" : saving ? saveLabel : label;
  const stable = <StableLabel current={text} candidates={[label, "Copied", ...(onCopyFailed ? [] : [saveLabel])]} />;
  // In the toolbar the label can collapse to the symbol (`toolbar-label`), staying the accessible name.
  const body: ReactNode = iconOnly ? (
    <Icon aria-hidden="true" />
  ) : (
    <>
      <Icon aria-hidden="true" />
      {appearance === "toolbar" ? <span className="toolbar-label">{stable}</span> : stable}
    </>
  );
  const shared = { ref, disabled, onClick: () => void act(), "aria-label": iconOnly ? text : undefined };
  return (
    <>
      {appearance === "tile" ? (
        <TileButton {...shared} tone={tone} className={className}>
          {body}
        </TileButton>
      ) : appearance === "toolbar" ? (
        <GlassButton {...shared} density="toolbar" className={className}>
          {body}
        </GlassButton>
      ) : (
        <GlassButton {...shared} tint shape={iconOnly ? "circle" : "pill"} className={className}>
          {body}
        </GlassButton>
      )}
      {status}
    </>
  );
}

/** A copy command inside a list: the row's symbol becomes a check and its title "Copied" for 1.5 s. */
export function CopyRow({
  content,
  label,
  icon: RowIcon,
  disabled,
  onFeedback,
  failure,
}: {
  content: CopyContent;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  onFeedback: (failure: string | null, cause?: unknown) => void;
  failure: string;
}) {
  const { copied, run, status } = useCopy();
  const Icon = copied ? Check : RowIcon;
  return (
    <ListRow
      lead={<Icon className="size-5" aria-hidden="true" />}
      disabled={disabled}
      after={status}
      onSelect={() =>
        void (async () => {
          onFeedback(null);
          const result = await run(content);
          if (!result.ok) onFeedback(failure, result.cause);
        })()
      }
    >
      {copied ? "Copied" : label}
    </ListRow>
  );
}
