"""Venue rules — SCRUM-31 (Add a Venue), SCRUM-32 (Record supported layouts),
SCRUM-40 (Block a Venue), SCRUM-75 (Update a Venue),
SCRUM-79 (End or Remove a Venue Block), SCRUM-33 (Search Venues by Date and
Capacity), SCRUM-34 (Filter Venue Results by Accessibility Requirements),
SCRUM-35 (Filter Venues by Layout and Facilities),
SCRUM-80 (Record Setup and Turnaround Time),
SCRUM-82 (Replace a Venue That Became Unavailable),
SCRUM-91 (Refuse Operating Hours That Close Before They Open).

Every rule the acceptance criteria state lives here, next to the query, and
refuses by raising ApiRefusal; the route never decides (ADR-002). Retiring a
venue is SCRUM-76 and room layouts SCRUM-32, so nothing here removes a venue.
A block's own timing rules read the time only through clock.now_local().
"""

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import clock
import occupancy
from db import db
from errors import ApiRefusal
from notifications import create_notification
from models import (
    AccessibilityFeature,
    EventRequest,
    Facility,
    RoomLayout,
    Venue,
    VenueBlock,
)

DATE_FORMAT = "%Y-%m-%d"
TIME_FORMAT = "%H:%M"
# A block's start and end on the wire: '2026-10-20T09:00', naive local time.
DATE_TIME_FORMAT = f"{DATE_FORMAT}T{TIME_FORMAT}"

# SCRUM-33 AC1: only an event in one of these statuses may be searched for.
SEARCHABLE_STATUSES = ("Approved", "Planning")

# A block's phase on the wire (SCRUM-79): derived from the time, never stored.
PHASE_UPCOMING = "upcoming"
PHASE_IN_PROGRESS = "in_progress"
PHASE_ENDED = "ended"

# SCRUM-82 AC3: a block over an Approved booking affects the event only in one
# of these statuses; a Completed or Cancelled event is left alone (curation).
AFFECTED_EVENT_STATUSES = ("Approved", "Planning", "Safety Check", "Confirmed")
# ...and an event in one of these returns to Planning; Approved and Planning keep theirs.
RETURNS_TO_PLANNING = ("Safety Check", "Confirmed")
PLANNING = "Planning"
# A block's period in a notification, as the pages show it: '05 Dec 2026, 11:00'.
MOMENT_TEXT_FORMAT = "%d %b %Y, %H:%M"


def list_venues():
    """Every venue, for the Venues page."""
    return db.session.query(Venue).order_by(Venue.id).all()


def get_venue(venue_id):
    """One venue, or refuse 404."""
    venue = db.session.get(Venue, venue_id)
    if venue is None:
        raise ApiRefusal(404, "Venue not found.")
    return venue


def venue_options():
    """The fixed lists the venue forms offer."""
    return {
        "facilities": [row.name for row in db.session.query(Facility).order_by(Facility.id)],
        "accessibility_features": [
            row.name
            for row in db.session.query(AccessibilityFeature).order_by(AccessibilityFeature.id)
        ],
        "layouts": [row.name for row in db.session.query(RoomLayout).order_by(RoomLayout.id)],
    }


def create_venue(body):
    """Record a venue from the add-venue form, or refuse 400.

    Name, location and maximum capacity are required; the maximum capacity is a
    positive whole number; facilities and accessibility features come from the
    seeded lists. The operating hours are optional, but are both given or both
    blank, and close after they open (SCRUM-91).
    """
    name = _required_text(body, "name", "Name")
    location = _required_text(body, "location", "Location")
    max_capacity = _positive_whole_number(body.get("max_capacity"))
    opening_time, closing_time = _operating_hours(body)
    facilities = _chosen(body.get("facilities"), Facility, "facility")
    accessibility_features = _chosen(
        body.get("accessibility_features"), AccessibilityFeature, "accessibility feature"
    )

    venue = Venue(
        name=name,
        location=location,
        max_capacity=max_capacity,
        opening_time=opening_time,
        closing_time=closing_time,
        facilities=facilities,
        accessibility_features=accessibility_features,
    )
    db.session.add(venue)
    db.session.commit()
    return venue


