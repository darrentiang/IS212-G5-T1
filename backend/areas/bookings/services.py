"""Venue booking request rules — SCRUM-36 (Request Venue Booking).

Every rule the acceptance criteria state lives here, next to the query, and
refuses by raising ApiRefusal; the route never decides (ADR-002). Approving,
rejecting and withdrawing are later stories, so nothing here changes a
booking request once it is Requested.

AC8's "assigned coordinator" is not enforced: no story has built coordinator
assignment yet (docs/design/permissions.md, the bookings.edit Rule). Any
Event Coordinator may raise for any Approved or Planning event.
"""

from datetime import datetime, timezone

from db import db
from errors import ApiRefusal
from models import EventRequest, Venue, VenueBookingRequest

# AC2: only these event statuses may receive a booking request.
RAISABLE_STATUSES = ("Approved", "Planning")

# A request in this status against the same (venue, event) pair blocks a new one (AC9).
AWAITING_DECISION = "Requested"


def _get_event_request(event_request_id):
    event_request = db.session.get(EventRequest, event_request_id)
    if event_request is None:
        raise ApiRefusal(404, "Event request not found.")
    return event_request


def _get_venue(venue_id):
    venue = db.session.get(Venue, venue_id)
    if venue is None:
        raise ApiRefusal(404, "Venue not found.")
    return venue


def raise_booking(account, event_request_id, data):
    """Raise a booking request for one venue against one event (AC1).

    AC2: the event must be Approved or in Planning. AC10: the venue must be
    active. AC9: no request already awaiting a decision for the same venue
    and event. Every check runs before anything is written, so a refusal
    records nothing.

    Who may call this is the route's own @require(BOOKINGS_EDIT): the
    feature key is held by Event Coordinator alone (permissions.py), so
    there is no broader role to narrow here, unlike requests.edit (shared
    with Event Organiser) needing _require_organiser downstream.
    """
    event_request = _get_event_request(event_request_id)
    if event_request.status not in RAISABLE_STATUSES:
        raise ApiRefusal(
            400, "A venue booking can be requested only for an Approved or Planning event."
        )

    venue_id = data.get("venue_id")
    if venue_id is None:
        raise ApiRefusal(400, "Choose a venue.")
    venue = _get_venue(venue_id)
    if not venue.is_active:
        raise ApiRefusal(400, "This venue has been retired and cannot be booked.")

    existing = (
        db.session.query(VenueBookingRequest)
        .filter_by(venue_id=venue.id, event_request_id=event_request.id, status=AWAITING_DECISION)
        .first()
    )
    if existing is not None:
        raise ApiRefusal(
            400, "A booking request for this venue and event is already awaiting a decision."
        )

    booking = VenueBookingRequest(
        venue=venue,
        event_request=event_request,
        status=AWAITING_DECISION,
        # AC3: carried from the event, not entered again.
        date=event_request.date,
        start_time=event_request.start_time,
        end_time=event_request.end_time,
        attendance=event_request.attendance,
        venue_requirements=event_request.venue_requirements,
        # AC11: who raised it and when.
        raised_by=account,
        raised_at=datetime.now(timezone.utc),
    )
    db.session.add(booking)
    db.session.commit()
    return booking


def list_bookings_for_venue(venue_id):
    """Every booking request against one venue, oldest first (AC4, AC5)."""
    venue = _get_venue(venue_id)
    return (
        db.session.query(VenueBookingRequest)
        .filter_by(venue_id=venue.id)
        .order_by(VenueBookingRequest.raised_at, VenueBookingRequest.id)
        .all()
    )


def booking_to_dict(booking):
    """Public JSON for a booking request: the event it is for and its own fields."""
    return {
        "id": booking.id,
        "venue_id": booking.venue_id,
        "event_request_id": booking.event_request_id,
        "event_request_name": booking.event_request.name,
        "status": booking.status,
        "date": booking.date,
        "start_time": booking.start_time,
        "end_time": booking.end_time,
        "attendance": booking.attendance,
        "venue_requirements": booking.venue_requirements,
        "raised_by": booking.raised_by.username,
        "raised_at": booking.raised_at.isoformat(),
    }
