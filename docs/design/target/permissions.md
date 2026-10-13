> **Target design after the Week 7 customer changes. Not in force.**
> This is where `docs/design/permissions.md` will be once every Week 7 story is merged. Do not build from this file as a whole.
> Each story copies only its own slice into `docs/design/permissions.md` in its own pull request, and adds that file's version row then, numbered in merge order (the version row below is a placeholder).
> Which slice belongs to which story is in the "Take note" line of the story's Links and notes in the Backlog. Delete this file in the pull request that merges the last slice.

# Role permissions

Kept current by every story that adds an action: the row is added or changed in the same pull request. An account may hold more than one role (customer clarification Q-06); it may do anything any of its roles allows (decision D-09). An account holding Event Coordinator Lead and Event Coordinator acts as a coordinator only on events assigned to it (SCRUM-87).

Abbreviations in the column headings: **Org** Event Organiser · **Coord** Event Coordinator · **Lead** Event Coordinator Lead · **Venue** Venue Staff · **Tech** Technical Support Staff · **Safety** Safety Officer · **Att** Attendee. "Assigned" means the Event Coordinator assigned to that event.

| Action | Org | Coord | Lead | Venue | Tech | Safety | Att |
|---|---|---|---|---|---|---|---|
| Create, edit (while Draft), delete (while Draft), submit own event request | Own only | No | No | No | No | No | No |
| Resubmit own rejected request | Own only | No | No | No | No | No | No |
| View event requests | Own only | Assigned only | Unassigned queue (basic information); all active events, read-only | No | No | Events in Safety Check | No |
| Assign a coordinator to a request in the unassigned queue | No | No | Yes | No | No | No | No |
| Reassign an event to another coordinator | No | No | Yes | No | No | No | No |
| View all assignments and active events | No | No | Yes | No | No | No | No |
| Edit an event during Planning | No | Assigned only | No | No | No | No | No |
| Approve or reject an event request; request clarification | No | Assigned only | No | No | No | No | No |
| View event request resulting status and any reason | Own only | Assigned only | Yes | No | No | No | No |
| Send for safety check, cancel, mark completed | No | Assigned only | No | No | No | No | No |
| Approve, reject or request changes on a safety check | No | No | No | No | No | Yes | No |
| View venues, venue booking requests and venue holds | No | Yes | Yes | Yes | No | Events in Safety Check | No |
| Maintain venue records and layouts; block a venue | No | No | No | Yes | No | No | No |
| Raise or withdraw a venue booking request; cancel an approved booking; place or release a venue hold | No | Assigned only | No | No | No | No | No |
| Approve or reject a venue booking | No | No | No | Yes | No | No | No |
| View equipment inventory | No | Yes | No | No | Yes | No | No |
| Record equipment requirements | No | Assigned only | No | No | View | View, events in Safety Check | No |
| Maintain equipment inventory; reserve or release; withdraw from service | No | No | No | No | Yes | No | No |
| View confirmed events open for registration | No | Yes | No | No | No | No | Yes |
| Register or withdraw registration | No | No | No | No | No | No | Own only |
| Raise a change request on a confirmed event | Own only | No | No | No | No | No | No |
| Decide a change request | No | Assigned only | No | No | No | No | No |
| View internal planning information (coordinator notes, booking requests, equipment requirements, decisions, reasons) | No | Assigned only | Yes, read-only | Venue-related only | Equipment-related only | Events in Safety Check | Never |
| View own notifications | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

Rule: an action not listed as permitted for any of the account's roles is refused, a message is shown, and no data changes.

Rule: when the refusal is object-level (the role is right but this particular record is not the account's to touch — "own only", "assigned only" and "events in Safety Check" above), a read (GET) answers 403: it may say a record exists that the account cannot open. A write (create, edit, submit, delete) instead answers 404: what another account is allowed to change never confirms that the record exists at all. Established by SCRUM-27 (reads) and SCRUM-28 (writes); kept by every story since. Not to be "corrected" into one status code for both.

## Feature keys

Keys used in `backend/permissions.py` and on API routes / `features` from `/api/me`. A pytest asserts this table matches `ROLE_FEATURES` in code (ADR-002). Object rules ("own only", "assigned only", "events in Safety Check") stay in services, not in this table.

| Key | Org | Coord | Lead | Venue | Tech | Safety | Att |
|---|---|---|---|---|---|---|---|
| requests.view | Yes | Yes | Yes | No | No | Yes | No |
| requests.edit | Yes | Yes | No | No | No | No | No |
| requests.decide | No | Yes | No | No | No | No | No |
| assignments.manage | No | No | Yes | No | No | No | No |
| assignments.view | No | No | Yes | No | No | No | No |
| safety.decide | No | No | No | No | No | Yes | No |
| venues.view | No | Yes | Yes | Yes | No | Yes | No |
| venues.edit | No | No | No | Yes | No | No | No |
| equipment.view | No | Yes | No | No | Yes | No | No |
| equipment.edit | No | No | No | No | Yes | No | No |
| registration.view | No | Yes | No | No | No | No | Yes |
| internal_notes.view | No | Yes | Yes | No | No | No | No |
| notifications.view | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.0 | 10-09-2026 | Initial table | Pre-sprint preparation |
| 1.1 | 15-09-2026 | Multi-role accounts; assigned-coordinator restriction on edits and arrangements; resubmit, reassign, change request, notification rows | Q-06, D-09, D-13, D-14, Q-11, Q-12 |
| 1.2 | 21-09-2026 | Feature keys section mapping API keys to the action table | SCRUM-27 review: ADR-002 requires code ≡ document |
| 1.3 | 22-09-2026 | `venues.edit` feature key, Venue Staff only | SCRUM-31: adding a venue needs a key of its own; `venues.view` is held by Event Coordinators, who may see venues but not maintain them |
| 1.4 | 23-09-2026 | Named "delete (while Draft)" on the Event Organiser row | SCRUM-30: deleting a draft is a new action, not implied by "edit" |
| 1.5 | 23-09-2026 | Rule: 403 for an object-level refusal on a read, 404 on a write | SCRUM-30 review: the split already existed in code (SCRUM-27/28) but was undocumented and read as an accident |
| 1.6 | 24-09-2026 | `requests.decide` for Event Coordinators; Organiser may see the request-level approve/reject reason | SCRUM-29: Organisers already hold `requests.edit`, so decide needs its own key; AC6 makes that decision public on the request |
| 1.7 | 02-10-2026 | New roles Event Coordinator Lead and Safety Officer; Event Coordinator restricted to assigned events (was all except Draft; decide was any coordinator); assignment and reassignment move to the Lead (coordinator-initiated reassignment removed); "Confirm" replaced by "Send for safety check"; new rows for safety decisions, booking cancellation and venue holds; keys `assignments.manage`, `assignments.view`, `safety.decide`; Lead and Safety Officer added to existing keys | Week 7 customer changes 3–6; SCRUM-44, SCRUM-53, SCRUM-83, SCRUM-84, SCRUM-86 to SCRUM-90 |
