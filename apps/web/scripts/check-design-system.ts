import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import postcss from "postcss";
import ts from "typescript";

import { minorWords } from "../lib/format.ts";

const option = process.argv.indexOf("--root");
const root = option < 0 ? path.resolve(import.meta.dirname, "..") : path.resolve(process.argv[option + 1]);
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const contract = JSON.parse(read("design-system/preset.json"));
const errors: string[] = [];
// Product tokens extend the preset and never override generated tokens.
const product = JSON.parse(read("design-system/product-tokens.json"));
for (const [scope, tokens] of Object.entries(product.tokens as Record<string, Record<string, string>>)) {
  for (const [token, value] of Object.entries(tokens)) {
    if (contract.tokens[scope]?.[token] !== undefined)
      errors.push(`Product token redefines preset: ${token} in ${scope}`);
    else (contract.tokens[scope] ??= {})[token] = value;
  }
}
const config = JSON.parse(read("components.json"));
for (const [key, value] of Object.entries(contract.components)) {
  if (JSON.stringify(config[key]) !== JSON.stringify(value)) errors.push(`Preset configuration drift: ${key}`);
}
const seen = new Set<string>();
const css = postcss.parse(read("app/globals.css"));
// Only reviewed package styles may extend this entry; local imports could hide overrides.
const cssImports = new Set(["tailwindcss", "tw-animate-css", "shadcn/tailwind.css", "@fontsource-variable/inter"]);
css.walkAtRules("import", (rule) => {
  const imported = rule.params.match(/^["']([^"']+)["']$/)?.[1];
  if (!imported || !cssImports.has(imported)) errors.push(`Unreviewed CSS import: ${rule.params}`);
});
css.walkDecls((decl) => {
  if (!decl.prop.startsWith("--")) return;
  // Local @utility variables belong to it, not to the theme.
  for (let node = decl.parent as postcss.Node | undefined; node; node = node.parent as postcss.Node | undefined)
    if (node.type === "atrule" && (node as postcss.AtRule).name === "utility") return;
  // Local animated mask and toolbar intensities are not theme tokens; other keyframes remain audited.
  const keyframes = decl.parent?.parent;
  if (
    keyframes?.type === "atrule" &&
    keyframes.name === "keyframes" &&
    ["edge-top", "edge-bottom", "toolbar-under"].includes(keyframes.params) &&
    decl.prop === `--${keyframes.params}` &&
    ["0", "1"].includes(decl.value)
  )
    return;
  // The contrast preference may only enlarge this thumb to the approved size.
  const preference = decl.parent?.parent;
  if (
    decl.parent?.type === "rule" &&
    decl.parent.selector === ":root" &&
    preference?.type === "atrule" &&
    preference.name === "media" &&
    preference.params === "(prefers-contrast: more)" &&
    decl.prop === "--scrollbar-thumb" &&
    decl.value === "color-mix(in oklab, var(--foreground) 50%, transparent)"
  )
    return;
  const parent = decl.parent;
  const scope =
    parent?.type === "rule"
      ? parent.selector
      : parent?.type === "atrule"
        ? `@${parent.name} ${parent.params}`
        : "unknown";
  const expected = contract.tokens[scope]?.[decl.prop];
  const key = `${scope}:${decl.prop}`;
  if (expected === undefined || expected !== decl.value || seen.has(key))
    errors.push(`Preset token drift: ${decl.prop} in ${scope}`);
  seen.add(key);
});
for (const [scope, tokens] of Object.entries(contract.tokens)) {
  for (const token of Object.keys(tokens as object))
    if (!seen.has(`${scope}:${token}`)) errors.push(`Missing preset token: ${token} in ${scope}`);
}

