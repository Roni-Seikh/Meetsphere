import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Two real users, two isolated browser contexts, real WebRTC using Chromium's fake camera/microphone.
 *
 * Requires: server + client running against a real Supabase project with email confirmation disabled,
 * and two existing accounts supplied through environment variables (never commit them):
 *   E2E_USER1_EMAIL / E2E_USER1_PASSWORD   (this user hosts)
 *   E2E_USER2_EMAIL / E2E_USER2_PASSWORD
 * And real VITE_* values so the client can reach Supabase. See docs/testing.md.
 */
const u1 = { email: process.env.E2E_USER1_EMAIL, password: process.env.E2E_USER1_PASSWORD };
const u2 = { email: process.env.E2E_USER2_EMAIL, password: process.env.E2E_USER2_PASSWORD };
const configured = !!(u1.email && u1.password && u2.email && u2.password);

async function login(browser: Browser, creds: typeof u1): Promise<Page> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(creds.email!);
  await page.getByLabel('Password').fill(creds.password!);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return page;
}

test.describe('two-participant call', () => {
  test.skip(!configured, 'Set E2E_USER1_* and E2E_USER2_* to run the real two-user call test');

  test('host and guest connect, see video, chat, share state, and leave cleanly', async ({ browser }) => {
    const host = await login(browser, u1);
    const guest = await login(browser, u2);

    // Host creates a meeting and starts it
    await host.goto('/meetings/new');
    await host.getByLabel('Title').fill('E2E call');
    await host.getByRole('button', { name: /create meeting/i }).click();
    const code = (await host.locator('span.font-mono').first().textContent())!.trim();
    await host.getByRole('button', { name: /start now/i }).click();
    await host.getByRole('button', { name: /start meeting/i }).click();
    await expect(host.getByRole('toolbar', { name: /meeting controls/i })).toBeVisible();

    // Guest joins through the invite link
    await guest.goto(`/room/${code}`);
    await guest.getByRole('button', { name: /join now/i }).click();
    await expect(guest.getByRole('toolbar', { name: /meeting controls/i })).toBeVisible();

    // Both sides receive a remote video that is actually playing frames
    for (const page of [host, guest]) {
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const videos = [...document.querySelectorAll('video')].filter((v) => !v.muted);
              return videos.some((v) => v.videoWidth > 0 && v.readyState >= 2);
            }),
          { timeout: 30_000 },
        )
        .toBe(true);
    }

    // Mute indicator propagates
    await guest.getByRole('button', { name: /mute microphone/i }).click();
    await host.getByRole('button', { name: /participants/i }).click();
    await expect(host.getByLabel('Muted').first()).toBeVisible();

    // Chat in both directions
    await host.getByRole('button', { name: /^chat/i }).click();
    await guest.getByRole('button', { name: /^chat/i }).click();
    await guest.getByLabel('Message').fill('hello from guest');
    await guest.getByLabel('Message').press('Enter');
    await expect(host.getByText('hello from guest')).toBeVisible();

    // Guest leaves -> host's participant list drops back to one
    await guest.getByRole('button', { name: /leave meeting/i }).click();
    await expect(host.getByText(/participants \(1\)/i)).toBeVisible({ timeout: 15_000 });
  });
});
