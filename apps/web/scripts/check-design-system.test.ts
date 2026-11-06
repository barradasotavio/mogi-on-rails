import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

const project = path.resolve(import.meta.dirname, "..");
function check(root = project): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(project, "scripts/check-design-system.ts"), "--root", root]);
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}
async function fixture(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), "mkw-design-contract-"));
  try {
    for (const entry of ["app", "components", "components.json", "design-system"])
      cpSync(path.join(project, entry), path.join(root, entry), { recursive: true });
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Each case spawns the checker on its own copy, so four run at once.
describe("design verification", { concurrency: 4 }, () => {
  test("design verification accepts the selected preset without a migration inventory", async () => {
    const result = await check();
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  test("design verification accepts the internal navigation sidebar in an app composition", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/sidebar-navigation.tsx"),
        'import { SidebarOverlay } from "@/components/ui/sidebar-overlay"; export function Navigation() { return <SidebarOverlay open onOpenChange={() => {}} onCloseAutoFocus={() => {}}><section><h2>Mogis</h2></section></SidebarOverlay>; }',
      );
      const result = await check(root);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }));

  test("design verification rejects a token override added after the preset", () =>
    fixture(async (root) => {
      const css = path.join(root, "app/globals.css");
      writeFileSync(css, readFileSync(css, "utf8") + "\n.dark { --primary: hotpink; }\n");
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /token.*primary/i);
    }));

  test("design verification rejects new native controls outside the UI layer", () =>
    fixture(async (root) => {
      mkdirSync(path.join(root, "components/new-flow"), { recursive: true });
      writeFileSync(
        path.join(root, "components/new-flow/example.tsx"),
        'export function Example() { return <select aria-label="New selector"><option>One</option></select>; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /native.*select/i);
    }));

  test("design verification rejects a measured bar outside Meter", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/usage.tsx"),
        'export function Usage() { return <><progress value={1} max={2} /><div role="meter" aria-valuenow={50} /></>; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /native progress/i);
      assert.match(result.stderr, /bar outside UI layer \(use Meter\)/i);
    }));

  test("design verification accepts Meter in an app composition", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/usage.tsx"),
        'import { Meter } from "@/components/ui/meter"; export function Usage() { return <Meter label="Storage used" value={1} max={2} valueText="1 KB of 2 KB used" />; }',
      );
      const result = await check(root);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }));

  test("design verification rejects changing the component base", () =>
    fixture(async (root) => {
      const file = path.join(root, "components.json");
      const config = JSON.parse(readFileSync(file, "utf8"));
      config.style = "base-nova";
      writeFileSync(file, JSON.stringify(config));
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /configuration drift: style/i);
    }));

  test("design verification rejects a fullscreen image outside CaptureViewer", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/bypass-viewer.tsx"),
        'import { Dialog, FullscreenDialogContent } from "@/components/ui/dialog"; export function Bypass() { return <Dialog open><FullscreenDialogContent /></Dialog>; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Fullscreen dialog outside CaptureViewer/);
    }));

  test("design verification rejects relative vendor imports outside the UI layer", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/bypass.tsx"),
        'import { Input } from "../vendor/shadcn/ui/input"; export function Bypass() { return <Input />; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /direct vendor import/i);
    }));

  test("design verification rejects visible controls outside the internal layer", () =>
    fixture(async (root) => {
      for (const [name, control] of [
        ["default", "<input />"],
        ["text", '<input type="text" />'],
        ["textarea", "<textarea />"],
        ["checkbox", '<input type="checkbox" />'],
        ["label", "<label>Caption</label>"],
        ["details", "<details />"],
        ["table", "<table />"],
        ["button", "<button>Continue</button>"],
      ]) {
        writeFileSync(path.join(root, `components/${name}.tsx`), `export function Example() { return ${control}; }`);
      }
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /native input.*default\.tsx/i);
      for (const tag of ["textarea", "label", "details", "table", "button"])
        assert.match(result.stderr, new RegExp(`native ${tag}`, "i"));
      assert.match(result.stderr, /native input.*checkbox\.tsx/i);
    }));

  test("design verification permits hidden upload controls and semantic structure", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/upload.tsx"),
        'export function Upload() { return <section><h2>Upload</h2><p role="status">Ready</p><input type="file" hidden /><input type="hidden" value="receipt" readOnly /></section>; }',
      );
      const result = await check(root);
      assert.equal(result.status, 0, result.stderr);
    }));

  test("design verification checks visible inputs and buttons inside non-interactive Items", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/visible.tsx"),
        "export function Example() { return <Item><input hidden={false} /><button>Continue</button></Item>; }",
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /native input.*visible\.tsx/i);
      assert.match(result.stderr, /native button.*visible\.tsx/i);
    }));

  test("design verification rejects local CSS imports that could override reviewed tokens", () =>
    fixture(async (root) => {
      const css = path.join(root, "app/globals.css");
      writeFileSync(css, readFileSync(css, "utf8") + '\n@import "./override.css";\n');
      writeFileSync(path.join(root, "app/override.css"), ":root { --primary: hotpink; }");
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /unreviewed CSS import/i);
    }));

  test("design verification needs no migration file and permits composed native triggers", () =>
    fixture(async (root) => {
      rmSync(path.join(root, "design-system/legacy-controls.json"), { force: true });
      writeFileSync(
        path.join(root, "components/composed.tsx"),
        'export function Example() { return <section><Item asChild><button>Open Item</button></Item><DialogTrigger asChild><button>Open Image</button></DialogTrigger><input type="file" className="hidden" /></section>; }',
      );
      const result = await check(root);
      assert.equal(result.status, 0, result.stderr);
    }));

  test("design verification rejects missing tokens", () =>
    fixture(async (root) => {
      const css = path.join(root, "app/globals.css");
      writeFileSync(css, readFileSync(css, "utf8").replace("  --radius: 0.625rem;", ""));
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /missing preset token: --radius/i);
    }));

  test("design verification rejects native alerts outside the UI layer", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/notice.tsx"),
        'export function Notice() { return <p role="alert">Review participation before confirming.</p>; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /native alert.*notice\.tsx/i);
    }));

  test("design verification rejects product tokens that redefine the preset", () =>
    fixture(async (root) => {
      const file = path.join(root, "design-system/product-tokens.json");
      const tokens = JSON.parse(readFileSync(file, "utf8"));
      tokens.tokens[":root"]["--primary"] = "oklch(0.5 0.2 20)";
      writeFileSync(file, JSON.stringify(tokens));
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /redefines preset: --primary/i);
    }));

  test("design verification rejects hand-built glass and dividers outside the UI layer", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/blur.tsx"),
        'export function Blur() { return <div className="md:backdrop-blur-xl" />; }',
      );
      writeFileSync(
        path.join(root, "components/rows.tsx"),
        'export function Rows() { return <div className="divide-y divide-border" />; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /material outside UI layer: components\/blur\.tsx/);
      assert.match(result.stderr, /divider outside UI layer: components\/rows\.tsx/);
    }));

  test("design verification rejects a titled Alert outside the UI layer", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/titled-alert.tsx"),
        'import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"; export function Titled() { return <Alert><AlertTitle>Saved</AlertTitle><AlertDescription>Done.</AlertDescription></Alert>; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Alert title outside UI layer/);
    }));

  test("design verification rejects an action inside an Alert", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/alert-action.tsx"),
        'import { Alert, AlertDescription } from "@/components/ui/alert"; import { Button } from "@/components/ui/button"; export function Decision() { return <Alert><AlertDescription>Image removed.<Button>Undo</Button></AlertDescription></Alert>; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /In-flow banner with an action.*alert-action\.tsx:1/);
    }));

  test("design verification rejects an in-flow banner with actions, even inside the UI layer", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/ui/notice.tsx"),
        'import { IconButton } from "@/components/ui/icon-button"; export function Notice({ tone }: { tone: "error" | "info" }) { return <div role={tone === "error" ? "alert" : "status"}><p>Race 2 edit in progress</p>\n<IconButton aria-label="Dismiss" /></div>; }',
      );
      writeFileSync(
        path.join(root, "components/draft-banner.tsx"),
        'import { TileButton } from "@/components/ui/tile-button"; export function Draft() { return <section aria-live="polite"><p>Edit in progress</p>\n<TileButton tone="primary">Resume Edit</TileButton></section>; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /In-flow banner with an action.*components\/ui\/notice\.tsx:2/);
      assert.match(result.stderr, /In-flow banner with an action.*components\/draft-banner\.tsx:2/);
    }));

  test("design verification accepts status without actions and actions in a sheet, an alert or a toast", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/draft-status.tsx"),
        'import { Sheet } from "@/components/ui/sheet"; import { List, ListRow } from "@/components/ui/list"; import { useToast } from "@/components/ui/toast"; export function Draft() { const toast = useToast(); return <><p role="status">Edit in progress</p><Sheet open onOpenChange={() => toast("Question left for later")} title="Race 2" subtitle="Edit in progress"><List><ListRow action="primary" onSelect={() => {}}>Resume Edit</ListRow></List></Sheet></>; }',
      );
      const result = await check(root);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }));

  test("design verification rejects copying outside CopyButton", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/share.tsx"),
        'export function Share() { return <p onClick={() => { void navigator.clipboard.writeText("x"); void navigator.clipboard.write([new ClipboardItem({})]); }}>Copy</p>; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Clipboard write outside CopyButton.*share\.tsx:1/);
    }));

  test("design verification accepts CopyButton and CopyRow in an app composition", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/share.tsx"),
        'import { Copy } from "lucide-react"; import { CopyButton, CopyRow } from "@/components/ui/copy-button"; export function Share() { return <><CopyButton label="Copy Table" filename="t.txt" content={{ kind: "text", text: () => "x" }} /><CopyRow icon={Copy} label="Copy Share Text" content={{ kind: "text", text: () => "x" }} onFeedback={() => {}} failure="Couldn\'t copy the share text. Try again." /></>; }',
      );
      const result = await check(root);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }));

  test("design verification rejects command labels in sentence case", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/commands.tsx"),
        'import { Plus } from "lucide-react"; import { Button } from "@/components/ui/button"; import { GlassButton } from "@/components/ui/glass-button"; import { CopyButton } from "@/components/ui/copy-button"; import { List, ListRow } from "@/components/ui/list";\n' +
          'export function Commands({ open }: { open: boolean }) { return <>\n<Button>Save image</Button>\n<GlassButton aria-label="New mogi"><Plus /></GlassButton>\n<List><ListRow onSelect={() => {}}><span><Plus />Restore from file…</span></ListRow></List>\n<GlassButton>{open ? "Hide mogis" : "Show Mogis"}</GlassButton>\n<CopyButton label="Copy table" filename="t.png" content={{ kind: "text", text: () => "x" }} />\n</>; }',
      );
      const result = await check(root);
      assert.notEqual(result.status, 0);
      for (const [label, line] of [
        ["Save image", 3],
        ["New mogi", 4],
        ["Restore from file…", 5],
        ["Hide mogis", 6],
        ["Copy table", 7],
      ])
        assert.match(
          result.stderr,
          new RegExp(
            `Command label in sentence case \\(use Title Case, "${label}"\\): components/commands\\.tsx:${line}`,
          ),
        );
      assert.doesNotMatch(result.stderr, /"Show Mogis"/);
    }));

  test("design verification accepts Title Case commands, literals and sentences", () =>
    fixture(async (root) => {
      writeFileSync(
        path.join(root, "components/commands.tsx"),
        'import { Button } from "@/components/ui/button"; import { GlassButton } from "@/components/ui/glass-button"; import { List, ListRow } from "@/components/ui/list";\n' +
          "export function Commands() { return <><Button>Restore from Backup</Button><Button>Add the Tier to Submit</Button><GlassButton>Copy !submit</GlassButton><Button>Not Sure</Button>" +
          '<List><ListRow onSelect={() => {}}>Install App</ListRow><ListRow>Pending names</ListRow><ListRow onSelect={() => {}} trail="2.1 MB">Mogi Tier 4 · FFA</ListRow><ListRow onSelect={() => {}} wrap>Use your browser\'s menu to install this app.</ListRow></List><p>Paste the bot list to start</p></>; }',
      );
      const result = await check(root);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }));
});
