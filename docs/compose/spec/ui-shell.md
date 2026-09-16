---
feature: ui-shell
status: delivered
updated: 2026-09-16
branch: chore/setup-ui-shell
owner: Darren (PO, setup under D-18); reviewer: a Developer
---

# UI shell v1.1 — home by permission, format helpers, page anatomy — setup

Read `AGENTS.md` first, then `docs/design/ui-guidelines.md` v1.1 and `docs/design/frontend.md` v1.1 (both already updated on this branch; this spec implements them and does not restate them). Enabling work (D-18). It does **not** implement any story.

## Report

**What was built** — `app/home.js` exports `homePathFor(account)`: the `path` of the first route in `areas.js` order with a `nav` label whose `permission` is absent or held, `null` when there is none. `App.jsx` is its only caller — `/` and `*` navigate to that path, and render `NotPermittedPage` when it is `null`. `LoginPage` navigates to `/` after a successful login and when already logged in, and `NotPermittedPage` links to `/`; neither works out the home page itself, so neither depends on the route list. New `app/format.js` holds the only shared functions in the front end: `formatDate` (`'2026-10-03'` → `'03 Oct 2026'`), `formatTime` (24-hour pass-through with validation), `formatPeriod` (`'03 Oct 2026, 14:30–16:00'`, en dash), each throwing on malformed input, and the frozen `STATUS` object grouped per record with the exact words from `state-model.md`. `RequestsPage` follows the §3 page anatomy — a title row carrying `requests-title`, with the place the SCRUM-28 action button goes marked, then `requests-empty`. `Layout` is unchanged. Tests: new `app/__tests__/format.test.js`; `App.test.jsx` extended with the three home-path cases; the LoginPage "goes to /requests" test became "goes home". `state-model.md` gains a version 1.2 row and the sentence pointing at `STATUS`; the Vitest skill gains the line about asserting status text through the constant.

**Verification** — pytest in `backend/`: **22 passed**, 100 % of every non-excluded file (untouched by this change, run to confirm that). Vitest in `frontend/`: **25 passed** in 5 files; `format.js` is at **100 %** statements, branches and lines, as [S5] requires, and so are `App.jsx`, `NotPermittedPage.jsx`, `LoginPage.jsx` and `RequestsPage.jsx`. `home.js` is at **100 %** too. Playwright in `functional/`: **1 passed** (INFRA-01), one worker. `vite build` completes with zero errors and `oxlint` reports no errors. In the browser against the real Flask backend, with no `/api/me` yet, `/` and `/nowhere` both land on `/login` with the form rendered; the console carries only the expected `/api/me` 404s and no React or module errors.

**Journey log** — What the spec left open, and how each was decided:

