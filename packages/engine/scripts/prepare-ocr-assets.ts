import { copyFile, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import models from "./paddle-models.json" with { type: "json" };
const require = createRequire(import.meta.url);
export const dependencyAsset = (file: string) => {
  for (const directory of require.resolve.paths(file) ?? []) {
    const candidate = path.join(directory, file);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing local dependency asset: ${file}`);
};
/** OCR_MODEL=tiny|small selects the staged detection/recognition pair; Tiny is the default, Small is for comparison. */
export function selectedOCRModel() {
  const model = process.env.OCR_MODEL ?? "tiny";
  if (model !== "small" && model !== "tiny") throw new Error(`Invalid OCR_MODEL: ${model}`);
  return model;
}
/** Pin official model bytes; stage only the selected model and the matching worker/WASM, never a CDN runtime. */
export async function prepareOCRAssets(destination: string) {
  await mkdir(destination, { recursive: true });
  const selected = models.filter((model) => model.name.includes(`_${selectedOCRModel()}_`));
  // A previous build with another model must not leave orphaned archives in the offline inventory.
  for (const file of await readdir(destination))
    if (/^PP-OCRv6_.*\.tar$/.test(file) && !selected.some((model) => file === `${model.name}.tar`))
      await rm(path.join(destination, file));
  const cache = path.resolve(import.meta.dirname, "../.ocr-cache");
  await mkdir(cache, { recursive: true });
  for (const model of selected) {
    const source = path.join(cache, model.name, model.revision);
    await mkdir(source, { recursive: true });
    for (const file of model.files) {
      const target = path.join(source, file.name);
      let bytes: Buffer;
      try {
        bytes = await readFile(target);
      } catch {
        const url = `https://huggingface.co/PaddlePaddle/${model.name}_onnx/resolve/${model.revision}/${file.name}`;
        console.log(`Downloading ${model.name}/${file.name}`);
        const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
        if (!response.ok) throw new Error(`Cannot download model: ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
      }
      if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw new Error(`Model integrity mismatch: ${model.name}/${file.name}`);
      if (!existsSync(target)) await writeFile(target, bytes);
    }
    execFileSync("tar", [
      "--format=ustar",
      "-cf",
      path.join(destination, `${model.name}.tar`),
      "-C",
      source,
      "inference.onnx",
      "inference.yml",
    ]);
  }
  const sdk = dependencyAsset("@paddleocr/paddleocr-js/dist/assets");
  const worker = (await readdir(sdk)).find((file) => /^worker-entry-.*\.js$/.test(file));
  if (!worker) throw new Error("PaddleOCR worker missing");
  await copyFile(path.join(sdk, worker), path.join(destination, "paddle-worker.js"));
  const ort = dependencyAsset("onnxruntime-web/package.json");
  if (JSON.parse(await readFile(ort, "utf8")).version !== "1.24.3")
    throw new Error("The Paddle worker requires ORT 1.24.3.");
  for (const file of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"])
    await copyFile(path.join(path.dirname(ort), "dist", file), path.join(destination, file));
  for (const [source, target] of [["@techstark/opencv-js/LICENSE", "LICENSE-opencv.txt"]])
    await copyFile(dependencyAsset(source), path.join(destination, target));
  for (const file of ["onnxruntime-LICENSE.txt", "paddleocr-LICENSE.txt"])
    await copyFile(path.resolve(import.meta.dirname, "../licenses", file), path.join(destination, file));
  for (const file of await readdir(destination))
    if (/tesseract|traineddata|^worker\.min\.js$/.test(file)) await rm(path.join(destination, file));
  await writeFile(path.join(destination, "models.json"), JSON.stringify(selected, null, 2));
  console.log(`PP-OCRv6 ${selectedOCRModel()} models, worker and pinned WASM prepared locally.`);
}
