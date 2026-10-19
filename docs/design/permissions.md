# Role permissions

Kept current by every story that adds an action: the row is added or changed in the same pull request. An account may hold more than one role (customer clarification Q-06); it may do anything any of its roles allows (decision D-09).

| Action | Event Organiser | Event Coordinator | Event Coordinator Lead | Venue Staff | Technical Support Staff | Safety Officer | Attendee |
|---|---|---|---|---|---|---|---|
| Create, edit (while Draft), delete (while Draft), submit own event request | Own only | No | No | No | No | No | No |
| Resubmit own rejected request | Own only | No | No | No | No | No | No |
| View event requests | Own only | All except Draft | Unassigned queue; requests that have a coordinator, read-only | No | No | Events in Safety Check | No |
| Assign a coordinator to a request in the unassigned queue | No | No | Yes | No | No | No | No |
| Edit an event during Planning | No | Assigned coordinator only | No | No | No | No | No |
| Approve or reject an event request; request clarification | No | Yes | No | No | No | No | No |
| View event request resulting status and any reason | Own only | Yes | Yes | No | No | No | No |
| Reassign an event | No | Assigned coordinator initiates; new coordinator accepts | No | No | No | No | No |
| Send for safety check, cancel, mark completed | No | Assigned coordinator | No | No | No | No | No |
| View venues, venue booking requests and venue holds | No | Yes | No | Yes | No | No | No |
| View a venue's availability calendar | No | Yes | No | Yes | No | No | No |
| Search venues free on an Approved or Planning event's dates and large enough for its attendance | No | Yes | No | No | No | No | No |
| Maintain venue records and layouts; block a venue | No | No | No | Yes | No | No | No |
| Raise a venue booking request | No | Yes* | No | No | No | No | No |
| Withdraw a venue booking request before a decision | No | Own only (whoever raised it) | No | No | No | No | No |
| Place or release a venue hold | No | Assigned coordinator | No | No | No | No | No |
| Cancel an approved venue booking | No | Assigned coordinator | No | No | No | No | No |
| See warnings that a venue appears unsuitable for an event, before raising a venue booking request | No | Yes* | No | No | No | No | No |
| Approve or reject a venue booking | No | No | No | Yes | No | No | No |
| Approve, reject or request changes on a safety check | No | No | No | No | No | Yes | No |
| View equipment inventory | No | Yes | No | No | Yes | No | No |
| Check equipment availability for a period (SCRUM-50) | No | No | No | No | Yes | No | No |
| View detailed equipment requirements | No | Assigned coordinator | No | No | Non-Draft events | Approved requirements, events in Safety Check | No |
| Add requirements, or change/remove Requested requirements while event Approved or Planning | No | Assigned coordinator | No | No | No | No | No |
| Review equipment requirements or change arrangement notes while event Approved or Planning | No | No | No | No | Yes | No | No |
| Reserve or release equipment while event Approved or Planning | No | No | No | No | Yes | No | No |
| Maintain equipment inventory; withdraw from service | No | No | No | No | Yes | No | No |
| View confirmed events open for registration | No | Yes | No | No | No | No | Yes |
| Register or withdraw registration | No | No | No | No | No | No | Own only |
| Raise a change request on a confirmed event | Own only | No | No | No | No | No | No |
| Decide a change request | No | Assigned coordinator | No | No | No | No | No |
| View internal planning information (coordinator notes, booking requests, equipment requirements, decisions, reasons) | No | Yes | No | Venue-related only | Equipment-related only | Events in Safety Check | Never |
| View, open and mark own notifications as read | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

Rule: an action not listed as permitted for any of the account's roles is refused, a message is shown, and no data changes.

