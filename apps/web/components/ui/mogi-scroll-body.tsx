import type { ReactNode } from "react";

/** Reserves the controls' space; the mask belongs to the scrolling main. */
export function MogiScrollBody({ children }: { children: ReactNode }) {
  return (
    <div className="section-stack mx-auto max-w-xl pb-28 pt-6 md:max-w-5xl md:pb-16 md:toolbar-clearance">
      {children}
    </div>
  );
}
