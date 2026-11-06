import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  dependencyAsset as dependency,
  prepareOCRAssets,
} from "../../../packages/engine/scripts/prepare-ocr-assets.ts";

await prepareOCRAssets(path.resolve("public/ocr"));

await mkdir("public/licenses", { recursive: true });
for (const [source, name] of [
  ["THIRD_PARTY_NOTICES.md", "third-party-notices.txt"],
  ["vendor/shadcn/LICENSE.md", "shadcn-MIT.txt"],
  [dependency("shadcn/LICENSE.md"), "shadcn-tailwind-MIT.txt"],
])
  await copyFile(source, path.join("public/licenses", name));