- **`STATUS` is grouped, not flat.** `frontend.md` §7 writes the example as `STATUS.SUBMITTED === 'Submitted'` while also saying "grouped per record"; the spec's [S2] and test 4 are unambiguous that `STATUS.REQUEST` is the group. Built grouped: `STATUS.REQUEST.SUBMITTED === 'Submitted'`, `STATUS.UNIT.OUT_OF_SERVICE === 'Out of Service'`. `frontend.md` was not edited — it is not in the [S2] file list — but its §7 example needs the one-word fix to `STATUS.REQUEST.SUBMITTED`, and a reviewer should make it.
- **Only `App` resolves the home path; the pages just point at `/`.** The spec has `LoginPage` navigate to `useHomePath()` and `NotPermittedPage` link to it, which made both pages depend on the route list and put them in an import cycle with it. They now navigate and link to `/` instead, and `App` — which already turns `/` into the account's home page, or into the not-permitted page when there is none — decides where that lands. This deviates from two lines of [S2] and from [S3] test 7, on the Product Owner's instruction: `NotPermittedPage` no longer varies by whether a home exists, so its link always renders, and the "contact ConnectSphere" sentence for an account that may open nothing is gone. One consequence for the reviewer: such an account now sees a home link that returns it to the same not-permitted page.
- **The not-permitted wording.** The link cannot name the page it leads to, because the page no longer knows which page that is; it reads "Go to your home page".
- **Dates are parsed by hand, not by `Date`.** `new Date('2026-10-03')` is parsed as UTC midnight and prints as the previous day west of Greenwich, so `formatDate` matches the ISO string with a regular expression and builds the output from its own parts. It then round-trips through `Date.UTC` only to reject a date that does not exist: `Date.UTC` rolls 31 February forward to 3 March, and comparing the parts back catches it. `'2026-02-31'` throws rather than printing `03 Mar 2026`.
- **`homePathFor` lives alone in `app/home.js`, and only `App.jsx` imports it.** It and a `useHomePath` hook were first written in `App.jsx`, which made `App.jsx` and `NotPermittedPage.jsx` import each other. Moving both to their own module fixed that but left a second cycle, `home → areas → auth/routes → LoginPage → home`, because the home path is derived from the route list and the route list holds the pages. Taking the home path out of both pages (above) removed that cycle and left the hook with no caller, so `useHomePath` was deleted: a component that needs home navigates to `/`. What remains is one pure function, one importer, no cycle anywhere in the front end, and `home.js` at 100 %. `docs/design/frontend.md` §1 and §4 record the same. Verified rather than assumed: Vitest, `vite build` (Rollup) and the browser console are all clean, and `oxlint` lost the two `only-export-components` warnings `App.jsx` had while it held the functions.
- **`App.test.jsx` now mocks `../areas` for the whole file**, as [S3] directs, using `vi.hoisted` so each test can set its own route list. Two existing tests were adapted to suit: the stand-in list gives `/requests` a `requests.view` permission, so the "lands on home from `/` and from an unknown address" account gained that feature, and the test now proves the new rule instead of the old fixed `/requests`. Both keep their original assertions.

Two notes for the reviewer, neither a defect:

- **`areas/*/routes.jsx` left the coverage measurement during this build.** Mocking `../areas` means the real `areas.js` no longer imports the per-area lists during a test run, so the coverage they used to show was incidental to being imported and never came from a test. The Product Owner added `src/areas/*/routes.jsx` to the Vitest `exclude` list and the matching row to `COVERAGE.md` (v1.1) while this work was in progress, on the same reasoning as the `src/app/areas.js` exclusion that was already there. That, and nothing about the code, is why the reported denominator is smaller than before.
- **The second browser item in [S5] cannot be checked yet.** "Once SCRUM-26 lands, `org1` goes to `/requests`" needs `/api/login` and `/api/me`, which are that story. The routing it describes is proven by the unit tests (`/venues` for a Venue Staff account, `/registration` for one with no features, the not-permitted page when nothing is permitted, and the login page landing on the first permitted entry); re-check it in the browser when SCRUM-26 merges.

## [S1] Problem

Three of five roles cannot view event requests (`permissions.md`), yet every account lands on `/requests` after login. Every page about to be built will format dates and type status strings by hand. The placeholder Requests page does not follow the page anatomy the guidelines now prescribe, so the first real page has no example to copy.

## [S2] Design

### Files to create or change

