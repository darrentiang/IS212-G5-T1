"""Venue booking request rules — SCRUM-36 (Request Venue Booking), SCRUM-37
(Approve or Reject a Venue Booking Request), SCRUM-38 (Prevent Double-Booking
of a Venue), SCRUM-42 (Warn When a Requested Venue Appears Unsuitable) and
SCRUM-77 (Withdraw a Venue Booking Request).

Every rule the acceptance criteria state lives here, next to the query, and
refuses by raising ApiRefusal; the route never decides (ADR-002).

AC8 of SCRUM-36 ("assigned coordinator") is not enforced: no story has built
coordinator assignment yet (docs/design/permissions.md, the bookings.edit
Rule). Any Event Coordinator may raise for any Approved or Planning event.

SCRUM-38 defines the conflict check state-model.md names on Approve: an
approval is refused while an Approved booking or a block of the same venue
overlaps the booking's period. What holds a venue is decided in one place,
occupancy.py, shared with venue search; rejecting is never checked.
"""

from datetime import datetime, timezone

import occupancy
from db import db
from errors import ApiRefusal
from models import EventRequest, Venue, VenueBookingRequest

# AC2: only these event statuses may receive a booking request.
RAISABLE_STATUSES = ("Approved", "Planning")

# The status of a request still awaiting a decision; only it may be decided.
AWAITING_DECISION = "Requested"

# AC9 (refined by the PO, 09-10-2026): a request in either status against the
# same (venue, event) pair blocks a new one. Rejected and Withdrawn do not.
BLOCKING_STATUSES = (AWAITING_DECISION, "Approved")

# AC9: the refusal for each blocking status, so the message names why.
DUPLICATE_MESSAGES = {
    AWAITING_DECISION: "A booking request for this venue and event is already awaiting a decision.",
    "Approved": "This event already holds an approved booking for this venue.",
}

TIME_FORMAT = "%H:%M"

# SCRUM-38 AC2: the refusal names whatever holds the venue, in the text
# formats the pages use (ui-guidelines.md §9).
HELD_MESSAGE = "This venue is already committed for an overlapping period: {}."
DATE_TEXT_FORMAT = "%d %b %Y"
MOMENT_TEXT_FORMAT = f"{DATE_TEXT_FORMAT}, {TIME_FORMAT}"
# A block's start and end on the wire, as venues/services.py sends them.
BLOCK_MOMENT_FORMAT = f"%Y-%m-%dT{TIME_FORMAT}"


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
    active. AC9: the event holds no Approved booking, and has no request
    awaiting a decision, for the same venue; an earlier Rejected or Withdrawn
    request does not block. Every check runs before anything is written, so
    a refusal records nothing.

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
        .filter(
            VenueBookingRequest.venue_id == venue.id,
            VenueBookingRequest.event_request_id == event_request.id,
            VenueBookingRequest.status.in_(BLOCKING_STATUSES),
        )
        .first()
    )
    if existing is not None:
        raise ApiRefusal(400, DUPLICATE_MESSAGES[existing.status])

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


def _booking_text(booking):
    """'TC38 Holder, 10 Dec 2026, 14:00–17:00': the event and the booking's own period."""
    day = datetime.strptime(booking.date, "%Y-%m-%d").strftime(DATE_TEXT_FORMAT)
    return f"{booking.event_request.name}, {day}, {booking.start_time}–{booking.end_time}"


def _block_text(block):
    """'blocked 10 Dec 2026, 13:00 to 10 Dec 2026, 15:00 (Projector replacement)'."""
    start = block.starts_at.strftime(MOMENT_TEXT_FORMAT)
    end = block.ends_at.strftime(MOMENT_TEXT_FORMAT)
    return f"blocked {start} to {end} ({block.reason})"


