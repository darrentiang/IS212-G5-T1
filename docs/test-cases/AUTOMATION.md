# From test cases to automated tests

Read this before writing Playwright or unit tests for a story. The test-case rows in the sheet are the specification; the tests prove the rows.

## Order
1. The story's rows exist in the "Test cases" tab, curated and reviewed (see `PROMPT.md`). If they do not, stop: write and curate the rows first.
2. Build the story.
3. Write the tests below. While building, run only the affected test file(s) with `pytest <file> --no-cov`. Run the full backend suite (with coverage), Vitest and Playwright once, before reporting back.
4. Open the pull request. CI runs the suites and appends every Playwright result to the "Executions" tab against its TC ID. CI never edits the "Test cases" tab. Unit test results stay in the CI log.

## Playwright (functional tests) — `functional/tests/<story key>.spec.js`
- One spec file per story, e.g. `SCRUM-26.spec.js`.
- One `test()` per test-case row, in the row's order. The test proves that row and nothing else.
- Header above each test, link fields only (the sheet holds the description):
  ```
  // @tc: TC-SCRUM-26-03
  // @test: wrong password is refused
  // @story: SCRUM-26
  // @ac: 3
  ```
  `@test` must match the `test('…')` name exactly; CI uses it to match results to the TC ID.
- Preconditions column → test setup (seeded accounts, objects created through the UI or API before the steps).
- Steps column → the actions in order. Test data column → the values typed.
- Expected result column → the assertions. Assert what the row says is shown or not shown; where the row says "nothing changed", assert the state is unchanged (reload and check).
- **Standing data belongs in the seed** (`backend/seed/data.json`): the accounts, and the records a story reads but never changes. **Data a test changes it creates itself**, through the UI if that is the story, otherwise through the API before the steps. One SQLite file is shared by every spec in a run, so a test asserts on its own records by name or id, never on a row count and never on the list being empty — another spec's records are in the same list.
- A row that cannot be automated (rare) keeps its sheet row with "Reviewed by" noting "manual"; do not write a placeholder test that always passes.

## Unit tests — `backend/tests/test_<feature>.py`, `frontend/src/areas/<area>/__tests__/`
- Unit tests exercise rules (state transitions, permissions, validation, conflict detection), not user journeys. They carry `@story` and `@ac` but no TC ID.
- Backend tests run through the Flask test client against a seeded in-memory database, so they are API integration tests as well as unit tests; the rubric's "integration" level is met here.
  ```
  # @story: SCRUM-26
  # @ac: 3
  ```
- **Backend test data:** new tests build the data they depend on with helpers from `backend/tests/factories.py` and pass the values that matter explicitly. From the seed they may rely only on reference data (roles and the fixed lists: facilities, accessibility features, layouts, equipment types) and the seeded accounts used to log in. Existing tests move to this style when their story is next touched; no bulk rewrite. (The Playwright standing-data rule above is separate: there, one SQLite file is shared by every spec in a run.)
- Backend rules come from `docs/design/state-model.md` and `docs/design/permissions.md`; a unit test that contradicts either is wrong, not the document.
- Frontend unit tests stay minimal: rendering and behaviour the functional tests do not cover. Mock the area's API module (`frontend/src/areas/<area>/api.js`), not `fetch`.

## Definition of Done link
A story is Done only when every test-case row for it has a passing Playwright test in the latest CI run, the rules it adds have unit tests, the reviewer can explain the tests, and the pull request states where AI was used. How much of the story's code those tests must reach, and what is excluded from the measurement, is `COVERAGE.md`.