| File | Purpose |
|---|---|
| `frontend/src/app/App.jsx` | export `useHomePath()`: the `path` of the first route in `areas.js` order that has `nav` and (no `permission` or `can(permission)`); `null` when none. `/` and `*` navigate to it; when `null`, render `NotPermittedPage` for `/` and `*`. |
| `frontend/src/areas/auth/LoginPage.jsx` | after a successful login and when already logged in, navigate to `useHomePath()` instead of `/requests`. (Note: `useHomePath` reads the account from context; call it inside the component, and navigate after `login()` resolves and the context has the account — compute the path from the login reply's `features` if needed by exporting `homePathFor(account)` as the pure function and `useHomePath` as the hook over it.) |
| `frontend/src/app/NotPermittedPage.jsx` | the link goes to `useHomePath()`; when `null`, the link is not rendered and the sentence says to contact ConnectSphere. |
| `frontend/src/app/Layout.jsx` | Log out still navigates to `/login`. No other change. |
| `frontend/src/app/format.js` | `formatDate(iso)` (`'2026-10-03'` → `'03 Oct 2026'`), `formatTime(hhmm)` (`'14:30'` → `'14:30'`, pass-through with validation), `formatPeriod(iso, start, end)` (`'03 Oct 2026, 14:30–16:00'`, en dash); each throws on malformed input rather than returning garbage. `STATUS` frozen object grouped per record, values exactly as `docs/design/state-model.md`: `REQUEST` (Draft, Submitted, Approved, Rejected, Planning, Confirmed, Completed, Cancelled), `BOOKING` (Requested, Approved, Rejected, Withdrawn), `RESERVATION` (Reserved, Released), `UNIT` (In Service, Out of Service), `REGISTRATION` (Registered, Withdrawn). Keys are upper snake case of the value. No date library; plain `Date`/string handling. |
| `frontend/src/areas/requests/RequestsPage.jsx` | the placeholder now follows `ui-guidelines.md` §3 so it is the example every page copies: title row (`requests-title` "Requests", no action button yet — SCRUM-28 adds it), then the empty message `requests-empty`. Still no API call. |
| `frontend/src/app/__tests__/format.test.js` | tests below. |
| `frontend/src/app/__tests__/App.test.jsx` | extend: tests 4–6 below. |
| `frontend/src/areas/auth/__tests__/LoginPage.test.jsx` | the "goes to /requests" test becomes "goes home": with a mocked `areas` list where the first permitted entry is `/venues`, login lands on `/venues`. |
| `docs/design/state-model.md` | one sentence under the version table: "The front end holds these words in `frontend/src/app/format.js` (`STATUS`); a change here changes that file in the same pull request." Version 1.2 row. |
| `.claude/skills/vitest-standard/SKILL.md` | one line under "What to test": a page test asserts status text through `STATUS`, never a literal. |

## [S3] Tests

Header on each: `// @story: setup` / `// @ac: ui-shell`.

`app/__tests__/format.test.js`
1. `formatDate('2026-10-03')` → `'03 Oct 2026'`; `formatDate('2026-01-09')` → `'09 Jan 2026'`.
2. `formatPeriod('2026-10-03', '14:30', '16:00')` → `'03 Oct 2026, 14:30–16:00'`.
3. `formatDate('3/10/2026')` and `formatTime('2pm')` throw.
4. `STATUS.REQUEST` has exactly the eight values above; every group is frozen (`Object.isFrozen`).

`app/__tests__/App.test.jsx` (mock `../areas` with a list of three nav entries: `/requests` needing `requests.view`, `/venues` needing `venues.view`, `/registration` with no permission)
5. Account with `features: ['venues.view']` → visiting `/` lands on `/venues`.
6. Account with no features → visiting `/` lands on `/registration` (the entry with no permission).
7. Mocked list where every entry needs a feature the account lacks → visiting `/` renders `not-permitted-message` and no home link.

`areas/auth/__tests__/LoginPage.test.jsx`
8. As in [S2]: login lands on the first permitted nav entry.

Existing tests keep passing; `RequestsPage` test id `requests-empty` unchanged.

## [S4] Out of scope
- Any permission key on a real route (SCRUM-27). The mocks in tests use placeholder keys.
- Notifications count in the nav (notifications story).
- Any real page beyond the placeholder.

## [S5] Done when
- `npm run test` in `frontend/`: all green; `format.js` at 100 %.
- `npm run test` in `functional/`: INFRA-01 green.
- Browser: with no `/api/me` yet the app still opens on `/login`; once SCRUM-26 lands, `org1` goes to `/requests`.
- PR title `Setup: UI shell v1.1`; description per `AGENTS.md`; a Developer approves.