def update_venue(venue_id, body):
    """Update a venue's recorded details (SCRUM-75).

    Venue Staff can change any of a venue's recorded fields (AC1).
    Name, location and maximum capacity are required; operating hours,
    facilities and accessibility features are optional and may be cleared (AC2).
    Name and location cannot be blank or contain only whitespace; maximum
    capacity must be a positive whole number; times must be valid 24-hour times;
    facilities and accessibility features must use recognised options (AC3).
    The hours follow the same SCRUM-91 rule as adding a venue, so a venue
    already stored with bad hours cannot be updated until they are corrected
    or both cleared. If any check fails, it is refused and nothing changes (AC4).
    """
    venue = get_venue(venue_id)

    name = _required_text(body, "name", "Name")
    location = _required_text(body, "location", "Location")
    max_capacity = _positive_whole_number(body.get("max_capacity"))
    opening_time, closing_time = _operating_hours(body)
    facilities = _chosen(body.get("facilities"), Facility, "facility")
    accessibility_features = _chosen(
        body.get("accessibility_features"), AccessibilityFeature, "accessibility feature"
    )

    venue.name = name
    venue.location = location
    venue.max_capacity = max_capacity
    venue.opening_time = opening_time
    venue.closing_time = closing_time
    venue.facilities = facilities
    venue.accessibility_features = accessibility_features

    db.session.commit()
    return venue


def update_layouts(venue_id, body):
    """Replace a venue's supported layout set, including with an empty set."""
    venue = get_venue(venue_id)
    values = body.get("layouts")
    if not isinstance(values, list):
        raise ApiRefusal(400, "Choose layouts as a list.")
    if not all(isinstance(value, str) for value in values):
        raise ApiRefusal(400, "Choose each layout from the list.")
    if len(values) != len(set(values)):
        raise ApiRefusal(400, "A layout cannot be selected more than once.")
    layouts = _chosen(values, RoomLayout, "layout")
    venue.layouts = layouts
    db.session.commit()
    return venue


def update_times(venue_id, body):
    """Record or change a venue's setup and turnaround times (SCRUM-80).

    The request body must be a JSON object containing both ``setup_time`` and
    ``turnaround_time`` keys. An explicitly blank or null value normalises to
    0. Missing keys or a malformed body are refused and neither stored value
    changes.

    Each value must be a non-negative whole number. Values such as 30.0 that
    represent an exact whole number are accepted; fractions, booleans and
    non-numeric strings are refused without rounding or truncation.

    Both values are validated before any database write, so a refusal leaves
    both stored times unchanged.
    """
    venue = get_venue(venue_id)

    if not isinstance(body, dict):
        raise ApiRefusal(
            400, "Request body must be a JSON object with setup_time and turnaround_time."
        )
    if "setup_time" not in body or "turnaround_time" not in body:
        raise ApiRefusal(
            400, "Request body must contain both setup_time and turnaround_time."
        )

    setup_time = _non_negative_whole_number(body.get("setup_time"), "Setup time")
    turnaround_time = _non_negative_whole_number(
        body.get("turnaround_time"), "Turnaround time"
    )

    venue.setup_time = setup_time
    venue.turnaround_time = turnaround_time
    db.session.commit()
    return venue


def _non_negative_whole_number(value, label):
    """Parse a non-negative whole number, or raise ApiRefusal naming the field.

    None or blank → 0. Exact whole numbers such as 30.0 are accepted.
    Fractions, booleans and non-numeric strings are refused.

    The text is read as a Decimal, never a float: float('0.99999999999999999')
    rounds to 1.0, which a float-based check would accept as a whole number
    (AC2: a fraction must be refused whatever its digits).
    """
    if value is None or str(value).strip() == "":
        return 0
    if isinstance(value, bool):
        raise ApiRefusal(400, f"{label} must be a non-negative whole number.")
    text = str(value).strip()
    try:
        number = Decimal(text)
    except InvalidOperation:
        raise ApiRefusal(400, f"{label} must be a non-negative whole number.") from None
    if not number.is_finite() or number != number.to_integral_value():
        raise ApiRefusal(400, f"{label} must be a non-negative whole number.")
    if number < 0:
        raise ApiRefusal(400, f"{label} must be a non-negative whole number.")
    return int(number)


