export interface TextReading {
  text: string;
  confidence: number;
  alternatives: { text: string; confidence: number }[];
}
export interface OCRReader {
  read(
    canvas: HTMLCanvasElement,
    location: { x: number; y: number; width: number; height: number },
  ): Promise<TextReading>;
  close(): void;
}
interface Runtime {
  predict(canvas: HTMLCanvasElement): Promise<{ items: { text: string; score: number }[] }[]>;
}
// The app may be served under a sub-path (BASE_PATH); Vite replaces this in the bundle.
const ocrBase = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"}ocr/`;
let runtime: Promise<Runtime> | undefined;
let queue: Promise<unknown> = Promise.resolve();
async function getRuntime() {
  if (!runtime)
    runtime = (async () => {
      const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
      // Preparation writes the pair chosen by OCR_MODEL to ocr/models.json.
      const staged = (await (await fetch(`${location.origin}${ocrBase}models.json`)).json()) as { name: string }[];
      const detection = staged.find((model) => model.name.endsWith("_det"))?.name,
        recognition = staged.find((model) => model.name.endsWith("_rec"))?.name;
      if (!detection || !recognition) throw new Error("OCR models are missing.");
      return PaddleOCR.create({
        worker: { createWorker: () => new Worker(`${ocrBase}paddle-worker.js`, { type: "module" }) },
        textDetectionModelName: detection,
        textRecognitionModelName: recognition,
        textDetectionModelAsset: { url: `${location.origin}${ocrBase}${detection}.tar` },
        textRecognitionModelAsset: { url: `${location.origin}${ocrBase}${recognition}.tar` },
        ortOptions: { backend: "wasm", numThreads: 1, wasmPaths: `${location.origin}${ocrBase}` },
        textRecScoreThresh: 0,
      });
    })().catch((error) => {
      runtime = undefined;
      throw error;
    });
  return runtime;
}
export function contrastCrop(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height),
    histogram = new Uint32Array(256);
  for (let n = 0; n < gray.length; n++) {
    gray[n] = Math.round(image.data[n * 4] * 0.299 + image.data[n * 4 + 1] * 0.587 + image.data[n * 4 + 2] * 0.114);
    histogram[gray[n]]++;
  }
  let low = 0,
    high = 255,
    count = 0;
  for (; low < 255; low++) {
    count += histogram[low];
    if (count >= gray.length * 0.01) break;
  }
  count = 0;
  for (; high > low; high--) {
    count += histogram[high];
    if (count >= gray.length * 0.01) break;
  }
  for (let n = 0; n < gray.length; n++) {
    const value = Math.round(Math.max(0, Math.min(255, ((gray[n] - low) * 255) / Math.max(1, high - low))));
    image.data[n * 4] = image.data[n * 4 + 1] = image.data[n * 4 + 2] = value;
  }
  context.putImageData(image, 0, 0);
}
/** One shared OCR runtime; each caller owns a cancellable lease. Reads are serialized. */
export async function createLocalOCRReader(): Promise<OCRReader> {
  const loaded = await getRuntime();
  let closed = false;
  const check = () => {
    if (closed) throw new DOMException("Cancelled", "AbortError");
  };
  return {
    close() {
      closed = true;
    },
    read(canvas, region) {
      const job = queue.then(async () => {
        check();
        const crop = document.createElement("canvas");
        crop.width = region.width;
        crop.height = region.height;
        const context = crop.getContext("2d");
        if (!context) throw new Error("Couldn't prepare the crop.");
        context.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, crop.width, crop.height);
        const alternatives: TextReading["alternatives"] = [];
        for (let pass = 0; pass < 2; pass++) {
          check();
          if (pass) contrastCrop(crop);
          const [result] = await loaded.predict(crop);
          check();
          if (!result) throw new Error("Recognition returned no result.");
          const reading = {
            text: result.items
              .map((item) => item.text)
              .join(" ")
              .trim(),
            confidence: result.items.length ? Math.round(Math.min(...result.items.map((item) => item.score)) * 100) : 0,
          };
          alternatives.push(reading);
          if (reading.text) return { ...reading, alternatives };
        }
        return { ...alternatives[alternatives.length - 1], alternatives };
      });
      queue = job.catch(() => undefined);
      return job;
    },
  };
}
