import { useEffect, useRef } from "react";

import { withBase } from "@/lib/base-path";

export function OpeningScreen({ done, onExited }: { done: boolean; onExited: () => void }) {
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!done) return;
    let cancelled = false;
    // Wait for the actual fade. With reduced motion (or no painted first frame),
    // there are no animations to wait for and no artificial minimum duration.
    const finish = () => {
      if (!cancelled) onExited();
    };
    void Promise.all((screen.current?.getAnimations() ?? []).map((animation) => animation.finished)).then(
      finish,
      finish,
    );
    return () => {
      cancelled = true;
    };
  }, [done, onExited]);
  return (
    <div
      ref={screen}
      role="status"
      aria-label="Opening Mogi on Rails"
      data-state={done ? "closed" : "open"}
      className="opening-screen fixed inset-0 z-50 flex items-center justify-center bg-background"
    >
      <img
        src={withBase("/icons/icon-512.png")}
        width={96}
        height={96}
        fetchPriority="high"
        alt=""
        className="opening-icon"
      />
    </div>
  );
}