Rule: when the refusal is object-level (the role is right but this particular record is not the account's to touch — "own only" and "events in Safety Check" above), a read (GET) answers 403: it may say a record exists that the account cannot open. A write (create, edit, submit, delete) instead answers 404: what another account is allowed to change never confirms that the record exists at all. Established by SCRUM-27 (reads) and SCRUM-28 (writes); kept by every story since. Not to be "corrected" into one status code for both.

Rule: \* "Assigned coordinator" is a real restriction on the equipment requirement rows (SCRUM-48): only the event's assigned Event Coordinator may add, change or remove them, and reads are scoped the same way — Technical Support Staff sees a non-Draft event's timing, Approved venue bookings and the requirements themselves, never the request's private fields, and a Safety Officer sees Approved requirements through the existing Safety Check view. It is not yet a real restriction on the rows marked \*: SCRUM-86 now records the coordinator the Event Coordinator Lead assigns from the unassigned queue (state-model.md), but SCRUM-36 is the first story to need the rule enforced and could not build it without inventing the assignment mechanism itself, so for now any Event Coordinator may raise a venue booking request for any Approved or Planning event (team decision, 07-10-2026), and the suitability warnings row is \* for the same reason. Narrow those back to the assigned coordinator once that story exists. Withdrawing is unaffected either way: SCRUM-77 restricts it to whoever raised that specific booking, not to the event's assigned coordinator, so there is nothing to narrow there later.

## Feature keys

Keys used in `backend/permissions.py` and on API routes / `features` from `/api/me`. A pytest asserts this table matches `ROLE_FEATURES` in code (ADR-002). Object rules ("own only", "all except Draft", "events in Safety Check") stay in services, not in this table.

| Key | Event Organiser | Event Coordinator | Event Coordinator Lead | Venue Staff | Technical Support Staff | Safety Officer | Attendee |
|---|---|---|---|---|---|---|---|
| requests.view | Yes | Yes | Yes | No | No | Yes | No |
| requests.edit | Yes | Yes | No | No | No | No | No |
| requests.decide | No | Yes | No | No | No | No | No |
| venues.view | No | Yes | No | Yes | No | No | No |
| venues.edit | No | No | No | Yes | No | No | No |
| venues.search | No | Yes | No | No | No | No | No |
| equipment.view | No | Yes | No | No | Yes | No | No |
| equipment.check | No | No | No | No | Yes | No | No |
| equipment.requirements.view | No | Yes | No | No | Yes | No | No |
| equipment.requirements.edit | No | Yes | No | No | No | No | No |
| equipment.requirements.review | No | No | No | No | Yes | No | No |
| equipment.reserve | No | No | No | No | Yes | No | No |
| equipment.edit | No | No | No | No | Yes | No | No |
| registration.view | No | Yes | No | No | No | No | Yes |
| internal_notes.view | No | Yes | No | No | No | No | No |
| notifications.view | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| bookings.edit | No | Yes | No | No | No | No | No |
| bookings.decide | No | No | No | Yes | No | No | No |
| safety.send | No | Yes | No | No | No | No | No |
| safety.decide | No | No | No | No | No | Yes | No |
| assignments.manage | No | No | Yes | No | No | No | No |

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
| 1.17 | 14-10-2026 | "Approve or reject a safety check" becomes "Approve, reject or request changes on a safety check"; no new feature key (`safety.decide` covers it) | SCRUM-90: requesting changes is another decision the Safety Officer makes under the same key |
| 1.18 | 14-10-2026 | "Confirm" replaced by "Send for safety check" in the Assigned coordinator row; new key `safety.send` for Event Coordinator (the assigned-only rule stays in the service) | Week 7 customer change 6; SCRUM-53: sending needs a key of its own, `requests.decide` being the Submitted request decision |
| 1.19 | 15-10-2026 | "Place or release a venue hold" row, assigned coordinator only, on `bookings.edit` (no new feature key; the assigned-only rule is enforced in the service and answers 404 to anyone else, the write rule); "View venues and venue booking requests" adds venue holds, on `venues.view` | Week 7 customer change 4; SCRUM-84 (this story's slice of `target/permissions.md`, which puts holds in the same row as raising a booking request) |
| 1.20 | 14-10-2026 | "Check equipment availability for a period" row and new key `equipment.check`, Technical Support Staff only | SCRUM-50: Event Coordinators hold `equipment.view` since SCRUM-49 and may see the inventory, but running the check (AC9) is Technical Support Staff's, so `equipment.view` cannot carry it |
| 1.21 | 15-10-2026 | "Cancel an approved venue booking" row, assigned coordinator only, on `bookings.edit` (no new feature key; the assigned-only rule is enforced in the service and answers 404 to anyone else, the write rule); an event's booking requests are read on `venues.view`, the existing "View venues, venue booking requests and venue holds" row | Week 7 customer change 3; SCRUM-83 (this story's slice of `target/permissions.md`, which puts cancelling in the same row as raising a booking request) |
| 1.22 | 16-10-2026 | "View detailed equipment requirements" and "Add requirements, or change/remove Requested requirements while event Approved or Planning" rows; `equipment.requirements.view` (assigned Coordinator; Technical Support Staff, non-Draft events) and `equipment.requirements.edit` (assigned Coordinator only, Approved/Planning only); Rule \* now records that assigned-coordinator ownership is enforced on these rows and folds in the scoped-read and Safety Officer notes | SCRUM-48: structured equipment requirements, scoped reads rather than general Technical Support event access |
| 1.23 | 18-10-2026 | `equipment.requirements.review`, Technical Support Staff only; decisions require no Reserved reservation for the event/type, notes do not | SCRUM-81 AC2–4; existing scoped reads unchanged |
| 1.24 | 19-10-2026 | `equipment.reserve`, TSS only, with Approved/Planning reserve/release and scoped history | SCRUM-51 AC1–7 |
| 1.25 | 19-10-2026 | New role Event Coordinator Lead, with the key `assignments.manage`: assign a coordinator to a request in the unassigned queue; read-only view of the queue and of requests that have a coordinator. The Rule \* note now names SCRUM-86's assignment | Week 7 customer change 5; SCRUM-86 (this story's slice of `target/permissions.md` v1.7: the Lead column and its queue row; the Lead's other rows are SCRUM-44, SCRUM-87 and SCRUM-88) |

SCRUM-81: Technical Support may decide or correct a requirement only while the event is Approved or Planning and no reservation for the same event/type is Reserved. Released history does not block a decision. Arrangement notes remain editable in those event stages even with a Reserved reservation. These mutations grant no general event-request access.


## SCRUM-51 reservation access (v1.24, 19-10-2026)

`equipment.reserve` is Technical Support Staff only. Reserve/release require an
Approved or Planning event; reserving additionally requires an Approved
requirement and no Reserved reservation for its event/type. Read history uses
`equipment.requirements.view`: assigned Coordinator, or Technical Support for
non-Draft events. A different Coordinator's read is 403; missing objects are
404. No new role or event status is introduced. Multi-role access is a union.
