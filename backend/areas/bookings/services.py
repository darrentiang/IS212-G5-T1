"""Venue booking request rules — SCRUM-36 (Request Venue Booking), SCRUM-37
(Approve or Reject a Venue Booking Request).

Every rule the acceptance criteria state lives here, next to the query, and
refuses by raising ApiRefusal; the route never decides (ADR-002). Withdrawing
is a later story, so nothing here supports it yet.

AC8 of SCRUM-36 ("assigned coordinator") is not enforced: no story has built
coordinator assignment yet (docs/design/permissions.md, the bookings.edit
Rule). Any Event Coordinator may raise for any Approved or Planning event.

state-model.md no longer qualifies Approve with "(conflict check passes)":
no story (this one included) has ever defined what a conflict is, so SCRUM-37
approves unconditionally while the request is Requested.
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


def _get_booking(venue_id, booking_id):
    """One booking request of the venue, or refuse 404 for an unknown venue or booking.

    A booking that belongs to another venue is not found either: the address
    names both, and they must agree (the same rule as a venue's block).
    """
    venue = _get_venue(venue_id)
    booking = db.session.get(VenueBookingRequest, booking_id)
    if booking is None or booking.venue_id != venue.id:
        raise ApiRefusal(404, "Booking request not found.")
    return booking


def _optional_reason(data):
    raw = (data or {}).get("reason")
    if raw is None:
        return None
    trimmed = str(raw).strip()
    return trimmed or None


def _already_decided_message(booking):
    return f"This booking request has already been decided ({booking.status})."


def _get_decidable_booking(venue_id, booking_id):
    """A Requested booking of the venue the Venue Staff may decide, else refuse (AC7).

    An already-decided or withdrawn booking is refused with its current
    status, nothing changed. The route's require(BOOKINGS_DECIDE) has already
    refused anyone who is not Venue Staff (AC6).
    """
    booking = _get_booking(venue_id, booking_id)
    if booking.status != AWAITING_DECISION:
        raise ApiRefusal(409, _already_decided_message(booking))
    return booking


def _record_decision(booking, account, decision, reason):
    booking.status = decision
    booking.decision = decision
    booking.decision_reason = reason
    booking.decided_at = datetime.now(timezone.utc)
    booking.decided_by_id = account.id
    db.session.commit()
    return booking


def approve_booking(venue_id, booking_id, account, data):
    """Requested -> Approved (state-model.md). Reason is optional (AC2, AC4, AC9, AC10)."""
    booking = _get_decidable_booking(venue_id, booking_id)
    return _record_decision(booking, account, "Approved", _optional_reason(data))


def reject_booking(venue_id, booking_id, account, data):
    """Requested -> Rejected (state-model.md). Reason is required (AC3, AC4, AC8, AC9, AC10)."""
    booking = _get_decidable_booking(venue_id, booking_id)
    reason = _optional_reason(data)
    if not reason:
        raise ApiRefusal(400, "A reason is required to reject.")
    return _record_decision(booking, account, "Rejected", reason)


def booking_to_dict(booking):
    """Public JSON for a booking request: the event it is for, its own fields,
    and its decision once made (SCRUM-37 AC4, AC5)."""
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
        "decision": booking.decision,
        "decision_reason": booking.decision_reason,
        "decided_at": booking.decided_at.isoformat() if booking.decided_at else None,
        "decided_by": booking.decided_by.username if booking.decided_by else None,
    }
