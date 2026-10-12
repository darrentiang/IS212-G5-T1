"""Sending a notification — the one function every story calls (SCRUM-58).

SCRUM-58 builds the inbox (areas/notifications): view, unread count, mark read.
This module is the other half, the way a row gets into that inbox, so the
stories that notify someone (SCRUM-44, 62, 63, 82, 85, 86, 89, 90) all call
create_notification() and a notification always has the same shape.

It lives at the top of backend/, like occupancy.py, so any area can use it
without importing another area's services.

It does not commit. The notification joins the transaction of the action that
causes it, so the two are saved together or not at all: a refused action creates
nothing, and one decision creates exactly one notification (SCRUM-62 AC6 and
AC7, SCRUM-63 AC6). The caller commits, once, after the action itself.
"""

from datetime import datetime, timezone

from db import db
from models import Notification


def create_notification(recipient, message, event_request=None):
    """Add one unread notification for ``recipient`` and return it.

    ``recipient`` is the Account to tell and ``message`` is what it reads.
    ``event_request`` is the event it is about, or None for a notification that
    is not about one event; the page names and links the event only when the
    recipient may open it (SCRUM-58 AC6), so passing it never reveals anything.

    The row is added to the session but not committed. A message that is blank
    or whitespace-only, or a missing recipient, is a mistake in the calling code
    rather than something a user did, so it raises ValueError and adds nothing.
    """
    if recipient is None:
        raise ValueError("A notification needs a recipient.")
    if message is None or str(message).strip() == "":
        raise ValueError("A notification needs a message.")

    notification = Notification(
        recipient=recipient,
        event_request=event_request,
        message=str(message).strip(),
        created_at=datetime.now(timezone.utc),
    )
    db.session.add(notification)
    return notification
