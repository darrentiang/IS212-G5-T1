# ADR-003: Notifications in release 1

**Status:** Accepted · **Decided:** 15-09-2026 · **Owners:** Kieren and Lisa (C4), Darren (scope)

## Context
The briefing lists fourteen notification triggers and allows delivery "in-app or another suitable channel" (p10). The team decided in-app only for release 1 (PROJECT_CONTEXT §3.3; stories SCRUM-62 to 64). An earlier draft of this ADR proposed a separate Notification & Task Worker sending email and SMS through a third-party gateway.

## Decision
- Notifications are rows in the database, written by the API in the same transaction as the state change that triggers them. There is no separate process and no external service in release 1.
- Users read their notifications through the API (`GET /api/notifications`) and the web application; unread state is per user.
- Scheduled reminders (SCRUM-74), if pulled into a sprint, run inside the Flask application on a schedule or on demand; the design is decided in that story's pull request.

## Alternatives considered
- **Dedicated worker plus email/SMS gateway (deferred):** decouples the UI from third-party latency, but no requirement in release 1 needs email or SMS, it adds a second process to run from a clean checkout, and the customer has not asked for it. Recorded as a future-release option; the C4 model shows only what release 1 runs.

## Consequences
One process to run and test. If the customer later requires email or SMS, this ADR is superseded by one that adds the worker and gateway, and the C4 model gains those containers then.
