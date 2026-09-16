# Front end

How the React front end is built: folders, routing and the permission guard, the account context from `/api/me`, API calls, error handling and styling. What each page shows and the `data-testid` of every element live in `ui-guidelines.md`; read it first. Authorisation follows `docs/adr/ADR-002-authorisation.md`: the API decides, the front end mirrors it for usability. Changing a rule here means changing this file first, in the same pull request.

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.0 | 16-09-2026 | Initial conventions | The scaffold and SCRUM-26/27 need one agreed way to build pages, routes and API calls; code is split by area so Developers on different stories rarely edit the same file |

## 1. Folders

The code is split by **area**: the kind of record a page shows or changes. Each area owns its pages, API calls, routes and tests. A new story adds or edits files inside one area folder; the shared core in `app/` is built once by the scaffold and rarely changes.

"Feature" is not used for folders: in ADR-002 a feature is a permission key (`can(account, feature)`).

```
frontend/src/
  main.jsx               renders App inside BrowserRouter; nothing else
  index.css              the Tailwind import only
  app/                   shared core
    App.jsx              login redirect, permission guard, one <Route> per entry in areas.js
    areas.js             imports every area's routes.jsx; the only list of areas
    Layout.jsx           header and nav, built from areas.js
    auth.jsx             account context from /api/me
    http.js              the only fetch: request() and ApiError
    NotPermittedPage.jsx
    __tests__/
  areas/
    <area>/
      api.js             this area's API calls
      routes.jsx         this area's pages, the permission each needs, nav labels
      <Name>Page.jsx     one page per file
      __tests__/         Vitest tests for this area
```

No `components/` folder. `Layout` is the only shared component; each page owns its markup, so a change to one story's page cannot break another story's tests. Markup repeated on two pages is repeated, not extracted.

## 2. Which area a story belongs to

The story's Jira `area-nn` label decides the folder.

| Folder | Jira areas | Record it is about |
|---|---|---|
| `auth` | 01 | Account, session |
| `requests` | 02, 03, 04, 05, 06, 07 | Event request and its status |
| `venues` | 08, 09, 10, 11 | Venue, layouts, availability |
| `bookings` | 12, 13, 14 | Venue booking request |
| `equipment` | 15, 16, 17 | Equipment and reservations |
| `registration` | 18 | Attendee registration |
| `changes` | 19 | Change request |
| `notifications` | 20 | Notification |

- **Tie-break:** a story that touches two records belongs to the area of the record it creates or changes. Example: SCRUM-36 Request Venue Booking starts from an event but creates a booking, so its page is in `bookings/`; the only edit in `requests/` is a link to it.
- If the label and the record disagree, the Product Owner settles it at refinement and corrects the label in Jira. This table stays the only rule.
- The scaffold creates all eight folders, so no story adds an area. A new area (future release) is one row here and one import in `areas.js`, in the same pull request.

## 3. Dependencies between folders

- An area may import from `app/` (`http.js`, `auth.jsx`).
- An area never imports from another area. To send the user to another area's page, link to its path (`<Link to="/requests/12/bookings/new">`).
- `app/` imports from areas in two places only: `areas.js` (every `routes.jsx`) and `auth.jsx` (`areas/auth/api.js`).

## 4. Routes

Each `areas/<area>/routes.jsx` exports a `routes` array:

```jsx
import RequestsPage from './RequestsPage'
import RequestNewPage from './RequestNewPage'

export const routes = [
  { path: '/requests', element: <RequestsPage />, nav: 'Requests' },
  { path: '/requests/new', element: <RequestNewPage />, permission: '<feature key>', nav: 'New request' },
]
```

| Field | Meaning |
|---|---|
| `path` | Exactly as in `ui-guidelines.md` §1 |
| `element` | The page |
| `permission` | Feature key from `backend/permissions.py` the account needs; omitted = any logged-in account |
| `nav` | Label of the nav link; omitted = no nav link (e.g. detail pages) |
| `public` | `true` only for `/login`: reachable without an account, no layout |

