import type { CaptureInterpretation, NumericReading, ObservedNameRow } from "./observations.ts";
import { screenProperties } from "./screens.ts";

/** Normalized bounds of the whole row; also reads captures older than the bounds field. */
export function captureRowBounds(
  capture: {
    rows: Pick<ObservedNameRow, "bounds" | "location">[];
    interpretation?: Pick<CaptureInterpretation, "screen">;
  },
  row: number,
  margin = 0,
): NumericReading["location"] {
  const reading = capture.rows[row - 1];
  const location = reading?.location ?? { x: 1270, y: 50 + (row - 1) * 77, width: 385, height: 56 };
  const preRace = screenProperties(capture.interpretation?.screen)?.moment === "before";
  const width = Math.round(location.width * 2.02),
    height = Math.round((width * 44) / 445);
  const bounds =
    reading?.bounds ??
    (preRace
      ? { x: location.x - 95, y: location.y - 10, width: 490, height: 67 }
      : {
          x: Math.max(0, Math.round(location.x - location.width * 0.556)),
          y: Math.max(0, Math.round(location.y + (location.height - height) / 2)),
          width,
          height,
        });
  const x = Math.max(0, bounds.x - margin),
    y = Math.max(0, bounds.y - margin);
  return {
    x,
    y,
    width: Math.min(1920, bounds.x + bounds.width + margin) - x,
    height: Math.min(1080, bounds.y + bounds.height + margin) - y,
  };
}
