import { readFile } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

const directory = "dist/client";
const application = "components/tracker.tsx";
const manifest = JSON.parse(await readFile(path.join(directory, ".vite/manifest.json"), "utf8")) as Record<
  string,
  { src?: string; file?: string }
>;
const entry = manifest[application];
if (entry?.src !== application || !entry.file)
  throw new Error(`Application client entry ${application} not found in the Vite manifest. Build first.`);

const file = path.join(directory, entry.file);
const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function isSentinel(node: ts.Expression): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Symbol" &&
    node.expression.name.text === "for" &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    node.arguments[0].text === "react.memo_cache_sentinel"
  );
}
let guards = 0;
function visit(node: ts.Node): void {
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
    ((ts.isElementAccessExpression(node.left) && isSentinel(node.right)) ||
      (ts.isElementAccessExpression(node.right) && isSentinel(node.left)))
  )
    guards++;
  ts.forEachChild(node, visit);
}
visit(source);
if (guards === 0)
  throw new Error(
    `React Compiler memo-cache guards not found in application client chunk ${file}. Verify Vinext compiler configuration. A runtime sentinel declaration alone is insufficient.`,
  );
console.log(`React Compiler verified in application output: ${file} (${guards} memo-cache guards)`);