def _required_text(body, field, label):
    value = body.get(field)
    text = str(value).strip() if value is not None else ""
    if not text:
        raise ApiRefusal(400, f"{label} is required.")
    return text


def _positive_whole_number(value):
    """The maximum capacity rule: a positive whole number, nothing else."""
    if value is None or str(value).strip() == "":
        raise ApiRefusal(400, "Maximum capacity is required.")
    # int() rejects anything that is not a whole number, '50.5' included,
    # whether it arrives as a JSON number or as a string from the form.
    try:
        number = int(str(value).strip())
    except ValueError:
        raise ApiRefusal(400, "Maximum capacity must be a positive whole number.") from None
    if number < 1:
        raise ApiRefusal(400, "Maximum capacity must be a positive whole number.")
    return number


def _operating_hours(body):
    """The opening and closing time, both or neither, closing after opening (SCRUM-91).

    Venues and events do not cross midnight (SCRUM-42 decision), so a closing
    time at or before the opening time is refused rather than read as overnight.
    """
    opening_time = _optional_time(body.get("opening_time"), "Opening time")
    closing_time = _optional_time(body.get("closing_time"), "Closing time")
    if (opening_time is None) != (closing_time is None):
        raise ApiRefusal(400, "Enter both opening and closing time, or leave both blank.")
    if opening_time is not None and closing_time <= opening_time:
        raise ApiRefusal(400, "Closing time must be after opening time.")
    return opening_time, closing_time


def _optional_time(value, label):
    if value is None or str(value).strip() == "":
        return None
    try:
        return datetime.strptime(str(value).strip(), TIME_FORMAT).time()
    except ValueError:
        raise ApiRefusal(400, f"{label} must be a 24-hour time, for example 08:00.") from None


def _chosen(values, model, label):
    """Rows for the names chosen, refusing anything outside the fixed list."""
    if not values:
        return []
    if not isinstance(values, list):
        raise ApiRefusal(400, f"Choose each {label} from the list.")
    rows = []
    for name in values:
        row = db.session.query(model).filter_by(name=name).first()
        if row is None:
            raise ApiRefusal(400, f"Choose each {label} from the list.")
        rows.append(row)
    return rows


def venue_to_dict(venue):
    """Public JSON for a venue: the same fields in a list row and on a detail page."""
    return {
        "id": venue.id,
        "name": venue.name,
        "location": venue.location,
        "max_capacity": venue.max_capacity,
        "opening_time": venue.opening_time.strftime(TIME_FORMAT) if venue.opening_time else None,
        "closing_time": venue.closing_time.strftime(TIME_FORMAT) if venue.closing_time else None,
        "setup_time": venue.setup_time,
        "turnaround_time": venue.turnaround_time,
        "facilities": [row.name for row in venue.facilities],
        "accessibility_features": [row.name for row in venue.accessibility_features],
        "layouts": [row.name for row in venue.layouts],
        "is_active": venue.is_active,
    }


def list_blocks(venue_id):
    """The venue's blocks, earliest start first, or refuse 404 for an unknown venue."""
    venue = get_venue(venue_id)
    return (
        db.session.query(VenueBlock)
        .filter_by(venue_id=venue.id)
        .order_by(VenueBlock.starts_at, VenueBlock.id)
        .all()
    )


