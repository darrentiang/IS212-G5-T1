"""SCRUM-92: the assigned Event Coordinator sets an event's registration.
SCRUM-57: they and the Event Organiser who created the event see who registered.

Registration is on or off, with a capacity and a closing date and time. The
closing time is naive local wall-clock time, the same convention as the
event's own date and start_time (models.EventRequest), so it compares with the
event's start directly. A value left blank keeps the stored one; turning
registration on with none stored takes the event's expected attendance and its
start (AC2, AC3). Turning it off keeps both, for when it is turned on again.

Same lock as SCRUM-47's edit (the event row), so a registration made while
this save runs is counted before the capacity or turning off is checked.
"""

from datetime import datetime

from areas.requests.editing import _lock
from areas.requests.services import _parse_positive_int
from db import db
from errors import ApiRefusal
from models import Registration
from permissions import REGISTRATION_MANAGE, can

SETTABLE_STATUSES = ("Approved", "Planning", "Safety Check", "Confirmed")

NOT_SETTABLE = (
    "Registration can be set only while the event is Approved, Planning, Safety Check or Confirmed."
)
NEEDS_ON_OR_OFF = "Registration must be turned on or off."
BAD_CAPACITY = "Capacity must be a whole number of at least 1."
NEEDS_DATE_AND_TIME = "The closing time needs both a date and a time."
BAD_CLOSING = "The closing date and time must be a valid date and time."
CLOSES_AFTER_START = "Registration cannot close after the event starts."


def _start(event):
    return datetime.fromisoformat(f"{event.date}T{event.start_time}")


def _blank(value):
    return value is None or (isinstance(value, str) and value.strip() == "")


def _registered_count(event):
    """Registered rows only; a Withdrawn registration never counts (AC2, AC4)."""
    return (
        db.session.query(Registration)
        .filter_by(event_request_id=event.id, status="Registered")
        .count()
    )


def _people(count):
    """'1 person' or '<n> people', as the count messages say it."""
    return "1 person" if count == 1 else f"{count} people"


def _capacity(body):
    """The capacity sent, or None when it is left blank."""
    value = body.get("capacity")
    if _blank(value):
        return None
    capacity = _parse_positive_int(value)
    if capacity is None:
        raise ApiRefusal(400, BAD_CAPACITY)
    return capacity


def _closes_at(body):
    """The closing date and time sent, or None when both are left blank (AC3)."""
    day, time = body.get("closing_date"), body.get("closing_time")
    if _blank(day) and _blank(time):
        return None
    if _blank(day) or _blank(time):
        raise ApiRefusal(400, NEEDS_DATE_AND_TIME)
    try:
        return datetime.strptime(f"{str(day).strip()} {str(time).strip()}", "%Y-%m-%d %H:%M")
    except ValueError:
        raise ApiRefusal(400, BAD_CLOSING)


def _registered_rows(event):
    """Registered rows, oldest first, then by id (SCRUM-57 AC2); never a Withdrawn one."""
    return (
        db.session.query(Registration)
        .filter_by(event_request_id=event.id, status="Registered")
        .order_by(Registration.registered_at, Registration.id)
        .all()
    )


def settings_to_dict(event, account, may_edit=True):
    """The registration settings as the assigned coordinator sees them (SCRUM-92).

    SCRUM-57: the Event Organiser who created the event sees the same, with
    may_edit False. While registration is on, both see the Registered count,
    the places remaining and who registered (AC1, AC2); while it is off, none
    of these (AC3).
    """
    closes_at = event.registration_closes_at
    payload = {
        "enabled": bool(event.registration_enabled),
        "capacity": event.registration_capacity,
        "closes_at": closes_at.strftime("%Y-%m-%dT%H:%M") if closes_at else None,
        "can_edit": may_edit and event.status in SETTABLE_STATUSES and can(account, REGISTRATION_MANAGE),
    }
    if event.registration_enabled:
        rows = _registered_rows(event)
        payload["registered"] = len(rows)
        payload["places_remaining"] = max(event.registration_capacity - len(rows), 0)
        payload["attendees"] = [
            {"username": row.attendee.username, "registered_at": row.registered_at.isoformat() + "Z"}
            for row in rows
        ]
    return payload


def set_registration(account, request_id, body):
    """Validate everything, then save all three values at once (AC1 to AC5).

    Anyone but the assigned coordinator gets 404, a write never confirming a
    record that is not theirs (permissions.md). A refusal changes nothing.
    """
    try:
        event = _lock(account, request_id)
        if event.status not in SETTABLE_STATUSES:
            raise ApiRefusal(409, NOT_SETTABLE)
        if not isinstance(body, dict) or not isinstance(body.get("enabled"), bool):
            raise ApiRefusal(400, NEEDS_ON_OR_OFF)
        enabled = body["enabled"]
        capacity = _capacity(body)
        closes_at = _closes_at(body)
        if closes_at is not None and closes_at > _start(event):
            raise ApiRefusal(400, CLOSES_AFTER_START)

        turning_on = enabled and not event.registration_enabled
        capacity = capacity or event.registration_capacity
        closes_at = closes_at or event.registration_closes_at
        if turning_on and capacity is None:
            capacity = event.attendance
        if turning_on and closes_at is None:
            closes_at = _start(event)

        # Counted under the lock, never taken from the browser.
        registered = _registered_count(event)
        if capacity is not None and capacity < registered:
            raise ApiRefusal(409, f"Capacity cannot be less than the {_people(registered)} registered.")
        if not enabled and registered:
            verb = "is" if registered == 1 else "are"
            raise ApiRefusal(
                409, f"Registration cannot be turned off while {_people(registered)} {verb} registered."
            )

        event.registration_enabled = enabled
        event.registration_capacity = capacity
        event.registration_closes_at = closes_at
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    db.session.refresh(event)
    return event


def close_by_start(event):
    """SCRUM-47 hook (AC3): a closing time after the event's new start moves to it."""
    start = _start(event)
    if event.registration_closes_at is not None and event.registration_closes_at > start:
        event.registration_closes_at = start
