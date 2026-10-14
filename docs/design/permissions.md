# Role permissions

Kept current by every story that adds an action: the row is added or changed in the same pull request. An account may hold more than one role (customer clarification Q-06); it may do anything any of its roles allows (decision D-09).

| Action | Event Organiser | Event Coordinator | Venue Staff | Technical Support Staff | Safety Officer | Attendee |
|---|---|---|---|---|---|---|
| Create, edit (while Draft), delete (while Draft), submit own event request | Own only | No | No | No | No | No |
| Resubmit own rejected request | Own only | No | No | No | No | No |
| View event requests | Own only | All except Draft | No | No | Events in Safety Check | No |
| Edit an event during Planning | No | Assigned coordinator only | No | No | No | No |
| Approve or reject an event request; request clarification | No | Yes | No | No | No | No |
| View event request resulting status and any reason | Own only | Yes | No | No | No | No |
| Reassign an event | No | Assigned coordinator initiates; new coordinator accepts | No | No | No | No |
| Confirm, cancel, mark completed | No | Assigned coordinator | No | No | No | No |
| View venues and venue booking requests | No | Yes | Yes | No | No | No |
| View a venue's availability calendar | No | Yes | Yes | No | No | No |
| Search venues free on an Approved or Planning event's dates and large enough for its attendance | No | Yes | No | No | No | No |
| Maintain venue records and layouts; block a venue | No | No | Yes | No | No | No |
| Raise a venue booking request | No | Yes* | No | No | No | No |
| Withdraw a venue booking request before a decision | No | Own only (whoever raised it) | No | No | No | No |
| See warnings that a venue appears unsuitable for an event, before raising a venue booking request | No | Yes* | No | No | No | No |
| Approve or reject a venue booking | No | No | Yes | No | No | No |
| Approve or reject a safety check | No | No | No | No | Yes | No |
| View equipment inventory | No | Yes | No | Yes | No | No |
| Record equipment requirements | No | Assigned coordinator | No | View | View, events in Safety Check | No |
| Maintain equipment inventory; reserve or release; withdraw from service | No | No | No | Yes | No | No |
| View confirmed events open for registration | No | Yes | No | No | No | Yes |
| Register or withdraw registration | No | No | No | No | No | Own only |
| Raise a change request on a confirmed event | Own only | No | No | No | No | No |
| Decide a change request | No | Assigned coordinator | No | No | No | No |
| View internal planning information (coordinator notes, booking requests, equipment requirements, decisions, reasons) | No | Yes | Venue-related only | Equipment-related only | Events in Safety Check | Never |
| View, open and mark own notifications as read | Yes | Yes | Yes | Yes | Yes | Yes |

Rule: an action not listed as permitted for any of the account's roles is refused, a message is shown, and no data changes.

