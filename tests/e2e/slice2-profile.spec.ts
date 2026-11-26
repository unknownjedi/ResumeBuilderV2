import { expect, test } from "@playwright/test";

test.describe("Slice 2 Career Profile & Resume Import", () => {
  test("creates verified profile facts manually and imports resume in No-AI raw text mode", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: /Career profile/i, level: 2 })).toBeVisible();

    // Update contact/headline manually
    await page.getByLabel(/Full name/i).fill("Taylor Morgan");
    await page.getByLabel(/Professional headline/i).fill("Staff Backend Engineer");
    await page.getByRole("button", { name: /Save contact & summary/i }).click();
    await expect(page.getByText(/Contact & headline saved/i)).toBeVisible();

    // Reload and verify persistence
    await page.reload();
    await expect(page.getByLabel(/Full name/i)).toHaveValue("Taylor Morgan");

    // Open Import resume panel and upload a Markdown resume without AI
    await page.getByRole("button", { name: /Import resume/i }).click();
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "taylor-resume.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Taylor Morgan\n\n## Experience\nSenior Systems Engineer at Meridian Cloud (2022 - Present)\n- Designed local-first SQLite task queue processing 10k jobs/day.\n"
      ),
    });

    // Side-by-side raw text viewer shows extracted text
    await expect(page.getByText(/Meridian Cloud/i).first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
