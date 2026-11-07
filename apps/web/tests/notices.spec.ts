import { expect, type Page, test } from "@playwright/test";

import { ffaRoster, mogiState, restoreState } from "./mogi-state";

/** Each write the app makes fails with this DOMException name until the flag clears. */
async function failWrites(page: Page) {
  await page.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>) {
      const name = (window as Window & { storageFailure?: string }).storageFailure;
      if (name && args[1] === "readwrite") throw new DOMException("Injected storage failure", name);
      return transaction.apply(this, args);
    } as IDBDatabase["transaction"];
  });
}
const setFailure = (page: Page, name: string | null) =>
  page.evaluate((value) => {
    (window as Window & { storageFailure?: string | null }).storageFailure = value;
  }, name);

/** Mogis A and B, B the last opened, and the list on screen. */
async function createTwo(page: Page) {
  const state = mogiState({ roster: ffaRoster("A") }, { roster: ffaRoster("B") });
  await restoreState(page, { ...state, activeMogiId: state.mogis[1].id });
  await page.getByRole("button", { name: "Back", exact: true }).click();
}
/** Opens mogi A after B was created, so remembering A is the write that fails. */
async function openWithFailure(page: Page, name: string) {
  await createTwo(page);
  await setFailure(page, name);
  await page.getByRole("button", { name: /^Mogi Tier A\W*FFA/ }).click();
  // The modal alert hides the mogi from the accessibility tree.
  await expect(
    page.getByRole("heading", { level: 1, name: "Mogi Tier A", exact: true, includeHidden: true }),
  ).toBeVisible();
}

const storageAlert = (page: Page, name: string) => page.getByRole("alertdialog", { name, exact: true });
/** Exactly these buttons, in DOM order, and the caution symbol only where data can be lost. */
async function expectAlert(page: Page, name: string, description: string, buttons: string[], caution: boolean) {
  const alert = storageAlert(page, name);
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAccessibleDescription(description);
  await expect(alert.getByRole("button")).toHaveText(buttons);
  await expect(alert.locator("svg.lucide-triangle-alert")).toHaveCount(caution ? 1 : 0);
  // The default button has the focus.
  await expect(alert.getByRole("button", { name: buttons.at(-1), exact: true })).toBeFocused();
  // Neither Escape nor a click outside dismisses it.
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 4);
  await expect(alert).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  return alert;
}
async function clearAndPress(button: ReturnType<Page["getByRole"]>) {
  // The alert ignores presses while the previous attempt is still writing; wait for it to settle.
  await expect(button.page().getByRole("alertdialog")).toHaveAttribute("aria-busy", "false");
  // Clear the failure and press in one step, so no other write clears the cause first.
  await button.evaluate((element: HTMLElement) => {
    (window as Window & { storageFailure?: string | null }).storageFailure = null;
    element.click();
  });
}

test("without space, the alert shows the cause and Try Again retries the write until it succeeds", async ({ page }) => {
  await failWrites(page);
  await openWithFailure(page, "QuotaExceededError");
  const alert = await expectAlert(
    page,
    "This Device Is Out of Space",
    "Your last change wasn't saved.",
    ["Manage Storage", "Try Again"],
    true,
  );
  // Default on top when stacked at 375.
  const [manage, retry] = [
    alert.getByRole("button", { name: "Manage Storage", exact: true }),
    alert.getByRole("button", { name: "Try Again", exact: true }),
  ];
  expect((await retry.boundingBox())!.y).toBeLessThan((await manage.boundingBox())!.y);
  await retry.click();
  await expect(alert).toBeVisible();
  await expect(retry).toBeFocused();
  await clearAndPress(retry);
  await expect(alert).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Mogi Tier A", exact: true })).toBeVisible();
});

