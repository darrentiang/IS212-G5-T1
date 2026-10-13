import { defineConfig, devices } from '@playwright/test'
import { CLOCK_FILE } from './tests/helpers/clock.js'

// Before the backend starts, any clock override left behind by a crashed run
// is deleted: a stale pinned file must never freeze time for the other specs
// in this run (SCRUM-49 plan §5). The backend then seeds the baseline and
// appends SCRUM-49's fixture rows (types, events, reservations) via
// seed.py --extra — normal demo data stays in seed/data.json alone.
const clearStaleClock = `python -c "import os,sys;p=sys.argv[1];os.path.exists(p) and os.remove(p)" "${CLOCK_FILE.replace(/\\/g, '/')}" &&`

export default defineConfig({
  testDir: './tests',
  // Every spec shares one SQLite file, seeded once per run by the backend
  // webServer command below, so specs must never run at the same time.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  // We retry to classify a test as flaky, not to make CI pass: a test that
  // fails and then passes on its retry is reported as flaky, and in CI any
  // flaky test fails the run. The retry also records the trace (below).
  retries: 1,
  failOnFlakyTests: !!process.env.CI,
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
      command: `${clearStaleClock} python ../backend/seed.py --reset && python ../backend/seed.py --extra fixtures/scrum49.json && python ../backend/app.py`,
      port: 5000,
      // Cross-platform way to hand the backend the override path; the file
      // itself is only ever written by SCRUM-49.spec.js (and cleared in
      // its beforeEach/afterEach).
      env: { ...process.env, CONNECTSPHERE_CLOCK_FILE: CLOCK_FILE },
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
