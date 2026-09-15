# Agent instructions — IS212-G5-T1 (ConnectSphere)

Read this file first in every session, then the documents it names, before touching a story. It applies to every AI tool used on this repository (Claude Code, Codex, Copilot, Cursor and others); `CLAUDE.md` and `.github/copilot-instructions.md` point here.

## 1. Read in this order
1. `docs/design/state-model.md` — the only status names and transitions that exist. Never invent a status.
2. `docs/design/permissions.md` — which role may do what. An account may hold several roles; it may do anything any of its roles allows.
3. `docs/adr/` — architecture decisions. ADR-001 fixes the stack: React front end; Flask API owns every business rule; SQLAlchemy with SQLite for development and CI; Flask session auth with seeded accounts. Rules live in the API, never only in the browser.
4. `docs/test-cases/PROMPT.md` and `docs/test-cases/AUTOMATION.md` — how test cases are drafted and how tests prove them.
5. `.claude/skills/*` — pytest, Vitest, Playwright and CI conventions.
6. The story itself, from Jira, verbatim (see §3).

## 2. Identifiers
- The Jira key (`SCRUM-nn`) is the only story identifier. Never use `PB-nn` or area numbers; `Backlog ID: PB-nn` lines inside Jira descriptions are history only.
- Test case IDs: `TC-SCRUM-<n>-<nn>`.
- Branch: `<type>/SCRUM-<n>-<short-slug>`, type ∈ feature, fix, docs, chore. Commit messages and PR titles start with the key: `SCRUM-26: add password hashing`.

## 3. Stories and acceptance criteria
- Acceptance criteria come from the Jira story text. Do not paraphrase, merge, drop or add criteria. If a criterion is unclear or contradicts a design document, stop and say so; the Product Owner decides.
- A "Working rule" or "Team decision D-nn" note in a story description is a rule to build to; it is in force until the customer says otherwise.
- Adding a status, transition, permission or role requires changing `state-model.md` or `permissions.md` in the same pull request as the story.

## 4. Flow for a story
1. Read §1 documents and the story.
2. Draft functional test cases with `PROMPT.md`; a developer curates, a second reviews; rows go into the team test sheet. No code before this.
3. Build. Backend rules first (unit tests as you go), then the API route, then the front end through `frontend/src/api.js` (components never call `fetch` directly).
4. Write the Playwright spec and unit tests per `AUTOMATION.md`. Unit tests for a story live in that story's feature test file (`backend/tests/test_<feature>.py`, `frontend/src/__tests__/<Component>.test.jsx`) and test only what the story adds or changes, never other features. Run all three suites locally; they print coverage.
5. Open the pull request: title `SCRUM-nn: …`; description states what was built, which TC IDs are covered, and where AI was used. CI must be green. A Developer other than the author approves; the author merges; the branch is deleted.

## 5. Definition of Done (per story)
Acceptance criteria shown to the Product Owner; merged through a reviewed pull request with CI green; the reviewer has read the change, including AI-generated code, and can explain it; no known defect open; design documents updated where the change touches them; every test-case row for the story has a passing functional test.

## 6. Never
- Never change a status name, transition, role or permission without changing the design document in the same PR.
- Never write application code in the same run as drafting test cases.
- Never mark a test-case row passed by hand; CI records results.
- Never cite what the customer told another section; only G5 clarifications and the team's decision log count.
- Never commit secrets, `.env`, `node_modules`, or generated reports.
