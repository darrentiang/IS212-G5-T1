import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/functional-results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'python ../backend/seed.py --reset && python ../backend/app.py',
      port: 5000,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: 'npm run dev --prefix ../frontend',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
})
