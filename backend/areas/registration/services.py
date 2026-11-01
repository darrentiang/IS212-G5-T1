"""SCRUM-54: an Attendee registers for a confirmed event, and the list they register from.
SCRUM-55: an Attendee's own registrations, and withdrawing one.
SCRUM-56: each of those registrations shows where the event is, by its status.

A registration is Registered or Withdrawn and never goes back (state-model.md,
'Registration'); an Attendee who registers again gets a new row (SCRUM-54).
A Withdrawn registration never counts toward the capacity and never blocks.
"""

from datetime import datetime, timezone

import clock
from areas.registration.settings import _registered_count
from areas.requests.editing import lock_event
from db import db
from errors import ApiRefusal
from models import EventRequest, Registration, Venue, VenueBookingRequest

REGISTERED = "Registered"
WITHDRAWN = "Withdrawn"
CANCELLED = "Cancelled"
CONFIRMED = "Confirmed"
COMPLETED = "Completed"
# Statuses an event is listed in (Confirmed) or can reach from there; an Attendee
# could have seen it, so a refusal may say why. Any other event is not found.
SEEN_STATUSES = (CONFIRMED, CANCELLED, COMPLETED)
NOT_FOUND = "Event not found."

NOT_OPEN = "This event is not open for registration."
CLOSED = "Registration for this event has closed."
ALREADY = "You are already registered for this event."
FULL = "This event is full."


def _utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def venue_names(event):
    """The names of the event's Approved venue booking requests, comma-separated,
    in name order: what an Attendee is told about where the event is (SCRUM-54 AC4;
    SCRUM-56 reuses it)."""
    rows = (
        db.session.query(Venue.name)
        .join(VenueBookingRequest, VenueBookingRequest.venue_id == Venue.id)
        .filter(VenueBookingRequest.event_request_id == event.id, VenueBookingRequest.status == "Approved")
        .distinct()
        .order_by(Venue.name)
        .all()
    )
    return ", ".join(name for (name,) in rows)


def _holds_registration(account, event):
    return (
        db.session.query(Registration.id)
        .filter_by(event_request_id=event.id, attendee_id=account.id, status=REGISTERED)
        .first()
        is not None
    )


def _has_closed(event):
    """True from the closing time (at or after it, AC1)."""
    return clock.now_local() >= event.registration_closes_at


def _state(event, account):
    """What the account's row says: registered, closed, full or register, in that order."""
    if _holds_registration(account, event):
        return "registered"
    if _has_closed(event):
        return "closed"
    if _registered_count(event) >= event.registration_capacity:
        return "full"
    return "register"


def _public_event(event, account):
    """An event as an Attendee may see it: never internal planning information (AC5)."""
    return {
        "id": event.id,
        "name": event.name,
        "purpose": event.purpose,
        "status": event.status,
        "date": event.date,
        "start_time": event.start_time,
        "end_time": event.end_time,
        "venues": venue_names(event),
        "state": _state(event, account),
    }


def list_open(account):
    """Confirmed events with registration on (SCRUM-27), each with the account's state."""
    rows = (
        db.session.query(EventRequest)
        .filter(EventRequest.status == CONFIRMED, EventRequest.registration_enabled.is_(True))
        .order_by(EventRequest.date, EventRequest.start_time, EventRequest.id)
        .all()
    )
    return [_public_event(row, account) for row in rows]


def _register_refusal(account, event):
    """Why the account cannot register now, else None (AC1, AC2, AC3, AC6)."""
    if event.status != CONFIRMED or not event.registration_enabled:
        return NOT_OPEN  # registration off, or Cancelled or Completed since the page opened
    if _has_closed(event):
        return CLOSED
    if _holds_registration(account, event):
        return ALREADY
    if _registered_count(event) >= event.registration_capacity:
        return FULL
    return None


def register(account, event_id):
    """— -> Registered for the account, first come first served (AC1 to AC4, AC6).

    Every check is read under the event's write lock, the lock SCRUM-92 saves
    the settings under, so two Attendees after the last place are counted one
    after the other. A refusal changes nothing. The whole success path is here:
    SCRUM-64 sends the confirmation notification after the commit.
    """
    try:
        event = lock_event(event_id)
        # A write never confirms a record the account may not read (permissions.md).
        if event is None or event.status not in SEEN_STATUSES:
            raise ApiRefusal(404, NOT_FOUND)
        message = _register_refusal(account, event)
        if message is not None:
            raise ApiRefusal(409, message)
        db.session.add(Registration(event_request=event, attendee=account, status=REGISTERED,
                                    registered_at=_utc_now()))
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return _public_event(event, account)


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


def _venue(event):
    """(venues, venue_state) for a registration's event (SCRUM-56 AC2).

    Decided by the event's status, never only by whether an Approved booking
    exists: an event sent back to Planning may still hold one.
    """
    if event.status in (CONFIRMED, COMPLETED):
        return venue_names(event), "confirmed"
    if event.status == CANCELLED:
        return None, "none"
    return None, "not_confirmed"


def _to_dict(registration):
    event = registration.event_request
    venues, venue_state = _venue(event)
    return {
        "id": registration.id,
        "event_request_id": event.id,
        "event_name": event.name,
        "event_status": event.status,
        "date": event.date,
        "start_time": event.start_time,
        "end_time": event.end_time,
        "venues": venues,
        "venue_state": venue_state,
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
    registration.withdrawn_at = _utc_now()
    db.session.commit()
    return _to_dict(registration)
