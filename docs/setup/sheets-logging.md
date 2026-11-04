---
feature: sheets-logging
status: superseded
updated: 2026-11-05
branch: feature/sheets-logging
superseded_by: docs/test-cases/AUTOMATION.md and .github/scripts/log-results.js (CI appends Executions only; the testcases action is retired, PR #3)
---

# Google Sheets Logging

## Report

**What was built** — Apps Script (deployed to Google Sheets) with two endpoints: `?action=testcases` (upsert, no dupes) and `?action=executions` (append). CI-side scripts in `.github/scripts/`: `parse-metadata.js` extracts `@tc` blocks from all test files; `log-results.js` collects results from pytest/vitest/playwright, maps to TC IDs via the `@test` field, and POSTs to the Apps Script. CI workflow gained a fourth job (`log-to-sheet`) that runs after all three test jobs, downloads their result artifacts, and calls the logging script. Each test file now includes a `@test` field mapping the TC ID to the test function name.

**Verification** — `parse-metadata.js` correctly extracts 5 TCs. `log-results.js` collects 5 results (2 pytest + 2 vitest + 1 playwright) and maps all TC IDs. POST fails locally (no webhook) as expected.

**Journey log** — Vitest JSON report uses `title` not `name` for individual test assertions. Playwright JSON uses `suites[].specs[].title`. The `@test` metadata field is essential for reliable TC ID mapping — without it, name matching is fragile. `tcLookupByName` must be built before the collection functions run (temporal dead zone with `const`).

## [S1] Problem

Test results need to be logged to a Google Sheet for evidence collection. The Test cases sheet needs upsert behavior (no dupes). The Executions sheet needs append-only logging. CI needs to map test results to TC IDs reliably.

## [S2] Design

### Apps Script (scripts/apps-script.gs)

Deployed as a Google Sheets Web App. Two endpoints:

| Endpoint | Action | Behavior |
|---|---|---|
| `?action=testcases` | Upsert | Update row if TC ID exists, append if new |
| `?action=executions` | Append | Add one row per execution |

Tab names required: `Test cases`, `Executions`.

### @tc metadata format (updated)

Each test file now includes a `@test` field mapping TC ID to the test function name:

```
# @tc: TC-INFRA-01
# @test: test_health_returns_200       ← new field
# @story: INFRA
# @ac: 1
# @type: Happy
# @scenario: ...
# @preconditions: ...
# @steps: ...
# @test_data: ...
# @expected: ...
```

### CI scripts

| Script | Purpose |
|---|---|
| `.github/scripts/parse-metadata.js` | Scans test files, extracts `@tc` blocks, outputs JSON |
| `.github/scripts/log-results.js` | Collects results from all frameworks, maps to TC IDs, POSTs to sheet |
| `.github/scripts/apps-script.gs` | Reference copy of the Google Sheets Apps Script |

`log-results.js` reads:
- `backend/junit.xml` (pytest JUnit XML)
- `frontend/vitest-report.json` (vitest JSON reporter)
- `functional/test-results/functional-results.json` (playwright JSON reporter)

### CI workflow (updated)

Four jobs:

| Job | Runs | Uploads |
|---|---|---|
| `backend-tests` | pytest | junit.xml, coverage.xml |
| `frontend-tests` | vitest | vitest-report.json, coverage |
| `functional-tests` | playwright | functional-results.json, report |
| `log-to-sheet` | log-results.js | (needs all three above) |

`log-to-sheet` downloads all artifact files, copies them to expected paths, and runs `log-results.js`. Gated on `SHEETS_WEBHOOK_URL` secret being set.

### Report file configs

- `backend/pytest.ini`: `addopts = --junitxml=junit.xml`
- `frontend/package.json`: vitest runs with `--reporter=json --outputFile=vitest-report.json`
- `functional/playwright.config.js`: JSON reporter already configured

## [S3] Out of Scope

- Skills (next phase)
- docs/TESTING.md (next phase)
- Authentication on the Apps Script webhook (acceptable for a student project)

## Tasks

- [x] T1: Apps Script with testcases upsert + executions append — acceptance: script deploys and handles both actions (covers: S2)
- [x] T2: parse-metadata.js extracts @tc blocks including @test field — acceptance: outputs 5 TCs with correct mappings (covers: S2)
- [x] T3: log-results.js collects results and maps TC IDs — acceptance: 5 results collected, all mapped (covers: S2; depends: T2)
- [x] T4: CI workflow with log-to-sheet job — acceptance: four jobs, logging gated on secret (covers: S2)
- [x] T5: Report file configs (pytest.ini, vitest, playwright) — acceptance: all three report files generated locally (covers: S2)
