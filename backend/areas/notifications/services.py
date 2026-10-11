"""Notification rules — SCRUM-58 (View My Notifications).

Every rule the acceptance criteria state lives here, next to the query, and
refuses by raising ApiRefusal; the route never decides (ADR-002).

What creates a notification is each triggering story's own concern (SCRUM-62,
SCRUM-63, SCRUM-64 — none built yet); nothing here writes a new row for any
workflow. Rows exist only from the seed data for now (team decision,
11-10-2026): building a trigger-side creator ahead of the stories that would
call it risks a shape this story cannot know yet.
"""

from datetime import datetime, timezone

from db import db
from errors import ApiRefusal
from models import EventRequest, Notification

ORGANISER_ROLE = "Event Organiser"
COORDINATOR_ROLE = "Event Coordinator"


def _can_view_event(account, event_request):
    """Whether this account may open event_request's own page.

    Mirrors areas/requests/services.py's get_visible_request rule (Event
    Coordinator: all except Draft; Event Organiser: own only) rather than
    importing it: areas do not import each other's services (ADR-001's area
    split), and this is a read-only predicate, not a refusal, so duplicating
    the two lines is cheaper than coupling the areas. Keep both in sync if
    that rule changes; SCRUM-87 will narrow it to the assigned coordinator
    only, and this call site narrows with it.
    """
    if event_request is None:
        return False
    if account.has_role(COORDINATOR_ROLE) and event_request.status != "Draft":
        return True
    return account.has_role(ORGANISER_ROLE) and event_request.created_by_id == account.id


def list_for(account):
    """This account's own notifications, newest first (AC2, AC9)."""
    return (
        db.session.query(Notification)
        .filter_by(recipient_id=account.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .all()
    )


def unread_count(account):
    """How many of this account's own notifications are unread (AC3)."""
    return (
        db.session.query(Notification)
        .filter_by(recipient_id=account.id, read_at=None)
        .count()
    )


def _get_own_notification(account, notification_id):
    """One of this account's own notifications by id, else refuse 404 (AC8).

    A write that is not the account's own answers 404, the same "a write
    does not reveal existence" rule as an own Draft (permissions.md's
    403-vs-404 Rule): another account's notification is not confirmed to
    exist by what this account may change.
    """
    notification = db.session.get(Notification, notification_id)
    if notification is None or notification.recipient_id != account.id:
        raise ApiRefusal(404, "Notification not found.")
    return notification


def mark_read(account, notification_id):
    """Mark one of this account's own notifications read (AC4).

    Already read is a no-op: nothing changes, including when it was read.
    """
    notification = _get_own_notification(account, notification_id)
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        db.session.commit()
    return notification


def mark_all_read(account):
    """Mark every one of this account's own unread notifications read (AC5)."""
    now = datetime.now(timezone.utc)
    (
        db.session.query(Notification)
        .filter_by(recipient_id=account.id, read_at=None)
        .update({Notification.read_at: now})
    )
    db.session.commit()


def notification_to_dict(notification, account):
    """Public JSON for one notification (SCRUM-58 AC2, AC6).

    AC6: the event name and a link to it are included only when this
    account may view that event; otherwise nothing about the event is
    revealed beyond the message itself, so event_request_id and
    event_request_name are both null.
    """
    visible = _can_view_event(account, notification.event_request)
    return {
        "id": notification.id,
        "event_request_id": notification.event_request_id if visible else None,
        "event_request_name": notification.event_request.name if visible else None,
        "message": notification.message,
        "created_at": notification.created_at.isoformat(),
        "read": notification.read_at is not None,
    }
