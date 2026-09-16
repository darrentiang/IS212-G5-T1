---
name: vitest-standard
description: How to write frontend unit tests with Vitest for this project — @story/@ac link header, what frontend unit tests cover, React Testing Library patterns, and mocking the API module. Use when writing, reviewing, or fixing frontend unit tests, or when implementing a user story that needs frontend tests.
---

# Vitest Standard — Frontend Unit Tests

Functional test cases live in the team test sheet and are proved by Playwright, not by unit tests. Read `docs/test-cases/AUTOMATION.md` first. Frontend unit tests stay minimal: rendering and behaviour the functional tests do not cover. They carry no TC ID.

## Location

Tests sit in the `__tests__/` folder next to the code they test: `frontend/src/areas/<area>/__tests__/` for an area's pages, `frontend/src/app/__tests__/` for the shared core. File naming: after the file tested, e.g. `LoginPage.test.jsx`, `Layout.test.jsx`. Which area a story belongs to, and how pages are built, is in `docs/design/frontend.md`.

## Link header (REQUIRED)

Every `it()` block is preceded by a two-line `//` header so a reviewer can see which story and criterion the test protects. CI does not parse unit tests; their results stay in the CI log.

```javascript
// @story: SCRUM-<n>
// @ac: <acceptance_criterion_numbers>
it('<test name>', () => {
  // ...
})
```

No `@tc` line. TC IDs belong to functional rows in the sheet.

## What to test

- Component renders the right fields and controls
- Role-based UI: elements shown or hidden by role (the API decides permissions; the UI only reflects them)
- Error and empty states (API failure, empty list)
- Behaviour not worth a browser test (formatting, disabled states)

## Mocking rules

- Pages call their area's `api.js`, never `fetch` (`docs/design/frontend.md`). From the area's `__tests__/`, mock it with `vi.mock('../api')` — never mock `global.fetch`.
- Render pages that use the router inside `MemoryRouter` from `react-router`.
- Call `vi.restoreAllMocks()` in `afterEach` to prevent cross-test contamination
- If importing JSON fixture data, use `structuredClone(data)` to avoid mutation leaking between tests

## Patterns

### Component renders

```javascript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import LoginPage from '../LoginPage'

describe('LoginPage', () => {
  // @story: SCRUM-26
  // @ac: 1
  it('renders username, password and submit', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
  })
})
```

### API call with the module mocked

```javascript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../api'
import { MemoryRouter } from 'react-router'
import LoginPage from '../LoginPage'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LoginPage', () => {
  // @story: SCRUM-26
  // @ac: 3
  it('shows the error returned by the API', async () => {
    api.login.mockRejectedValue(Object.assign(new Error('Invalid username or password'), { status: 401 }))

    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText(/username/i), 'org1')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    await waitFor(() => {
      expect(screen.getByText(/invalid username or password/i)).toBeInTheDocument()
    })
  })
})
```

## Running tests

```bash
cd frontend
npm run test              # run all
npm run test:watch        # watch mode
npx vitest run src/areas/auth/__tests__/LoginPage.test.jsx  # one file
```

## Definition of Done for tests

- [ ] Every test has the `@story` / `@ac` header; no `@tc`
- [ ] The API module is mocked — no `fetch` mocks, no real network requests
- [ ] Only behaviour the functional tests do not cover
- [ ] Tests pass locally: `npm run test` is green
- [ ] A human can explain what each test verifies
