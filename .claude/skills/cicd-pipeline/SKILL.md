---
name: cicd-pipeline
description: How the CI/CD pipeline works for this project — branch model, what runs on PR, how to interpret failures, and the PR workflow. Use when pushing code, opening PRs, debugging CI failures, or asking about tests, pipeline, or merge process.
---

# CI/CD Pipeline

## Branch model

```
feature/* → PR to main → CI must pass → merge
```

- One feature per branch. Branch naming: `feature/<short-description>`
- `main` is always green. Only merge after CI passes.
- Push freely to feature branches. CI only runs on PRs to main.

## What runs on every PR to main

| Order | Job | Tool | What it tests |
|---|---|---|---|
| 1 | Pytest | pytest | Backend unit tests (`backend/tests/`) |
| 2 | Vitest | vitest | Frontend unit tests (`frontend/src/__tests__/`) |
| 3 | Functional | Playwright | Browser tests (`functional/tests/`) |
| 4 | Log to Sheet | Node.js | Posts results to Google Sheet |

Jobs 1–3 run in parallel. All must pass for merge. Job 4 runs after and logs results.

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

## PR workflow

1. Create feature branch off main
2. Write code + tests
3. Run tests locally (all three suites)
4. Commit and push
5. Open PR to main
6. Wait for CI to pass (all three green)
7. Get peer review approval
8. Merge to main

## Important

- After `npm install`, commit BOTH `package.json` AND `package-lock.json`
- CI runs `npm ci` which requires the lockfile to be up to date
- Never commit `.env`, secrets, or API keys
- The Log to Sheet job uses `if: always()` — it runs even if tests fail, so failures are always logged
