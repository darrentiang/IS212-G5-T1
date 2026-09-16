---
feature: functional-tests
status: superseded
updated: 2026-09-13
branch: feature/functional-tests
superseded_by: docs/test-cases/AUTOMATION.md (four-field link header, one test per curated row, PR #3)
---

# Functional Tests — Playwright Setup

## Report

**What was built** — Playwright functional test infrastructure in a top-level `functional/` directory. One example spec (`INFRA-01.spec.js`) tests the full stack: browser → React → Flask → response. The `playwright.config.js` auto-starts both Flask and Vite via `webServer` before tests run. CI gained a third job (`Functional`) that runs after unit tests, boots both servers, and executes Playwright. All three CI jobs must pass for merge.

**Verification** — `playwright test`: 1/1 passed locally. `pytest`: 2/2 passed. `vitest run`: 2/2 passed. All three verified before commit.

**Journey log** — Playwright's `webServer` array supports starting multiple servers (Flask + Vite) in a single config; no separate orchestration script needed. The `reuseExistingServer: !process.env.CI` flag means locally it reuses running servers, but in CI it always starts fresh.

## [S1] Problem

The CI pipeline only gates on unit tests. Functional tests — browser-based tests that verify one user story's flow through the real stack — need infrastructure, a config that boots both servers, and a CI job. Without this, teammates have no template for writing per-story functional tests.

## [S2] Design

### Naming convention

| Layer | Term | Tool | Location |
|---|---|---|---|
| Unit tests | Unit tests | pytest / vitest | `backend/tests/`, `frontend/src/__tests__/` |
| Functional tests | Functional tests | Playwright | `functional/tests/` |

Not called "E2E" — per-story functional tests verify one feature works through the full stack. The course (Week 4) defines functional tests as verifying "a function or feature works as intended."

### Folder structure

```
functional/
  tests/
    INFRA-01.spec.js       # example: ping flow through browser
  playwright.config.js     # webServer starts Flask + Vite
  package.json             # separate package for Playwright deps
```

### playwright.config.js

- `testDir: './tests'`
- `baseURL: 'http://localhost:5173'`
- `webServer` array starts:
  - Flask on port 5000 (`python ../backend/app.py`)
  - Vite on port 5173 (`npm run dev --prefix ../frontend`)
- `retries: 1` for flake tolerance
- HTML + JSON reporters
- Chromium only

### Example spec (INFRA-01.spec.js)

Tests the existing ping flow through the real browser:
1. Visit `http://localhost:5173`
2. Assert heading visible
3. Click "Ping Backend"
4. Assert "Backend says: pong" appears

Uses `@tc` metadata block (TC-INFRA-05) matching the established format.

### CI workflow (updated)

Three jobs on PR to main:

| Job | Name | Runs |
|---|---|---|
| `backend-tests` | Pytest | pytest with coverage |
| `frontend-tests` | Vitest | vitest with coverage |
| `functional-tests` | Functional | Playwright (starts both servers) |

All three must pass. Functional job installs Python, Node, and Playwright browsers, then runs `npx playwright test`.

### Per-story convention for teammates

Each user story gets one spec file named `<story-id>.spec.js`:
```
functional/tests/PB-01.spec.js   # Event Request Creation
functional/tests/PB-02.spec.js   # Draft Event Requests
```

Each spec contains multiple tests (Happy, Negative, Boundary) derived from the story's ACs, all with `@tc` metadata blocks.

## [S3] Out of Scope

- Google Sheets logging (next phase)
- Skills (next phase)
- docs/TESTING.md (next phase)
- Actual user story functional tests (teammates write these in Sprint 1)
- Multi-browser testing (Chromium only for now)

## Tasks

- [x] T1: Playwright infrastructure (config, package.json, folder) — acceptance: `npx playwright test` runs (covers: S2)
- [x] T2: Example functional spec (INFRA-01) — acceptance: 1/1 test passes locally (covers: S2; depends: T1)
- [x] T3: CI workflow with functional test job — acceptance: ci.yml has three jobs, all must pass (covers: S2)
- [x] T4: Verify all three suites pass locally — acceptance: pytest 2/2, vitest 2/2, playwright 1/1 (covers: S2; depends: T1, T2)
