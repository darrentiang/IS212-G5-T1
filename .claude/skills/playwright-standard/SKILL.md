---
name: playwright-standard
description: How to write functional tests with Playwright for this project — per-story spec conventions, the @tc link header, browser test patterns, and the full-stack testing approach. Use when writing, reviewing, or fixing functional/Playwright tests, or when implementing a user story that needs browser-level testing.
---

# Playwright Standard — Functional Tests

Test cases come from the team test sheet, not from this file. Read `docs/test-cases/AUTOMATION.md` first: it says how a Playwright test maps to a sheet row. This skill covers how to write the test itself.

## What these are

Functional tests verify one user story's flow through the real stack: browser → React → Flask → response. Not unit tests. Not whole-project E2E journeys. One story, one spec file.

## Location

All functional tests go in `functional/tests/`. File naming: `<jira-key>.spec.js` (e.g. `SCRUM-26.spec.js`).

## @tc link header (REQUIRED)

One `test()` per curated row in the Test cases tab, in the row's order. The header above each test carries link fields only; the sheet holds the scenario, preconditions, steps, test data and expected result.

```javascript
// @tc: TC-SCRUM-<n>-<nn>
// @test: <exact_test_name_as_in_test_block>
// @story: SCRUM-<n>
// @ac: <acceptance_criterion_numbers>
test('<exact name matching @test field>', async ({ page }) => {
  // ...
})
```

### Critical: @test must match the test() block name exactly

CI matches results to TC IDs by this name. If they differ, the execution is logged without a TC ID.

```
// @test: wrong password is refused
...
test('wrong password is refused', async ({ page }) => { ... })
```

## Spec file structure

One spec file per user story. Multiple tests within the file cover the story's scenarios (Happy, Cross, Negative, Boundary), one per row in the Test cases tab.

```javascript
import { test, expect } from '@playwright/test'

// @tc: TC-SCRUM-26-01
// @test: organiser logs in with valid credentials
// @story: SCRUM-26
// @ac: 1
test('organiser logs in with valid credentials', async ({ page }) => {
  await page.goto('/login')

  await page.fill('[data-testid="username"]', 'org1')
  await page.fill('[data-testid="password"]', 'Passw0rd!')
  await page.click('[data-testid="login-submit"]')

  await expect(page.getByTestId('current-role')).toHaveText(/event organiser/i)
})

// @tc: TC-SCRUM-26-02
// @test: wrong password is refused
// @story: SCRUM-26
// @ac: 3
test('wrong password is refused', async ({ page }) => {
  await page.goto('/login')

  await page.fill('[data-testid="username"]', 'org1')
  await page.fill('[data-testid="password"]', 'wrong')
  await page.click('[data-testid="login-submit"]')

  await expect(page.getByTestId('login-error')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})
```

Map the row to the test: Preconditions → setup (seeded accounts, objects created through the UI or API before the steps); Steps → the actions in order; Test data → the values typed; Expected result → the assertions. Where the row says "nothing changed", reload and assert the state is unchanged.

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
test('deletes event', async ({ page }) => { /* assumes "Conference" exists */ })

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
npx playwright test tests/SCRUM-26.spec.js  # one spec file
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

- [ ] Every curated row for the story in the Test cases tab has exactly one test
- [ ] Every test has the 4-field `@tc` link header; no description fields in the file
- [ ] `@test` field matches the `test()` block name exactly
- [ ] Uses `data-testid` selectors, not CSS classes or text
- [ ] Tests are independent — no cross-test dependencies
- [ ] Tests pass locally: `npm run test` is green
- [ ] A human can explain what each test verifies