function files(directory: string): string[] {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const name = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(name) : name.endsWith(".tsx") ? [name] : [];
  });
}
function enabledAttribute(attributes: ts.JsxAttributes, name: string) {
  return attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      attribute.name.getText() === name &&
      (!attribute.initializer ||
        (ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword)),
  );
}
// An action belongs to an alert, a sheet or a toast, never to a banner in the content flow. A banner is an
// element announced as alert/status (role or aria-live) or an Alert; these files own the allowed surfaces.
const bannerSurfaces = new Set([
  "components/ui/blocking-alert.tsx",
  "components/ui/alert-dialog.tsx",
  "components/ui/confirmation-dialog.tsx",
  "components/ui/sheet.tsx",
  "components/ui/toast.tsx",
]);
const isAction = (tag: string) => /^(?:[A-Z]\w*)?Button$|^button$/.test(tag) || tag.endsWith(".Button");
function bannerRole(attributes: ts.JsxAttributes, source: ts.SourceFile) {
  return attributes.properties.some((attribute) => {
    if (!ts.isJsxAttribute(attribute) || !attribute.initializer) return false;
    const name = attribute.name.getText(source);
    if (name === "aria-live") return true;
    if (name !== "role") return false;
    // A conditional role ("alert" or "status") is still a banner.
    const literals: string[] = [];
    (function collect(node: ts.Node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.push(node.text);
      ts.forEachChild(node, collect);
    })(attribute.initializer);
    return literals.some((role) => role === "alert" || role === "status");
  });
}
for (const file of [...files("app"), ...files("components")]) {
  if (bannerSurfaces.has(file)) continue;
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  (function visit(node: ts.Node) {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      if (opening.tagName.getText(source) === "Alert" || bannerRole(opening.attributes, source)) {
        const action = (function find(child: ts.Node): ts.Node | undefined {
          if (
            (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) &&
            isAction(child.tagName.getText(source))
          )
            return child;
          return ts.forEachChild(child, find);
        })(node);
        if (action)
          errors.push(
            `In-flow banner with an action (use BlockingAlert, an alert dialog, a sheet or a toast): ${file}:${source.getLineAndCharacterOfPosition(action.getStart(source)).line + 1}`,
          );
      }
    }
    ts.forEachChild(node, visit);
  })(source);
}
for (const file of [...files("app"), ...files("components")]) {
  if (file.startsWith("components/ui/")) continue;
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const imported = node.moduleSpecifier.text;
      const resolved = imported.startsWith(".") ? path.resolve(root, path.dirname(file), imported) : imported;
      if (resolved.includes("/vendor/shadcn/ui/")) errors.push(`Direct vendor import outside UI layer: ${file}`);
      // Every enlarged image uses CaptureViewer: fullscreen is composed only in the internal layer.
      if (imported === "@/components/ui/dialog" || resolved.endsWith("/components/ui/dialog"))
        errors.push(`Fullscreen dialog outside CaptureViewer: ${file}`);
    }
    // Copy feedback ("Copied" on the control, announced) has one path: CopyButton, CopyRow or useCopy.
    const clipboardWrite =
      ts.isPropertyAccessExpression(node) &&
      ["write", "writeText"].includes(node.name.text) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "clipboard";
    if (clipboardWrite || (ts.isIdentifier(node) && node.text === "ClipboardItem"))
      errors.push(
        `Clipboard write outside CopyButton (use CopyButton, CopyRow or useCopy): ${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
      );
    // Glass and dividers belong to the internal layer: glass/glass-tint and List provide them.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const handBuilt = node.text.split(/\s+/).find((name) => /^(?:[\w-]+:)*(?:backdrop-|divide-)/.test(name));
      if (handBuilt)
        errors.push(
          `Hand-built ${handBuilt.includes("backdrop-") ? "material" : "divider"} outside UI layer: ${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        );
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const nativeAlert =
        /^[a-z]/.test(tag) &&
        node.attributes.properties.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(source) === "role" &&
            attribute.initializer &&
            ts.isStringLiteral(attribute.initializer) &&
            attribute.initializer.text === "alert",
        );
      if (nativeAlert)
        errors.push(
          `New native alert outside UI layer: ${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        );
      // A measured bar is Meter: native progress/meter and hand-built bars stay inside the UI layer.
      const handBuiltBar =
        /^[a-z]/.test(tag) &&
        node.attributes.properties.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(source) === "role" &&
            attribute.initializer &&
            ts.isStringLiteral(attribute.initializer) &&
            ["meter", "progressbar"].includes(attribute.initializer.text),
        );
      if (handBuiltBar)
        errors.push(
          `Hand-built bar outside UI layer (use Meter): ${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        );
      // Inline Alerts only explain: no title and no dismissal; an action inside one is an in-flow banner, refused above.
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (tag === "AlertTitle")
        errors.push(`Alert title outside UI layer (a decision is an alert or a sheet): ${file}:${line}`);
      let controlled = ["select", "textarea", "label", "details", "table", "button", "progress", "meter"].includes(tag);
      if (tag === "input") {
        const attrs = node.attributes.properties;
        const type = attrs.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === "type");
        const hidden =
          enabledAttribute(node.attributes, "hidden") ||
          attrs.some(
            (attr) =>
              ts.isJsxAttribute(attr) &&
              attr.name.getText(source) === "className" &&
              attr.initializer &&
              ts.isStringLiteral(attr.initializer) &&
              attr.initializer.text.split(/\s+/).includes("hidden"),
          );
        const hiddenType =
          type &&
          ts.isJsxAttribute(type) &&
          type.initializer &&
          ts.isStringLiteral(type.initializer) &&
          type.initializer.text === "hidden";
        controlled = !hidden && !hiddenType;
      }
      if (controlled && tag === "button") {
        const parent = ts.isJsxOpeningElement(node) ? node.parent.parent : node.parent;
        if (
          ts.isJsxElement(parent) &&
          ["Item", "DialogTrigger"].includes(parent.openingElement.tagName.getText(source)) &&
          enabledAttribute(parent.openingElement.attributes, "asChild")
        )
          controlled = false;
      }
      if (controlled) {
        errors.push(
          `New native ${tag} outside UI layer: ${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
// Command labels are Title Case (HIG): every word capitalized except articles, coordinating conjunctions and
// prepositions of four letters or fewer, unless first or last. Only a literal label of two or more words on a
// button, a list row that acts (`onSelect`) or a copy control is checked; sentences (ending in . or ?) are text.
const labeled = (tag: string) => isAction(tag) || tag === "ListRow" || tag === "CopyRow";
function sentenceCaseLabel(text: string) {
  const words = text.trim().split(/\s+/);
  if (words.length < 2 || !/^[A-Z]/.test(words[0]) || /[.?]$/.test(text.trim())) return false;
  return words.some((word, index) => {
    if (!/^[a-z]/.test(word) || /[A-Z\d]/.test(word)) return false;
    const bare = word.replace(/[^a-z']/g, "");
    return index === words.length - 1 || !minorWords.has(bare);
  });
}
for (const file of [...files("app"), ...files("components")]) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const flag = (node: ts.Node, text: string) =>
    errors.push(
      `Command label in sentence case (use Title Case, "${text.trim()}"): ${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
    );
  // A literal, or either literal branch of a condition (`open ? "Hide Mogis" : "Show Mogis"`).
  const literals = (node: ts.Node | undefined): ts.StringLiteral[] =>
    !node
      ? []
      : ts.isStringLiteral(node)
        ? [node]
        : ts.isConditionalExpression(node)
          ? [...literals(node.whenTrue), ...literals(node.whenFalse)]
          : ts.isParenthesizedExpression(node)
            ? literals(node.expression)
            : [];
  // The label's own text, also through plain elements such as an icon's `span`, never inside another component.
  const text = (children: ts.NodeArray<ts.JsxChild>) =>
    children.forEach((child) => {
      if (ts.isJsxText(child)) {
        if (sentenceCaseLabel(child.text)) flag(child, child.text);
      } else if (ts.isJsxExpression(child))
        literals(child.expression).forEach((value) => {
          if (sentenceCaseLabel(value.text)) flag(value, value.text);
        });
      else if (ts.isJsxElement(child) && /^[a-z]/.test(child.openingElement.tagName.getText(source)))
        text(child.children);
    });
  (function visit(node: ts.Node) {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
    const tag = opening?.tagName.getText(source);
    if (
      opening &&
      tag &&
      labeled(tag) &&
      (tag !== "ListRow" ||
        opening.attributes.properties.some(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "onSelect",
        ))
    ) {
      for (const attribute of opening.attributes.properties) {
        if (
          !ts.isJsxAttribute(attribute) ||
          !["label", "aria-label"].includes(attribute.name.getText(source)) ||
          !attribute.initializer
        )
          continue;
        const values = ts.isStringLiteral(attribute.initializer)
          ? [attribute.initializer]
          : ts.isJsxExpression(attribute.initializer)
            ? literals(attribute.initializer.expression)
            : [];
        for (const value of values) if (sentenceCaseLabel(value.text)) flag(value, value.text);
      }
      if (ts.isJsxElement(node)) text(node.children);
    }
    ts.forEachChild(node, visit);
  })(source);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(`Design system ${contract.preset.code}: tokens/configuration, imports and visible controls verified.`);
