---
feature: ci-pipeline
status: superseded
updated: 2026-09-13
branch: feature/ci-pipeline
superseded_by: .claude/skills/cicd-pipeline/SKILL.md (current pipeline: coverage on every run, main ruleset, PR #4)
---

# CI Pipeline — Minimal Tests + GitHub Actions

## Report

## [S1] Problem

The team needs a CI pipeline that gates PRs before Sprint 1 begins. Without tests, CI has nothing to run. Without CI, tests aren't enforced. Both must exist together as a single deliverable.

## [S2] Design

### Tests

Four tests with `@tc` metadata blocks (comment-based tags for future sheet automation):

| TC ID | Layer | What it verifies |
|---|---|---|
| TC-INFRA-01 | pytest | `GET /api/health` returns 200 `{"status": "ok"}` |
| TC-INFRA-02 | pytest | `GET /api/ping` returns 200 `{"message": "pong"}` |
| TC-INFRA-03 | vitest | App renders heading and ping button |
| TC-INFRA-04 | vitest | Ping button calls `/api/ping` and displays result (API mocked) |

### @tc metadata format

Each test file begins with comment blocks:

```
# @tc: TC-INFRA-01        (or // for JS)
# @story: INFRA
# @ac: 1
# @type: Happy
# @scenario: <one-line description>
# @preconditions: <state needed>
# @steps: <numbered steps>
# @test_data: <inputs>
# @expected: <expected result>
```

### CI workflow (`.github/workflows/ci.yml`)

- Triggers on `pull_request` to `main`
- Job 1 `backend-tests`: Python 3.12, pip install, pytest with coverage
- Job 2 `frontend-tests`: Node 22, npm ci, vitest with coverage
- Both jobs run in parallel; both must pass for merge
- Coverage reports uploaded as artifacts

### Folder structure (agreed convention)

Tests co-located with their packages. E2E gets its own root directory when added (Phase 4).

```
backend/
  app.py
  requirements.txt
  pytest.ini
  tests/
    conftest.py
    test_health.py       # TC-INFRA-01
    test_ping.py         # TC-INFRA-02
frontend/
  src/
    App.jsx
    __tests__/
      setup.js
      App.test.jsx       # TC-INFRA-03
      Ping.test.jsx      # TC-INFRA-04
  vitest.config.js
.github/workflows/ci.yml
```

## [S3] Out of Scope

- Playwright E2E (Phase 4)
- Google Sheets logging (Phase 4)
- Skills (Phase 5)
- Feature code (DataStore, events, etc.)
- Branch protection setup (manual step on GitHub)

## Tasks

- [ ] T1: Backend pytest tests with @tc metadata — acceptance: `pytest` passes 2/2 (covers: S2)
- [ ] T2: Frontend vitest tests with @tc metadata — acceptance: `vitest run` passes 2/2 (covers: S2)
- [ ] T3: GitHub Actions workflow — acceptance: `ci.yml` triggers on PR, runs both jobs (covers: S2)
- [ ] T4: Verify both suites pass locally — acceptance: green output from both commands (covers: S2; depends: T1, T2)
