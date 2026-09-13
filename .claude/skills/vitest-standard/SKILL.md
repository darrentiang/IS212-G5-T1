---
name: vitest-standard
description: How to write frontend unit tests with Vitest for this project — @tc metadata format, test derivation from acceptance criteria, React Testing Library patterns, and mocking. Use when writing, reviewing, or fixing frontend unit tests, or when implementing a user story that needs frontend tests.
---

# Vitest Standard — Frontend Unit Tests

## Location

All frontend tests go in `frontend/src/__tests__/`. File naming: `<Component>.test.jsx`.

## @tc metadata (REQUIRED)

Every test file MUST begin with a metadata block using `//` comments. The CI pipeline parses these to populate the Test cases sheet.

```javascript
// @tc: TC-<STORY>-<NN>
// @test: <exact_test_name_as_in_it_block>
// @story: <story_id>
// @ac: <acceptance_criterion_numbers>
// @type: Happy | Cross | Negative | Boundary
// @scenario: <one-line description>
// @preconditions: <state needed>
// @steps: <numbered steps>
// @test_data: <specific inputs>
// @expected: <expected result>
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MyComponent from '../MyComponent'

describe('MyComponent', () => {
  it('<exact name matching @test field>', () => {
    // ...
  })
})
```

### Critical: @test must match the it() block name exactly

```
// @test: renders heading and ping button
...
it('renders heading and ping button', () => { ... })
```

If they don't match, the CI cannot map results to TC IDs.

## Test derivation method

Same 5-step method as backend:

1. **Visualise workflow** — what does the user see and do?
2. **Happy path** — renders correctly, handles valid interaction
3. **Cross-cutting** — role-based UI, permission-gated elements
4. **Negative** — error states, API failures, invalid input
5. **Boundary** — empty lists, long text, max values

## Patterns

### Component renders

```javascript
// @tc: TC-02-01
// @test: renders event form with all fields
// @story: PB-02
// @ac: 1
// @type: Happy
// @scenario: Event form displays all required inputs
// @preconditions: None
// @steps: 1. Render EventForm component
// @test_data: none
// @expected: Name, date, and attendance fields are visible
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EventForm from '../components/EventForm'

describe('EventForm', () => {
  it('renders event form with all fields', () => {
    render(<EventForm />)
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/attendance/i)).toBeInTheDocument()
  })
})
```

### API call with mock

```javascript
// @tc: TC-02-02
// @test: submits form and shows success message
// @story: PB-02
// @ac: 2
// @type: Happy
// @scenario: Form submission calls API and displays confirmation
// @preconditions: API mock returns 201
// @steps: 1. Fill form 2. Click submit 3. Wait for response
// @test_data: mock response {id: 1, name: "Test Event"}
// @expected: Success message is displayed
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EventForm from '../components/EventForm'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EventForm', () => {
  it('submits form and shows success message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 1, name: 'Test Event' }),
    })

    render(<EventForm />)
    await userEvent.type(screen.getByLabelText(/name/i), 'Test Event')
    await userEvent.click(screen.getByText(/submit/i))

    await waitFor(() => {
      expect(screen.getByText(/success/i)).toBeInTheDocument()
    })
  })
})
```

### Error state

```javascript
it('shows error when API fails', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: 'Server error' }),
  })

  render(<EventForm />)
  await userEvent.click(screen.getByText(/submit/i))

  await waitFor(() => {
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })
})
```

## Mocking rules

- Mock `global.fetch` for API calls — never hit a real server in unit tests
- Call `vi.restoreAllMocks()` in `afterEach` to prevent cross-test contamination
- If importing JSON fixture data, use `structuredClone(data)` to avoid mutation leaking between tests

## Running tests

```bash
cd frontend
npm run test              # run all
npm run test:watch        # watch mode
npx vitest run src/__tests__/EventForm.test.jsx  # one file
```

## Definition of Done for tests

- [ ] Every test has a complete `@tc` metadata block
- [ ] `@test` field matches the `it()` block name exactly
- [ ] API calls are mocked — no real network requests
- [ ] Happy path, error, and edge cases covered
- [ ] Tests pass locally: `npm run test` is green
- [ ] A human can explain what each test verifies
