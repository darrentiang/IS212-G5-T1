"""Venue booking request rules — SCRUM-36 (Request Venue Booking) and
SCRUM-42 (Warn When a Requested Venue Appears Unsuitable).

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

TIME_FORMAT = "%H:%M"


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
        # AC3's venue requirements: the event's chosen layout and facilities
        # (SCRUM-42), read through the event (see VenueBookingRequest).
        "layout": booking.event_request.layout.name if booking.event_request.layout else None,
        "facilities": [row.name for row in booking.event_request.facilities],
        "raised_by": booking.raised_by.username,
        "raised_at": booking.raised_at.isoformat(),
    }


def check_venue(account, event_request_id, venue_id):
    """SCRUM-42: the warnings for one (event request, venue) pair; nothing is stored.

    The route's @require(BOOKINGS_EDIT) has already refused anyone who may not
    raise a booking request (403 before 404, ADR-002). A Draft is refused 403,
    the same read rule GET /api/requests/:id applies to an Event Coordinator:
    the check must not reveal a Draft's attendance or times.
    """
    event_request = _get_event_request(event_request_id)
    venue = _get_venue(venue_id)
    if event_request.status == "Draft":
        raise ApiRefusal(403, "You do not have permission to perform this action.")
    return venue_warnings(event_request, venue)


def _within_hours(moment, opening, closing):
    # Exactly at opening or closing is within hours (PO decision).
    return opening <= moment <= closing


def venue_warnings(event_request, venue):
    """One warning per mismatch between an event and a venue (SCRUM-42 AC2-AC4).

    Each carries the values AC3 shows. Attendance equal to the capacity fits.
    Operating hours are checked only when the venue records both opening and
    closing time; the start and the end are each checked on their own, so an
    event wholly outside the hours gets two warnings. A layout, facility or
    accessibility feature the event did not choose is not checked. An event
    crossing midnight is out of scope.
    """
    warnings = []

    if event_request.attendance > venue.max_capacity:
        warnings.append(
            {
                "type": "capacity",
                "attendance": event_request.attendance,
                "max_capacity": venue.max_capacity,
            }
        )

    if venue.opening_time is not None and venue.closing_time is not None:
        opening = venue.opening_time.strftime(TIME_FORMAT)
        closing = venue.closing_time.strftime(TIME_FORMAT)
        for field in ("start_time", "end_time"):
            value = getattr(event_request, field)
            moment = datetime.strptime(value, TIME_FORMAT).time()
            if not _within_hours(moment, venue.opening_time, venue.closing_time):
                warnings.append(
                    {"type": field, field: value, "opening_time": opening, "closing_time": closing}
                )

    if event_request.layout is not None and event_request.layout not in venue.layouts:
        warnings.append({"type": "layout", "name": event_request.layout.name})

    for row in event_request.facilities:
        if row not in venue.facilities:
            warnings.append({"type": "facility", "name": row.name})

    for row in event_request.accessibility_features:
        if row not in venue.accessibility_features:
            warnings.append({"type": "accessibility_feature", "name": row.name})

    return warnings
