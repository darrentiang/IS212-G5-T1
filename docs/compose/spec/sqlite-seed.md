---
feature: sqlite-seed
status: delivered
updated: 2026-09-16
branch: chore/setup-sqlite-seed
owner: Darren (PO, setup under D-18); reviewer: a Developer
---

# SQLite database and seed data — setup

Read `AGENTS.md` first, then `docs/adr/ADR-001-tech-stack.md`. This is enabling work (decision D-18): it is recorded in the setup document, not in a Jira story. It creates the database foundation every story builds on. It does **not** implement any story.

## Report

**What was built** — The database foundation every story builds on: Flask-SQLAlchemy over SQLite, one shared `db` instance (`backend/db.py`), and the only models release 1 needs before SCRUM-26 — `Account`, `Role`, the `account_roles` association table and `SchemaMeta`, with `SCHEMA_VERSION = 1` (`backend/models.py`). `Account` carries `set_password` / `check_password` (werkzeug scrypt), `has_role(name)` and the sorted `role_names`, so SCRUM-26/27 have a stable surface; no permission logic lives here. `backend/seed/data.json` holds the five role names from `permissions.md` and the eight accounts from `PROMPT.md`, passwords in plain text and hashed at seed time; `org1` and `org2` sit in different client organisations in a plain text `organisation` field. `backend/seed.py` exposes `seed_database(db, data_path)` — used by both the script and the pytest fixture — plus a CLI: `python seed.py` creates and seeds an absent database and prints `already seeded (schema v1)` on a current one; `python seed.py --reset` deletes the file and recreates it. It never partially updates: a database that already holds seed data raises `AlreadySeededError`, and any other failure is rolled back. `create_app` now reads `DATABASE_URL` (defaulting to `backend/instance/app.db`), initialises `db`, and refuses to start on a database seeded at another version with `Database schema is v{found}, code expects v{expected}. Run: python seed.py --reset`; `/api/health` reports `"database": "ok"` after a `SELECT 1`. The pytest `app` fixture gives every test a fresh in-memory seeded database, `backend/tests/test_seed.py` holds the seven tests from [S3], the Playwright backend `webServer` reseeds before the browser starts, `backend/instance/` is gitignored, `flask-sqlalchemy>=3.1` is in `requirements.txt`, and the pytest skill documents the fixture.

**Verification** — `pytest` in `backend/`: 9 passed (the 7 new tests plus the existing health and ping tests), coverage printed, 80% total. `npm run test` in `functional/`: 1 passed (the existing INFRA spec) with the reseed in `webServer`; proved the reseed really runs by deleting `instance/app.db` first and finding 8 accounts in it afterwards. The [S5] fresh-clone path was walked end to end in a clean venv: `pip install -r requirements.txt`, `python seed.py` (seeded v1), `python seed.py` again (`already seeded (schema v1)`), `python seed.py --reset` (deleted and recreated), `python app.py`, then `GET /api/health` → `{"database": "ok", "status": "ok"}` and `GET /api/ping` → `{"message": "pong"}`. The refusal path was exercised by hand as well as in a test: with the stored version forced to 0, both `python app.py` and `python seed.py` exit 1 printing the message that names `seed.py --reset`, and `--reset` recovers. `instance/app.db` was checksummed before and after a pytest run and is byte-identical, so the suite never touches the development database. `git status` shows only the intended files; `backend/instance/` and the local `.venv` are ignored.

**Journey log** — Three things were not settled by the spec and were decided in the build:

- `/api/health` gaining `"database": "ok"` contradicts the existing `test_health.py`, which asserted the whole body equalled `{"status": "ok"}`, while [S3] requires that test to keep passing. Its assertion was narrowed to `resp.get_json()["status"] == "ok"` — the smallest change that keeps it testing what it tested; the new field is proved by test 7. This is the one edit to a file [S2] does not list.
- The startup check is written against the `schema_meta` table rather than the database file, because connecting to a SQLite URL creates the file, so "the file exists" is not a reliable signal and would not carry to the PostgreSQL connection string ADR-001 allows. A missing file, a missing table and an empty table all mean "not seeded yet" and are not a refusal. To keep `seed.py --reset` able to rescue a database at the wrong version, `--reset` deletes the file before `create_app` ever inspects it, using `default_database_uri()` exported from `app.py`; plain `python seed.py` on such a database inherits the refusal and prints its message, which is the right instruction anyway.
- `organisation` is filled only for `org1` and `org2` (`Client Organisation A` / `B`, deliberately neutral placeholders, as neither the briefing nor `PROMPT.md` names them) and left `null` for the six internal staff accounts, since a client organisation is not a meaningful attribute of a coordinator or venue staff member. If a story later needs staff to carry one, the column already exists.

Two smaller notes: the in-memory fixture works because Flask-SQLAlchemy keeps a `StaticPool` for `sqlite:///:memory:`, so the seeded data survives across the app contexts a request pushes; and engines are disposed on the fixture teardown and on the refusal path, which is what clears the `ResourceWarning: unclosed database` noise from the first green run.

## [S1] Problem

The backend has no database. Every story needs one, every developer needs the same starting data on their own machine, every pytest run needs a clean throwaway database, and every Playwright run needs the standard data in place before the browser starts. Today none of that exists, and the first story (SCRUM-26) would have to invent it.

## [S2] Design

