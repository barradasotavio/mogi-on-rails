/** Browser-only recognition entry. Pure calculations do not load PaddleOCR or Canvas. */
export { type AssociatedNameRow, type AssociationParticipant, matchRows } from "./recognition/association.ts";
export { type RawRecognition, recognizeImage } from "./recognition/recognize.ts";
import { createLocalOCRReader } from "./recognition/worker.ts";

/** Warm the existing local model without exposing worker lifecycle to the product. */
export async function prepareRecognition(): Promise<void> {
  const worker = await createLocalOCRReader();
  worker.close();
}

export { recognitionConfiguration } from "./recognition/configuration.ts";