def create_block(venue_id, body, account):
    """Block a venue for a period with a reason (SCRUM-40 AC1), or refuse.

    Unknown venue → 404. Start date, start time, end date, end time and reason
    are all required → 400 naming the field; the start must be before the end
    → 400. Every check runs before anything is written, so a refusal records
    nothing.

    SCRUM-82: the bookings the new block marks Venue unavailable are dealt
    with in the same commit (_tell_bookings_hit), so the block and what it
    causes are saved together.
    """
    venue = get_venue(venue_id)
    start_date = _required_text(body, "start_date", "Start date")
    start_time = _required_text(body, "start_time", "Start time")
    end_date = _required_text(body, "end_date", "End date")
    end_time = _required_text(body, "end_time", "End time")
    reason = _required_text(body, "reason", "Reason")

    start = _date_time(start_date, start_time, "Start")
    end = _date_time(end_date, end_time, "End")
    # Equal is refused too: "the start must be before the end".
    if end <= start:
        raise ApiRefusal(400, "End must be after the start.")

    block = VenueBlock(
        venue=venue,
        starts_at=start,
        ends_at=end,
        reason=reason,
        created_by=account,
        created_at=datetime.now(timezone.utc),
    )
    db.session.add(block)
    _tell_bookings_hit(block)
    db.session.commit()
    return block


def _tell_bookings_hit(block):
    """What a new block does to the Approved bookings it overlaps (SCRUM-82 AC1-AC3).

    A booking is hit when the block makes it Venue unavailable
    (occupancy.blocks_over, the one rule), and its event is Approved,
    Planning, Safety Check or Confirmed. For each one, the event's assigned
    Event Coordinator gets one notification naming the event, the venue and
    the block's period and reason (AC2), and an event in Safety Check or
    Confirmed returns to Planning; nothing else on the event changes (AC3).
    With no assigned coordinator nobody is told. Once means once per block:
    a second block sends a second notification, and nothing is sent or moved
    back when a block is later ended or removed (PO decisions). This runs only
    when a block is created, so a booking marked because the venue's setup or
    turnaround time grew is marked and nothing more (curation).
    """
    bookings = sorted(block.venue.booking_requests, key=lambda booking: booking.id)
    for booking in bookings:
        event = booking.event_request
        if event.status not in AFFECTED_EVENT_STATUSES or block not in occupancy.blocks_over(booking):
            continue
        if event.assigned_coordinator is not None:
            create_notification(event.assigned_coordinator, _unavailable_message(booking, block), event)
        if event.status in RETURNS_TO_PLANNING:
            event.status = PLANNING


def _unavailable_message(booking, block):
    """'Seminar Room 1, booked for Swap Gala, is unavailable 05 Dec 2026, 11:00
    to 05 Dec 2026, 15:00 (Pipe burst).' (SCRUM-82 AC2, curated text)."""
    start = block.starts_at.strftime(MOMENT_TEXT_FORMAT)
    end = block.ends_at.strftime(MOMENT_TEXT_FORMAT)
    return (
        f"{booking.venue.name}, booked for {booking.event_request.name}, "
        f"is unavailable {start} to {end} ({block.reason})."
    )


def _date_time(date_text, time_text, label):
    """One end of a block as a naive local date-time; the date first, then the time."""
    try:
        day = datetime.strptime(date_text, DATE_FORMAT).date()
    except ValueError:
        raise ApiRefusal(400, f"{label} date must be a valid date.") from None
    try:
        moment = datetime.strptime(time_text, TIME_FORMAT).time()
    except ValueError:
        raise ApiRefusal(400, f"{label} time must be a 24-hour time, for example 09:00.") from None
    return datetime.combine(day, moment)


def get_block(venue_id, block_id):
    """One block of the venue, or refuse 404 for an unknown venue or block.

    A block that belongs to another venue is not found either: the address
    names both, and they must agree.
    """
    venue = get_venue(venue_id)
    block = db.session.get(VenueBlock, block_id)
    if block is None or block.venue_id != venue.id:
        raise ApiRefusal(404, "Block not found.")
    return block


def block_phase(block, now):
    """Where now falls against the block's period (SCRUM-79).

    Derived, never stored, and not a state-model status: the page uses it only
    to decide which action to offer. The start is inside the block and the end
    is not, so a block is in progress from its start up to, not including, its end.
    """
    if now < block.starts_at:
        return PHASE_UPCOMING
    if now < block.ends_at:
        return PHASE_IN_PROGRESS
    return PHASE_ENDED


