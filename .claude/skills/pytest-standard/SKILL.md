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

## What to test

- API endpoint responses (status codes, response body)
- Validation logic (missing fields, invalid data)
- Business rules (state transitions, conflict detection, capacity limits)
- Role-based access (wrong role gets 403; an account with several roles may do what any of them allows)

## What NOT to test

- Framework internals (Flask routing, ORM plumbing)
- Private helper methods directly — test through public endpoints
- External services (mock them)
- User journeys through the browser (that's Playwright)

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
