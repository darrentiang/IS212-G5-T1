"""Venue booking request rules — SCRUM-36 (Request Venue Booking), SCRUM-37
(Approve or Reject a Venue Booking Request), SCRUM-38 (Prevent Double-Booking
of a Venue), SCRUM-41 (Reserve Setup and Turnaround Time Around a Booking),
SCRUM-42 (Warn When a Requested Venue Appears Unsuitable), SCRUM-77
(Withdraw a Venue Booking Request) and SCRUM-78 (Suggest an Alternative When
Rejecting a Venue Booking), SCRUM-84 (Place a Tentative Venue Hold) and
SCRUM-83 (Manage Several Venues for One Event) and SCRUM-85 (Expire a
Tentative Venue Hold).

Every rule the acceptance criteria state lives here, next to the query, and
refuses by raising ApiRefusal; the route never decides (ADR-002).

AC8 of SCRUM-36 ("assigned coordinator") is not enforced: no story has built
coordinator assignment yet (docs/design/permissions.md, the bookings.edit
Rule). Any Event Coordinator may raise for any Approved or Planning event.

SCRUM-38 defines the conflict check state-model.md names on Approve: an
approval is refused while an Approved booking or a block of the same venue
overlaps the booking's occupied period. What holds a venue is decided in one
place, occupancy.py, shared with venue search; rejecting is never checked.
SCRUM-41 widens that occupied period by the venue's setup and turnaround time
on both sides of every comparison, and lists the Approved bookings of a venue
whose occupied periods clash (AC5) without changing any of them.

SCRUM-84 adds a venue hold: the event's assigned Event Coordinator holds a
venue for the event's occupied period until an expiry. A Held hold of another
event holds the venue in occupancy.py exactly as an Approved booking does, so
search, approval and the warnings see it with no check of their own; approving
the event's own booking request for the venue releases its hold.

SCRUM-83 lists an event's booking requests and lets its assigned Event
Coordinator cancel an Approved one. A Cancelled booking no longer holds the
venue with no check of its own: occupancy.py counts only Approved bookings.

SCRUM-85 expires a hold. There is no scheduler: check_hold_expiry runs at the
start of every API request (app.py) and saves what is due since the last one,
a Held hold Expired at its expiry and the 24-hour warning before it, each
notice once.
"""

from datetime import datetime, timedelta, timezone

import clock
import occupancy
from areas.requests.services import start_planning_if_approved
from db import db
from errors import ApiRefusal
from models import EventRequest, Venue, VenueBookingRequest, VenueHold
from notifications import create_notification

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
    # SCRUM-86 AC8: the first booking request raised for an Approved event
    # moves it to Planning, in the same commit (a hold does the same: SCRUM-84).
    start_planning_if_approved(event_request)
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


def _record_decision(booking, account, decision, reason, suggestion=None):
    booking.status = decision
    booking.decision = decision
    booking.decision_reason = reason
    booking.decided_at = datetime.now(timezone.utc)
    booking.decided_by_id = account.id
    for column, value in (suggestion or {}).items():
        setattr(booking, column, value)
    db.session.commit()
    return booking


def _text(data, key):
    """A field's trimmed text, or None when it is absent or blank."""
    raw = data.get(key)
    if raw is None:
        return None
    return str(raw).strip() or None


def _suggested_venue(data):
    """The venue suggested, or None when none was (SCRUM-78 AC2: an existing venue)."""
    raw = _text(data, "suggested_venue_id")
    if raw is None:
        return None
    try:
        venue_id = int(raw)
    except ValueError:
        venue_id = None
    venue = db.session.get(Venue, venue_id) if venue_id is not None else None
    if venue is None:
        raise ApiRefusal(400, "The suggested venue must be an existing venue.")
    return venue


def _suggested_period(data):
    """(date, start, end) as ISO text, or None when no part of a period was given.

    SCRUM-78 AC2: a period needs all three parts, real ones, with the start
    before the end. The values are stored in the one form the booking itself
    uses, so '9:00' and '09:00' compare equal.
    """
    given = [_text(data, key) for key in ("suggested_date", "suggested_start_time", "suggested_end_time")]
    if all(part is None for part in given):
        return None
    if any(part is None for part in given):
        raise ApiRefusal(400, "A suggested period needs a date, a start time and an end time.")
    try:
        day = datetime.strptime(given[0], "%Y-%m-%d").date()
    except ValueError:
        raise ApiRefusal(400, "The suggested date must be a valid date.")
    try:
        start = datetime.strptime(given[1], TIME_FORMAT)
        end = datetime.strptime(given[2], TIME_FORMAT)
    except ValueError:
        raise ApiRefusal(400, "The suggested start and end time must be valid times.")
    if start >= end:
        raise ApiRefusal(400, "The suggested start time must be before the end time.")
    return day.isoformat(), start.strftime(TIME_FORMAT), end.strftime(TIME_FORMAT)


