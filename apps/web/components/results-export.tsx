"use client";
import { loungeSubmission } from "@mkw/engine";
import { Copy, Download, Image as ImageIcon, Share } from "lucide-react";
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { CopyButton, CopyRow } from "@/components/ui/copy-button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { sharingText, submissionBlockerText, tablePng } from "@/lib/mogi/exports";
import { assertTrackerCurrent } from "@/lib/mogi/storage";
import type { Mogi } from "@/lib/mogi/types";
import { fail } from "@/lib/settled";

// The image follows the applied theme, including when the preference follows the system.
function subscribeTheme(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const readTheme = () => document.documentElement.classList.contains("dark");
const serverTheme = () => false;
const staleMessage = "The data changed. Reload before exporting.";

type ExportOptions = {
  mogi: Mogi;
  resultMogi?: Mogi;
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  saving: boolean;
  /** While false, Export keeps no preview and resets on the next opening. */
  open: boolean;
  /** Opened to save the text: the header's copy just failed. */
  saveText?: boolean;
};

/** Export on its own sheet: the header's Copy !submit falls back to it on Save Text. */
export function ResultsExport({
  onOpenChange,
  onCloseAutoFocus,
  ...options
}: ExportOptions & {
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: ComponentProps<typeof Sheet>["onCloseAutoFocus"];
}) {
  const exported = useResultsExport(options);
  return (
    <Sheet
      blocksUpdates={false}
      open={options.open}
      onOpenChange={onOpenChange}
      kind="detail"
      title="Export"
      onCloseAutoFocus={onCloseAutoFocus}
      initialFocus={options.saveText ? exported.saveRef : undefined}
      footer={exported.footer}
    >
      {exported.body}
    </Sheet>
  );
}

/** Export's preview, tier, !submit and actions, for a sheet of its own or a page of another sheet (Mogi Settings). */
export function useResultsExport({
  mogi: liveMogi,
  resultMogi: liveResult = liveMogi,
  onUpdate,
  saving,
  open,
  saveText = false,
}: ExportOptions) {
  // Closed, Export keeps what it last showed, for the exit animation, and follows no saves: the mogi screen
  // saves often, and the submission rule and the serialized mogi would run on each one.
  const [shown, setShown] = useState<{ mogi: Mogi; resultMogi: Mogi } | null>(null);
  const mogi = open ? liveMogi : (shown?.mogi ?? liveMogi);
  const resultMogi = open ? liveResult : (shown?.resultMogi ?? liveResult);
  const drawn = open || !!shown;
  const submission = useMemo(() => (drawn ? loungeSubmission(resultMogi) : null), [drawn, resultMogi]);
  const saveRef = useRef<HTMLButtonElement>(null);
  const [tier, setTier] = useState(mogi.submissionTier ?? "");
  const dark = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  const signature = useMemo(() => (drawn ? `${JSON.stringify(mogi)}:${dark}` : ""), [drawn, mogi, dark]);
  type ImageSnapshot = { blob: Blob; url: string };
  const [snapshot, setSnapshot] = useState<{ signature: string; image: ImageSnapshot | null }>({
    signature,
    image: null,
  });
  // Returning to the same data must not revive the image of an earlier generation.
  if (snapshot.signature !== signature) setSnapshot({ signature, image: null });
  const image = snapshot.image;
  const currentImage = snapshot.signature === signature ? image : null;
  const generation = useRef(0);
  const invalidateGeneration = useCallback(() => {
    generation.current++;
  }, []);
  const [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);
  // The failure of the last copy, share or save, shown under the actions until the next attempt.
  const [failure, setFailure] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setShown(open ? null : { mogi: liveMogi, resultMogi: liveResult });
    if (open) {
      setTier(mogi.submissionTier ?? "");
      setMessage("");
      setStale(false);
      // Opened to save the text: the header's copy just failed.
      setFailure(saveText ? "Couldn't copy !submit. Use Save Text." : null);
    }
  }
  // A stale result already explains itself in the message below; it is not a copy failure.
  const feedback = (next: string | null, cause?: unknown) =>
    setFailure(cause instanceof Error && cause.message === staleMessage ? null : next);
  const tierDirty = tier.trim() !== (mogi.submissionTier ?? "").trim();
  const disabled = saving || stale || tierDirty;
  useEffect(() => {
    if (!open) return;
    let active = true;
    const request = ++generation.current;
    void (async () => {
      try {
        await assertTrackerCurrent();
        const blob = await tablePng(mogi);
        await assertTrackerCurrent();
        if (active && request === generation.current) {
          setSnapshot({ signature, image: { blob, url: URL.createObjectURL(blob) } });
        }
      } catch {
        if (active && request === generation.current)
          setMessage("Couldn't create the preview. Reopen Export to try again.");
      }
    })();
    return () => {
      active = false;
      invalidateGeneration();
    };
  }, [open, mogi, signature, invalidateGeneration]);
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );

  async function currentResult(expected?: number) {
    expected = expected ?? generation.current;
    try {
      await assertTrackerCurrent();
      if (expected !== generation.current) fail(staleMessage);
    } catch {
      generation.current++;
      setSnapshot({ signature, image: null });
      setStale(true);
      setMessage(staleMessage);
      throw new Error(staleMessage);
    }
  }
  async function submissionText() {
    await currentResult();
    if (!submission?.available) throw new Error("The final result isn't available yet.");
    return submission.text;
  }
  async function imageBlob() {
    await currentResult();
    if (!currentImage) throw new Error("The image isn't ready yet.");
    return currentImage.blob;
  }
  async function saveTier() {
    if (!tierDirty) return;
    if (await onUpdate({ ...mogi, submissionTier: tier.trim() })) setMessage("");
    else setMessage("Couldn't save the tier. Try again.");
  }
  async function shareText() {
    await currentResult();
    return sharingText(mogi);
  }
  async function saveImage() {
    setFailure(null);
    try {
      await currentResult();
      if (!currentImage) return;
      const link = document.createElement("a");
      link.href = currentImage.url;
      link.download = "mkw-results.png";
      link.click();
    } catch {
      /* The check above shows the update message. */
    }
  }
  async function shareImage() {
    setFailure(null);
    try {
      const blob = await imageBlob();
      const file = new File([blob], "mkw-results.png", { type: "image/png" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        setFailure("Couldn't share. Use Save Image.");
        return;
      }
      await navigator.share({ files: [file], title: mogi.name });
    } catch (cause) {
      // Closing the share sheet is a choice, not a failure.
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      feedback("Couldn't share. Use Save Image.", cause);
    }
  }
  if (!submission) return { saveRef, footer: null, body: null };
  return {
    saveRef,
    footer: (
      <CopyButton
        key={`${open}:${saveText}:${submission.available}`}
        ref={saveRef}
        initialAction={saveText ? "save" : "copy"}
        appearance="glass"
        className="w-full"
        content={submission.available ? { kind: "text", text: submissionText } : { kind: "image", image: imageBlob }}
        label={submission.available ? "Copy !submit" : "Copy Table"}
        filename={submission.available ? "mkw-submit.txt" : "mkw-results.png"}
        copyFailure={
          submission.available ? "Couldn't copy !submit. Use Save Text." : "Couldn't copy the image. Use Save Image."
        }
        onFeedback={feedback}
        disabled={disabled || (submission.available ? !mogi.submissionTier?.trim() : !currentImage)}
      />
    ),
    body: (
      <>
        {currentImage ? (
          <img src={currentImage.url} alt="Table preview" className="w-full rounded-xl" />
        ) : (
          <p className="text-sm text-muted-foreground">{message ? "Preview unavailable." : "Creating preview…"}</p>
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="command-tier">Tier</FieldLabel>
            <Input
              id="command-tier"
              variant="filled"
              value={tier}
              maxLength={20}
              disabled={saving}
              onChange={(event) => setTier(event.target.value)}
              onBlur={() => void saveTier()}
              aria-describedby={!tier.trim() ? "command-tier-help" : undefined}
            />
            {!tier.trim() && <FieldDescription id="command-tier-help">Enter a tier to copy !submit.</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="lounge-command">!submit</FieldLabel>
            <Textarea
              id="lounge-command"
              variant="filled"
              className="max-h-64"
              rows={7}
              readOnly
              value={submission.available ? submission.text : submissionBlockerText(resultMogi, submission.blockers)}
            />
          </Field>
        </FieldGroup>
        <ListGroup>
          <List>
            {submission.available && (
              <CopyRow
                icon={ImageIcon}
                label="Copy Image"
                disabled={disabled || !currentImage}
                content={{ kind: "image", image: imageBlob }}
                onFeedback={feedback}
                failure="Couldn't copy the image. Use Save Image."
              />
            )}
            <CopyRow
              icon={Copy}
              label="Copy Share Text"
              disabled={disabled}
              content={{ kind: "text", text: shareText }}
              onFeedback={feedback}
              failure="Couldn't copy the share text. Try again."
            />
            <ListRow
              lead={<Download className="size-5" aria-hidden="true" />}
              disabled={disabled || !currentImage}
              onSelect={() => void saveImage()}
            >
              Save Image
            </ListRow>
            {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
              <ListRow
                lead={<Share className="size-5" aria-hidden="true" />}
                disabled={disabled || !currentImage}
                onSelect={() => void shareImage()}
              >
                Share
              </ListRow>
            )}
          </List>
        </ListGroup>
        {failure && (
          <Alert variant="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
        {message && (
          <Alert>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
      </>
    ),
  };
}
