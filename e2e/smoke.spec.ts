import { expect, test } from "@playwright/test";

test("loads playable arena and feedback modal", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await page.keyboard.press("KeyD");
  await page.mouse.move(720, 360);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press("KeyJ");
  await page.keyboard.press("KeyK");
  await page.keyboard.press("KeyE");
  await page.getByRole("button", { name: "Feedback" }).click();
  await expect(page.getByRole("dialog", { name: "Combat feedback" })).toBeVisible();
});
