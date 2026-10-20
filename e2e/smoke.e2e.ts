// UI smoke test on the production build: open a file, see it drawn, switch 2D / 3D, select a lane and read it in the
// inspector; a broken file shows its problems banner instead of failing. Run: npm run build && npx playwright test
import { expect, test } from "@playwright/test";

const ONE_ROAD = "e2e/fixtures/one-road.xodr";

test("open a file, switch 2D / 3D, select a lane and see it in the inspector", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(ONE_ROAD);

  // drawn: the status bar names the file, the stats count one road and three lanes
  await expect(page.getByText("one-road.xodr").first()).toBeVisible();
  await expect(page.locator(".stats > div").filter({ hasText: "roads" })).toContainText("1");
  await expect(page.locator(".stats > div").filter({ hasText: "lanes" })).toContainText("3");

  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.getByRole("button", { name: "3D", exact: true })).toHaveClass(/on/);
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await expect(page.getByRole("button", { name: "2D", exact: true })).toHaveClass(/on/);

  // the map fits the road; just right of the reference line (the map's centre) lies lane -1. The camera may still be
  // moving after the 3D / 2D switch (slow CI runners), so the click is repeated until the inspector opens
  const map = page.locator(".stage canvas").first();
  const box = (await map.boundingBox())!;
  const inspector = page.locator("aside.inspector");
  await expect(async () => {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 12);
    await expect(inspector).toContainText("Road 1 · Smoke Street", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(inspector).toContainText(/Lane -[12]/);
  expect(errors).toEqual([]);
});

test("a file with problems is drawn and its problems listed; a broken file is refused with a message", async ({ page }) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]').first();
  const lanes = `<lanes><laneSection s="0"><center><lane id="0" type="none"/></center><right><lane id="-1" type="driving"><width sOffset="0" a="3" b="0" c="0" d="0"/></lane></right></laneSection></lanes>`;
  const withProblem = `<OpenDRIVE><header/><road id="1" length="10" junction="-1"><planView><geometry s="0" x="0" y="0" hdg="0" length="10"><line/></geometry></planView>${lanes}</road><road id="2" length="-1" junction="-1">${lanes}</road></OpenDRIVE>`;
  await input.setInputFiles({ name: "problem.xodr", mimeType: "application/xml", buffer: Buffer.from(withProblem) });
  await expect(page.locator(".banner-issues")).toContainText("1 problem reading problem.xodr");

  await input.setInputFiles({ name: "broken.xodr", mimeType: "application/xml", buffer: Buffer.from("<OpenDRIVE><header><road") });
  await expect(page.locator(".banner.error")).toContainText("malformed XML");
});
