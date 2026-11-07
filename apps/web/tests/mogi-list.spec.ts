import { expect, test } from "@playwright/test";

import type { Mogi } from "@/lib/mogi/types";
import { releaseDate, releaseNotes } from "@/lib/release-notes";

import { openMogiSettings } from "./mogi-navigation";
import { ffaRoster, mogiState, restoreState } from "./mogi-state";

test("the empty compact start lands on Instructions over the list, whose empty state opens creation and Storage", async ({
  page,
}) => {
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Mogi on Rails", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/view=instructions/);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(main.getByRole("list", { name: "Destinations", exact: true }).getByRole("button")).toHaveText([
    "Instructions",
    "Release Notes",
    "Tracks",
  ]);
  await expect(main.getByRole("heading", { level: 1, name: "Mogis", exact: true })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["No Mogis Yet"]);
  await expect(
    main
      .getByRole("paragraph")
      .filter({ hasText: "Paste the bot list to start. Add screenshots after each race, then copy the table." }),
  ).toBeVisible();
  const create = main.getByRole("button", { name: "New Mogi", exact: true });
  await expect(create).toHaveClass(/glass-tint/);
  await create.click();
  const creation = page.getByRole("dialog", { name: "New Mogi", exact: true });
  await expect(creation.getByLabel("Lounge bot list", { exact: true })).toHaveValue("");
  await creation.getByRole("button", { name: "Close", exact: true }).click();
  await expect(create).toBeFocused();
  const restore = main.getByRole("button", { name: "Restore from Backup", exact: true });
  await expect(restore).toHaveClass(/\bglass\b/);
  await restore.click();
  const backups = page.getByRole("dialog", { name: "Storage", exact: true });
  await expect(backups.getByRole("button", { name: "Restore from File…", exact: true })).toBeVisible();
  await backups.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(restore).toBeFocused();
});

test("Release Notes opens from the list, newest date first, each line labeled", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Release Notes", exact: true }).click();
  await expect(page).toHaveURL(/view=release-notes/);
  await expect(main.getByRole("heading", { level: 1, name: "Release Notes", exact: true })).toBeVisible();
  // The newest entry, whatever it is, so adding a note never edits this test.
  const [{ date, changes }] = releaseNotes;
  await expect(main.getByRole("heading", { level: 2 }).first()).toHaveText(releaseDate(date));
  const [first] = changes;
  await expect(
    main
      .getByRole("list", { name: releaseDate(date), exact: true })
      .getByRole("listitem")
      .first(),
  ).toHaveText(`${first.kind === "new" ? "New" : "Fixed"}${first.text}`);
});

test("the empty regular start lands on Instructions, with New Mogi in the bar", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Mogi on Rails", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/view=instructions/);
  // The sidebar floats closed at this width, so its toggle lives in the toolbar.
  await expect(page.getByRole("button", { name: "Show Mogis", exact: true })).toBeVisible();
  // The page itself has no actions; New Mogi is the toolbar's while the sidebar is closed.
  await expect(main.getByRole("button", { name: /^(New Mogi|Restore from Backup)$/ })).toHaveCount(0);
  const create = page
    .getByRole("navigation", { name: "Instructions actions", exact: true })
    .getByRole("button", { name: "New Mogi", exact: true });
  await expect(create).toHaveClass(/glass-tint/);
  await create.click();
  const creation = page.getByRole("dialog", { name: "New Mogi", exact: true });
  await expect(creation.getByLabel("Lounge bot list", { exact: true })).toHaveValue("");
  await creation.getByRole("button", { name: "Close", exact: true }).click();
  await expect(create).toBeFocused();
});