def remove_block(venue_id, block_id):
    """Remove a block that has not started (SCRUM-79 AC1, AC3), or refuse.

    Removing is a hard delete: release 1 keeps no action history (D-17).
    """
    block = get_block(venue_id, block_id)
    phase = block_phase(block, clock.now_local())
    if phase == PHASE_IN_PROGRESS:
        raise ApiRefusal(400, "A block that has started cannot be removed; end it early instead.")
    if phase == PHASE_ENDED:
        raise ApiRefusal(400, "A block that has already ended cannot be removed.")
    db.session.delete(block)
    db.session.commit()


def end_block(venue_id, block_id, body):
    """End a block in progress at a new end time (SCRUM-79 AC2, AC3), or refuse.

    The new end must be no earlier than now, after the start and before the
    current end. Every check runs before anything is written, so a refusal
    leaves the block unchanged. The time is read once, so the phase and the
    "not earlier than now" rule agree.
    """
    block = get_block(venue_id, block_id)
    now = clock.now_local()
    phase = block_phase(block, now)
    if phase == PHASE_UPCOMING:
        raise ApiRefusal(400, "A block that has not started cannot be ended early; remove it instead.")
    if phase == PHASE_ENDED:
        raise ApiRefusal(400, "A block that has already ended cannot be ended.")

    end_date = _required_text(body, "end_date", "New end date")
    end_time = _required_text(body, "end_time", "New end time")
    new_end = _date_time(end_date, end_time, "New end")
    # Equal to now is allowed: "no earlier than the current time".
    if new_end < now:
        raise ApiRefusal(400, "New end cannot be earlier than the current time.")
    if new_end <= block.starts_at:
        raise ApiRefusal(400, "New end must be after the block's start.")
    # Equal to the current end is refused: "before its original end".
    if new_end >= block.ends_at:
        raise ApiRefusal(400, "New end must be before the block's current end.")

    block.ends_at = new_end
    db.session.commit()
    return block


def block_to_dict(block):
    """Public JSON for a block: its period and reason, who recorded it when,
    and its phase now (SCRUM-79)."""
    return {
        "id": block.id,
        "venue_id": block.venue_id,
        "start": block.starts_at.strftime(DATE_TIME_FORMAT),
        "end": block.ends_at.strftime(DATE_TIME_FORMAT),
        "reason": block.reason,
        "created_by": block.created_by.username,
        "created_at": block.created_at.isoformat(),
        "phase": block_phase(block, clock.now_local()),
    }