`App.jsx` and `Layout.jsx` read the combined list from `areas.js`:

- No account → `<Navigate to="/login" replace />`.
- `permission` present and `can(permission)` false → render `NotPermittedPage` in place; no redirect.
- `/` and unknown paths → `<Navigate to="/requests" replace />`.
- Nav: entries with `nav`, in `areas.js` order then array order, shown only when the account may open them.
- The front end never checks role names.

## 5. Account context (`app/auth.jsx`)

- On start it calls `me()` from `areas/auth/api.js`. A 401 means no account.
- Holds the account as `/api/me` returns it: username, roles, features.
- `useAuth()` returns `{ account, loading, can(feature), login(username, password), logout() }`.
  - `login` calls the auth area's `login` and stores what it returns; `logout` calls `logout` and clears the account.
  - `can(feature)` is true when the account's features include it. Pages use it to hide controls.
- While `loading`, render nothing, so a logged-in user never sees the login page flash.

## 6. API calls

**`app/http.js`** is the only file that calls `fetch`.

- `request(method, path, body)` sends `credentials: 'include'`, a JSON body and header, and parses the JSON reply.
- 2xx → returns the parsed body.
- Anything else → throws `ApiError` (a subclass of `Error`) with `status`, `message` (the reply's `message`) and `fields` (the reply's `fields` object, field name → message, when present).
- It never navigates and never renders.

**`areas/<area>/api.js`** holds that area's calls: one exported async function per endpoint, named for the action (`listRequests()`, `submitRequest(data)`), each a one-line call to `request()`. Pages import only their own area's `api.js`; tests mock it with `vi.mock('../api')`.

**Contract first.** Above each function, a comment states the endpoint before either side is built:

```js
// POST /api/requests
// body:    { name, purpose, description, date, start_time, end_time, attendance, venue, accessibility, equipment, registration }
// 201:     the created request
// 400:     { message, fields }   403: { message }
export const submitRequest = (data) => request('POST', '/api/requests', data)
```

The story author commits this first and opens a draft pull request, so a Developer whose page depends on it can build against it with the module mocked. Waiting on another story's endpoint is raised at the Daily Scrum.

**Handling an `ApiError`** (the caller decides):
- 401 from `login` → a refused login: `error.message` in the login banner.
- 401 from any other call → the session has ended: clear the account through `useAuth()`; routing sends the user to `/login`.
- `fields` present → each message under its field.
- Otherwise → `error.message` in the page banner.

## 7. Pages

- State with `useState`; data loaded in `useEffect` or in event handlers through the area's `api.js`. No global store other than the account context, no data-fetching library.
- Submitting: set `submitting` before the call, clear it in `finally`; every button `disabled={submitting}`.
- Every `catch` puts the error on screen (banner or field). No empty `catch`, no `console.log` as error handling.
- Success that moves to another page: `navigate(path, { state: { banner: 'Request submitted' } })`; the landing page shows `location.state?.banner` as its success banner.
- Labels linked to inputs with `htmlFor` / `id`.

## 8. When two stories share a file

Some stories share a page (SCRUM-28 Submit and SCRUM-30 Save Draft both change `RequestNewPage.jsx`). The Developers say so at Sprint Planning or the first Daily Scrum; whoever merges second pulls `main` into their branch before asking for review.

## 9. Styling

- Tailwind utility classes in `className` only. No other CSS file, no CSS modules, no `style` props.
- No component, icon, CSS-in-JS, state or fetching library.
- Mobile first with Tailwind breakpoints; tables in an `overflow-x-auto` wrapper.

## 10. Review checks (per pull request that touches `frontend/src/`)

1. `fetch` appears only in `app/http.js`.
2. The story's files are in the area its Jira label maps to (§2); `app/` untouched unless the pull request says why.
3. No import from another area.
4. New endpoint functions carry the contract comment.
5. Controls and nav hidden with `can()`, never by role name.
6. Every `ApiError` reaches a field message or the banner.
7. No dependency added beyond `react-router`.
8. Elements, text and test ids match `ui-guidelines.md`.