def _refuse_if_venue_held(booking):
    """SCRUM-38 AC1-AC3, AC5: refuse 409 while anything holds the venue for an
    overlapping period, naming every holder: bookings first, then blocks, each
    earliest first. The booking's occupied period is compared, so SCRUM-41's
    setup and turnaround time widen both sides together."""
    holders = occupancy.venue_holders(booking.venue, *occupancy.occupied_period(booking))
    named = [_booking_text(row) for row in holders.bookings] + [
        _block_text(row) for row in holders.blocks
    ]
    if named:
        raise ApiRefusal(409, HELD_MESSAGE.format("; ".join(named)))


def approve_booking(venue_id, booking_id, account, data):
    """Requested -> Approved (state-model.md). Reason is optional (AC2, AC4, AC9, AC10).

    SCRUM-38: the conflict check runs after the awaiting-a-decision check and
    before anything is written, so a refused approval leaves the booking
    Requested with no decision (AC6).
    """
    booking = _get_decidable_booking(venue_id, booking_id)
    _refuse_if_venue_held(booking)
    return _record_decision(booking, account, "Approved", _optional_reason(data))


def reject_booking(venue_id, booking_id, account, data):
    """Requested -> Rejected (state-model.md). Reason is required (AC3, AC4, AC8, AC9, AC10)."""
    booking = _get_decidable_booking(venue_id, booking_id)
    reason = _optional_reason(data)
    if not reason:
        raise ApiRefusal(400, "A reason is required to reject.")
    return _record_decision(booking, account, "Rejected", reason)


def withdraw_booking(venue_id, booking_id, account):
    """Requested -> Withdrawn (state-model.md): the raising Coordinator pulls
    back a request before Venue Staff decide it.

    AC4: refused for anyone other than the Coordinator who raised it,
    answered as 404 — the same "a write does not reveal existence" rule as
    an own Draft (permissions.md's 403-vs-404 Rule), checked before AC3's
    status check so a non-raiser learns nothing about the booking's status
    either. AC3: only a Requested booking can be withdrawn; already decided
    is refused with its current status, nothing changed. AC2 (no longer
    approvable/rejectable once Withdrawn) and AC5 (other bookings on the
    event untouched) need no extra code: _get_decidable_booking already
    refuses anything not Requested, and this only ever touches the one row.
    """
    booking = _get_booking(venue_id, booking_id)
    if booking.raised_by_id != account.id:
        raise ApiRefusal(404, "Booking request not found.")
    if booking.status != AWAITING_DECISION:
        raise ApiRefusal(409, _already_decided_message(booking))

    booking.status = "Withdrawn"
    db.session.commit()
    return booking


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
        # AC3's venue requirements: the event's chosen layout and facilities
        # (SCRUM-42), read through the event (see VenueBookingRequest).
        "layout": booking.event_request.layout.name if booking.event_request.layout else None,
        "facilities": [row.name for row in booking.event_request.facilities],
        "raised_by": booking.raised_by.username,
        "raised_at": booking.raised_at.isoformat(),
        "decision": booking.decision,
        "decision_reason": booking.decision_reason,
        "decided_at": booking.decided_at.isoformat() if booking.decided_at else None,
        "decided_by": booking.decided_by.username if booking.decided_by else None,
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

    SCRUM-38 AC7: after those, one warning per Approved booking and then per
    block of the venue that overlaps the event's own period, each carrying
    what its line names. They are warnings only: raising stays allowed.
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

    holders = occupancy.venue_holders(
        venue,
        occupancy.moment(event_request.date, event_request.start_time),
        occupancy.moment(event_request.date, event_request.end_time),
    )
    for booking in holders.bookings:
        warnings.append(
            {
                "type": "approved_booking",
                "id": booking.id,
                "event_request_name": booking.event_request.name,
                "date": booking.date,
                "start_time": booking.start_time,
                "end_time": booking.end_time,
            }
        )
    for block in holders.blocks:
        warnings.append(
            {
                "type": "block",
                "id": block.id,
                "start": block.starts_at.strftime(BLOCK_MOMENT_FORMAT),
                "end": block.ends_at.strftime(BLOCK_MOMENT_FORMAT),
                "reason": block.reason,
            }
        )

    return warnings
