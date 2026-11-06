import { chromium, type FullConfig } from "@playwright/test";

// Vite compiles each module on its first request. Parallel workers that all
// open a cold dev server at once miss the hydration deadline, so one page
// compiles the app and every Vite fixture before the workers start.
export default async function warmDevServer(config: FullConfig) {
  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto("/");
    await page
      .getByRole("button", { name: /^(App Settings|Settings)$/ })
      .first()
      .waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector('[role="status"][aria-label="Opening Mogi on Rails"]'));
    // The fixtures that specs mount through /@fs.
    const fixtures = ["mogi-render-fixture.tsx", "question-session-fixture.tsx", "recognition-contract-fixture.ts"].map(
      (file) => new URL(file, import.meta.url).pathname,
    );
    await page.evaluate(async (files) => {
      Object.assign(window, {
        $RefreshReg$: () => {},
        $RefreshSig$: () => (type: unknown) => type,
        __vite_plugin_react_preamble_installed__: true,
      });
      for (const file of files) await import(/* @vite-ignore */ `/@fs${file}`);
    }, fixtures);
  } finally {
    await browser.close();
  }
}
