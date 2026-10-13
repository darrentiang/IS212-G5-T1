# Agent instructions — IS212-G5-T1 (ConnectSphere)

Read this file first in every session, then the documents it names, before touching a story. It applies to every AI tool used on this repository (Claude Code, Codex, Copilot, Cursor and others); `CLAUDE.md` and `.github/copilot-instructions.md` point here.

## 1. Read in this order
1. `docs/design/state-model.md` — the only status names and transitions that exist. Never invent a status.
2. `docs/design/permissions.md` — which role may do what. An account may hold several roles; it may do anything any of its roles allows.
3. `docs/design/ui-guidelines.md` — what every page shows and the `data-testid` of every element; functional tests use only these ids. `docs/design/frontend.md` — how the front end is built (area folders, routing, API calls, errors, styling).
4. `docs/adr/` — architecture decisions. ADR-001 fixes the stack (React front end; Flask API owns every business rule; SQLAlchemy with SQLite for development and CI; Flask session auth with seeded accounts). ADR-002 fixes authorisation (feature matrix in `backend/permissions.py`, `require()` on routes, object rules in services, front-end route guards). ADR-003: in-app notifications written by the API, no worker. Rules live in the API, never only in the browser.
5. `docs/test-cases/PROMPT.md`, `docs/test-cases/CURATION.md` and `docs/test-cases/AUTOMATION.md` — how test cases are drafted, curated, and proved by tests.
6. `.claude/skills/*` — pytest, Vitest, Playwright and CI conventions; `docs/test-cases/COVERAGE.md` — how much of a story's code its tests must reach.
7. The story itself, from the Backlog tab of the team scrum workbook (SharePoint), verbatim (see §3).

## 2. Identifiers
- The story key (`SCRUM-nn`) is the only story identifier. Never use `PB-nn` or area numbers; `Backlog ID: PB-nn` lines in old Jira descriptions are history only.
- Test case IDs: `TC-SCRUM-<n>-<nn>`.
- Branch: `<type>/SCRUM-<n>-<short-slug>`, type ∈ feature, fix, docs, chore. Commit messages and PR titles start with the key: `SCRUM-26: add password hashing`.

## 3. Stories and acceptance criteria
- Acceptance criteria come from the story's row in the Backlog tab: the Acceptance criteria column, verbatim. Do not paraphrase, merge, drop or add criteria. If a criterion is unclear or contradicts a design document, stop and say so; the Product Owner decides.
- The same row's Links and notes column holds working rules, team decisions and "Take note" lines; its Change history column shows what changed in the story and when.
- A "Working rule" or "Team decision D-nn" note in a story's Links and notes is a rule to build to; it is in force until the customer says otherwise.
- A "Take note" line names the design documents (state model, permissions, seed data, C4 diagrams) the story's pull request must update. While `docs/design/target/` exists, the wording to copy is there: take only this story's slice.
- Adding a status, transition, permission or role requires changing `state-model.md` or `permissions.md` in the same pull request as the story.

## 4. Flow for a story
1. Read §1 documents and the story.
2. Draft functional test cases with `PROMPT.md`; a developer curates with `CURATION.md`, a second reviews; rows go into the team test sheet. No code before this.
3. Build. Backend rules first (unit tests as you go) in `backend/areas/<area>/`, then the API route, then the front end per `docs/design/frontend.md`, inside the area folder the story's Area column maps to (pages call their area's `api.js`, never `fetch`).
4. Write the Playwright spec and unit tests per `AUTOMATION.md`. Unit tests for a story live in that story's feature test file (`backend/tests/test_<feature>.py`, `frontend/src/areas/<area>/__tests__/<Name>Page.test.jsx`) and test only what the story adds or changes, never other features.
   - Test data (backend): new tests build the data they depend on with helpers from `backend/tests/factories.py` and pass the values that matter explicitly. From the seed they may rely only on reference data (roles and the fixed lists: facilities, accessibility features, layouts, equipment types) and the seeded accounts used to log in. Existing tests move to this style when their story is next touched; no bulk rewrite.
   - Development loop: while building, run only the affected test file(s) with `pytest <file> --no-cov`. Run the full backend suite (with coverage), Vitest and Playwright once, before reporting back; they print coverage.
5. Open the pull request: title `SCRUM-nn: …`; description states what was built, which TC IDs are covered, and where AI was used. CI must be green. A Developer other than the author approves; the author merges; the branch is deleted.

## 5. Definition of Done (per story)
Acceptance criteria shown to the Product Owner; merged through a reviewed pull request with CI green; the reviewer has read the change, including AI-generated code, and can explain it; no known defect open; design documents updated where the change touches them; every test-case row for the story has a passing functional test; the story's files are 100 % covered or the pull request states why (`docs/test-cases/COVERAGE.md`).

## 6. Never
- Never change a status name, transition, role or permission without changing the design document in the same PR.
- Never write application code in the same run as drafting test cases.
- Never mark a test-case row passed by hand; CI records results.
- Never cite what the customer told another section; only G5 clarifications and the team's decision log count.
- Never commit secrets, `.env`, `node_modules`, or generated reports.
