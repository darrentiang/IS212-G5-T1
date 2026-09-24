# Role permissions

Kept current by every story that adds an action: the row is added or changed in the same pull request. An account may hold more than one role (customer clarification Q-06); it may do anything any of its roles allows (decision D-09).

| Action | Event Organiser | Event Coordinator | Venue Staff | Technical Support Staff | Attendee |
|---|---|---|---|---|---|
| Create, edit (while Draft), delete (while Draft), submit own event request | Own only | No | No | No | No |
| Resubmit own rejected request | Own only | No | No | No | No |
| View event requests | Own only | All except Draft | No | No | No |
| Edit an event during Planning | No | Assigned coordinator only | No | No | No |
| Approve or reject an event request; request clarification | No | Yes | No | No | No |
| Reassign an event | No | Assigned coordinator initiates; new coordinator accepts | No | No | No |
| Confirm, cancel, mark completed | No | Assigned coordinator | No | No | No |
| View venues and venue booking requests | No | Yes | Yes | No | No |
| Maintain venue records and layouts; block a venue | No | No | Yes | No | No |
| Raise or withdraw a venue booking request | No | Assigned coordinator | No | No | No |
| Approve or reject a venue booking | No | No | Yes | No | No |
| Record equipment requirements | No | Assigned coordinator | No | View | No |
| Maintain equipment inventory; reserve or release; withdraw from service | No | No | No | Yes | No |
| View confirmed events open for registration | No | Yes | No | No | Yes |
| Register or withdraw registration | No | No | No | No | Own only |
| Raise a change request on a confirmed event | Own only | No | No | No | No |
| Decide a change request | No | Assigned coordinator | No | No | No |
| View internal planning information (coordinator notes, booking requests, equipment requirements, decisions, reasons) | No | Yes | Venue-related only | Equipment-related only | Never |
| View own notifications | Yes | Yes | Yes | Yes | Yes |

Rule: an action not listed as permitted for any of the account's roles is refused, a message is shown, and no data changes.

Rule: when the refusal is object-level (the role is right but this particular record is not the account's to touch — "own only" above), a read (GET) answers 403: it may say a record exists that the account cannot open. A write (create, edit, submit, delete) instead answers 404: what another account is allowed to change never confirms that the record exists at all. Established by SCRUM-27 (reads) and SCRUM-28 (writes); kept by every story since. Not to be "corrected" into one status code for both.

## Feature keys

Keys used in `backend/permissions.py` and on API routes / `features` from `/api/me`. A pytest asserts this table matches `ROLE_FEATURES` in code (ADR-002). Object rules ("own only", "all except Draft") stay in services, not in this table.

| Key | Event Organiser | Event Coordinator | Venue Staff | Technical Support Staff | Attendee |
|---|---|---|---|---|---|
| requests.view | Yes | Yes | No | No | No |
| requests.edit | Yes | Yes | No | No | No |
| venues.view | No | Yes | Yes | No | No |
| venues.edit | No | No | Yes | No | No |
| equipment.view | No | No | No | Yes | No |
| registration.view | No | Yes | No | No | Yes |
| internal_notes.view | No | Yes | No | No | No |
| notifications.view | Yes | Yes | Yes | Yes | Yes |

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.0 | 10-09-2026 | Initial table | Pre-sprint preparation |
| 1.1 | 15-09-2026 | Multi-role accounts; assigned-coordinator restriction on edits and arrangements; resubmit, reassign, change request, notification rows | Q-06, D-09, D-13, D-14, Q-11, Q-12 |
| 1.2 | 21-09-2026 | Feature keys section mapping API keys to the action table | SCRUM-27 review: ADR-002 requires code ≡ document |
| 1.3 | 22-09-2026 | `venues.edit` feature key, Venue Staff only | SCRUM-31: adding a venue needs a key of its own; `venues.view` is held by Event Coordinators, who may see venues but not maintain them |
| 1.4 | 23-09-2026 | Named "delete (while Draft)" on the Event Organiser row | SCRUM-30: deleting a draft is a new action, not implied by "edit" |
| 1.5 | 23-09-2026 | Rule: 403 for an object-level refusal on a read, 404 on a write | SCRUM-30 review: the split already existed in code (SCRUM-27/28) but was undocumented and read as an accident |
