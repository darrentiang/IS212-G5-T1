---
feature: frontend-scaffold
status: ready
updated: 2026-09-16
branch: chore/setup-frontend-scaffold
owner: Darren; reviewer: a Developer
---

# Front-end scaffold — setup

Read `AGENTS.md` first, then `docs/design/frontend.md` and `docs/design/ui-guidelines.md`; every rule in those two files applies to this build and is not repeated here. This is enabling work (decision D-18): recorded in the setup document, not in a Jira story. It gives every story a place to put its pages and a working login page, layout and nav to build against. It does **not** implement any story.

## Report

_Filled in by Claude Code after the build: what was built, verification, journey log (anything the spec left open and how it was decided)._

## [S1] Problem

`frontend/src/` is one page with a "Ping Backend" button. There is no router, no layout, no login page, no account context, no API module, and no folder for a story to put a page in. The first three stories (SCRUM-26, 27, 28) would each have to invent these, in the same files, at the same time.

## [S2] Design

### Files to create or change

| File | Purpose |
|---|---|
| `frontend/package.json` | add `react-router` (latest 7.x) to `dependencies`. No other dependency. |
| `frontend/src/main.jsx` | renders `<App />` inside `BrowserRouter` and `StrictMode`; imports `index.css`. |
| `frontend/src/App.jsx` | **delete** (replaced by `app/App.jsx`). |
| `frontend/src/__tests__/` | **delete** the folder (`App.test.jsx`, `Ping.test.jsx`, `setup.js`); `setup.js` moves to `app/__tests__/setup.js`. |
| `frontend/vitest.config.js` | `setupFiles: ['./src/app/__tests__/setup.js']`. `include`/`exclude` already cover `src/**/__tests__/`. |
| `frontend/src/app/http.js` | `request(method, path, body)` and `ApiError` exactly as `frontend.md` §6. Only file with `fetch`. |
| `frontend/src/app/auth.jsx` | `AuthProvider` and `useAuth()` per `frontend.md` §5. Calls `me()` from `areas/auth/api.js` on mount. |
| `frontend/src/app/areas.js` | `export const routes = [...authRoutes, ...requestRoutes, ...venueRoutes, ...bookingRoutes, ...equipmentRoutes, ...registrationRoutes, ...changeRoutes, ...notificationRoutes]` — eight named imports, in this order. Nothing else. |
| `frontend/src/app/App.jsx` | wraps everything in `AuthProvider`; renders one `<Route>` per entry in `areas.js`; login redirect, permission guard, `/` and unknown → `/requests`, per `frontend.md` §4. `RequireFeature` defined here. Routes with `public: true` render without `Layout`; all others inside `Layout`. |
| `frontend/src/app/Layout.jsx` | header and nav per `ui-guidelines.md` §2 (test ids `layout-username`, `layout-roles`, `layout-logout-button`, `layout-nav-<page>`). Nav entries from `areas.js`: entries with `nav`, shown only when `permission` is absent or `can(permission)` is true. `<page>` for the nav test id is the last path segment (`/requests` → `requests`). Log out calls `logout()` from `useAuth()` then navigates to `/login`. `<main>` renders `<Outlet />`. |
| `frontend/src/app/NotPermittedPage.jsx` | per `ui-guidelines.md` §7: `not-permitted-message`, `not-permitted-home-link`. |
| `frontend/src/areas/auth/api.js` | contract comments and functions: `login(username, password)` → `POST /api/login` body `{ username, password }`, 200 `{ username, roles, features }`, 401 `{ message }`; `logout()` → `POST /api/logout`, 204; `me()` → `GET /api/me`, 200 `{ username, roles, features }`, 401 `{ message }`. |
| `frontend/src/areas/auth/LoginPage.jsx` | per `ui-guidelines.md` §3–4: username and password inputs (`login-username-input`, `login-password-input`, both required), one primary button `login-submit-button`, banner `login-banner`. Empty required field → message under it (`login-username-error`, `login-password-error`), nothing sent. Submit → `useAuth().login`; success → `navigate('/requests')`; `ApiError` → its message in the banner. Already logged in → `<Navigate to="/requests" />`. Heading text "ConnectSphere Event Planning". |
| `frontend/src/areas/auth/routes.jsx` | `[{ path: '/login', element: <LoginPage />, public: true }]`. |
| `frontend/src/areas/requests/RequestsPage.jsx` | placeholder: heading "Requests" and `<p data-testid="requests-empty">No requests yet.</p>`. Replaced by SCRUM-28/29. |
| `frontend/src/areas/requests/routes.jsx` | `[{ path: '/requests', element: <RequestsPage />, nav: 'Requests' }]`. |
| `frontend/src/areas/requests/api.js` | empty: `import { request } from '../../app/http'` and a comment "Add this area's calls here; see docs/design/frontend.md §6". |
| `frontend/src/areas/{venues,bookings,equipment,registration,changes,notifications}/` | each with `api.js` (as above) and `routes.jsx` exporting `export const routes = []`. No pages. |
| `functional/tests/INFRA-01.spec.js` | rewritten: four-field link header only (`@tc: TC-INFRA-01`, `@test: app opens on the login page`, `@story: INFRA`, `@ac: 1`); `goto('/')`, expect URL `/login`, expect `login-username-input`, `login-password-input`, `login-submit-button` visible. |
| `.claude/skills/playwright-standard/SKILL.md` | none — already points at `ui-guidelines.md`. |