def search_venues(account, event_request_id, location, accessibility_features=(), layout="", facilities=()):
    """Venues that are free for an event and large enough for it (SCRUM-33),
    narrowed by the accessibility features (SCRUM-34) and the room layout and
    facilities (SCRUM-35) the coordinator selected.

    AC1: the event must be Approved or in Planning, and the search uses the
    event's own date, start time, end time and expected attendance, read here
    and never sent by the caller. AC2: only venues whose maximum capacity is at
    least that attendance. AC3 and AC5: a venue is left out when the event's
    occupied period overlaps an approved booking's occupied period or a block;
    periods that only touch at a boundary do not overlap; SCRUM-84 AC4 leaves
    out a venue another event's Held hold covers the same way. AC4: a booking that
    is not Approved never leaves a venue out. AC6: a location, when given, must
    match the venue's recorded location exactly; none given means no
    restriction. AC8: nothing matching is an empty list, not a refusal.

    SCRUM-41: the candidate's occupied period is its own period widened by
    each venue's setup and turnaround time (occupancy.buffered_period), so a
    venue offering more time around an event is judged by that time — a
    proposed 12:30 event with 30 minutes of setup starts occupying at 12:00
    and so loses to a 10:00–12:00 booking still turning around until 12:15.
    The existing Approved booking is widened the same way, in
    occupancy.venue_holders. Capacity, location and the three filter lists are
    unchanged.

    SCRUM-34 AC1-AC3: each accessibility feature selected must be one the
    fixed list recognises (else 400), and a venue is kept only when it records
    every one of them; none selected means accessibility restricts nothing, and
    the event's own required features are never read here. AC4: this is one more
    condition on the same search, so it can only remove venues, never bring back
    one the other rules left out. AC5: leaving the features out again is all
    "clearing" means; location, capacity and availability still apply.

    SCRUM-35 AC1: one room layout may be selected; it must be on the fixed list
    (else 400) and a venue is kept only when it records that layout as
    supported, so a venue with no layouts recorded is left out. AC2: facilities
    work like accessibility features: each must be on the fixed list, and a
    venue is kept only when it records every one. AC3: none selected restricts
    nothing, and the event's own required layout and facilities are never read
    here. AC4 and AC5: the same as for accessibility, one more condition each
    that can only remove venues, and leaving one out clears only that one.

    A retired venue is left out as well. The criteria do not say so, but a
    retired venue cannot be booked (SCRUM-36 AC10), so offering it to
    shortlist would only end in a refusal.
    """
    if event_request_id is None:
        raise ApiRefusal(400, "Event request is required.")
    event = db.session.get(EventRequest, event_request_id)
    if event is None:
        raise ApiRefusal(404, "Event request not found.")
    # SCRUM-87 AC4: searching reads the event, so one that is not the account's
    # to manage is refused 403 (a read), like opening its page.
    if event.assigned_coordinator_id != account.id:
        raise ApiRefusal(403, "You do not have permission to perform this action.")
    if event.status not in SEARCHABLE_STATUSES:
        raise ApiRefusal(400, "Venue search is available only for an Approved or Planning event.")

    required_features = _recognised(
        accessibility_features, AccessibilityFeature, "Choose each accessibility feature from the list."
    )
    required_facilities = _recognised(facilities, Facility, "Choose each facility from the list.")
    # One layout at most: a blank one is none selected.
    required_layouts = _recognised([layout] if layout else [], RoomLayout, "Choose the layout from the list.")

    query = db.session.query(Venue).filter(
        Venue.is_active.is_(True), Venue.max_capacity >= event.attendance
    )
    if location:
        query = query.filter(Venue.location == location)
    venues = [
        venue
        for venue in query.order_by(Venue.id).all()
        if _is_free(
            venue,
            *occupancy.buffered_period(venue, event.date, event.start_time, event.end_time),
            asking_event=event,
        )
        and _records_every(venue.accessibility_features, required_features)
        and _records_every(venue.facilities, required_facilities)
        and _records_every(venue.layouts, required_layouts)
    ]
    return event, venues


def _recognised(names, model, message):
    """The selected names as a set, refusing 400 with the message for any the fixed list lacks."""
    selected = set(names)
    recognised = {row.name for row in db.session.query(model).all()}
    if not selected <= recognised:
        raise ApiRefusal(400, message)
    return selected


def _records_every(rows, required_names):
    """True when the venue records every required name (vacuously true when none are required)."""
    return required_names <= {row.name for row in rows}


def _is_free(venue, starts_at, ends_at, asking_event):
    """True when no block, no approved booking and no other event's Held hold
    of the venue overlaps the occupied period: the one overlap rule, shared
    with SCRUM-38 (occupancy.py). The caller passes the candidate's occupied
    period (SCRUM-41) and the event searching, whose own holds never leave the
    venue out (SCRUM-84 AC4, AC6)."""
    return not occupancy.venue_holders(venue, starts_at, ends_at, asking_event).any()


def search_to_dict(event, venues):
    """Public JSON for a search: the event values it used, and the venues that fit.

    SCRUM-82 AC6: the event's status and assigned coordinator come along so
    the page can offer Request booking and Place hold on each result under
    the same rule as the event's own Venues section.
    """
    return {
        "event": {
            "id": event.id,
            "name": event.name,
            "date": event.date,
            "start_time": event.start_time,
            "end_time": event.end_time,
            "attendance": event.attendance,
            "status": event.status,
            "assigned_coordinator": (
                event.assigned_coordinator.username if event.assigned_coordinator else None
            ),
        },
        "venues": [venue_to_dict(venue) for venue in venues],
    }
