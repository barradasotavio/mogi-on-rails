import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Playwright runs from the app, so its configs, testDir and webServer resolve there.
const appRoot = path.join(root, 'apps/web');
const playwrightCLI = createRequire(import.meta.url).resolve('@playwright/test/cli');
const mode = process.argv[2] ?? 'quick';
const extra = process.argv.slice(3);
const output = path.resolve(process.env.VALIDATION_OUTPUT ?? path.join(root, '.validation', `${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}`));
const port = process.env.PORT ?? '5174';
const steps = [];
const startedAt = new Date();
const budgetMs = ["quick", "app-quick"].includes(mode) ? 45000 : mode === "all" ? 300000 : undefined;
mkdirSync(output, { recursive: true });
const source = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const dirty = !!spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim();
// The budget measures this worktree's work, not the time spent queued for the shared browser slot.
const slotWaitMs = () => steps.reduce((total, step) => total + (step.slotWaitMs ?? 0), 0);
const workMs = () => Date.now() - startedAt.getTime() - slotWaitMs();
function save() {
  writeFileSync(path.join(output, 'commands.json'), JSON.stringify({ source, dirty, mode, startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime(), slotWaitMs: slotWaitMs(), budgetMs, budgetMet: budgetMs === undefined ? undefined : workMs() <= budgetMs, node: process.version, host: { platform: os.platform(), arch: os.arch(), release: os.release() }, steps }, null, 2));
}
const active = new Map();
let interrupted;
// Focused runs both of its server boundaries before reporting the first failure.
let keepGoing = false;
let failed = 0;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = signal;
  // Playwright tears down detached servers on SIGINT; retain the caller's exit status.
  for (const [child, managedBrowser] of active) child.kill(managedBrowser && signal === 'SIGTERM' ? 'SIGINT' : signal);
  if (!active.size) process.exit(signal === 'SIGINT' ? 130 : 143);
});
// A step with a log writes there instead of the terminal, so parallel steps don't interleave; the log is printed when it fails.
async function run(name, command, args, environment = {}, managedBrowser = false, log, cwd = root) {
  const started = new Date();
  const slotFile = managedBrowser ? path.join(output, `${name}.slot-wait`) : undefined;
  process.stdout.write(`\n[validation] ${name}${log ? ' (parallel)' : ''}\n`);
  const result = await new Promise(resolve => {
    const file = log && openSync(log, 'w');
    const child = spawn(command, args, { cwd, env: { ...process.env, ...environment, ...(slotFile ? { BROWSER_SLOT_WAIT_FILE: slotFile } : {}) }, stdio: file ? ['ignore', file, file] : 'inherit' });
    active.set(child, managedBrowser);
    child.once('error', error => { active.delete(child); resolve({ status: 1, error: error.message }); });
    child.once('close', (status, signal) => { active.delete(child); resolve({ status: status ?? (signal === 'SIGINT' ? 130 : 143), signal }); });
  });
  const status = interrupted ? (interrupted === 'SIGINT' ? 130 : 143) : result.status;
  let slotWaitMs;
  try { slotWaitMs = slotFile ? Number(readFileSync(slotFile, 'utf8')) : undefined; } catch { slotWaitMs = undefined; }
  steps.push({ name, command, args, startedAt: started.toISOString(), durationMs: Date.now() - started.getTime(), slotWaitMs, exitCode: status, error: result.error, signal: interrupted ?? result.signal });
  save();
  if (log && status !== 0) process.stdout.write(`\n[validation] ${name} failed:\n${readFileSync(log, 'utf8')}`);
  if (status !== 0 && (interrupted || !keepGoing)) process.exit(status);
  failed ||= status;
}
const npm = (name, script, parallel = false) => run(name, 'npm', ['run', script], {}, false, parallel ? path.join(output, `${name}.log`) : undefined);
// Independent static steps share the CPU; the first failure stops the gate once they all finish.
async function together(...scripts) {
  const previous = keepGoing;
  keepGoing = true;
  await Promise.all(scripts.map(([name, script]) => npm(name, script, true)));
  keepGoing = previous;
  if (failed && !keepGoing) process.exit(failed);
}
function browser(name, config, args = [], environment = {}) {
  return run(name, 'python3', [path.join(root, 'scripts/run-browser.py'), '--', process.execPath, playwrightCLI, 'test', '--config', config, '--reporter=line,json', `--output=${path.join(output, name)}`, ...args], {
    CI: '1', PORT: port, APP_PORT: process.env.APP_PORT ?? String(Number(port) + 1),
    PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(output, `${name}.json`), ...environment,
  }, true, undefined, appRoot);
}
function listed(config, environment = {}) {
  const result = spawnSync(process.execPath, [playwrightCLI, 'test', '--config', config, '--list', ...extra], { cwd: appRoot, encoding: 'utf8', env: { ...process.env, ...environment } });
  const total = /Total: (\d+) tests? in/.exec(result.stdout);
  if (!total) throw new Error(`Could not list ${config}:\n${result.stdout}${result.stderr}`);
  return Number(total[1]);
}
// The build is stale when a source file that feeds it is newer than its service worker.
function buildIsStale() {
  let built;
  try { built = statSync(path.join(root, 'apps/web/dist/client/sw.js')).mtimeMs; } catch { return true; }
  const files = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z', 'apps/web', 'packages/engine/src', 'package-lock.json'], { cwd: root, encoding: 'utf8' }).stdout.split('\0');
  return files.some(file => file && !/^apps\/web\/(tests|benchmarks)\/|\.test\.ts$|playwright[^/]*\.config\.ts$|\.md$/.test(file) && (statSync(path.join(root, file), { throwIfNoEntry: false })?.mtimeMs ?? 0) > built);
}
const freshBuild = () => buildIsStale() ? npm('app-build', 'build') : process.stdout.write('\n[validation] app-build: reusing the current build\n');
// Production-only specs (*.production.spec.ts) need the built service worker, so focused sends them to the production config.
const production = { PRODUCTION_SPECS_ONLY: '1' };
async function focused() {
  const [development, built] = [listed('playwright.config.ts'), listed('playwright.chrome-production.config.ts', production)];
  if (!development && !built) throw new Error(`No app test matches: ${extra.join(' ')}`);
  keepGoing = true;
  if (development) await browser('app-focused', 'playwright.config.ts', extra);
  if (built) { await freshBuild(); await browser('app-focused-production', 'playwright.chrome-production.config.ts', extra, production); }
  if (failed) process.exit(failed);
}
// Every app spec: the dev server for most, the production build for *.production.spec.ts.
const app = async () => { await browser('app-chrome', 'playwright.config.ts', extra); await freshBuild(); await browser('app-chrome-production', 'playwright.chrome-production.config.ts', extra, production); };
const appQuick = () => browser('app-quick', 'playwright.quick.config.ts', extra);
const quick = async () => { await together(['engine', 'test:engine'], ['app-rules', 'test:app-rules']); await appQuick(); };
const handlers = {
  'app-quick': quick,
  focused,
  batch: () => browser('app-batch', 'playwright.batch.config.ts', extra),
  app,
  quick,
  all: async () => {
    await together(['engine', 'test:engine'], ['app-rules', 'test:app-rules'], ['types', 'typecheck'], ['lint-design', 'lint'], ['design-cli', 'test:design'], ['app-build', 'build']);
    await npm('compiler', 'check:compiler');
    await app();
  },
};
if (!Object.hasOwn(handlers, mode)) throw new Error(`Unknown validation boundary: ${mode}`);
if (budgetMs !== undefined && extra.length) throw new Error("Quick and all use their complete selection. Use test:focused for explicit filters.");
await handlers[mode]();
save();
if (budgetMs !== undefined && workMs() > budgetMs) {
  process.stderr.write(`Validation completed above its ${budgetMs / 1000}s budget (${Math.round(slotWaitMs() / 1000)}s waiting for the browser slot excluded). See ${output}/commands.json.\n`);
  process.exitCode = 1;
}
process.stdout.write(`\nValidation evidence: ${output}\n`);
