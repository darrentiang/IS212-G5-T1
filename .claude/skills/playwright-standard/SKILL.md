---
name: playwright-standard
description: How to write functional tests with Playwright for this project — per-story spec conventions, @tc metadata format, browser test patterns, and the full-stack testing approach. Use when writing, reviewing, or fixing functional/Playwright tests, or when implementing a user story that needs browser-level testing.
---

# Playwright Standard — Functional Tests

## What these are

Functional tests verify one user story's flow through the real stack: browser → React → Flask → response. Not unit tests. Not whole-project E2E journeys. One story, one spec file.

## Location

All functional tests go in `functional/tests/`. File naming: `<story-id>.spec.js` (e.g. `PB-01.spec.js`).

## @tc metadata (REQUIRED)

```javascript
// @tc: TC-<STORY>-<NN>
// @test: <exact_test_name_as_in_test_block>
// @story: <story_id>
// @ac: <acceptance_criterion_numbers>
// @type: Happy | Cross | Negative | Boundary
// @scenario: <one-line description>
// @preconditions: <state needed>
// @steps: <numbered steps>
// @test_data: <specific inputs>
// @expected: <expected result>
import { test, expect } from '@playwright/test'

test('<exact name matching @test field>', async ({ page }) => {
  // ...
})
```

### Critical: @test must match the test() block name exactly

```
// @test: event organiser creates a valid event request
...
test('event organiser creates a valid event request', async ({ page }) => { ... })
```

## Spec file structure

One spec file per user story. Multiple tests within the file cover different scenarios (Happy, Negative, Boundary).

```javascript
// @tc: TC-01-01
// @test: event organiser creates a valid event request
// @story: PB-01
// @ac: 1, 2
// @type: Happy
// @scenario: Event organiser fills form and submits successfully
// @preconditions: Event organiser account exists, logged in
// @steps: 1. Navigate to event creation 2. Fill form 3. Submit 4. Verify confirmation
// @test_data: Event name "Annual Conference", date "2026-11-15", attendance 100
// @expected: Success message shown, event appears in list
import { test, expect } from '@playwright/test'

test('event organiser creates a valid event request', async ({ page }) => {
  await page.goto('/events/new')

  await page.fill('[data-testid="event-name"]', 'Annual Conference')
  await page.fill('[data-testid="event-date"]', '2026-11-15')
  await page.fill('[data-testid="event-attendance"]', '100')
  await page.click('button[type="submit"]')

  await expect(page.getByText(/success/i)).toBeVisible()
  await expect(page.getByText('Annual Conference')).toBeVisible()
})

// @tc: TC-01-02
// @test: event creation fails with empty name
// @story: PB-01
// @ac: 3
// @type: Negative
// @scenario: Submitting with empty name shows validation error
// @preconditions: Event creation form is open
// @steps: 1. Leave name empty 2. Submit 3. Verify error
// @test_data: empty name, valid date and attendance
// @expected: Error message about required name field
test('event creation fails with empty name', async ({ page }) => {
  await page.goto('/events/new')

  await page.fill('[data-testid="event-date"]', '2026-11-15')
  await page.fill('[data-testid="event-attendance"]', '100')
  await page.click('button[type="submit"]')

  await expect(page.getByText(/name.*required/i)).toBeVisible()
})
```

## Selector strategy

Use `data-testid` attributes for reliable selectors:

```javascript
// Good — stable, not affected by CSS/text changes
await page.click('[data-testid="submit-event"]')
await page.fill('[data-testid="event-name"]', 'Test')

// Avoid — brittle
await page.click('.btn-primary')           // CSS class
await page.click('button:nth-child(3)')    // position
await page.getByText('Submit')             // text (OK for assertions, fragile for actions)
```

Add `data-testid` to React components:

```jsx
<input data-testid="event-name" ... />
<button data-testid="submit-event" ...>
```

## Test independence

Each test must be independent. No test should depend on another test's side effects.

```javascript
// BAD — second test depends on first
test('creates event', async ({ page }) => { /* creates "Conference" */ })
test('deletes event', async ({ page') => { /* assumes "Conference" exists */ })

// GOOD — each test sets up its own state
test('creates event', async ({ page }) => { /* creates its own event */ })
test('deletes event', async ({ page }) => {
  // Create the event first, then delete it
  // or use a beforeEach that seeds data
})
```

## Running tests

```bash
cd functional
npm run test              # headless
npm run test:headed       # watch in browser
npm run test:report       # open HTML report
npx playwright test tests/PB-01.spec.js  # one spec file
```

The Playwright config auto-starts Flask (:5000) and Vite (:5173) before tests run.

## What to test at this level

- Complete user flows through the browser (fill form → submit → verify result)
- Navigation between pages
- Role-based access (wrong role sees wrong page / gets redirected)
- Visible error messages and success confirmations
- Data appearing in lists after creation

## What NOT to test at this level

- Individual function logic (that's unit tests)
- API response codes directly (that's backend unit tests)
- CSS styling details
- Database internals

## Definition of Done for tests

- [ ] Every test has a complete `@tc` metadata block
- [ ] `@test` field matches the `test()` block name exactly
- [ ] Uses `data-testid` selectors, not CSS classes or text
- [ ] Tests are independent — no cross-test dependencies
- [ ] Happy path, negative, and boundary scenarios covered
- [ ] Tests pass locally: `npm run test` is green
- [ ] A human can explain what each test verifies
