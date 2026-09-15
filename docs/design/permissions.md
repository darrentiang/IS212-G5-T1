# Role permissions

Kept current by every story that adds an action: the row is added or changed in the same pull request. An account may hold more than one role (customer clarification Q-06); it may do anything any of its roles allows (decision D-09).

| Action | Event Organiser | Event Coordinator | Venue Staff | Technical Support Staff | Attendee |
|---|---|---|---|---|---|
| Create, edit (while Draft), submit own event request | Own only | No | No | No | No |
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

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.0 | 10-09-2026 | Initial table | Pre-sprint preparation |
| 1.1 | 15-09-2026 | Multi-role accounts; assigned-coordinator restriction on edits and arrangements; resubmit, reassign, change request, notification rows | Q-06, D-09, D-13, D-14, Q-11, Q-12 |
