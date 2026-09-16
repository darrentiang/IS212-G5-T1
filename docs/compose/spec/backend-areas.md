---
feature: backend-areas
status: delivered
updated: 2026-09-16
branch: chore/setup-backend-areas
owner: Darren; reviewer: a Developer
---

# Backend areas, JSON errors, session config, serial functional tests, coverage policy — setup

Read `AGENTS.md` first, then `docs/adr/ADR-001-tech-stack.md`, `docs/adr/ADR-002-authorisation.md` and `docs/design/frontend.md` §1–2 (the area names and the Jira label table are shared with the backend). This is enabling work (decision D-18). It gives every backend story a folder to build in, makes every API error the same JSON shape, prepares the app for session cookies, makes the functional suite safe to grow, and writes down the coverage policy. It does **not** implement any story: `/api/login`, `/api/logout`, `/api/me` are SCRUM-26 (next spec).

## Report

**What was built** — `backend/config.py` (`Config`: `SECRET_KEY` from the environment with a development default, `SESSION_COOKIE_HTTPONLY`, `SESSION_COOKIE_SAMESITE = "Lax"`, `SESSION_COOKIE_SECURE = False`, `SQLALCHEMY_TRACK_MODIFICATIONS = False`, each with the reason beside it). `backend/errors.py` (`ApiRefusal(status, message)` for services, plus handlers for `ApiRefusal`, `HTTPException` and `Exception`, so every non-2xx reply is `{"message": "…"}`; 500 says only `"Something went wrong"` and logs the traceback, and re-raises under `TESTING`). `backend/areas/` with the eight area packages — `auth`, `requests`, `venues`, `bookings`, `equipment`, `registration`, `changes`, `notifications` — each an empty `Blueprint("<area>", url_prefix="/api")` with a docstring naming its Jira areas, and `areas/__init__.py` exporting `BLUEPRINTS` in that order. `create_app` now reads `Config` before the caller's override, registers the error handlers and the eight blueprints, and no longer calls `CORS`; `flask-cors` is out of `requirements.txt` and out of the local virtualenv. `backend/.coveragerc` omits `tests/*` and `seed.py` and excludes `pragma: no cover` and `__main__` blocks. `backend/tests/test_errors.py` holds the seven tests from [S3]; `test_health.py` and `test_ping.py` lost their ten-field headers. `functional/playwright.config.js` gains `workers: 1` and `fullyParallel: false`; `frontend/vitest.config.js` gains the two coverage exclusions. New `docs/test-cases/COVERAGE.md` states the policy, the exclusion table and what the reviewer checks; `AUTOMATION.md`, `AGENTS.md` (§1, §4.3, §5), `ADR-001` and the pytest and CI/CD skills were updated as listed in [S2].

**Verification** — `pytest` in `backend/`: 22 passed, and the coverage table reads **100 %** for every non-excluded file (`app.py`, `config.py`, `db.py`, `errors.py`, `models.py`, all eighteen files under `areas/`); no warnings. `grep -rn flask_cors backend` and `grep -rn flask-cors backend` both find nothing. Fresh terminal: `python seed.py --reset && python app.py`, then `curl -i localhost:5000/api/nope` → `404 NOT FOUND` with `Content-Type: application/json`; `POST /api/health` → `405` JSON; `/api/health` → `{"database": "ok", "status": "ok"}` and `/api/ping` → `{"message": "pong"}`, both unchanged. `npm run test` in `functional/`: green, and the output line reads "Running 1 test using 1 worker"; because one test would use one worker anyway, the config was also read back directly — `workers: 1 | fullyParallel: false`.