test("the list and sidebar summarize teams and players in the right groups", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const players = (perLine: number) =>
    `${Array.from(
      { length: 12 / perLine },
      (_, line) =>
        `${line + 1}. ${Array.from({ length: perLine }, (_, n) => `Player ${line * perLine + n + 1}`).join(", ")}`,
    ).join("\n")}`;
  const inOrder = (races: number) => (mogi: Mogi) =>
    Array.from({ length: races }, (_, index) => ({
      id: `r${index + 1}`,
      origin: "manual" as const,
      number: index + 1,
      placements: mogi.participants.map(({ id }) => id),
    }));
  const state = mogiState(
    {
      roster: `Tier A\n${players(3)}`,
      races: inOrder(12),
      with: { id: "previous-trios", createdAt: "2026-10-26T12:00:00Z" },
    },
    { roster: `Tier D\n${players(2)}`, races: inOrder(1), with: { createdAt: "2026-10-28T12:00:00Z" } },
    { roster: ffaRoster("B"), races: inOrder(12), with: { id: "previous-ffa", createdAt: "2026-10-27T12:00:00Z" } },
  );
  state.mogis[0].teams![0].tag = "KZ";
  state.mogis[1].teams![0].tag = "XO";
  await restoreState(page, { ...state, activeMogiId: state.mogis[1].id });
  await page.goto("/");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["Current mogis", "Previous mogis"]);
  await expect(main.getByRole("list").getByRole("button")).toHaveText([
    "Instructions",
    "Release Notes",
    "Tracks",
    "Mogi Tier D · 2v2Race 1 of 12 · XO leads with 27",
    "Mogi Tier B · FFAPlayer 1 won · 180Oct 27",
    "Mogi Tier A · 3v3KZ won · 444Oct 26",
  ]);
  const currentRow = main.getByRole("button", { name: /^Mogi Tier D · 2v2/ });
  await expect(currentRow).toBeFocused();
  await expect(currentRow).toHaveAttribute("aria-current", "true");
  await page.setViewportSize({ width: 1280, height: 812 });
  const sidebar = page.getByRole("complementary");
  await sidebar.getByRole("button", { name: /^Mogi Tier D · 2v2/ }).click();
  await expect(sidebar.getByRole("heading", { level: 2 })).toHaveText(["Current mogis", "Previous mogis"]);
  await expect(sidebar.getByRole("button", { name: /^Mogi Tier D · 2v2/ })).toHaveAttribute("aria-current", "true");
  await expect(sidebar.getByText("Race 1 of 12 · XO leads with 27", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Player 1 won · 180", { exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: /^Mogi Tier B · FFA/ }).click();
  await expect(page).toHaveURL(/mogi=previous-ffa/);
  await expect(sidebar.getByRole("button", { name: /^Mogi Tier B · FFA/ })).toHaveAttribute("aria-current", "true");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Mogi Tier D", exact: true })).toBeVisible();
  await openMogiSettings(page);
  await page.getByRole("button", { name: "Delete Mogi", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(sidebar.getByRole("heading", { level: 2 })).toHaveText(["Previous mogis"]);
  await expect(main.getByText("Choose a mogi, or paste a bot list in New Mogi.", { exact: true })).toBeVisible();
  await expect(main.getByRole("heading", { name: "No Mogis Yet", exact: true })).toHaveCount(0);
});

test("a three-way tie names every leader in the header and the list", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // Players 1 to 3 take turns winning, so after three races they share first with 37.
  const state = mogiState({
    roster: ffaRoster(),
    races: (mogi) =>
      Array.from({ length: 3 }, (_, race) => {
        const ids = mogi.participants.map(({ id }) => id);
        const top = ids.slice(0, 3);
        return {
          id: `r${race + 1}`,
          origin: "manual" as const,
          number: race + 1,
          placements: [...top.slice(race), ...top.slice(0, race), ...ids.slice(3)],
        };
      }),
  });
  await restoreState(page, state);
  const tied = "Player 1, Player 2 and Player 3 are tied";
  await expect(page.getByRole("main").getByText(tied, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("main").getByRole("button", { name: /^Mogi Tier D · FFA/ })).toHaveText(
    `Mogi Tier D · FFARace 3 of 12 · ${tied} at 37`,
  );
});
