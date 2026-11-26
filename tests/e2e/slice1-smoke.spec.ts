import { expect, test } from "@playwright/test";

test.describe("Slice 1 Local Foundation Smoke", () => {
  test("renders primary views, enforces CSP nonce, supports Cmd+K navigation, and persists CLI AI settings", async ({
    page,
    request,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    const cspHeader = res?.headers()["content-security-policy"] ?? "";
    expect(cspHeader).toContain("script-src 'self' 'nonce-");
    expect(cspHeader).not.toContain("'unsafe-eval'");

    await expect(page.getByRole("heading", { name: "Overview", level: 2 })).toBeVisible();

    // Verify all 7 navigation links exist
    for (const label of [
      "Overview",
      "Discover jobs",
      "Career profile",
      "Search profiles",
      "Applications",
      "Resumes",
      "Settings",
    ]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    // Verify health and diagnostics endpoints
    const healthRes = await request.get("/api/health");
    expect(healthRes.status()).toBe(200);
    const diagRes = await request.get("/api/diagnostics");
    expect(diagRes.status()).toBe(200);
    const diagJson = await diagRes.json();
    expect(diagJson.diagnostics?.playwrightVersion).toBe("1.65.1");
    expect(diagJson.diagnostics?.pdfBrowser?.available).toBe(true);

    // Open Command Palette via Control+K / Meta+K and navigate to Settings
    const modifier = process.platform === "darwin" ? "Meta+k" : "Control+k";
    await page.keyboard.press(modifier);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("Command search").fill("Settings");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings$/);

    // Update AI CLI preset + model and verify persistence across reload
    await page.getByRole("button", { name: /OpenCode/i }).click();
    const modelInput = page.getByLabel(/Model name/i);
    await modelInput.fill("anthropic/claude-sonnet-4");
    await page.getByRole("button", { name: /Save AI settings/i }).click();
    await expect(page.getByText(/AI provider settings saved/i)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/Model name/i)).toHaveValue("anthropic/claude-sonnet-4");

    // Check SSE endpoint returns ready event
    const sseCheck = await page.evaluate(async () => {
      return await new Promise<string>((resolve, reject) => {
        const es = new EventSource("/api/events");
        const timer = setTimeout(() => {
          es.close();
          reject(new Error("SSE ready timeout"));
        }, 5000);
        es.addEventListener("ready", (ev) => {
          clearTimeout(timer);
          es.close();
          resolve((ev as MessageEvent).data);
        });
        es.onerror = () => {
          clearTimeout(timer);
          es.close();
          reject(new Error("SSE error"));
        };
      });
    });
    expect(sseCheck).toContain("cursor");

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
