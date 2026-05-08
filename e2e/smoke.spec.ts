import { expect, test } from "@playwright/test";

test("loads playable arena and feedback modal", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Feedback" }).click({ timeout: 5_000 });
  await expect(page.getByRole("dialog", { name: "Combat feedback" })).toBeVisible();
});
