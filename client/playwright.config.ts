import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests. They start the Vite dev server with dummy Supabase values, which is enough for the
 * smoke tests. The two-user call test needs real test accounts and a running server: see docs/testing.md.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream', // auto-accept the permission prompt
        '--use-fake-device-for-media-stream', // synthetic camera + beeping microphone
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        env: {
          VITE_API_URL: process.env.VITE_API_URL ?? 'http://localhost:4000',
          VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? 'https://example.supabase.co',
          VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? 'dummy-anon-key',
        },
      },
});