**The frontend half of [S5] could not be verified on this branch.** `chore/setup-backend-areas` was cut from `main` before the front-end scaffold merged (PR #8), so it is five commits behind and does not contain `frontend/src/app/`, `frontend/src/areas/`, `docs/design/frontend.md` or `docs/design/ui-guidelines.md`. Three consequences, none of them a defect in this build:

- `npm run test` in `frontend/` gives 2 passed, not 14, and its coverage table lists only the old `App.jsx`. It lists no `api.js` or `areas.js` rows, but because those files are absent here, not because the new exclusions did any work; the exclusions are correct and load cleanly, and will bite once the branches meet.
- Every reference this change makes to `docs/design/frontend.md` §2 — the area docstrings, `areas/__init__.py`, ADR-001, the pytest skill, AGENTS.md §1 — points at a file that arrives with `main`.
- `frontend/vitest.config.js` will conflict on merge: `main` has `exclude: ['src/**/__tests__/**', 'src/main.jsx']` where this branch still has `['src/__tests__/**', …]`. Keep `main`'s two entries and add this change's two.

`docs/design/frontend.md` §8 already prescribes the fix: whoever merges second pulls `main` into their branch before asking for review. That should happen before this pull request is opened, and the frontend line of [S5] re-checked then.

**Journey log** — Four decisions and one correction:

- **The gaps were closed rather than explained.** [S5] allows a shortfall with a stated reason, but all six uncovered lines had honest tests behind them, so five went into `test_seed.py` (they belong to the sqlite-seed spec's files, not this one, which keeps `test_errors.py` exactly the seven tests [S3] lists): `default_database_uri` with and without `DATABASE_URL`, `create_app` starting on a database already at the current version — the complement of the refusal test that existed — `/api/health` reporting `"database": "error"` when the connection string points somewhere unopenable, `Account.has_role`, and the three `__repr__` methods. No `pragma: no cover` was added anywhere.
- **The `TESTING` re-raise is doing real work.** Flask's `handle_user_exception` finds a registered `Exception` handler and calls it *even when* `TESTING` is true, so without the explicit `raise` a test would get a tidy 500 instead of the real error. The re-raise sends it up to `wsgi_app`, where `PROPAGATE_EXCEPTIONS` (true under testing) hands it to pytest. `test_an_unexpected_error_reaches_pytest_while_testing` and its `TESTING: False` twin pin both halves.
- **`HTTPException` replies carry werkzeug's own `description`.** It is already a sentence ("The requested URL was not found on the server…"), so it satisfies the contract without inventing wording. The tests assert the shape and the type, not the exact text, so a werkzeug upgrade cannot break them.
- **`flask-cors` was uninstalled from the virtualenv, not just dropped from `requirements.txt`.** The virtualenv lives at `backend/.venv`, so `grep -rn flask_cors backend` would otherwise have matched its own site-packages and the [S5] check would have failed for a reason that had nothing to do with the code.
- One correction along the way: the 500 test created a second app and left its engine open, which surfaced as a `ResourceWarning` under a later test. It now disposes the engine, and the run is warning-free.

## [S1] Problem

- Every story would add routes to `app.py`, the same file, at the same time.
- Errors Flask raises itself (404, 405, 500) are HTML pages; only our own refusals are `{ "message" }`. The front end currently guesses.
- Flask sessions (ADR-001) need a `SECRET_KEY` and cookie settings; nothing sets them. `CORS(app)` is present but does nothing behind the Vite proxy and would need `supports_credentials` if it ever did.
- Playwright runs spec files in parallel by default against one shared SQLite file seeded once per run. With two specs, tests interfere.
- The rubric asks for 100 % coverage or a stated reason. The measured numbers include entry points nothing can unit-test, and nothing states the policy.

## [S2] Design

### Backend folders

```
backend/
  app.py            create_app: config, db, error handlers, blueprint registration, /api/health, /api/ping
  config.py         reads the environment; dev defaults
  errors.py         JSON error handlers and ApiRefusal
  db.py, models.py, seed.py, seed/       unchanged
  areas/
    __init__.py
    <area>/
      __init__.py
      routes.py     Blueprint "<area>", url_prefix "/api"; empty except a module docstring
      (services.py, added by the first story that needs one)
  tests/            unchanged location; one test_<feature>.py per story (AGENTS.md §4)
```

Eight areas, the same names as the front end: `auth`, `requests`, `venues`, `bookings`, `equipment`, `registration`, `changes`, `notifications`. Which area a story belongs to is `docs/design/frontend.md` §2; that table is the rule for both halves.

`backend/areas/__init__.py` exports `BLUEPRINTS`, a list of the eight blueprints in that order; `create_app` registers each. Adding an area is one folder and one entry in that list.

Models stay in `backend/models.py` (one file; a story adds its model there and bumps `SCHEMA_VERSION`). Reason: SQLAlchemy relationships cross areas (an event has a venue booking), and one models file avoids circular imports. Route and service code is what areas separate.

### Files to create or change

| File | Purpose |
|---|---|
| `backend/config.py` | `class Config` read once by `create_app`: `SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-in-production")`; `SESSION_COOKIE_HTTPONLY = True`; `SESSION_COOKIE_SAMESITE = "Lax"`; `SESSION_COOKIE_SECURE = False` (HTTP in dev and CI); `SQLALCHEMY_TRACK_MODIFICATIONS = False`. Comment on each line saying why. |
| `backend/errors.py` | `class ApiRefusal(Exception)` with `status` and `message`, so a service can `raise ApiRefusal(403, "…")` and never build a response itself. `register_error_handlers(app)`: handlers for `ApiRefusal`, `werkzeug.exceptions.HTTPException` (400, 401, 403, 404, 405, 415 …) and `Exception` (500), each returning `jsonify(message=…)` with the status. 500's message is `"Something went wrong"`; the traceback goes to the log, never to the client. In `TESTING` mode the `Exception` handler re-raises so pytest sees real errors. |
| `backend/areas/__init__.py` | imports the eight `routes.py` modules; `BLUEPRINTS = [auth_bp, requests_bp, …]`. |
| `backend/areas/<area>/__init__.py` | empty. |
| `backend/areas/<area>/routes.py` | `bp = Blueprint("<area>", __name__, url_prefix="/api")` and a docstring naming the area's Jira areas. No routes. |
| `backend/app.py` | `create_app`: `app.config.from_object(Config)` before the `config` override; remove `CORS(app)` and the import; call `register_error_handlers(app)`; register `BLUEPRINTS`. `/api/health` and `/api/ping` stay in `app.py` (infrastructure, not an area). |
| `backend/requirements.txt` | remove `flask-cors`. |
| `backend/tests/test_errors.py` | tests below. |
| `backend/tests/test_health.py`, `test_ping.py` | replace the 10-field `@tc` header with `# @story: INFRA` / `# @ac: 1` (chore from the handover; these files are touched anyway). |
| `backend/.coveragerc` | `[run] omit = tests/*, seed.py`; `[report] exclude_lines = pragma: no cover, if __name__ == .__main__.:`. `seed.py`'s `seed_database` is exercised by the fixture but the file is dominated by the CLI; the CLI is proven by the [S5] walk-through, not by unit tests. State this in `COVERAGE.md`. |
| `backend/pytest.ini` | keep `addopts`; coverage reads `.coveragerc` automatically. |
| `frontend/vitest.config.js` | coverage `exclude` gains `src/areas/*/api.js` and `src/app/areas.js` (contract one-liners and an import list, proven by Playwright, unreachable from mocked unit tests). |
| `functional/playwright.config.js` | `workers: 1`, `fullyParallel: false`, with a comment: one shared seeded database per run. |
| `docs/test-cases/COVERAGE.md` | New. Policy: target 100 % of the files a story touches; measured on every run; exclusions listed here with the reason (backend `seed.py` CLI, `tests/`, `__main__` blocks; frontend `main.jsx`, `areas/*/api.js`, `app/areas.js`, `__tests__/`); reviewer checks the PR's coverage summary for the story's files; a per-story shortfall is stated in the PR description with the reason; no CI threshold yet (to be decided at the Sprint 1 retro). Version table like the other docs. |
| `docs/test-cases/AUTOMATION.md` | under "Unit tests": one sentence, "Backend tests run through the Flask test client against a seeded in-memory database, so they are API integration tests as well as unit tests; the rubric's 'integration' level is met here." Link `COVERAGE.md` from the Definition of Done paragraph. |
| `AGENTS.md` | §1 read order: add `docs/test-cases/COVERAGE.md` to item 5's line. §4 step 3: "Backend rules first … in `backend/areas/<area>/`". §5 DoD: add "the story's files are 100 % covered or the PR states why (`COVERAGE.md`)". |
| `.claude/skills/pytest-standard/SKILL.md` | "Location" gains: routes and services live in `backend/areas/<area>/`; raise `ApiRefusal(status, message)` for refusals; every refusal reply is `{ "message" }`. |
| `.claude/skills/cicd-pipeline/SKILL.md` | one line under "What runs": functional tests run serially (shared database). |
| `docs/adr/ADR-001-tech-stack.md` | "API" bullet gains: "Routes and services are split by area (`backend/areas/<area>/`, the same eight areas as the front end, `docs/design/frontend.md` §2); models stay in one file." Edited in place (team decision 16 Sep: ADRs are edited while scaffolding, not superseded). |
| `docs/c4/workspace.dsl` | no change (containers unchanged). |

### Error reply contract (the whole of it)
Every non-2xx reply from the API, whether raised by our code or by Flask, is `{ "message": "<sentence>" }` with the matching status. Nothing else is ever in an error body. The front end (`frontend.md` §6) relies on this.

## [S3] Tests (`backend/tests/test_errors.py`)
Header on each: `# @story: setup` / `# @ac: backend-areas`.
1. `GET /api/does-not-exist` → 404 and JSON `{"message": ...}`, content type `application/json`.
2. `POST /api/health` → 405, JSON with `message`.
3. A test-only route registered inside the test that raises `ApiRefusal(403, "Not allowed")` → 403, `{"message": "Not allowed"}`.
4. A test-only route that raises `RuntimeError` → with `TESTING` true the error propagates (pytest sees it); with a second app created with `TESTING` false, the client gets 500 and `{"message": "Something went wrong"}` and the body contains no traceback text.
5. `create_app()` has `SECRET_KEY` set, `SESSION_COOKIE_HTTPONLY` true, `SESSION_COOKIE_SAMESITE == "Lax"`.
6. All eight blueprints are registered (`app.blueprints` keys equal the eight area names).
Existing tests keep passing. Coverage after this PR: 100 % of non-excluded backend files, or the Report states which lines and why.

## [S4] Out of scope (do not build)
- Any route in any area. `/api/login`, `/api/logout`, `/api/me` are SCRUM-26.
- `permissions.py`, `require()`, feature keys — SCRUM-27.
- A CI coverage threshold — Sprint 1 retro decision.
- README — separate setup item.
- Front-end code beyond the two config lines.

## [S5] Done when
- `pytest` in `backend/`: all green; the coverage table shows 100 % for every non-excluded file, or the Report explains the gap.
- `npm run test` in `frontend/`: 14 green, coverage table no longer lists `api.js` or `areas.js` rows.
- `npm run test` in `functional/`: INFRA-01 green, run with 1 worker (visible in the Playwright output line "Running 1 test using 1 worker").
- Fresh terminal: `python seed.py --reset && python app.py`; `curl -i localhost:5000/api/nope` returns 404 with a JSON body; `/api/health` unchanged.
- `grep -rn flask_cors backend` finds nothing.
- PR title `Setup: backend areas, JSON errors and coverage policy`; description per template in `AGENTS.md` §4.5; a Developer other than the author approves.