test("a closed connection or new version asks only for Reload; another cause asks for Try Again and Manage Storage", async ({
  page,
}) => {
  await failWrites(page);
  await openWithFailure(page, "InvalidStateError");
  const updated = await expectAlert(
    page,
    "Mogi on Rails Was Updated in Another Tab",
    "Reload to keep saving.",
    ["Reload"],
    false,
  );
  await Promise.all([page.waitForNavigation(), updated.getByRole("button", { name: "Reload", exact: true }).click()]);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // The reload reopens A and remembers it; opening B is the next write.
  await expect(page.getByRole("heading", { level: 1, name: "Mogi Tier A", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await setFailure(page, "UnknownError");
  await page.getByRole("button", { name: /^Mogi Tier B\W*FFA/ }).click();
  const unknown = await expectAlert(
    page,
    "Couldn't Save on This Device",
    "Your last change wasn't saved.",
    ["Manage Storage", "Try Again"],
    true,
  );
  await clearAndPress(unknown.getByRole("button", { name: "Try Again", exact: true }));
  await expect(unknown).toHaveCount(0);
});

/** Mogi A with races 1 and 2 counted and an edit of race 2 in progress. */
async function openWithDraft(page: Page) {
  await page.setViewportSize({ width: 375, height: 812 });
  const state = mogiState({
    roster: ffaRoster("A"),
    races: (mogi) =>
      [1, 2].map((number) => {
        const people = mogi.participants.map((person) => person.id);
        return {
          id: `race-${number}`,
          origin: "manual" as const,
          number,
          placements: number === 1 ? people : [...people].reverse(),
        };
      }),
  });
  const people = state.mogis[0].participants.map((person) => person.id);
  state.mogis[0].raceDraft = {
    version: 1,
    purpose: "manual",
    raceId: "race-2",
    number: 2,
    baseSignature: "0".repeat(64),
    updatedAt: "2026-10-29T00:00:00Z",
    fields: { placements: people, absentParticipantIds: [], reviewed: false },
  };
  await restoreState(page, state);
  await expect(page.getByRole("heading", { level: 1, name: "Mogi Tier A", exact: true })).toBeVisible();
}
const draftTile = (page: Page) =>
  page.getByRole("button", { name: "Race 2 · counted · Edit in progress", exact: true });
const refusal = "Resume or discard the pending edit before editing another race.";

test("an edit in progress is a pencil on the race, with Resume and Discard in the sheet, and refusal appears below Edit Result", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openWithDraft(page);
  // No banner in the content flow: only the pencil on the race's tile.
  await expect(page.getByText(/edit in progress/i)).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button", { name: "Resume Edit", exact: true })).toHaveCount(0);
  await expect(draftTile(page).locator('[data-race-badge="editing"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Race 1 · counted", exact: true }).locator("[data-race-badge]"),
  ).toHaveCount(0);

  // Another race refuses Edit Result while the draft exists: the sentence sits right under the command.
  await page.getByRole("button", { name: "Race 1 · counted", exact: true }).click();
  const first = page.getByRole("dialog", { name: "Race 1", exact: true });
  const edit = first.getByRole("button", { name: "Edit Result", exact: true });
  await edit.click();
  const inline = first.getByRole("alert");
  await expect(inline).toHaveText(refusal);
  await expect(page.locator("[data-toast]")).toHaveCount(0);
  const [editBox, inlineBox, uncountBox] = [
    await edit.boundingBox(),
    await inline.boundingBox(),
    await first.getByRole("button", { name: "Don't Count This Race", exact: true }).boundingBox(),
  ];
  expect(inlineBox!.y).toBeGreaterThanOrEqual(editBox!.y + editBox!.height);
  expect(inlineBox!.y - (editBox!.y + editBox!.height)).toBeLessThan(16);
  expect(inlineBox!.y).toBeLessThan(uncountBox!.y);
  // The next attempt clears it, and a repeated refusal shows it again.
  await first.getByRole("button", { name: /^Track/ }).click();
  const tracks = page.getByRole("dialog", { name: "Track", exact: true });
  await expect(tracks.getByRole("alert")).toHaveCount(0);
  await tracks.getByRole("button", { name: "Back", exact: true }).click();
  await expect(first.getByRole("button", { name: "Edit Result", exact: true })).toBeVisible();
  await expect(first.getByRole("alert")).toHaveCount(0);
  await first.getByRole("button", { name: "Close", exact: true }).click();
  await expect(first).toBeHidden();

  // The draft's sheet says so under its title and holds Resume and Discard instead of Edit Result.
  await draftTile(page).click();
  const second = page.getByRole("dialog", { name: "Race 2", exact: true });
  await expect(second).toHaveAccessibleDescription("Edit in progress");
  await expect(second.getByText("Edit in progress", { exact: true })).toBeVisible();
  await expect(second.getByRole("button", { name: "Edit Result", exact: true })).toHaveCount(0);
  await expect(second.getByRole("button", { name: "Resume Edit", exact: true })).toBeVisible();
  await second.getByRole("button", { name: "Discard Edit", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Discard Edit?", exact: true });
  await expect(confirm).toHaveAccessibleDescription("Saved results are kept.");
  await confirm.getByRole("button", { name: "Discard Edit", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(second.getByRole("button", { name: "Edit Result", exact: true })).toBeFocused();
  await expect(second).not.toHaveAccessibleDescription("Edit in progress");
  await second.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Race 2 · counted", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Race 2 · counted", exact: true })).toBeVisible();
});