### Stack (ADR-001)
Flask-SQLAlchemy over SQLite. Development and CI use one file, `backend/instance/app.db` (gitignored). Tests use `sqlite:///:memory:`. The connection string comes from the environment variable `DATABASE_URL` when set, so a hosted demo can point at Postgres without a code change; no Postgres-specific feature may be used.

### Files to create or change
| File | Purpose |
|---|---|
| `backend/db.py` | `db = SQLAlchemy()` instance, nothing else. |
| `backend/models.py` | `SCHEMA_VERSION = 1`; models `Account`, `Role`, association table `account_roles`, `SchemaMeta` (one row: version). Nothing else: venues, events, equipment are created by their stories, which bump `SCHEMA_VERSION`. |
| `backend/seed/data.json` | Seed values: roles (the five names exactly as in `docs/design/permissions.md`), accounts (`org1`, `org2`, `coord1`, `coord2`, `venue1`, `tech1`, `att1`, `multi1` with roles as listed in `docs/test-cases/PROMPT.md`; `org1` and `org2` in different client organisations, held as a plain text `organisation` field). Passwords in plain text in this file (`Passw0rd!` for all); hashed at seed time. Stories append their own sections to this file. |
| `backend/seed.py` | `seed_database(db, data_path)` used by both the script and the tests: creates tables, inserts data, writes `SchemaMeta`. CLI: `python seed.py` creates the file if absent and reports "already seeded (schema v1)" if present at the current version; `python seed.py --reset` deletes the file and recreates it. Never partially updates an existing database. |
| `backend/app.py` | `create_app(config)` reads `DATABASE_URL` (default the instance file), initialises `db`, and on startup, if the database file exists and its `SchemaMeta.version != SCHEMA_VERSION`, refuses to start with the message: `Database schema is v{found}, code expects v{expected}. Run: python seed.py --reset`. Keep `/api/health` and `/api/ping`; `/api/health` also reports `"database": "ok"` after a trivial query. No other routes. |
| `backend/tests/conftest.py` | `app` fixture: `create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})`, `db.create_all()`, `seed_database(...)` from the same `data.json`, yield, `db.drop_all()`. `client` fixture unchanged. Every test gets a fresh seeded database. |
| `backend/tests/test_seed.py` | Unit tests listed below. |
| `backend/requirements.txt` | add `flask-sqlalchemy>=3.1`. |
| `.gitignore` | add `backend/instance/`. |
| `functional/playwright.config.js` | backend `webServer.command` becomes `python ../backend/seed.py --reset && python ../backend/app.py` so every functional run starts from the seed. Keep `reuseExistingServer: !process.env.CI`. |
| `.claude/skills/pytest-standard/SKILL.md` | one paragraph under "Location": the `app` fixture gives every test a fresh in-memory seeded database; tests never touch `instance/app.db`; add rows to `seed/data.json` when a story needs standing data. |

### Password hashing
`werkzeug.security.generate_password_hash` / `check_password_hash`. No password rules (customer: none required). The hash is stored on `Account.password_hash`; the plain password exists only in `data.json`.

### Roles
`Account.roles` is a many-to-many. A helper `Account.has_role(name)` and `Account.role_names` (sorted list) exist so SCRUM-26/27 have a stable surface. No permission logic here: that is SCRUM-27 and ADR-002.

## [S3] Tests (`backend/tests/test_seed.py`)
Header on each test: `# @story: setup` and `# @ac: sqlite-seed` (setup work has no Jira key; the reference is this spec).
1. Seeding creates exactly five roles with the names in `permissions.md`.
2. Seeding creates the eight accounts; `multi1` has exactly `Event Coordinator` and `Venue Staff`; every other account has exactly one role.
3. Passwords are hashed: `password_hash` is not `Passw0rd!` and `check_password_hash` succeeds for it.
4. `SchemaMeta` holds `SCHEMA_VERSION` after seeding.
5. `create_app` refuses to start when the stored version differs from `SCHEMA_VERSION` (use a temp file database; write version 0; assert the error message names `seed.py --reset`).
6. `seed_database` on an already seeded in-memory database raises rather than duplicating rows.
7. `/api/health` returns `"database": "ok"`.
Existing `test_health.py` and `test_ping.py` keep passing with the new fixture.

## [S4] Out of scope (do not build)
- `/api/login`, `/api/logout`, `/api/me`, sessions, cookies — SCRUM-26.
- Permission checks, `permissions.py`, `require()` — SCRUM-27 / ADR-002.
- Venue, layout, equipment, event tables and their seed rows — their stories.
- Alembic or any migration tool — the database is disposable; `--reset` is the migration.
- Front-end changes of any kind.
- README — separate setup item owned by Hong Yi.

## [S5] Done when
- Fresh clone: `pip install -r requirements.txt`, `python seed.py`, `python app.py` starts and `/api/health` shows the database ok.
- `pytest` in `backend/`: all tests green, coverage printed; `instance/app.db` untouched by the run.
- `npm run test` in `functional/`: green (the existing INFRA spec) with the reseed in `webServer`.
- `git status` clean apart from intended files; `backend/instance/` ignored.
- PR title `Setup: SQLite database and seed data`; description lists the files, says the code was drafted with Claude Code from this spec and reviewed by the author, and names the reviewer. A Developer other than the author approves before merge.
