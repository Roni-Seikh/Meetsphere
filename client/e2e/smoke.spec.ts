import { expect, test } from '@playwright/test';

test.describe('public pages (no backend required)', () => {
  test('landing page renders with calls to action', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /meetings that just work/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /get started/i })).toBeVisible();
  });

  test('protected routes redirect anonymous users to sign in', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('a room link also requires sign in', async ({ page }) => {
    await page.goto('/room/abc-defg-hij');
    await expect(page).toHaveURL(/\/login/);
  });

  test('registration validates password length', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Password').fill('short');
    await expect(page.getByText(/at least 8 characters/i).first()).toBeVisible();
  });

  test('unknown URLs show the 404 page', async ({ page }) => {
    await page.goto('/this-does-not-exist');
    await expect(page.getByText('404')).toBeVisible();
  });
});
