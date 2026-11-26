import { expect, test } from "@playwright/test";

test.describe("Slice 4 Search Profiles, Overview & Matching", () => {
  test("creates a search profile with 100% weights, imports a job, runs deterministic match, and displays ranked Overview", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Add a verified skill in Career Profile
    await page.goto("/profile");
    await page.getByRole("tab", { name: /Skills/i }).click();
    await page.getByRole("button", { name: /Add skill/i }).click();
    await page.getByPlaceholder("TypeScript").fill("TypeScript");
    await page.getByRole("button", { name: /Save skill/i }).click();
    await expect(page.getByText("TypeScript", { exact: true }).first()).toBeVisible();

    // 2. Create Search Profile with weighted must-have skill and 100% weights
    await page.goto("/search-profiles");
    await page.getByRole("button", { name: /New search profile/i }).click();
    await page.getByLabel(/Profile name/i).fill("Backend Platform");
    await page.getByLabel(/Skill label/i).fill("TypeScript");
    await page
      .locator("section")
      .filter({ has: page.getByLabel(/Skill label/i) })
      .getByRole("button", { name: "Add", exact: true })
      .click();
    await page.getByRole("button", { name: /Create profile/i }).click();
    await expect(page.getByText("Backend Platform", { exact: true }).first()).toBeVisible();

    // 3. Import a job on Discover and inspect its deterministic match
    await page.goto("/discover");
    await page.getByRole("button", { name: /Import job/i }).first().click();
    await page.getByLabel(/Job title/i).fill("Senior Backend Platform Engineer");
    await page.getByLabel(/Company/i).fill("Horizon Data");
    await page
      .getByLabel(/Pasted job description/i)
      .fill("Requirements:\n- Strong TypeScript and SQLite backend architecture experience.\n- Remote friendly.");
    await page.getByRole("dialog").getByRole("button", { name: /Import job/i }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /Analyze job/i }).click();
    await page.getByRole("button", { name: /Recompute match/i }).click();
    await expect(page.getByText(/Documented fit/i).first()).toBeVisible();

    // 4. Overview shows the ranked recommendation
    await page.goto("/");
    await expect(page.getByText("Senior Backend Platform Engineer").first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
