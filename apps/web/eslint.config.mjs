import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import a11y from "eslint-plugin-jsx-a11y";
import { plugin as shadcn } from "@shadcn/lint";
import simpleImportSort from "eslint-plugin-simple-import-sort";

export default ts.config(
  {
    ignores: [
      "dist/**",
      "public/ocr/**",
      ".next/**",
      ".vinext/**",
      ".sites-runtime/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [js.configs.recommended, ...ts.configs.recommended],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      // One import statement per module (type-only imports may stay separate), in a stable order.
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    files: ["**/*.tsx"],
    extends: [hooks.configs.flat.recommended, a11y.flatConfigs.recommended],
    plugins: { shadcn },
    settings: {
      shadcn: {
        ui: ["@/vendor/shadcn/ui", "@/components/ui"],
        entryPoint: "app/globals.css",
      },
    },
    rules: {
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-inline-styles": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
    },
  },
  {
    // Vendored originals keep upstream's import order.
    files: ["vendor/**"],
    rules: { "simple-import-sort/imports": "off", "simple-import-sort/exports": "off" },
  },
  {
    files: ["vendor/shadcn/ui/**/*.tsx"],
    rules: {
      // Component implementations own their variants and static class expressions.
      "shadcn/no-restyle": "off",
      "shadcn/no-arbitrary-values": "off",
      "shadcn/require-static-classes": "off",
    },
  },
  // Product adaptations stay class-specific; all other wrapper styles use the normal rules.
  ...[
    ["button", "^Button$", ["text-destructive", "hover:text-destructive", "text-link", "hover:text-link"]],
    // The viewer surface: fullscreen, opaque and edge to edge; its swipe to dismiss fades it.
    ["dialog", "^DialogContent$", ["rounded-none", "bg-background", "p-0", "ring-0", "viewer-fade"]],
    ["drawer", "^DrawerContent$", ["app-sheet"]],
    ["item", "^Item(Title|Description)$", ["line-clamp-none"]],
    ["native-select", "^NativeSelect$", ["[&_select]:text-base", "md:[&_select]:text-sm"]],
    // `filled`: the muted field of sheets.
    ["input", "^Input$", ["rounded-xl", "border-transparent", "bg-muted", "px-3", "shadow-none", "dark:bg-muted"]],
    ["textarea", "^Textarea$", ["rounded-xl", "border-transparent", "bg-muted", "p-3", "shadow-none", "dark:bg-muted"]],
  ].map(([file, pattern, allow]) => ({
    files: [`components/ui/${file}.tsx`],
    rules: {
      "shadcn/no-restyle": ["error", { allow: ["layout"], contracts: [{ pattern, allow: ["layout", ...allow] }] }],
    },
  })),
  {
    // Choices: 44px cells and chips, muted until chosen and primary when chosen; the radio list keeps list dividers.
    files: ["components/ui/choice.tsx"],
    rules: {
      "shadcn/no-restyle": [
        "error",
        {
          allow: ["layout"],
          contracts: [
            {
              pattern: "^ToggleGroupItem$",
              allow: [
                "layout",
                "rounded-xl",
                "rounded-full",
                "bg-muted",
                "px-4",
                "font-semibold",
                "tabular-nums",
                "hover:bg-muted",
                "data-[state=on]:bg-primary",
                "data-[state=on]:text-primary-foreground",
                "data-[state=on]:hover:bg-primary",
                "data-[state=on]:hover:text-primary-foreground",
              ],
            },
            { pattern: "^RadioGroup$", allow: ["layout", "gap-0", "divide-y", "divide-rule"] },
          ],
        },
      ],
    },
  },
  {
    // Surfaces compose Radix and Vaul primitives directly, like the originals.
    files: ["components/ui/sheet.tsx", "components/ui/sidebar-overlay.tsx"],
    rules: { "shadcn/no-restyle": "off" },
  },
  {
    files: ["components/ui/sidebar-overlay.tsx"],
    // The contract fixes 24px; rounded-3xl measures 22px in this preset.
    rules: { "shadcn/no-arbitrary-values": ["error", { allow: ["rounded-[1.5rem]"] }] },
  },
  {
    files: ["components/ui/race-tile.tsx"],
    // The contract fixes "?" at 17 px and the "needs images" dash at 1.5 px; the scale has neither.
    rules: { "shadcn/no-arbitrary-values": ["error", { allow: ["text-[1.0625rem]", "border-[1.5px]"] }] },
  },
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/vendor/shadcn/ui/*"],
              message: "Compose originals inside components/ui; app uses the MKW layer.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["components/ui/**/*.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
);
