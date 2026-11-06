import { compressImage, webpSupported } from "../images/compressed";
import { type CompressedResult, pendingImages } from "./compression";
import type { TrackerState } from "./types";

/** One session, one image at a time, and one quiet transaction per mogi. */
export function compressionJob(options: {
  state: () => TrackerState;
  canRun: () => boolean;
  write: (results: CompressedResult[]) => Promise<boolean>;
}) {
  const failed = new WeakSet<Blob>();
  let running = false;
  let requested = false;
  let disposed = false;
  const canRun = () => !disposed && options.canRun();
  async function run() {
    if (!canRun() || !(await webpSupported())) return;
    while (canRun()) {
      const pending = pendingImages(options.state()).filter((image) => !failed.has(image.original));
      if (!pending.length) return;
      const batch = pending.filter((image) => image.mogiId === pending[0].mogiId);
      const results: CompressedResult[] = [];
      for (const image of batch) {
        // Let input and OCR activity updates run before starting another decode.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!canRun()) return;
        if (
          !pendingImages(options.state()).some(
            (current) =>
              current.mogiId === image.mogiId &&
              current.kind === image.kind &&
              current.id === image.id &&
              current.original === image.original,
          )
        )
          continue;
        const result = await compressImage(image.original);
        if (result) results.push({ ...image, ...result });
        else failed.add(image.original);
      }
      if (!canRun()) return;
      // A write failure waits for a later state change/launch, without retrying in a hot loop.
      if (results.length && !(await options.write(results))) {
        requested = false;
        return;
      }
    }
  }
  return {
    wake() {
      requested = true;
      if (running || disposed) return;
      running = true;
      void (async () => {
        try {
          do {
            requested = false;
            await run();
          } while (requested && canRun());
        } catch {
          /* Background failures leave originals pending for the next state change. */
        } finally {
          running = false;
        }
      })();
    },
    dispose() {
      disposed = true;
    },
  };
}
