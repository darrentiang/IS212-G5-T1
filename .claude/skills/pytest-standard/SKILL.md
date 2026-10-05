---
name: pytest-standard
description: How to write backend unit tests with pytest for this project — @story/@ac link header, what unit tests cover, naming conventions, and the Definition of Done checklist. Use when writing, reviewing, or fixing backend unit tests, or when implementing a user story that needs tests.
---

# Pytest Standard — Backend Unit Tests

Functional test cases live in the team test sheet and are proved by Playwright, not by unit tests. Read `docs/test-cases/AUTOMATION.md` first. Unit tests carry no TC ID; they prove rules.

## Location

All backend tests go in `backend/tests/`. File naming: `test_<feature>.py`.

The `app` fixture in `backend/tests/conftest.py` gives every test a fresh in-memory database, created and seeded from `backend/seed/data.json` by `seed_database`. Tests never touch the development database in `backend/instance/app.db`, so running pytest cannot disturb a developer's data and no test needs to clean up after another. When a story needs standing data of its own (a venue, an event, an equipment unit), add rows to `seed/data.json` and bump `SCHEMA_VERSION` in `backend/models.py` in the same pull request; every test and every Playwright run then starts from that same data.

The code those tests exercise lives in `backend/areas/<area>/`: `routes.py` for the endpoints, `services.py` for the rules, one area per folder and the same eight areas as the front end (`docs/design/frontend.md` §2 decides which). Models stay in `backend/models.py`. A service refuses by raising `ApiRefusal(status, message)` from `backend/errors.py` and never builds a response itself; every error reply the API sends, ours or Flask's own, is `{"message": "…"}` with the matching status, so a test asserts `resp.get_json()["message"]` whatever went wrong.

## Link header (REQUIRED)

Every test function is preceded by a two-line header so a reviewer can see which story and criterion the test protects. CI does not parse unit tests; their results stay in the CI log.

```python
# @story: SCRUM-<n>
# @ac: <acceptance_criterion_numbers>
def test_example(client):
    resp = client.get("/api/example")
    assert resp.status_code == 200
```

### Field rules

| Field | Required | Format |
|---|---|---|
| `@story` | Yes | Story key, e.g. `SCRUM-26` |
| `@ac` | Yes | Which AC(s) this test covers, e.g. `1` or `1, 3` |

No `@tc` line. TC IDs belong to functional rows in the sheet; a unit test does not prove a sheet row.

## What unit tests derive from

- The rules the story adds: state transitions (`docs/design/state-model.md`), permissions (`docs/design/permissions.md`), validation, conflict detection.
- The story's acceptance criteria as written in the Backlog tab of the team scrum workbook.
- A unit test that contradicts a design document is wrong, not the document.

## Test structure

```python
# @story: SCRUM-26
# @ac: 3
def test_login_wrong_password_is_refused(client):
    resp = client.post("/api/login", json={"username": "org1", "password": "wrong"})
    assert resp.status_code == 401
    assert "user_id" not in resp.get_json()


# @story: SCRUM-26
# @ac: 1
def test_login_returns_all_roles_of_the_account(client):
    resp = client.post("/api/login", json={"username": "multi1", "password": "Passw0rd!"})
    assert resp.status_code == 200
    assert set(resp.get_json()["roles"]) == {"Event Coordinator", "Venue Staff"}
```

## The expected value (the oracle)

A test is evidence that the code does what the story asked. The green bar only proves the tests agree with the code: if the same author or agent wrote both, they can share a misunderstanding.

- Work out every expected value from the acceptance criterion, `state-model.md` or `permissions.md`, by hand. Never run the code and paste its output into an assertion; a value copied from the implementation can only confirm what it already does.
- When a test written from the criterion fails, re-read the criterion before touching the number. If the criterion is ambiguous, stop: the Product Owner decides (`AGENTS.md` §3).
- Show a non-obvious derivation in a comment: `# 14:00 start minus 30 min setup = occupied from 13:30`.

## Choosing what to test

For every input, ask: would a plausible fault give a different answer here? If not, the test is decoration.

