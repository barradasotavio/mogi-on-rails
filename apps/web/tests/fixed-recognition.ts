import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

// Real recognizeImage output for each fixture, read in development Chrome. When recognition changes, regenerate it with
// `UPDATE_RECOGNITIONS=1 npm run test:focused -- tests/fixed-recognition.spec.ts`.
const readings = JSON.parse(readFileSync(new URL("./fixtures/recognitions.json", import.meta.url), "utf8")) as Record<
  string,
  unknown
>;

/**
 * Replaces OCR in this page with the saved readings of the fixtures (development server only; `recognizeCapture`
 * keys them by SHA-256). Call before the first navigation. Real OCR stays covered by `recognition-contract` and
 * `paddle-runtime`; an image without a saved reading fails to read.
 */
export async function useFixedRecognition(page: Page) {
  const byHash = Object.fromEntries(
    Object.entries(readings).map(([name, reading]) => [
      createHash("sha256")
        .update(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
        .digest("hex"),
      reading,
    ]),
  );
  await page.addInitScript((fixed) => {
    (globalThis as { mkwFixedRecognitions?: unknown }).mkwFixedRecognitions = fixed;
  }, byHash);
}
