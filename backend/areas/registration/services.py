"""SCRUM-55: an Attendee's own registrations, and withdrawing one.

A registration is Registered or Withdrawn and never goes back (state-model.md,
'Registration'); an Attendee who registers again gets a new row (SCRUM-54).
"""

from datetime import datetime, timezone

import clock
from db import db
from errors import ApiRefusal
from models import Registration

REGISTERED = "Registered"
WITHDRAWN = "Withdrawn"
CANCELLED = "Cancelled"


def _has_started(event):
    """True from the event's start time (at or after it, AC3)."""
    start = datetime.fromisoformat(f"{event.date}T{event.start_time}")
    return clock.now_local() >= start


def _refusal(registration):
    """Why this registration cannot be withdrawn now, else None (AC3)."""
    event = registration.event_request
    if registration.status != REGISTERED:
        return "This registration is already withdrawn."
    if event.status == CANCELLED:
        return "This event was cancelled, so its registration cannot be withdrawn."
    if _has_started(event):
        return "The event has started, so the registration can no longer be withdrawn."
    return None


def _to_dict(registration):
    event = registration.event_request
    return {
        "id": registration.id,
        "event_request_id": event.id,
        "event_name": event.name,
        "event_status": event.status,
        "date": event.date,
        "start_time": event.start_time,
        "end_time": event.end_time,
        "status": registration.status,
        "can_withdraw": _refusal(registration) is None,
    }


def list_mine(account):
    """The account's own registrations, oldest first; never anyone else's (AC5)."""
    rows = (
        db.session.query(Registration)
        .filter_by(attendee_id=account.id)
        .order_by(Registration.id)
        .all()
    )
    return [_to_dict(row) for row in rows]


def withdraw(account, registration_id):
    """Registered -> Withdrawn for the account's own registration (AC1, AC3, AC5).

    Anything that is not the account's own answers 404: a write never
    confirms that a record exists (permissions.md). A refusal changes nothing.
    """
    registration = db.session.get(Registration, registration_id)
    if registration is None or registration.attendee_id != account.id:
        raise ApiRefusal(404, "Registration not found.")
    message = _refusal(registration)
    if message is not None:
        raise ApiRefusal(409, message)
    registration.status = WITHDRAWN
    registration.withdrawn_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.session.commit()
    return _to_dict(registration)