Rule: when the refusal is object-level (the role is right but this particular record is not the account's to touch — "own only" and "events in Safety Check" above), a read (GET) answers 403: it may say a record exists that the account cannot open. A write (create, edit, submit, delete) instead answers 404: what another account is allowed to change never confirms that the record exists at all. Established by SCRUM-27 (reads) and SCRUM-28 (writes); kept by every story since. Not to be "corrected" into one status code for both.

Rule: \* "Assigned coordinator" is not yet a real restriction anywhere in this table — SCRUM-43 now records the coordinator the system auto-assigns at Approved → Planning (state-model.md), but no story yet enforces the restriction. SCRUM-36 is the first story to need the rule enforced and could not build it without inventing the assignment mechanism itself, so for now any Event Coordinator may raise a venue booking request for any Approved or Planning event (team decision, 07-10-2026). Narrow this back to the assigned coordinator once that story exists; every other "Assigned coordinator" row in this table is similarly unenforced today, for the same reason. Withdrawing is unaffected either way: SCRUM-77 restricts it to whoever raised that specific booking, not to the event's assigned coordinator, so there is nothing to narrow there later.

## Feature keys

Keys used in `backend/permissions.py` and on API routes / `features` from `/api/me`. A pytest asserts this table matches `ROLE_FEATURES` in code (ADR-002). Object rules ("own only", "all except Draft", "events in Safety Check") stay in services, not in this table.

| Key | Event Organiser | Event Coordinator | Venue Staff | Technical Support Staff | Safety Officer | Attendee |
|---|---|---|---|---|---|---|
| requests.view | Yes | Yes | No | No | Yes | No |
| requests.edit | Yes | Yes | No | No | No | No |
| requests.decide | No | Yes | No | No | No | No |
| venues.view | No | Yes | Yes | No | No | No |
| venues.edit | No | No | Yes | No | No | No |
| venues.search | No | Yes | No | No | No | No |
| equipment.view | No | Yes | No | Yes | No | No |
| equipment.edit | No | No | No | Yes | No | No |
| registration.view | No | Yes | No | No | No | Yes |
| internal_notes.view | No | Yes | No | No | No | No |
| notifications.view | Yes | Yes | Yes | Yes | Yes | Yes |
| bookings.edit | No | Yes | No | No | No | No |
| bookings.decide | No | No | Yes | No | No | No |
| safety.decide | No | No | No | No | Yes | No |

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.0 | 10-09-2026 | Initial table | Pre-sprint preparation |
| 1.1 | 15-09-2026 | Multi-role accounts; assigned-coordinator restriction on edits and arrangements; resubmit, reassign, change request, notification rows | Q-06, D-09, D-13, D-14, Q-11, Q-12 |
| 1.2 | 21-09-2026 | Feature keys section mapping API keys to the action table | SCRUM-27 review: ADR-002 requires code ≡ document |
| 1.3 | 22-09-2026 | `venues.edit` feature key, Venue Staff only | SCRUM-31: adding a venue needs a key of its own; `venues.view` is held by Event Coordinators, who may see venues but not maintain them |
| 1.4 | 23-09-2026 | Named "delete (while Draft)" on the Event Organiser row | SCRUM-30: deleting a draft is a new action, not implied by "edit" |
| 1.5 | 23-09-2026 | Rule: 403 for an object-level refusal on a read, 404 on a write | SCRUM-30 review: the split already existed in code (SCRUM-27/28) but was undocumented and read as an accident |
| 1.6| 24-09-2026 | `requests.decide` for Event Coordinators; Organiser may see the request-level approve/reject reason | SCRUM-29: Organisers already hold `requests.edit`, so decide needs its own key; AC6 makes that decision public on the request |
| 1.7 | 07-10-2026 | `bookings.edit` for Event Coordinators; "Raise or withdraw a venue booking request" row marked \* (unenforced "assigned coordinator"), with a Rule explaining why | SCRUM-36: raising a booking needs a key of its own, and is the first story to hit the fact that coordinator assignment itself does not exist yet |
| 1.8 | 08-10-2026 | `venues.search` for Event Coordinators; "Search venues" row | SCRUM-33: searching venues for an event needs a key of its own; `venues.view` is also held by Venue Staff, who cannot open event requests and so have no event to search for |
| 1.9 | 08-10-2026 | Venue-suitability warnings row, under `bookings.edit`, marked \* like raising; no new feature key. The fixed lists an event request's requirements are chosen from (`GET /api/request-options`) sit under `requests.edit`, covered by the existing create/edit row | SCRUM-42: the check is part of raising a venue booking request; Event Organisers choose requirements but do not hold `venues.view` |
| 1.10 | 08-10-2026 | `bookings.decide` for Venue Staff | SCRUM-37: approving or rejecting a venue booking request needs a key of its own; the "Approve or reject a venue booking" row already named Venue Staff only |
| 1.11 | 09-10-2026 | Rule \* reworded: assignment is now recorded; enforcement still pending | SCRUM-43 records who is assigned; narrowing "assigned coordinator" rows is a separate decision for the Product Owner |
| 1.12 | 09-10-2026 | "Raise or withdraw a venue booking request" split into its own raise row (unchanged, still marked \*) and a withdraw row restricted to "Own only (whoever raised it)"; Rule \* reworded to say withdrawing is unaffected by the assigned-coordinator gap | SCRUM-77: withdrawing is restricted to the Coordinator who raised that specific booking (AC4), a stricter, different rule from the unenforced event-level "assigned coordinator"; the old combined row read as if any Event Coordinator could withdraw any booking |
| 1.13 | 09-10-2026 | "View a venue's availability calendar" row, Event Coordinator and Venue Staff, no new feature key | SCRUM-39: the calendar reuses `venues.view` exactly, already held by both; the story's own AC6 ("venues they manage") was reworded to any venue during drafting, since no story has ever built per-venue Venue Staff assignment (team decision, 09-10-2026) |
| 1.14 | 11-10-2026 | "View own notifications" reworded to "View, open and mark own notifications as read"; no new feature key | SCRUM-58: opening and marking read are the same own-record action as viewing, just reusing `notifications.view`, the same way withdrawing a booking reused `bookings.edit` (SCRUM-77) |
| 1.15 | 12-10-2026 | "View equipment inventory" row (Event Coordinator and Technical Support Staff); `equipment.view` granted to Event Coordinator; new `equipment.edit` key for Technical Support Staff only | SCRUM-49: AC1 lets both roles view the inventory and its totals, while AC2/AC7 restrict changing a stock count to Technical Support Staff; the action table had no row for merely viewing inventory, and the existing "Maintain equipment inventory" row already covers editing (was 1.14 on the branch; renumbered after SCRUM-58's 1.14 merged first) |
| 1.16 | 13-10-2026 | New role Safety Officer (a column in both tables); `safety.decide` for the Safety Officer; "Approve or reject a safety check" row; Safety Officer may view event requests and internal planning information for events in Safety Check, and has `requests.view` and `notifications.view`; the object rule "events in Safety Check" is added to the 403-read, 404-write Rule. Not granted yet: `venues.view` and `equipment.view` (the venues and equipment a Safety Officer sees come with the event, so they cannot browse the inventory or venues) | SCRUM-89 (this story's slice of `target/permissions.md` v1.7); SCRUM-90 adds "request changes" to the row |