def _suggestion_columns(booking, data):
    """What to store for the suggestion sent with a rejection, all checked before anything is written.

    SCRUM-78 AC1: a suggested venue, a suggested period, both or neither.
    AC2: it must change at least the venue or the period from what was
    requested, so a suggestion that repeats the request is refused.
    """
    venue = _suggested_venue(data)
    period = _suggested_period(data)
    if venue is None and period is None:
        return {}

    changes_venue = venue is not None and venue.id != booking.venue_id
    changes_period = period is not None and period != (
        booking.date,
        booking.start_time,
        booking.end_time,
    )
    if not (changes_venue or changes_period):
        raise ApiRefusal(
            400, "A suggestion must change the venue or the period from what was requested."
        )

    date_text, start_text, end_text = period or (None, None, None)
    return {
        "suggested_venue_id": venue.id if venue is not None else None,
        "suggested_date": date_text,
        "suggested_start_time": start_text,
        "suggested_end_time": end_text,
    }


def _booking_text(booking):
    """'TC38 Holder, 10 Dec 2026, 14:00–17:00': the event and the booking's own period."""
    day = datetime.strptime(booking.date, "%Y-%m-%d").strftime(DATE_TEXT_FORMAT)
    return f"{booking.event_request.name}, {day}, {booking.start_time}–{booking.end_time}"


def _block_text(block):
    """'blocked 10 Dec 2026, 13:00 to 10 Dec 2026, 15:00 (Projector replacement)'."""
    start = block.starts_at.strftime(MOMENT_TEXT_FORMAT)
    end = block.ends_at.strftime(MOMENT_TEXT_FORMAT)
    return f"blocked {start} to {end} ({block.reason})"


def _hold_text(hold):
    """'Hold Seminar, 05 Dec 2026, 10:00–12:00': the event and its published
    period, the same wording as a booking (SCRUM-84 AC3, AC4)."""
    event = hold.event_request
    day = datetime.strptime(event.date, "%Y-%m-%d").strftime(DATE_TEXT_FORMAT)
    return f"{event.name}, {day}, {event.start_time}–{event.end_time}"


def _refuse_if_held(venue, starts_at, ends_at, asking_event):
    """SCRUM-38 AC1-AC3, AC5: refuse 409 while anything holds the venue for an
    overlapping period, naming every holder: bookings first, then holds
    (SCRUM-84), then blocks, each earliest first. The caller passes an occupied
    period, so SCRUM-41's setup and turnaround time widen both sides together,
    and the asking event, whose own holds never hold the venue against it."""
    holders = occupancy.venue_holders(venue, starts_at, ends_at, asking_event)
    named = (
        [_booking_text(row) for row in holders.bookings]
        + [_hold_text(row) for row in holders.holds]
        + [_block_text(row) for row in holders.blocks]
    )
    if named:
        raise ApiRefusal(409, HELD_MESSAGE.format("; ".join(named)))


def approve_booking(venue_id, booking_id, account, data):
    """Requested -> Approved (state-model.md). Reason is optional (AC2, AC4, AC9, AC10).

    SCRUM-38: the conflict check runs after the awaiting-a-decision check and
    before anything is written, so a refused approval leaves the booking
    Requested with no decision (AC6).

    SCRUM-84 AC6: another event's Held hold refuses the approval as an
    Approved booking does, while the event's own hold never does; once
    approved, the event's Held hold on this venue is Released in the same
    commit as the decision.
    """
    booking = _get_decidable_booking(venue_id, booking_id)
    _refuse_if_held(
        booking.venue, *occupancy.occupied_period(booking), asking_event=booking.event_request
    )
    for hold in booking.event_request.venue_holds:
        if hold.venue_id == booking.venue_id and occupancy.is_holding(hold):
            _release(hold)
    return _record_decision(booking, account, "Approved", _optional_reason(data))


