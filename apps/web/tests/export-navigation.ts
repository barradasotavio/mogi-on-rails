import type { Page } from "@playwright/test";

export async function closeExportPanel(page: Page) {
  const panel = page.getByRole("dialog", { name: "Export", exact: true });
  if (await panel.isVisible()) {
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await panel.waitFor({ state: "hidden" });
  }
}
