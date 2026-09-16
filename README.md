# IS212-G5-T1 — ConnectSphere Event Planning and Venue Booking System

Section G5, Team 1. React front end, Flask API, SQLite, three test suites, GitHub Actions. This file is the onboarding guide: how to run it, how a story flows through the repository, and which document owns which rule. Nothing here is a rule itself; every rule links to its home.

## 1. Run it locally

Prerequisites: Python 3.12+, Node 22+, npm 10+. On a Mac, turn off AirPlay Receiver (System Settings → General → AirDrop & Handoff) or Flask cannot use port 5000.

```bash
# Backend (terminal 1)
cd backend
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python seed.py            # creates backend/instance/app.db with the seeded accounts
python app.py             # http://localhost:5000

# Frontend (terminal 2)
cd frontend
npm install
npm run dev               # http://localhost:5173, proxies /api to Flask

# Functional tests, once
cd functional
npm install
npx playwright install chromium
```

Log in at http://localhost:5173 with a seeded account: `org1`, `org2` (Event Organisers), `coord1`, `coord2` (Event Coordinators), `venue1` (Venue Staff), `tech1` (Technical Support Staff), `att1` (Attendee), `multi1` (Event Coordinator and Venue Staff). Password for all: `Passw0rd!`. Login works once SCRUM-26 is merged.

**After pulling `main`:** if `python app.py` refuses to start with `Database schema is v… code expects v…`, a story changed the database. Run `python seed.py --reset`. The development database is disposable; nothing in it is kept. If `npm run dev` fails on a missing module, run `npm install` again in that folder.

Run the tests (all three print coverage):

```bash
cd backend && pytest                 # API tests, in-memory database, never touches app.db
cd frontend && npm run test          # Vitest
cd functional && npm run test        # Playwright; starts Flask and Vite itself, reseeds first
```

## 2. How a story flows

One story, one branch, one pull request. The full rule set is `AGENTS.md`; this is the walk-through.

1. **Pull the story from Jira.** `SCRUM-nn` is the only identifier. Branch `feature/SCRUM-nn-short-slug` from `main`. Its `area-nn` label decides which folder the code goes in (`docs/design/frontend.md` §2, same table for backend and frontend).
2. **Draft the test cases before any code.** Open Claude Code in the repository and paste this, filling in the Jira text word for word:

   ```
   Draft test cases for this story with docs/test-cases/PROMPT.md.

   Key: SCRUM-nn
   Title: <title>
   Area label: area-nn

   User story:
   <paste from Jira>

   Acceptance criteria:
   1. <paste AC 1 exactly>
   2. ...

   Working rules / decisions in the story:
   <paste any "Working rule" or "D-nn" lines, or "none">

   Neighbouring stories in this sprint: <keys and titles>

   Rows already in the sheet for this story: none
   ```

   Curate the rows against the acceptance criteria (resolve every Assumption, decide every Not covered item), fill "Curated by", paste them into the Test cases tab of the team test sheet. A second Developer reads them and fills "Reviewed by". `docs/test-cases/PROMPT.md` says how; the rows are the specification the tests prove.
3. **Build.** Backend rules first (`backend/areas/<area>/`, unit tests as you go), then the route, then the page (`frontend/src/areas/<area>/`). Whether you type it or an AI does, the same documents apply, and `AGENTS.md` names them in reading order. If you use Claude Code, the prompt is the same story block as in step 2 plus the curated rows copied from the sheet (they paste as tab-separated text), and nothing else; the documents do the rest.
4. **Tests.** One Playwright `test()` per curated row in `functional/tests/SCRUM-nn.spec.js`; unit tests for the rules the story adds (`docs/test-cases/AUTOMATION.md`). Coverage target is 100 % of the files the story touches (`docs/test-cases/COVERAGE.md`). Run all three suites.
5. **Pull request** to `main`, title `SCRUM-nn: …`. Description: what was built, which TC IDs are covered, where AI was used. CI runs the three suites and logs every Playwright result to the Executions tab. A Developer other than the author approves; the author merges; the branch is deleted. Definition of Done: `AGENTS.md` §5.

## 3. Where each rule lives

| Question | File |
|---|---|
| What must I read, in what order, before touching a story? | `AGENTS.md` |
| Which statuses exist and how do they change? | `docs/design/state-model.md` |
| Which role may do what? | `docs/design/permissions.md` |
| What does a page show, and what is every element's `data-testid`? | `docs/design/ui-guidelines.md` |
| How is the front end built: folders, routing, API calls, errors, styling? | `docs/design/frontend.md` |
| Which area folder does my story belong to? | `docs/design/frontend.md` §2 |
| Why this stack, this authorisation model, in-app notifications? | `docs/adr/ADR-001`, `ADR-002`, `ADR-003` |
| How are test cases drafted? | `docs/test-cases/PROMPT.md` |
| How do tests map to test cases; where do they live? | `docs/test-cases/AUTOMATION.md` |
| How much coverage, and what is excluded? | `docs/test-cases/COVERAGE.md` |
| pytest, Vitest, Playwright and CI conventions | `.claude/skills/*/SKILL.md` |
| What was set up before the stories, and why? | `docs/setup/README.md` (the setup log), one spec with a report per item |
| C4 model | `docs/c4/workspace.dsl` (Structurizr) |

A change to a status, transition, role, permission or test id changes the owning document in the same pull request as the code.

## 4. Which file each AI tool reads

| Tool | Reads first | Then |
|---|---|---|
| Claude Code | `CLAUDE.md` → `AGENTS.md` | `.claude/skills/*` automatically when relevant |
| GitHub Copilot | `.github/copilot-instructions.md` → `AGENTS.md` | the skills as ordinary files, via `AGENTS.md` §1 |
| Codex, Cursor, others | `AGENTS.md` | same |

One instruction set, three entry points. Every session, whatever the tool, starts from `AGENTS.md` and the documents it names. You are accountable for what the tool produces: the reviewer must be able to explain it, and so must you.

## 5. Repository layout

```
backend/          Flask API. app.py (factory), config.py, errors.py, models.py, seed.py, seed/data.json
  areas/<area>/   routes.py and services.py per area
  tests/          pytest, one test_<feature>.py per story
frontend/src/
  app/            shared core: App, Layout, auth, http, format, home, areas
  areas/<area>/   api.js, routes.jsx, <Name>Page.jsx, __tests__/
functional/tests/ Playwright, one SCRUM-nn.spec.js per story
docs/             design, adr, test-cases, c4, setup
.github/          workflows/ci.yml, scripts/ (sheet logging), rulesets/main.json
.claude/skills/   conventions per tool
```

The eight areas, front and back: `auth`, `requests`, `venues`, `bookings`, `equipment`, `registration`, `changes`, `notifications`.

## 6. CI and the `main` branch

Every pull request runs Pytest, Vitest and Functional in parallel; all three must pass. Coverage tables appear on the run's Summary page; HTML reports and raw results are downloadable artifacts for 90 days. The Log to Sheet job then appends each Playwright result to the Executions tab against its TC ID. `main` accepts no direct pushes; the ruleset is `.github/rulesets/main.json`. Approval is requested on every PR and required by the Working Agreement.

## 7. Team artefacts outside the repository

Jira `SCRUM` project (backlog, sprints, board) · Teams Files / SharePoint (sprint records, decision log, Working Agreement, Definition of Done, setup document) · the team test sheet (Test cases, Executions, Traceability tabs).
