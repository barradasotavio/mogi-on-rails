import { expect, test } from "@playwright/test";

import { createMogi } from "./mogi-creation";
import { openMogiSettings } from "./mogi-navigation";
import { ffaRoster, mogiState, restoreState } from "./mogi-state";
import { nameQuestions } from "./question-fixture";

const roster = ffaRoster();

for (const width of [390]) {
  test(`Mogi Settings keeps focus on Back and closes with Escape on the Images page at ${width}px`, async ({
    page,
  }) => {
    await page.goto("/");
    await createMogi(page, roster);
    await page.setViewportSize({ width, height: 844 });
    await openMogiSettings(page);
    const settings = page.getByRole("dialog", { name: "Mogi Settings", exact: true });
    const nested = page.getByRole("dialog", { name: "Screenshots", exact: true });
    await settings.getByRole("button", { name: "Screenshots 0", exact: true }).click();
    await expect(nested.getByRole("button", { name: "Back", exact: true })).toBeFocused();
    await nested.getByRole("button", { name: "Back", exact: true }).click();
    await expect(settings.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    // Export is a page of the same sheet, not a second sheet over it.
    await settings.getByRole("button", { name: "Export", exact: true }).click();
    const exported = page.getByRole("dialog", { name: "Export", exact: true });
    await expect(exported.getByRole("button", { name: "Back", exact: true })).toBeFocused();
    await expect(exported.getByRole("img", { name: "Table preview", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await exported.getByRole("button", { name: "Back", exact: true }).click();
    await settings.getByRole("button", { name: "Screenshots 0", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(nested).toBeHidden();
    await expect(settings).toBeHidden();
  });
}

test("Mogi Settings groups actions and includes images without a race in Images", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const state = nameQuestions(mogiState({ roster }), [undefined]);
  state.mogis[0].captures![1].fileName = "unassigned.jpeg";
  await restoreState(page, state);
  await openMogiSettings(page);
  const settings = page.getByRole("dialog", { name: "Mogi Settings", exact: true });
  await expect(settings.getByRole("heading", { level: 2 })).toHaveText(["Mogi Settings"]);
  await expect(settings.getByRole("button")).toHaveText(["", "Bot List", "Screenshots2", "Export", "Delete Mogi"]);
  await expect(page.getByRole("button", { name: "More options", exact: true })).toHaveCount(0);
  await settings.getByRole("button", { name: "Screenshots 2", exact: true }).click();
  const images = page.getByRole("dialog", { name: "Screenshots", exact: true });
  await expect(images.getByRole("listitem")).toHaveCount(2);
  // Thumbnails are decorative: the row title already names the image.
  await expect(images.locator("img")).toHaveCount(2);
  await expect(images.getByRole("img")).toHaveCount(0);
  const unassigned = images.getByRole("button", { name: /Race not assigned · after the race.*unassigned.jpeg/ });
  await expect(unassigned).toBeVisible();
  await unassigned.click();
  const image = page.getByRole("dialog", { name: "Screenshot 2", exact: true });
  await expect
    .poll(() => image.getByRole("listitem").evaluateAll((rows) => rows.slice(0, 3).map((row) => row.textContent)))
    .toEqual(["RaceNot Assigned", "MomentAfter the race", "ScreenFinish order, points added"]);
  await expect(
    image.getByRole("list", { name: "How this was counted", exact: true }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(image.getByRole("button", { name: "Not counted yet, 3 questions", exact: true })).toBeVisible();
  await expect(image.getByRole("button", { name: "Move to another mogi", exact: true })).toHaveCount(0);
  await expect(image.getByRole("button", { name: "Remove Screenshot", exact: true })).toHaveClass(/text-destructive/);
  // This capture has no numbers read, so no empty page is offered.
  await expect(image.getByRole("button", { name: "Numbers Read", exact: true })).toHaveCount(0);
  await image.getByRole("button", { name: "Race Not Assigned", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Race", exact: true })
    .getByRole("button", { name: "Race 3", exact: true })
    .click();
  await expect(image.getByRole("button", { name: "Race 3", exact: true })).toBeVisible();
  await image.getByRole("button", { name: "Remove Screenshot", exact: true }).click();
  await expect(images.getByRole("listitem")).toHaveCount(1);
  await expect(images.getByText("unassigned.jpeg", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(images).toBeHidden();
});

test("the race sheet and a Tracks row's picker page among sibling races; the picker inside the race doesn't", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await restoreState(
    page,
    mogiState({
      roster,
      races: (mogi) =>
        [1, 2, 3].map((number) => ({
          id: `race-${number}`,
          origin: "manual",
          number,
          placements: mogi.participants.map((person) => person.id),
        })),
    }),
  );

  await page.getByRole("button", { name: "Race 1 · counted", exact: true }).click();
  // The one sheet open; its name follows the page.
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "Previous Race", exact: true })).toBeDisabled();
  await sheet.getByRole("button", { name: "Next Race", exact: true }).click();
  await expect(sheet).toHaveAccessibleName("Race 2");
  await expect(sheet.getByRole("button", { name: "Next Race", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(sheet).toHaveAccessibleName("Race 3");
  // A two-finger trackpad swipe is taken by the sheet, so the browser's back swipe never starts; one swipe, one race.
  // The pointer may still rest on the mogi beside the sheet, where the tile was: the swipe pages all the same.
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(box.x / 2, box.y + box.height / 2);
  for (let step = 0; step < 12; step++) await page.mouse.wheel(-60, 0);
  await expect(sheet).toHaveAccessibleName("Race 2");
  await expect(page).toHaveURL(/mogi=/);

  // Inside the race, the picker is a pick-and-return task: no paging, and ← stays put.
  await sheet.getByRole("button", { name: /^Track/ }).click();
  await expect(sheet).toHaveAccessibleName("Track");
  await expect(sheet.getByRole("button", { name: "Next Race", exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Back", exact: true }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  // Closing returns to the tile of the race on screen.
  await expect(page.getByRole("button", { name: "Race 2 · counted", exact: true })).toBeFocused();

  // From the Tracks list, the picker pages among the resolved races' pickers.
  await page.getByRole("list", { name: "Tracks", exact: true }).getByRole("button").first().click();
  const picker = page.getByRole("dialog", { name: "Race 1 Track", exact: true });
  await picker.getByRole("button", { name: "Next Race", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Race 2 Track", exact: true })).toBeVisible();
});

test("a trackpad turns one race per swipe: consecutive swipes turn consecutive races, a long momentum tail one", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await restoreState(
    page,
    mogiState({
      roster,
      races: (mogi) =>
        [1, 2, 3, 4, 5].map((number) => ({
          id: `race-${number}`,
          origin: "manual",
          number,
          placements: mogi.participants.map((person) => person.id),
        })),
    }),
  );
  await page.getByRole("button", { name: "Race 1 · counted", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toHaveAccessibleName("Race 1");
  const box = (await sheet.boundingBox())!;
  // A wheel stream as Chromium sends a trackpad swipe: deltas rise with the fingers, then decay as momentum, one
  // event a frame at the same pointer position. The pointer never moves between swipes.
  const swipe = (tail: number) => {
    const deltas = [4, 10, 18, 26, 30, 26];
    for (let delta = 20; delta > 0.5; delta *= tail) deltas.push(delta);
    return deltas;
  };
  const stream = (deltas: number[]) =>
    page.evaluate(
      async ({ deltas, x, y }) => {
        for (const deltaX of deltas) {
          (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(
            new WheelEvent("wheel", { deltaX, clientX: x, clientY: y, bubbles: true, cancelable: true }),
          );
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
      },
      { deltas, x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
  // Two swipes, the second while the first's momentum still flows: two races.
  await stream([...swipe(0.9).slice(0, 14), ...swipe(0.9)]);
  await expect(sheet).toHaveAccessibleName("Race 3");
  // One swipe whose momentum lasts over a second: one race.
  await stream(swipe(0.97));
  await expect(sheet).toHaveAccessibleName("Race 4");
});
