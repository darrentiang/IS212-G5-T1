"""Change requests as the rest of the backend meets them (SCRUM-59).

The Organiser raises one in areas/changes; an event ending closes it and an assignment tells
the coordinator it is waiting. Those two happen inside other areas' actions (a rejection, a
cancellation, a completion, an assignment), so they live here, at the top of backend/ like
notifications.py, and no area imports another area's services.

Nothing here commits: each joins the transaction of the action that causes it.
"""

from datetime import datetime, timezone

from models import ChangeRequest
from notifications import create_notification


def open_change_request(event_request):
    """The one change request still open on the event, or None (SCRUM-59 AC5)."""
    return next((row for row in event_request.change_requests if row.status == ChangeRequest.OPEN), None)


def close_open_change_request(event_request):
    """The event has become Rejected, Cancelled or Completed: close its open request without a
    decision (SCRUM-59 AC7). The Organiser sees it Closed."""
    open_one = open_change_request(event_request)
    if open_one is not None:
        open_one.status = ChangeRequest.CLOSED
        open_one.closed_at = datetime.now(timezone.utc)


def notify_waiting_change_request(event_request, coordinator):
    """A coordinator has just been assigned: tell them if a request has been waiting for them
    (SCRUM-59 AC6)."""
    waiting = open_change_request(event_request)
    if waiting is not None:
        create_notification(
            coordinator,
            f'A {waiting.kind.lower()} request is waiting on your event "{event_request.name}".',
            event_request,
        )
