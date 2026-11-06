import type { Screen } from "./screens.ts";
/** The value a numeric crop's text shows. OCR may split the digits into items joined by spaces: "1 2" shows 12. */
export function numericTextValue(text: string, addition = false): number | null {
  const compact = text.replace(/\s+/g, "");
  return (addition ? /^\+\d{1,2}$/ : /^\d{1,4}$/).test(compact) ? Number(compact.replace("+", "")) : null;
}
/** An observed crop stays immutable even after its interpretation is corrected. */
export interface NumericReading {
  text: string;
  value: number | null;
  confidence: number;
  uncertain: boolean;
  location: { x: number; y: number; width: number; height: number };
  alternatives?: { text: string; value: number | null; confidence: number }[];
}
export interface CaptureInterpretation {
  version: 1;
  screen: Screen;
  origin: "visual" | "user";
  /** Readings of the displayed positions, separate from source row ordinals. */
  positions: NumericReading[];
  movementRows: number[];
  /** Only a complete native addition vector is an integral race gain. */
  currentScale?: 10 | 11 | 12;
  /** Occupied extent supported by names/ranks or consistent native addition votes. */
  represented?: 10 | 11 | 12;
  /** Rows alone suggest an extent; scales, votes and answers establish it. */
  representedBy?: "scale" | "vote" | "rows" | "user";
  nextTrack?: {
    text: string;
    confidence: number;
    uncertain: boolean;
    location?: NumericReading["location"];
    alternatives?: { text: string; confidence: number }[];
  };
  groups?: { rows: number[]; total?: NumericReading; label?: string }[];
  reasons: string[];
}

export interface CaptureNumericRow {
  row: number;
  right: NumericReading;
  addition: NumericReading;
}
export interface ObservedNameRow {
  bounds?: NumericReading["location"];
  text: string;
  confidence: number;
  location?: NumericReading["location"];
  alternatives?: { text: string; confidence: number }[];
}
/** Raw image observations; association to a confirmed participant belongs to analysis. */
export interface CaptureObservation {
  id: string;
  width: number;
  height: number;
  rows: ObservedNameRow[];
  interpretation: CaptureInterpretation;
  numericRows: CaptureNumericRow[];
  numericStageSuggestion?: "points-only" | "animation" | "unverified";
  unreadableRowNumbers?: number[];
}
