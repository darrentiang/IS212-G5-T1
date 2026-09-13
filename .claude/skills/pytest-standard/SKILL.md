---
name: pytest-standard
description: How to write backend unit tests with pytest for this project — @tc metadata format, test derivation from acceptance criteria, naming conventions, and the Definition of Done checklist. Use when writing, reviewing, or fixing backend unit tests, or when implementing a user story that needs tests.
---

# Pytest Standard — Backend Unit Tests

## Location

All backend tests go in `backend/tests/`. File naming: `test_<feature>.py`.

## @tc metadata (REQUIRED)

Every test file MUST begin with a metadata block. The CI pipeline parses these to populate the Test cases sheet. Without them, tests are invisible to the tracking system.

```python
# @tc: TC-<STORY>-<NN>
# @test: <exact_test_function_name>
# @story: <story_id>
# @ac: <acceptance_criterion_numbers>
# @type: Happy | Cross | Negative | Boundary
# @scenario: <one-line description of what this tests>
# @preconditions: <state needed before test runs>
# @steps: <numbered steps>
# @test_data: <specific inputs used>
# @expected: <expected result>
def test_example(client):
    resp = client.get("/api/example")
    assert resp.status_code == 200
```

### Field rules

| Field | Required | Format |
|---|---|---|
| `@tc` | Yes | `TC-<STORY>-<NN>` e.g. `TC-01-03` for story PB-01, third test |
| `@test` | Yes | Must exactly match the Python test function name |
| `@story` | Yes | Story ID from the product backlog |
| `@ac` | Yes | Which AC(s) this test covers, e.g. `1` or `1, 3` |
| `@type` | Yes | One of: Happy, Cross, Negative, Boundary |
| `@scenario` | Yes | One sentence describing the test objective |
| `@preconditions` | Yes | State that must exist before the test |
| `@steps` | Yes | Numbered steps |
| `@test_data` | Yes | Specific inputs, or `none` |
| `@expected` | Yes | Observable expected outcome |

## Test derivation method (Week 4, 5-step)

For each user story, derive tests from acceptance criteria:

1. **Visualise workflow** — put yourself in the user's shoes
2. **Happy path** — the path with no errors (positive test)
3. **Cross-cutting** — role permissions, auth, security
4. **Negative** — wrong input, missing fields, unauthorized access
5. **Boundary** — values at limits (min/max capacity, empty vs. one item)

## Test structure

```python
# @tc: TC-01-01
# @test: test_create_event_success
# @story: PB-01
# @ac: 1, 2
# @type: Happy
# @scenario: Event organiser creates a valid event request
# @preconditions: Event organiser account exists and is logged in
# @steps: 1. POST /api/events with valid data 2. Check response
# @test_data: {"name": "Conference", "date": "2026-11-15", "attendance": 100}
# @expected: HTTP 201, event returned with assigned id
def test_create_event_success(client):
    resp = client.post("/api/events", json={
        "name": "Conference",
        "date": "2026-11-15",
        "expected_attendance": 100,
    })
    assert resp.status_code == 201
    data = resp.get_json()
    assert data["name"] == "Conference"
    assert "id" in data
```

## What to test

- API endpoint responses (status codes, response body)
- Validation logic (missing fields, invalid data)
- Business rules (conflict detection, capacity limits)
- Role-based access (wrong role gets 403)

## What NOT to test

- Framework internals (Flask routing, ORM plumbing)
- Private helper methods directly — test through public endpoints
- External services (mock them)

## Running tests

```bash
cd backend
python -m pytest tests/ -v                    # all tests
python -m pytest tests/test_events.py -v      # one file
python -m pytest tests/test_events.py::test_create_event_success -v  # one test
```

## Definition of Done for tests

- [ ] Every test has a complete `@tc` metadata block
- [ ] `@test` field matches the function name exactly
- [ ] Tests derive from ACs, not from implementation code
- [ ] Happy path, negative, and boundary cases covered
- [ ] Tests pass locally: `pytest tests/ -v` is green
- [ ] A human can explain what each test verifies
