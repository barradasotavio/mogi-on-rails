import { expect, type Page, test } from "@playwright/test";

async function openSession(page: Page, query = "") {
  const fixture = new URL("./question-session-fixture.tsx", import.meta.url).pathname;
  await page.route("**/__question-session*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
    import "/@vite/client";
    import RefreshRuntime from "/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { mountQuestionSession } = await import("/@fs${fixture}");
    await mountQuestionSession();
  </script></body></html>`,
    }),
  );
  await page.goto(`/__question-session${query}`);
}

test("confirmation keeps the page until saved and silently advances if another path resolved the question", async ({
  page,
}) => {
  await openSession(page);
  const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  await expect(question.getByText("Who is “Reading 1”?", { exact: true })).toBeVisible();
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await page.evaluate(() => window.questionSession.resolveCurrent());
  await expect(question.getByText("Who is “Reading 1”?", { exact: true })).toBeVisible();
  await expect(question).toHaveAccessibleName("Question 1 of 4");
  await page.evaluate(() => window.questionSession.release());
  await expect(question.getByText("Who is “Reading 2”?", { exact: true })).toBeVisible();
  await expect(question).toHaveAccessibleName("Question 1 of 4");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator('[aria-live="polite"]')).toBeEmpty();
});

test("the displayed capture remains until confirmation finishes even when its file leaves the queue", async ({
  page,
}) => {
  await openSession(page, "?image");
  const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  await expect(question.getByRole("img", { name: "Screenshot", exact: true })).toBeVisible();
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await page.evaluate(() => window.questionSession.resolveCurrent());
  await expect(question.getByRole("img", { name: "Screenshot", exact: true })).toBeVisible();
  await page.evaluate(() => window.questionSession.release());
  await expect(question.getByText("Who is “Reading 1”?", { exact: true })).toBeVisible();
  await expect(question).toHaveAccessibleName("Question 1 of 5");
  await expect(page.locator('[aria-live="polite"]')).toBeEmpty();
});

test("the toast action is a shortcut: it opens the sheet and disappears on the same timer", async ({ page }) => {
  await openSession(page);
  const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  await question.getByRole("button", { name: "Close", exact: true }).click();
  await expect(question).toBeHidden();
  await page.clock.install();
  await page.evaluate(() => window.questionSession.notifyReview());
  const open = page.getByRole("button", { name: "Open", exact: true });
  await open.click();
  await expect(question).toBeVisible();
  await expect(open).toHaveCount(0);
  await question.getByRole("button", { name: "Close", exact: true }).click();
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.questionSession.notifyReview());
  await expect(open).toBeVisible();
  await page.clock.runFor(4300);
  await expect(open).toHaveCount(0);
});

test("an option occupied by another answer is refreshed without counting a confirmation", async ({ page }) => {
  await openSession(page);
  const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await page.evaluate(() => window.questionSession.resolveCurrent(1));
  await page.evaluate(() => window.questionSession.release());
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await expect(question.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(question).toHaveAccessibleName("Question 1 of 4");
  await expect(page.locator('[aria-live="polite"]')).toBeEmpty();
});

test("the counter preserves progress when the queue shrinks and the last question closes normally", async ({
  page,
}) => {
  await openSession(page);
  const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await page.evaluate(() => window.questionSession.release());
  await expect(question).toHaveAccessibleName("Question 2 of 4");
  await page.evaluate(() => window.questionSession.resolveCurrent());
  await expect(question.getByText("Who is “Reading 3”?", { exact: true })).toBeVisible();
  await expect(question).toHaveAccessibleName("Question 2 of 4");
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await page.evaluate(() => window.questionSession.resolveCurrent());
  await expect(question.getByText("Who is “Reading 3”?", { exact: true })).toBeVisible();
  await page.evaluate(() => window.questionSession.release());
  await expect(question).toBeHidden();
  await expect(page.locator('[aria-live="polite"]')).toBeEmpty();
});
