import { expect, test } from "@playwright/test";

test.describe("Slice 5 Resume Tailoring Studio, Exports & Applications", () => {
  test("tailors a resume from an inspected job, edits bullets with autosave, exports DOCX/PDF, and marks application applied with confirmed snapshot", async ({
    page,
    request,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Seed verified profile identity, experience, and skill
    await page.goto("/profile");
    await page.getByLabel(/Full name/i).fill("Morgan Rivera");
    await page.getByLabel(/Email/i).fill("morgan@example.com");
    await page.getByLabel(/Professional headline/i).fill("Staff TypeScript Engineer");
    await page.getByRole("button", { name: /Save contact & summary/i }).click();
    await expect(page.getByText("Contact & headline saved", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: /Experience/i }).click();
    await page.getByRole("button", { name: /Add experience/i }).click();
    await page.getByPlaceholder("Senior Backend Engineer").fill("Lead Platform Engineer");
    await page.getByPlaceholder("Acme Corp").fill("Summit Cloud");
    await page
      .getByPlaceholder(/Key responsibilities, team scope/i)
      .fill("Built local-first TypeScript sync pipelines cutting export latency by 35%.");
    await page.getByLabel(/Mark immediately as Verified/i).check();
    await page.getByRole("button", { name: /Save experience/i }).click();
    await expect(page.getByText("Summit Cloud").first()).toBeVisible();

    await page.getByRole("tab", { name: /Skills/i }).click();
    await page.getByRole("button", { name: /Add skill/i }).click();
    await page.getByPlaceholder("TypeScript").fill("TypeScript");
    await page.getByRole("button", { name: /Save skill/i }).click();
    await expect(page.getByText("TypeScript", { exact: true }).first()).toBeVisible();

    // 2. Import job on Discover
    await page.goto("/discover");
    await page.getByRole("button", { name: /Import job/i }).first().click();
    await page.getByLabel(/Job title/i).fill("Principal Local-First Engineer");
    await page.getByLabel(/Company/i).fill("Kestrel Systems");
    await page
      .getByLabel(/Job URL/i)
      .fill("https://www.linkedin.com/jobs/view/999000111");
    await page
      .getByLabel(/Pasted job description/i)
      .fill(
        "Requirements:\n- Strong TypeScript architecture and document pipelines.\n- Remote engineering team."
      );
    await page.getByRole("dialog").getByRole("button", { name: /Import job/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // 3. Click "Tailor resume" from the Job Detail drawer
    const tailorPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/jobs/") && res.url().endsWith("/tailor-resume")
    );
    await page.getByRole("button", { name: /Tailor resume/i }).click();
    const tailorRes = await tailorPromise;
    expect(tailorRes.status(), await tailorRes.text()).toBe(200);
    await page.waitForURL(/\/resumes\/[a-zA-Z0-9-]+/, { timeout: 15000 });
    await expect(page.getByText("Principal Local-First Engineer").first()).toBeVisible();

    // 4. Edit a bullet & trigger 500ms autosave
    const firstBulletArea = page.locator('textarea[aria-label^="Bullet "]').first();
    await expect(firstBulletArea).toBeVisible();
    await firstBulletArea.fill(
      "Built local-first TypeScript sync pipelines cutting Kestrel-class export latency by 35%."
    );
    await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible({
      timeout: 5000,
    });

    // 5. Export DOCX & PDF and verify download endpoints respond 200 with attachment headers
    const exportDocxPromise = page.waitForResponse(
      (res) => res.url().includes("/api/resumes/") && res.url().endsWith("/export")
    );
    await page.getByRole("button", { name: /Export DOCX/i }).click();
    const docxExportRes = await exportDocxPromise;
    expect(docxExportRes.status()).toBe(200);
    const docxJson = (await docxExportRes.json()) as {
      ok: boolean;
      downloadUrl: string;
    };
    expect(docxJson.ok).toBe(true);
    const docxDownload = await request.get(docxJson.downloadUrl);
    expect(docxDownload.status()).toBe(200);
    expect(docxDownload.headers()["content-disposition"]).toContain("attachment");

    const exportPdfPromise = page.waitForResponse(
      (res) => res.url().includes("/api/resumes/") && res.url().endsWith("/export")
    );
    await page.getByRole("button", { name: /Export PDF/i }).click();
    const pdfExportRes = await exportPdfPromise;
    expect(pdfExportRes.status()).toBe(200);
    const pdfJson = (await pdfExportRes.json()) as {
      ok: boolean;
      downloadUrl: string;
    };
    const pdfDownload = await request.get(pdfJson.downloadUrl);
    expect(pdfDownload.status()).toBe(200);
    expect(pdfDownload.headers()["content-type"]).toContain("application/pdf");

    // 6. Navigate back to Discover -> Prepare application -> Applications page -> Mark applied via confirmation dialog
    await page.goto("/discover");
    await page.getByText("Principal Local-First Engineer").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /Prepare application/i }).click();
    await page.waitForURL(/\/applications/);

    await expect(page.getByText("Principal Local-First Engineer").first()).toBeVisible();
    await page.getByRole("button", { name: /Mark as applied/i }).click();
    const confirmDialog = page.getByRole("dialog");
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByText("Kestrel Systems").first()).toBeVisible();
    await confirmDialog
      .getByLabel(/I confirm that I personally completed/i)
      .check();
    await confirmDialog
      .getByRole("button", { name: /Confirm & mark applied/i })
      .click();

    await expect(page.getByText("Applied", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(/Submitted snapshot frozen/i).first()
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
