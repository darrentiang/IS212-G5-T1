# ADR-002: Authorisation model

**Status:** Accepted · **Decided:** 15-09-2026 · **Owners:** Darren (rules), Hong Yi (implementation in SCRUM-26/27)

## Context
Access depends on role and on the user's relationship to an event (briefing p11): an Event Organiser sees only their own requests, an Attendee never sees internal planning information, a Coordinator edits only events assigned to them. One account may hold several roles (customer clarification Q-06) and may do anything any of its roles allows (decision D-09). `docs/design/permissions.md` is the table of who may do what.

## Decision
**The API is the authority.** Every route decides whether this account may do this action on this object.
- `backend/permissions.py` holds the role → feature matrix, a direct transcription of `permissions.md`. `can(account, feature)` returns true if any of the account's roles allows the feature.
- Routes are guarded with a `require("<feature>")` decorator. A refused request returns HTTP 403 with a message; nothing changes.
- Object rules ("own only", "assigned coordinator only", "not a Draft") are checked in the service function next to the query, because only the server knows who owns what.
- A pytest asserts that the matrix in code equals the table in `permissions.md`, so the document and the code cannot drift.

**The front end mirrors it for usability.** `POST /api/login` and `GET /api/me` return the account's roles and the features they allow. The React app keeps these in context, wraps each route in a guard that shows the not-permitted page when the feature is missing, and hides controls the account cannot use. A 403 from the API is still shown as a message, so the two layers never disagree silently.

## Alternatives considered
- **Front-end-only restriction after login (rejected):** the API would serve any data to any logged-in account; fails the criteria.
- **Permissions stored in the database (rejected):** the matrix changes only when `permissions.md` changes and belongs in version control.
- **Checking role names directly in routes (rejected):** scatters the table through the code; the matrix keeps one home.

## Consequences
Adding a feature means one row in `permissions.md`, one entry in `permissions.py`, and the guard on the route, in the same pull request. Functional tests prove refusal at the page; unit tests prove refusal at the API.
