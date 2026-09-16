# ADR-001: Technology stack

**Status:** Accepted · **Decided:** 13-09-2026 · **Recorded:** 15-09-2026 · **Owners:** Hong Yi (runtime), Kieren and Lisa (C4)

## Context
Release 1 must run from a clean checkout on any team member's machine and in CI, enforce role-based access and booking rules server-side, and be fully unit-testable in the stack taught in the module (Python, Flask, SQLAlchemy). The team has five developers with mixed React and Python experience.

## Decision
- **Front end:** React 19 with Vite and Tailwind CSS. Code is split by area (`frontend/src/areas/<area>/`, one per group of Jira area labels) so Developers on different stories rarely edit the same file. `fetch` is called in one place, `frontend/src/app/http.js`; each area's `api.js` holds that area's calls and pages never call `fetch` directly (`docs/design/frontend.md`).
- **API:** Python Flask. The API owns every business rule: state transitions (`docs/design/state-model.md`), permissions (`docs/design/permissions.md`, ADR-002), conflict detection, warnings. The browser only reflects what the API decides.
- **Data:** SQLAlchemy with SQLite for development and CI. PostgreSQL only as a plain connection string if a hosted demo is ever needed; no code may depend on Postgres-specific features.
- **Authentication:** Flask session cookies with accounts seeded per role (customer clarification: onboarding is outside this release). No third-party auth.
- **Tests:** pytest (backend), Vitest with Testing Library (frontend), Playwright (functional). Coverage measured on every run.
- **Delivery:** GitHub, pull requests to `main`, GitHub Actions running all three suites on every PR (`.claude/skills/cicd-pipeline/SKILL.md`).

## Alternatives considered
- **Supabase as database and auth (rejected 14-09-2026):** rules would sit in the browser or in a service the team cannot unit-test in the taught stack; no requirement needs its features.
- **JSON file as the data store (rejected):** no transactions, no reliable conflict detection for double-booking.
- **Mock Service Worker for front-end tests (rejected):** functional tests run against the real API; front-end unit tests mock the area's `api.js`.

## Consequences
Every rule has one home and one unit test. Local setup is `pip install`, `npm install`, `npx playwright install chromium`. A hosted demo, if wanted, is a deployment concern, not a design change.
