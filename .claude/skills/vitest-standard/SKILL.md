---
name: vitest-standard
description: How to write frontend unit tests with Vitest for this project — @story/@ac link header, what frontend unit tests cover, React Testing Library patterns, and mocking the API module. Use when writing, reviewing, or fixing frontend unit tests, or when implementing a user story that needs frontend tests.
---

# Vitest Standard — Frontend Unit Tests

Functional test cases live in the team test sheet and are proved by Playwright, not by unit tests. Read `docs/test-cases/AUTOMATION.md` first. Frontend unit tests stay minimal: rendering and behaviour the functional tests do not cover. They carry no TC ID.

## Location

All frontend tests go in `frontend/src/__tests__/`. File naming: `<Component>.test.jsx`.

## Link header (REQUIRED)

Every `it()` block is preceded by a two-line `//` header. CI reads it to log the execution against the story.

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

- Components never call `fetch` directly; they call functions in `frontend/src/api.js`. Mock that module with `vi.mock('../api')` — never mock `global.fetch` in a component test.
- Call `vi.restoreAllMocks()` in `afterEach` to prevent cross-test contamination
- If importing JSON fixture data, use `structuredClone(data)` to avoid mutation leaking between tests

## Patterns

### Component renders

```javascript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoginForm from '../components/LoginForm'

describe('LoginForm', () => {
  // @story: SCRUM-26
  // @ac: 1
  it('renders username, password and submit', () => {
    render(<LoginForm />)
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
import LoginForm from '../components/LoginForm'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LoginForm', () => {
  // @story: SCRUM-26
  // @ac: 3
  it('shows the error returned by the API', async () => {
    api.login.mockRejectedValue(new Error('Invalid username or password'))

    render(<LoginForm />)
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
npx vitest run src/__tests__/LoginForm.test.jsx  # one file
```

## Definition of Done for tests

- [ ] Every test has the `@story` / `@ac` header; no `@tc`
- [ ] The API module is mocked — no `fetch` mocks, no real network requests
- [ ] Only behaviour the functional tests do not cover
- [ ] Tests pass locally: `npm run test` is green
- [ ] A human can explain what each test verifies