### Behaviour that is not in the design documents
- While `auth` is `loading`, `App` renders nothing (no flash of the login page).
- `login-banner` is rendered only when there is a message; error banners have `role="alert"`.
- Tailwind only, plain and legible; no visual design work beyond what `ui-guidelines.md` states. Header: app name left, username and roles centre, Log out right; nav links below the header.

## [S3] Tests

Header on each: `// @story: setup` and `// @ac: frontend-scaffold`. Mock `../api` (area tests) or `../../areas/auth/api` (app tests); never `fetch`. Render inside `MemoryRouter`.

`frontend/src/app/__tests__/`
1. `Layout.test.jsx` — with an account `{ username: 'coord1', roles: ['Event Coordinator'], features: [] }`, the header shows `layout-username` = `coord1` and `layout-roles` = `Event Coordinator`; with two roles, both appear comma-separated in the given order.
2. `Layout.test.jsx` — a nav entry with a `permission` the account lacks is not rendered; one with a permission it has is rendered with test id `layout-nav-<page>`.
3. `App.test.jsx` — no account (`me` rejects 401): visiting `/requests` shows the login page.
4. `App.test.jsx` — with an account: visiting `/` lands on `/requests`; visiting `/nowhere` lands on `/requests`.
5. `App.test.jsx` — `RequireFeature` with a missing feature renders `not-permitted-message` and the URL is unchanged.
6. `http.test.js` — `request` on a non-2xx reply throws `ApiError` with `status` and the reply's `message`; on 2xx returns the parsed body; sends `credentials: 'include'` (this one test may stub `global.fetch`, since `http.js` is the one file allowed to call it).

`frontend/src/areas/auth/__tests__/LoginPage.test.jsx`
7. Empty submit → `login-username-error` and `login-password-error` shown, `login` not called.
8. `login` rejects with `ApiError(401, 'Invalid username or password')` → `login-banner` shows that text with `role="alert"`, URL stays `/login`.
9. `login` resolves → navigates to `/requests`.

`functional/tests/INFRA-01.spec.js` as in [S2]. `Ping.test.jsx` and `App.test.jsx` (old) are deleted, not adapted.

## [S4] Out of scope (do not build)
- `/api/login`, `/api/logout`, `/api/me` on the backend, sessions, password check — SCRUM-26. The login page will show the API's 404 until then; that is expected.
- `features` content, `backend/permissions.py`, any permission key — SCRUM-27. `RequireFeature` is built and tested with a placeholder key in tests only; no route in `areas.js` carries a `permission` yet.
- Any page beyond `LoginPage` and the `RequestsPage` placeholder.
- Removing `/api/ping` or `test_ping.py` from the backend — they stay.
- README — separate setup item.
- Docs — all already written; if the build finds a contradiction between `frontend.md`, `ui-guidelines.md` and this spec, stop and report it rather than choosing.

## [S5] Done when
- `npm install` then `npm run dev` in `frontend/`: `/` shows the login page; submitting empty shows field messages; submitting anything shows a banner with the API's message.
- `npm run test` in `frontend/`: tests 1–9 green, coverage printed, old tests gone.
- `npm run test` in `functional/`: INFRA-01 green.
- `frontend/src/` contains no `fetch` outside `app/http.js`, no file outside `app/`, `areas/`, `main.jsx`, `index.css`.
- `git status` shows only intended files.
- PR title `Setup: front-end scaffold`; description lists the files, says the code was drafted with Claude Code from this spec and reviewed by the author, names the reviewer, and notes that login works end to end only once SCRUM-26 lands. A Developer other than the author approves before merge.