| Rule | Write | Fault it catches |
|---|---|---|
| Status transition | The allowed from-status succeeds **and** the stored status is the to-status; one test per other status the rule refuses (group statuses only where the criterion treats them alike) | Missing guard; wrong set of allowed statuses |
| Permission | Each role allowed against each refused; the multi-role account `multi1`; another user's or organisation's record (object rule: read answers 403, write answers 404, `permissions.md`) | Wrong role check; object rule missing |
| Validation | Smallest invalid and smallest valid; missing, blank, whitespace-only, wrong type | Guard too loose or too strict |
| Limit or window | Just below, exactly at, just above — including derived values: a date against today, start against end, attendance against capacity, a booking's occupied period once setup and turnaround are added, periods that touch against periods that overlap, an expiry time | `<` against `<=`; wrong constant |
| Refusal | The status code and message, **and** that nothing changed: re-fetch the record, or check no row was created | Partial write before the refusal |
| Success | The response **and** what was stored (re-fetch: status, who, when) | Response says yes, nothing persisted |
| Rule combinations | Data that switches every rule on: non-zero setup time, a second booking, a non-default role; never only the neutral path | A rule skipped under some condition; a zero that hides the rule |
| Sequences | Two operations in a row on the same record (decide twice, withdraw then approve) | One-off logic firing twice; overwrite instead of refuse |

Use `@pytest.mark.parametrize` for a table of cases; each case is reported separately.

## Assertions and naming

- Assert exact values: status code, the specific fields, `resp.get_json()["message"]`. The API's message is what the page shows, so asserting it is fine.
- Never `assert resp`, `> 0` or `is not None` as the only check: they survive almost every fault.
- One behaviour per test, Arrange–Act–Assert visible. Several asserts are fine when they check one behaviour's outputs (response plus stored state).
- Name the requirement, not the endpoint: `test_booking_touching_previous_turnaround_is_allowed`, not `test_booking_3`. A failing name should read as the broken requirement in the CI log.
- Tests pass alone and in any order: never depend on another test's records.

## Test doubles

- The database is already a fake: each test gets a fresh, seeded, in-memory SQLite database from `conftest.py`. Do not mock SQLAlchemy, services or routes; test through the endpoint.
- Time: a date-level rule ("not before today") can be computed relative to `date.today()` in the test, as `test_requests.py` does. A rule at the minute or second (an expiry time) needs a controllable clock: read the time through one function the test can `monkeypatch`, never by sleeping.
- Mock an interaction only when the interaction is the requirement. A notification is a database row (ADR-003): assert the row, not a call.
- If you must mock, use `create_autospec` or `Mock(spec=...)` so a call to a method that does not exist fails.

## What NOT to test

- Framework internals (Flask routing, ORM plumbing)
- Private helper functions directly — test through public endpoints
- User journeys through the browser (that's Playwright)
- Behaviour the criteria do not define: you would be guessing the expected value. Raise it with the Product Owner instead.

## Coverage is a diagnostic, not a target

Read the missed lines, not the percentage. 100% coverage proves every line ran, not that anything was checked: weak assertions reach 100% and catch nothing. Low coverage reliably shows untested code. The target and exclusions are in `docs/test-cases/COVERAGE.md`.

## Running tests

```bash
cd backend
python -m pytest tests/ -v                    # all tests
python -m pytest tests/test_events.py -v      # one file
python -m pytest tests/test_events.py::test_create_event_success -v  # one test
```

## Definition of Done for tests

- [ ] Every rule the story adds has a unit test
- [ ] Every test has the `@story` / `@ac` header; no `@tc`
- [ ] Tests derive from ACs and design documents, not from implementation code
- [ ] Tests pass locally: `pytest tests/ -v` is green
- [ ] A human can explain what each test verifies
- [ ] Every expected value is derived from the criterion or a design document, not copied from the code's output
- [ ] Every limit has below / at / above tests; every refusal also asserts that nothing changed

### Five questions the reviewer asks of each test
1. Which acceptance criterion does it cover?
2. What wrong implementation would make it fail? If none, strengthen it or delete it.
3. Can you explain the setup, the action and the expected result?
4. Can the expected value be justified without looking at the code?
5. Is it deterministic and does it assert something real?
