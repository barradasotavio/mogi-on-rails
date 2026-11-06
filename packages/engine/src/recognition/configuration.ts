/** Shared metadata for the local browser recognizer and exported cases. */
export const recognitionConfiguration = {
  engine: "paddleocr.js",
  version: "0.4.2",
  language: "multilingual",
  model: "PP-OCRv6_tiny",
  mode: "WASM_SINGLE_THREAD",
  normalization: { width: 1920, height: 1080 },
  dictionaries: false,
  preparation: "original-color; percentile-contrast-only-when-empty",
} as const;