def reject_booking(venue_id, booking_id, account, data):
    """Requested -> Rejected (state-model.md). Reason is required (AC3, AC8, AC4, AC9, AC10).

    SCRUM-78: the rejection may carry a suggested venue, period or both. The
    reason stays required, a suggestion cannot stand in for it, and a bad
    suggestion refuses the whole rejection: the booking stays Requested.
    A suggestion creates no booking and holds nothing; it is only recorded.
    """
    booking = _get_decidable_booking(venue_id, booking_id)
    reason = _optional_reason(data)
    if not reason:
        raise ApiRefusal(400, "A reason is required to reject.")
    suggestion = _suggestion_columns(booking, data)
    return _record_decision(booking, account, "Rejected", reason, suggestion)


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


# --- SCRUM-83: an event's bookings, and cancelling an approved one -----------

APPROVED = occupancy.HOLDING_BOOKING_STATUS
CANCELLED = "Cancelled"

# AC3: only while the event is in one of these statuses.
CANCELLABLE_EVENT_STATUSES = ("Approved", "Planning")


def list_bookings_for_event(event_request_id):
    """Every booking request raised for one event, oldest first (AC1)."""
    event_request = _get_event_request(event_request_id)
    return sorted(event_request.booking_requests, key=lambda row: (row.raised_at, row.id))


def cancel_booking(venue_id, booking_id, account, data):
    """Approved -> Cancelled (state-model.md), by the event's assigned Event Coordinator (AC3, AC4).

    Anyone else is refused 404 first, a write not revealing the record
    (permissions.md), so they learn nothing about its status either; SCRUM-87
    owns the functional rows for this. AC4: refused, nothing changed, when the
    booking is not Approved (a request awaiting a decision is withdrawn
    instead, SCRUM-77), when the event is not Approved or Planning, and when
    the reason is missing, blank or whitespace only. AC3: the booking becomes
    Cancelled with the trimmed reason, who and when; its approval stays on
    record. AC5: only this one row changes, never another booking, a hold or
    the event's status, so a hold Released by this booking's approval stays
    Released (SCRUM-84 curation). Venue Staff are not notified (SCRUM-63).
    """
    booking = _get_booking(venue_id, booking_id)
    # The rule _get_assigned_event applies to holds, answered for the booking.
    if booking.event_request.assigned_coordinator_id != account.id:
        raise ApiRefusal(404, "Booking request not found.")
    if booking.status != APPROVED:
        raise ApiRefusal(409, "Only an approved booking can be cancelled.")
    if booking.event_request.status not in CANCELLABLE_EVENT_STATUSES:
        raise ApiRefusal(
            409, "A booking can be cancelled only while the event is Approved or Planning."
        )
    reason = _optional_reason(data)
    if not reason:
        raise ApiRefusal(400, "Reason is required.")

    booking.status = CANCELLED
    booking.cancel_reason = reason
    booking.cancelled_at = datetime.now(timezone.utc)
    booking.cancelled_by_id = account.id
    db.session.commit()
    return booking


def booking_to_dict(booking):
    """Public JSON for a booking request: the event it is for, its own fields,
    and its decision once made (SCRUM-37 AC4, AC5).

    SCRUM-41 AC1 adds the occupied period beside the published one. It is
    derived from the venue's recorded durations at every read and never stored
    beside the booking, so changing a duration cannot leave a stale snapshot;
    the published date and times above stay exactly as the event recorded them
    (AC1, AC5). The endpoints are the block wire format (§9 of the API
    contract), e.g. '2026-12-15T09:30'.
    """
    occupied_start, occupied_end = occupancy.occupied_period(booking)
    return {
        "id": booking.id,
        "venue_id": booking.venue_id,
        "event_request_id": booking.event_request_id,
        "event_request_name": booking.event_request.name,
        "status": booking.status,
        "date": booking.date,
        "start_time": booking.start_time,
        "end_time": booking.end_time,
        # isoformat, not strftime: %Y does not pad years below 1000 on every
        # platform (Linux yields '1-01-01T00:00' for the clamped edge), while
        # the wire format always wants four digits ('0001-01-01T00:00').
        "occupied_start": occupied_start.isoformat(timespec="minutes"),
        "occupied_end": occupied_end.isoformat(timespec="minutes"),
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
        # SCRUM-78: what Venue Staff suggested when they rejected; all null when nothing was.
        "suggested_venue_id": booking.suggested_venue_id,
        "suggested_venue": booking.suggested_venue.name if booking.suggested_venue else None,
        "suggested_date": booking.suggested_date,
        "suggested_start_time": booking.suggested_start_time,
        "suggested_end_time": booking.suggested_end_time,
        # SCRUM-83: the venue's name for the event's own list, and the
        # cancellation once made; all null until then.
        "venue_name": booking.venue.name,
        "cancel_reason": booking.cancel_reason,
        "cancelled_at": booking.cancelled_at.isoformat() if booking.cancelled_at else None,
        "cancelled_by": booking.cancelled_by.username if booking.cancelled_by else None,
        # SCRUM-82: derived at every read, never stored; only ever true on an Approved booking.
        "venue_unavailable": bool(occupancy.blocks_over(booking)),
    }


