import { expect, test } from "@playwright/test";

test("recognition reads a team standings capture, then the race 1 pre-race board where every total is a lone 0", async ({
  page,
}) => {
  test.setTimeout(60000);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const fixture = new URL("./recognition-contract-fixture.ts", import.meta.url).pathname;
  // One page and one worker; the second reading starts after the first settles.
  await page.route("**/__recognition-contract", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html lang="en"><body><script type="module">
    import "/@vite/client";
    const { readTeamStandings, readZeroPreRace } = await import("/@fs${fixture}");
    readTeamStandings();
    await window.teamStandingsRecognition.catch(() => {});
    readZeroPreRace();
  </script></body></html>`,
    }),
  );
  await page.goto("/__recognition-contract");
  await page.waitForFunction(() => !!window.teamStandingsRecognition);
  const observation = await page.evaluate(() => window.teamStandingsRecognition);
  expect(observation.interpretation.screen).toBe("teamStandings");
  expect(observation.rows).toHaveLength(12);
  expect(observation.rows[0].text).toBe("Tavo");
  expect(observation.rows[6].text).toBe("xxYoshi");
  // PP-OCRv6 Tiny misses the lone 1 that Small read; the group total below still reads 108.
  expect(observation.numericRows.map((row) => row.right.value)).toEqual([
    73,
    58,
    55,
    107,
    79,
    73,
    59,
    48,
    null,
    83,
    59,
    42,
  ]);
  expect(observation.interpretation.groups?.map((group) => group.total?.value)).toEqual([186, 259, 108, 184]);
  expect(observation.interpretation.groups?.every((group) => group.total?.uncertain === false)).toBe(true);

  await page.waitForFunction(() => !!window.zeroPreRaceRecognition);
  const zeros = await page.evaluate(() => window.zeroPreRaceRecognition);
  expect(zeros.interpretation.screen).toBe("twoColumnsByTeam");
  expect(zeros.numericRows.map((row) => row.right.value)).toEqual(Array(12).fill(0));
  expect(requests.filter((url) => url.endsWith("/ocr/paddle-worker.js"))).toHaveLength(1);
  expect(requests.some((url) => /traineddata|tesseract|worker\.min\.js/.test(url))).toBe(false);
});
