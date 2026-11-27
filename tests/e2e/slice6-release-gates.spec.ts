import { expect, test } from "@playwright/test";

const WORKSPACE_ROUTES = [
  { path: "/", heading: /Overview/i },
  { path: "/discover", heading: /Discover jobs/i },
  { path: "/profile", heading: /Career profile/i },
  { path: "/search-profiles", heading: /Search profiles/i },
  { path: "/resumes", heading: /Resumes/i },
  { path: "/applications", heading: /Applications/i },
  { path: "/settings", heading: /Workspace settings/i },
];

test.describe("Slice 6 Release Gates: Backup/Restore, Reset, Accessibility & Responsive Audit", () => {
  test("creates a backup, validates and restores after mutation, and clears workspace with typed confirmation", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Ensure known profile baseline
    await page.goto("/profile");
    await page.getByLabel(/Full name/i).fill("Before Backup Name");
    await page.getByLabel(/Professional headline/i).fill("Snapshot Anchor Engineer");
    await page.getByRole("button", { name: /Save contact & summary/i }).click();
    await expect(page.getByText("Contact & headline saved", { exact: true })).toBeVisible();

    // 2. Create backup in Settings -> Resume Defaults & Backups
    await page.goto("/settings");
    await page.getByRole("tab", { name: /Resume Defaults & Backups/i }).click();

    await page.getByRole("button", { name: /Create backup now/i }).first().click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText(/Backup created/i).first()).toBeVisible({
      timeout: 10000,
    });

    const restoreBtn = page.getByRole("button", { name: /^Restore$/i }).first();
    await expect(restoreBtn).toBeVisible();

    // 3. Mutate profile after backup
    await page.goto("/profile");
    await page.getByLabel(/Full name/i).fill("Mutated After Backup");
    await page.getByRole("button", { name: /Save contact & summary/i }).click();
    await expect(page.getByText("Contact & headline saved", { exact: true })).toBeVisible();

    // 4. Validate & Restore from the backup archive
    await page.goto("/settings");
    await page.getByRole("tab", { name: /Resume Defaults & Backups/i }).click();
    await page.getByRole("button", { name: /^Restore$/i }).first().click();

    await expect(page.getByText(/DB integrity OK/i).first()).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole("button", { name: /Continue to restore/i }).click();
    const restoreDialog = page.getByRole("dialog");
    await expect(restoreDialog).toBeVisible();
    await restoreDialog.getByRole("button", { name: /Restore workspace/i }).click();
    await expect(restoreDialog).not.toBeVisible({ timeout: 10000 });

    // 5. Verify profile data matches pre-mutation snapshot
    await page.goto("/profile");
    await expect(page.getByLabel(/Full name/i)).toHaveValue("Before Backup Name");

    // 6. Test Danger Zone typed confirmation reset
    await page.goto("/settings");
    await page.getByRole("tab", { name: /Resume Defaults & Backups/i }).click();
    await page.getByRole("button", { name: /Delete all local data/i }).click();
    const resetDialog = page.getByRole("dialog");
    await expect(resetDialog).toBeVisible();
    const confirmDeleteBtn = resetDialog.getByRole("button", {
      name: /Delete all local data/i,
    });
    await expect(confirmDeleteBtn).toBeDisabled();

    await resetDialog
      .getByPlaceholder("DELETE ALL LOCAL DATA")
      .fill("DELETE ALL LOCAL DATA");
    await expect(confirmDeleteBtn).toBeEnabled();
    await confirmDeleteBtn.click();
    await expect(resetDialog).not.toBeVisible({ timeout: 10000 });

    // Verify clean empty state after reset
    await page.goto("/profile");
    await expect(page.getByLabel(/Full name/i)).toHaveValue("");

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("renders cleanly across desktop 1440x900 and mobile 390x844 with reduced-motion and keyboard escape", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.emulateMedia({ reducedMotion: "reduce" });

    // Desktop pass + keyboard Cmd/Meta+K dialog escape test
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of WORKSPACE_ROUTES) {
      await page.goto(route.path);
      await expect(
        page.getByRole("heading", { name: route.heading, level: 2 }).first()
      ).toBeVisible();
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(hasOverflow, `Unexpected horizontal overflow on ${route.path} desktop`).toBe(
        false
      );
    }

    // Keyboard Cmd+K palette open and Escape dismiss
    await page.keyboard.press("Tab");
    const cmdTrigger = page.getByRole("button", { name: /Command/i }).first();
    await cmdTrigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Mobile 390x844 responsive pass
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of WORKSPACE_ROUTES) {
      await page.goto(route.path);
      await expect(
        page.getByRole("heading", { name: route.heading, level: 2 }).first()
      ).toBeVisible();
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(hasOverflow, `Unexpected horizontal overflow on ${route.path} mobile`).toBe(
        false
      );
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
