---
name: cicd-pipeline
description: How the CI/CD pipeline works for this project — branch model, what runs on PR, how to interpret failures, and the PR workflow. Use when pushing code, opening PRs, debugging CI failures, or asking about tests, pipeline, or merge process.
---

# CI/CD Pipeline

## Branch model

```
<type>/SCRUM-<n>-<short-slug> → PR to main → CI green + review → author merges → branch deleted
```

- One story per branch. Branch naming: `<type>/SCRUM-<n>-<short-slug>`, type ∈ `feature`, `fix`, `docs`, `chore`. Example: `feature/SCRUM-26-login`.
- Commit messages and PR titles start with the Jira key: `SCRUM-26: add password hashing`.
- `main` is always green. Only merge after CI passes.
- Push freely to story branches. CI only runs on PRs to main.

## What runs on every PR to main

| Order | Job | Tool | What it tests |
|---|---|---|---|
| 1 | Pytest | pytest | Backend unit tests (`backend/tests/`) |
| 2 | Vitest | vitest | Frontend unit tests (`frontend/src/__tests__/`) |
| 3 | Functional | Playwright | Browser tests (`functional/tests/`) |
| 4 | Log to Sheet | Node.js | Appends every result to the Executions tab of the team test sheet |

Jobs 1–3 run in parallel. All must pass for merge. Job 4 runs after and logs results. It never edits the Test cases tab; those rows are written by the team before the story is built (see `docs/test-cases/PROMPT.md`).

## How to run tests locally before pushing

```bash
# Backend unit tests
cd backend && python -m pytest tests/ -v

# Frontend unit tests
cd frontend && npm run test

# Functional tests (auto-starts Flask + Vite)
cd functional && npm run test
```

## Interpreting failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Pytest red | Backend test assertion failed | Run `pytest tests/ -v` locally, find the failing test, fix code or test |
| Vitest red | Frontend test failed | Run `npm run test` locally, check the test file |
| Functional red | Playwright browser test failed | Run `npm run test` locally, check the spec file |
| "MISSING DEPENDENCY" | npm package not in package.json | Run `npm install --save-dev <package>` in the correct directory |
| Log to Sheet fails | Webhook URL missing or invalid | Check `SHEETS_WEBHOOK_URL` secret in GitHub settings; non-blocking so other jobs still count |
| Execution logged without a TC ID | `@test` header does not match the `test()` name | Fix the header or the test name so they match exactly |

## PR workflow

1. Create the story branch off `main`
2. Test cases for the story are curated and reviewed in the sheet (`docs/test-cases/PROMPT.md`)
3. Write code + tests (`docs/test-cases/AUTOMATION.md`)
4. Run tests locally (all three suites)
5. Commit and push
6. Open PR to main: title `SCRUM-<n>: …`; description states what was built, which TC IDs are covered, and where AI was used
7. Wait for CI to pass (all three green)
8. A Developer other than the author reviews and approves
9. The author merges; the branch is deleted

## Important

- After `npm install`, commit BOTH `package.json` AND `package-lock.json`
- CI runs `npm ci` which requires the lockfile to be up to date
- Never commit `.env`, secrets, or API keys
- The Log to Sheet job uses `if: always()` — it runs even if tests fail, so failures are always logged
