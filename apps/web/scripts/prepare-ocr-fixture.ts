import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const fixtures = [
  {
    file: "lt-issue12-no-colors.png",
    asset: "79f485d6-22f3-4ab6-9b7e-144ed7d17bb4",
    hash: "f3abcb4df05e1d6999410ac5ea052d1beee97e118b6ed00b8ad503a0872480b4",
  },
  {
    file: "lt-issue12-colors.png",
    asset: "8f16f016-0822-4448-822b-3ecfc151b819",
    hash: "f4aa45c9c70d933b97d314ca94a30e6b31a07ba23f1ead84d64b25dd2f991e6b",
  },
];
await mkdir(".fixtures", { recursive: true });
for (const fixture of fixtures) {
  const path = `.fixtures/${fixture.file}`;
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch {
    const response = await fetch(`https://github.com/user-attachments/assets/${fixture.asset}`);
    if (!response.ok) throw new Error(`Fixture download failed: ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== fixture.hash)
    throw new Error("The public OCR test fixture changed. Inspect its source before replacing the known fixture.");
  await writeFile(path, bytes);
}
console.log("Local-only real OCR fixtures verified. Source/provenance: docs/contracts/ocr.md");
