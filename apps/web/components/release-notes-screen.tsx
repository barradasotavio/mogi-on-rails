"use client";

import { ArrowLeft } from "lucide-react";
import { createPortal } from "react-dom";

import { FloatingBar } from "@/components/ui/floating-bar";
import { GlassButton } from "@/components/ui/glass-button";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { MetadataBadge } from "@/components/ui/metadata";
import { MogiScrollBody } from "@/components/ui/mogi-scroll-body";
import { SidebarToggle, Toolbar } from "@/components/ui/toolbar";
import { releaseDate, releaseNotes } from "@/lib/release-notes";

/**
 * Release Notes: what changed, a section per date, newest first, each line labeled New or Fixed.
 * A destination beside the mogis, like Tracks: the toolbar on regular, Back in the floating bar on compact.
 * Lines wrap at any width and stay a readable measure on wide windows.
 */
export function ReleaseNotesScreen({
  visible,
  controlsContainer,
  mogisShown,
  onShowMogis,
  onBack,
}: {
  visible: boolean;
  controlsContainer: HTMLElement | null;
  mogisShown: boolean;
  onShowMogis: () => void;
  onBack: () => void;
}) {
  return (
    <section className="@container relative min-h-full">
      {visible &&
        controlsContainer &&
        createPortal(
          <>
            <Toolbar
              aria-label="Release Notes actions"
              leading={<SidebarToggle placement="toolbar" expanded={mogisShown} onClick={onShowMogis} />}
            />
            <FloatingBar className="mx-auto max-w-xl" aria-label="Release Notes actions">
              <GlassButton shape="circle" aria-label="Back" onClick={onBack}>
                <ArrowLeft aria-hidden="true" />
              </GlassButton>
            </FloatingBar>
          </>,
          controlsContainer,
        )}
      <MogiScrollBody>
        <header className="px-4">
          <h1
            data-mogi-title
            tabIndex={-1}
            className="text-xl font-semibold outline-none md:text-3xl md:font-bold md:tracking-tight"
          >
            Release Notes
          </h1>
        </header>
        {releaseNotes.map(({ date, changes }) => (
          <ListGroup key={date} inset title={<time dateTime={date}>{releaseDate(date)}</time>} className="max-w-prose">
            <List aria-label={releaseDate(date)}>
              {changes.map(({ kind, text }) => (
                <ListRow key={text} wrap>
                  <span className="flex items-start gap-3 py-2.5">
                    <span className="w-14 shrink-0 whitespace-nowrap">
                      <MetadataBadge tone={kind === "new" ? "attention" : "neutral"}>
                        {kind === "new" ? "New" : "Fixed"}
                      </MetadataBadge>
                    </span>
                    <span className="min-w-0">{text}</span>
                  </span>
                </ListRow>
              ))}
            </List>
          </ListGroup>
        ))}
      </MogiScrollBody>
    </section>
  );
}
