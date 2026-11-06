import "@/app/globals.css";

import { answerNameQuestion } from "@mkw/engine";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { QuestionSheet } from "@/components/question-sheet";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { answerImageQuestion } from "@/lib/mogi/ingestion";
import { answerCurrentQuestion } from "@/lib/mogi/question-answers";
import { mogiQuestions } from "@/lib/mogi/questions";
import { loadTracker, saveTracker } from "@/lib/mogi/storage";
import type { TrackerState } from "@/lib/mogi/types";

declare global {
  interface Window {
    questionSession: {
      resolveCurrent: (index?: number) => Promise<void>;
      release: () => void;
      notifyReview: () => void;
    };
  }
}

// The host injects facts through the public API while confirmation awaits the write.
function Session({ original }: { original: Blob }) {
  const toast = useToast();
  const participants = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    loungeName: `Player ${i + 1}`,
    ign: i < 4 ? `Reading ${i + 1}` : `Player ${i + 1}`,
  }));
  const [state, setState] = useState<TrackerState>(() => {
    const initial: TrackerState = {
      version: 1,
      activeMogiId: "m",
      mogis: [
        {
          id: "m",
          name: "Mogi",
          createdAt: "2026-10-29",
          format: "FFA",
          participants,
          races: [{ id: "r", number: 1, origin: "observed", status: "pending", placements: [], captureIds: ["c"] }],
          captures: [
            {
              id: "c",
              fileName: "capture.jpeg",
              original,
              width: 1920,
              height: 1080,
              reviewedAt: "",
              reviewedPlacements: [],
              stage: "context",
              context: { phase: "after", raceId: "r" },
              rows: participants.map((person, i) => ({
                text: i < 4 ? `Reading ${i + 1}` : person.ign,
                confidence: 90,
                uncertain: i < 4,
                suggestedParticipantId: person.id,
              })),
              nameAssociations: participants.map((person, i) => ({ participantId: i < 4 ? null : person.id })),
            },
          ],
        },
      ],
    };
    if (!new URLSearchParams(window.location.search).has("image")) return initial;
    const capture = initial.mogis[0].captures![0];
    return {
      ...initial,
      sharedReceipts: [
        {
          id: "receipt",
          receivedAt: "2026-10-29",
          rejections: [],
          files: [{ id: "file", name: "image.jpeg", original, mimeType: "image/jpeg", lastModified: 0 }],
        },
      ],
      mogis: [
        {
          ...initial.mogis[0],
          captureReview: {
            version: 1,
            id: "review",
            currentItemId: "item",
            items: [
              {
                id: "item",
                source: { fileId: "file" },
                status: "ready",
                number: 1,
                association: "new",
                separation: "another mogi",
                recognition: { ...capture, id: "image-c" },
              },
            ],
          },
        },
      ],
    };
  });
  const latest = useRef(state);
  const release = useRef<() => void>(() => {});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    window.questionSession = {
      notifyReview: () => toast("Players changed", { label: "Open", onClick: () => setOpen(true) }),
      release: () => release.current(),
      resolveCurrent: async (index = 0) => {
        const mogi = latest.current.mogis[0],
          question = mogiQuestions(mogi)[index];
        if (question.kind !== "name" && question.kind !== "image") throw new Error("Expected a name or image question");
        const next =
          question.kind === "image"
            ? answerImageQuestion(latest.current, "m", question.id, "no")
            : {
                ...latest.current,
                mogis: [answerNameQuestion(mogi, question.id, { participantId: question.options[0].id })],
              };
        await saveTracker(next);
        latest.current = next;
        setState(next);
      },
    };
  }, [toast]);
  return (
    <QuestionSheet
      mogi={state.mogis[0]}
      pendingFiles={state.sharedReceipts?.flatMap((receipt) => receipt.files) ?? []}
      open={open}
      busy={busy}
      onOpenChange={setOpen}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onAnswer={async (shown, answer) => {
        setBusy(true);
        await new Promise<void>((resolve) => {
          release.current = resolve;
        });
        const before = latest.current;
        const next = await answerCurrentQuestion(before, "m", shown, answer);
        await saveTracker(next);
        latest.current = next;
        setState(next);
        setBusy(false);
        return next !== before;
      }}
    />
  );
}

export async function mountQuestionSession() {
  await loadTracker();
  const original = await (await fetch(new URL("./fixtures/spec29/finish-order-totals.jpeg", import.meta.url))).blob();
  createRoot(document.getElementById("root")!).render(
    <ToastProvider>
      <Session original={original} />
    </ToastProvider>,
  );
}