def current_clashes(venue_id):
    """The venue's Approved bookings whose occupied periods overlap another's (SCRUM-41 AC5).

    Only Approved bookings of this venue are compared with each other: never a
    block, a booking still awaiting a decision, or a booking of another venue.
    Each booking is compared with the others and never with itself, and every
    booking of a clashing pair is listed once, so a chain A-B-C names all
    three. Nothing is stored or changed — this is the clash picture as the
    venue's recorded durations define it right now, which is why reducing a
    duration clears a resolved pair (AC5) and saving durations that expose a
    clash never alters a booking. Ordered by occupied start, then id.
    """
    venue = _get_venue(venue_id)
    booked = sorted(
        (
            (booking, occupancy.occupied_period(booking))
            for booking in venue.booking_requests
            if booking.status == occupancy.HOLDING_BOOKING_STATUS
        ),
        key=lambda row: (row[1][0], row[0].id),
    )
    clashing = set()
    for index, (booking, period) in enumerate(booked):
        for other, other_period in booked[index + 1 :]:
            if occupancy.overlaps(*period, *other_period):
                clashing.add(booking.id)
                clashing.add(other.id)
    return [booking for booking, _ in booked if booking.id in clashing]


def clash_to_dict(booking):
    """Public JSON for one clashing booking (SCRUM-41 AC5): the event it is for,
    its published period and the occupied period that makes it clash.

    event_request_id comes along so the page can link the event's name to its
    request for an account with requests.view (ui-guidelines.md §7), the same
    rule the Occupied periods list follows.
    """
    occupied_start, occupied_end = occupancy.occupied_period(booking)
    return {
        "id": booking.id,
        "event_request_id": booking.event_request_id,
        "event_request_name": booking.event_request.name,
        # Same wire format as booking_to_dict: always four-digit years.
        "occupied_start": occupied_start.isoformat(timespec="minutes"),
        "occupied_end": occupied_end.isoformat(timespec="minutes"),
        "date": booking.date,
        "start_time": booking.start_time,
        "end_time": booking.end_time,
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
    block of the venue that overlaps the event's occupied period, each carrying
    what its line names. They are warnings only: raising stays allowed.

    SCRUM-84 AC4: one warning per other event's Held hold, between the
    bookings and the blocks; the event's own hold gives none (AC6).

    SCRUM-41: the holder lookup compares the event's occupied period — its own
    period widened by this venue's setup and turnaround time — while each line
    still shows the holder's own published period or the block's own period,
    the text the warnings have always carried (ui-guidelines.md §7).
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
        *occupancy.buffered_period(
            venue, event_request.date, event_request.start_time, event_request.end_time
        ),
        asking_event=event_request,
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
    for hold in holders.holds:
        warnings.append(
            {
                "type": "hold",
                "id": hold.id,
                "event_request_name": hold.event_request.name,
                "date": hold.event_request.date,
                "start_time": hold.event_request.start_time,
                "end_time": hold.event_request.end_time,
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


# --- SCRUM-84: venue holds ---------------------------------------------------

# AC1: only these event statuses may have a venue held.
HOLDABLE_STATUSES = ("Approved", "Planning")

HELD = occupancy.HOLDING_HOLD_STATUS
RELEASED = "Released"
EXPIRED = "Expired"

EXPIRY_FORMAT = "%Y-%m-%d %H:%M"


def _get_assigned_event(account, event_request_id):
    """The event if the account is its assigned Event Coordinator, else refuse 404.

    A write answers 404 when the record is not the account's (permissions.md),
    the same rule SCRUM-53 applies to sending for safety check. SCRUM-87 owns
    the functional rows for this; the rule is enforced here.
    """
    event_request = db.session.get(EventRequest, event_request_id)
    if event_request is None or event_request.assigned_coordinator_id != account.id:
        raise ApiRefusal(404, "Event request not found.")
    return event_request


def _expiry(data):
    """The expiry as a naive local date-time, from expiry_date and expiry_time (AC1)."""
    day = _text(data, "expiry_date")
    time = _text(data, "expiry_time")
    if day is None or time is None:
        raise ApiRefusal(400, "Enter an expiry date and time.")
    try:
        return datetime.strptime(f"{day} {time}", EXPIRY_FORMAT)
    except ValueError:
        raise ApiRefusal(400, "The expiry must be a valid date and time.")


def place_hold(account, event_request_id, data):
    """Place a hold on one venue for one event (AC1-AC3, AC8).

    Only the event's assigned Event Coordinator, only for an Approved or
    Planning event (AC1). AC2: the expiry is strictly after now and strictly
    before the event's published start, the start of the event itself and not
    of its occupied period (PO decision). AC3: refused while another event's
    Approved booking or Held hold, or a block, overlaps the period the hold
    would cover, naming each; touching is not overlapping. An event may hold a
    venue only once at a time (PO decision at curation, as SCRUM-36 AC9
    refuses a second request), and a venue the event already has an Approved
    booking for, or a retired venue, cannot be held (PO decisions, 15-10-2026).
    Every check runs before anything is written,
    so a refusal records nothing. AC8: an Approved event moves to Planning in
    the same commit as the hold.
    """
    event_request = _get_assigned_event(account, event_request_id)
    if event_request.status not in HOLDABLE_STATUSES:
        raise ApiRefusal(400, "A venue can be held only for an Approved or Planning event.")

    venue_id = data.get("venue_id")
    if venue_id is None:
        raise ApiRefusal(400, "Choose a venue.")
    venue = _get_venue(venue_id)
    if not venue.is_active:
        # PO decision, 15-10-2026: the same refusal as SCRUM-36 AC10.
        raise ApiRefusal(400, "This venue has been retired and cannot be booked.")

    expires_at = _expiry(data)
    if expires_at <= clock.now_local():
        raise ApiRefusal(400, "The expiry must be in the future.")
    if expires_at >= occupancy.moment(event_request.date, event_request.start_time):
        raise ApiRefusal(400, "The expiry must be before the event's start.")

    for hold in event_request.venue_holds:
        if hold.venue_id == venue.id and occupancy.is_holding(hold):
            raise ApiRefusal(400, "This event already holds this venue.")
    # PO decision, 15-10-2026: the event's own Approved booking is not a
    # conflict naming the event itself; a hold on a venue it has booked is
    # refused for what it is.
    for booking in event_request.booking_requests:
        if booking.venue_id == venue.id and booking.status == occupancy.HOLDING_BOOKING_STATUS:
            raise ApiRefusal(400, f"This event already has an approved booking for {venue.name}.")

    _refuse_if_held(
        venue,
        *occupancy.buffered_period(
            venue, event_request.date, event_request.start_time, event_request.end_time
        ),
        asking_event=event_request,
    )

    hold = VenueHold(
        venue=venue,
        event_request=event_request,
        status=HELD,
        expires_at=expires_at,
        placed_by=account,
        placed_at=datetime.now(timezone.utc),
    )
    db.session.add(hold)
    start_planning_if_approved(event_request)
    db.session.commit()
    return hold


def _release(hold):
    """Held -> Released, not committed: the caller commits it."""
    hold.status = RELEASED
    hold.released_at = datetime.now(timezone.utc)


def release_hold(account, event_request_id, hold_id):
    """Held -> Released, by the event's assigned Event Coordinator (AC7).

    A hold of another event is not found: the address names both, and they
    must agree. A hold that is no longer Held is refused with its status,
    nothing changed.
    """
    event_request = _get_assigned_event(account, event_request_id)
    hold = db.session.get(VenueHold, hold_id)
    if hold is None or hold.event_request_id != event_request.id:
        raise ApiRefusal(404, "Venue hold not found.")
    if not occupancy.is_holding(hold):
        raise ApiRefusal(409, f"This hold is already {hold.status}.")
    _release(hold)
    db.session.commit()
    return hold


# --- SCRUM-85: expiring a hold ------------------------------------------------

# AC2: the warning is due when this much time or less remains.
WARNING_WINDOW = timedelta(hours=24)

# AC2, AC3: the curated texts (ui-guidelines.md §7, Venue holds).
WARNING_MESSAGE = "The hold on {venue} for {event} expires {expiry}."
EXPIRED_MESSAGE = "The hold on {venue} for {event} expired {expiry} and the venue was released."


def _hold_message(template, hold):
    return template.format(
        venue=hold.venue.name,
        event=hold.event_request.name,
        expiry=hold.expires_at.strftime(MOMENT_TEXT_FORMAT),
    )


def _tell_coordinator(hold, template):
    """Notify the event's assigned Event Coordinator; with none, nobody is told."""
    coordinator = hold.event_request.assigned_coordinator
    if coordinator is not None:
        create_notification(coordinator, _hold_message(template, hold), hold.event_request)


def check_hold_expiry():
    """Save every expiry and warning due by now, in one commit (SCRUM-85 AC1-AC3).

    The time is read once, from clock.now_local(). Only a Held hold
    with something still to do is read, in one query: its expiry has been
    reached, or it is 24 hours away or less and its warning has not been sent.

    - Expiry reached (equal counts): Held -> Expired, recorded when, and the
      expiry notice is sent (AC1, AC3). A warning never sent is not sent now:
      the coordinator hears only that it expired (PO decision).
    - Otherwise: the warning is sent and recorded when, so it is never sent
      twice (AC2), including straight away for a hold placed with less than
      24 hours left.

    The event's status never changes, and a Released hold is never read. With
    no assigned coordinator the hold still expires and nobody is told.
    Returns the number of holds changed; nothing is committed when it is 0.
    """
    now = clock.now_local()
    due = (
        db.session.query(VenueHold)
        .filter(
            VenueHold.status == HELD,
            VenueHold.expires_at <= now + WARNING_WINDOW,
            db.or_(VenueHold.expires_at <= now, VenueHold.warning_sent_at.is_(None)),
        )
        .order_by(VenueHold.expires_at, VenueHold.id)
        .all()
    )
    for hold in due:
        if hold.expires_at <= now:
            hold.status = EXPIRED
            hold.expired_at = now
            _tell_coordinator(hold, EXPIRED_MESSAGE)
        else:
            hold.warning_sent_at = now
            _tell_coordinator(hold, WARNING_MESSAGE)
    if due:
        db.session.commit()
    return len(due)


def list_holds_for_event(event_request_id):
    """Every hold of one event, oldest first (AC1, AC6, AC7)."""
    event_request = _get_event_request(event_request_id)
    return sorted(event_request.venue_holds, key=lambda hold: (hold.placed_at, hold.id))


def list_holds_for_venue(venue_id):
    """Every hold of one venue, oldest first (AC5)."""
    venue = _get_venue(venue_id)
    return sorted(venue.holds, key=lambda hold: (hold.placed_at, hold.id))


def hold_to_dict(hold):
    """Public JSON for a hold: its venue and event, the event's published period,
    the occupied period it covers (derived at every read, never stored), its
    expiry (naive local, the block wire format) and its status."""
    occupied_start, occupied_end = occupancy.hold_period(hold)
    event = hold.event_request
    return {
        "id": hold.id,
        "venue_id": hold.venue_id,
        "venue_name": hold.venue.name,
        "event_request_id": hold.event_request_id,
        "event_request_name": event.name,
        "status": hold.status,
        "date": event.date,
        "start_time": event.start_time,
        "end_time": event.end_time,
        # Same wire format as booking_to_dict: always four-digit years.
        "occupied_start": occupied_start.isoformat(timespec="minutes"),
        "occupied_end": occupied_end.isoformat(timespec="minutes"),
        "expires_at": hold.expires_at.isoformat(timespec="minutes"),
        "placed_by": hold.placed_by.username,
        "placed_at": hold.placed_at.isoformat(),
        "released_at": hold.released_at.isoformat() if hold.released_at else None,
        # SCRUM-85: naive local, like expires_at.
        "expired_at": hold.expired_at.isoformat(timespec="minutes") if hold.expired_at else None,
    }
