import "@/app/globals.css";

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MogiDetail } from "@/components/mogi-detail";
import { ToastProvider } from "@/components/ui/toast";
import type { Mogi } from "@/lib/mogi/types";

declare global {
  interface Window {
    projectionCalls: { questions: number; overview: number };
    renderProbe: (action: "busy" | "reading" | "revision") => void;
  }
}

function Probe() {
  const [mogi, setMogi] = useState<Mogi>({
    id: "render",
    name: "Mogi",
    createdAt: "2026-10-29",
    format: "FFA",
    races: [],
    participants: Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      loungeName: `Player ${i}`,
      ign: `Player ${i}`,
    })),
  });
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(0);
  useEffect(() => {
    window.renderProbe = (action) => {
      if (action === "busy") setBusy((value) => !value);
      if (action === "reading") setReading((value) => value + 1);
      if (action === "revision") setMogi((value) => ({ ...value, name: "Revised" }));
    };
  }, []);
  const noop = () => {};
  const accept = async () => true;
  return (
    <MogiDetail
      mogi={mogi}
      busy={busy}
      pendingFiles={[]}
      activity={reading ? { reading: { current: reading, total: 13, numbers: [reading] } } : {}}
      onCloseEditor={noop}
      onQuestions={noop}
      onQuestionAnswer={accept}
      onAddImages={noop}
      onBack={noop}
      onShowMogis={noop}
      onConcurrentWrite={noop}
      onUpdate={accept}
      onRemoveSource={accept}
      onIgnChange={accept}
      onCorrectNames={noop}
      onEditContext={noop}
      onSequenceAnswer={accept}
      onEdit={noop}
      onEnterResult={noop}
      onResumeDraft={noop}
      onDiscardDraft={accept}
      onRevertToScreenshots={accept}
      onDelete={accept}
    />
  );
}

export function mountMogiRender() {
  window.projectionCalls = { questions: 0, overview: 0 };
  createRoot(document.getElementById("root")!).render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  );
}
