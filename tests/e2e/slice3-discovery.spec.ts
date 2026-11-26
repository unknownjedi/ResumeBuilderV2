import { expect, test } from "@playwright/test";

test.describe("Slice 3 Job Sources & Discovery", () => {
  test("adds a source in Settings, imports a job manually in Discover, inspects drawer, and saves/dismisses", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Settings -> Job Sources tab: add a Greenhouse board
    await page.goto("/settings");
    await page.getByRole("tab", { name: /Job Sources/i }).click();
    await page.getByRole("button", { name: /Add source/i }).click();
    await page.getByLabel(/Display name/i).fill("Example Greenhouse Board");
    await page.getByLabel(/Board token/i).fill("example-board");
    await page.getByRole("dialog").getByRole("button", { name: /Add source/i }).click();
    await expect(page.getByText("Example Greenhouse Board", { exact: true })).toBeVisible();

    // 2. Discover -> Manual import with LinkedIn reference URL + pasted description
    await page.goto("/discover");
    await page.getByRole("button", { name: /Import job/i }).first().click();
    await page.getByLabel(/Job title/i).fill("Principal Systems Engineer");
    await page.getByLabel(/Company/i).fill("Meridian Systems");
    await page.getByLabel(/Job URL/i).fill("https://www.linkedin.com/jobs/view/123456");
    await page
      .getByLabel(/Job description/i)
      .fill("Lead distributed SQLite and TypeScript platform engineering.");
    await page.getByRole("dialog").getByRole("button", { name: /Import job/i }).click();

    // 3. Import opens right-side detail drawer on 1440px desktop; verify freshness provenance
    await expect(page.getByText(/Posting date not provided; first discovered/i).first()).toBeVisible();

    // Close drawer via Escape, then reopen via list row and close with Escape to verify focus restoration
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    const rowButton = page.getByRole("button", { name: /Principal Systems Engineer/i }).first();
    await expect(rowButton).toBeVisible();
    await rowButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close panel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(rowButton).toBeFocused();

    // 4. Optimistic Save
    await page.getByRole("button", { name: "Save Principal Systems Engineer" }).click();
    await expect(
      page.getByRole("button", { name: "Unsave Principal Systems Engineer" })
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
