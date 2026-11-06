#!/usr/bin/env node
// Code, tests and UI strings are English (docs/adr/0002-english-interface-and-documentation.md).
// Portuguese slipped in before, so this flags accented letters and common Portuguese words.
// Genuine Portuguese data (an OCR'd name, a game word to match) carries `english-check: data` on its line.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Root-level configs and every root script are covered too, so a new config or helper is checked from its first commit.
const roots = ["packages/engine/src", "packages/engine/tests", "packages/engine/scripts", "apps/web", "scripts", ":(glob)*.*"];
const portuguese = /[À-ÖØ-öø-ÿ]|\b(?:não|corrida|corridas|jogador|jogadores|acumulados?|equipes?|imagem|imagens|linha|linhas)\b/iu; // english-check: data
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...roots], { encoding: "utf8" })
  .split("\0")
  .filter(
    (file) => existsSync(file) &&
      !/(?:^|\/)(?:node_modules|dist|vendor)\//.test(file) &&
      !file.startsWith("apps/web/public/ocr/") && !file.endsWith("/next-env.d.ts") &&
      /\.(?:tsx?|mjs|sh|py)$|^[^/]+\.json$/.test(file) && file !== "package-lock.json",
  );

const findings = files.flatMap((file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) => (portuguese.test(line) && !line.includes("english-check: data") ? [`${file}:${index + 1}: ${line.trim().slice(0, 120)}`] : [])),
);
if (findings.length) {
  process.stderr.write(`English only (ADR 0002): Portuguese found in ${findings.length} line(s). Translate it, or mark genuine data with "english-check: data".\n${findings.join("\n")}\n`);
  process.exit(1);
}
