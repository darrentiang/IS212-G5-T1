"""Venue rules — SCRUM-31 (Add a Venue), SCRUM-40 (Block a Venue), SCRUM-75 (Update a Venue).

Every rule the acceptance criteria state lives here, next to the query, and
refuses by raising ApiRefusal; the route never decides (ADR-002). Retiring a
venue is SCRUM-76 and room layouts SCRUM-32, so nothing here changes or
removes a venue. Ending or removing a block is SCRUM-79.
"""

from datetime import datetime, timezone

from db import db
from errors import ApiRefusal
from models import AccessibilityFeature, Facility, Venue, VenueBlock

DATE_FORMAT = "%Y-%m-%d"
TIME_FORMAT = "%H:%M"
# A block's start and end on the wire: '2026-10-20T09:00', naive local time.
DATE_TIME_FORMAT = f"{DATE_FORMAT}T{TIME_FORMAT}"


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
    """The two fixed lists the add-venue form offers (team decision, 22-09-2026)."""
    return {
        "facilities": [row.name for row in db.session.query(Facility).order_by(Facility.id)],
        "accessibility_features": [
            row.name
            for row in db.session.query(AccessibilityFeature).order_by(AccessibilityFeature.id)
        ],
    }


def create_venue(body):
    """Record a venue from the add-venue form, or refuse 400.

    Name, location and maximum capacity are required; the maximum capacity is a
    positive whole number; facilities and accessibility features come from the
    seeded lists. The operating hours are optional.
    """
    name = _required_text(body, "name", "Name")
    location = _required_text(body, "location", "Location")
    max_capacity = _positive_whole_number(body.get("max_capacity"))
    opening_time = _optional_time(body.get("opening_time"), "Opening time")
    closing_time = _optional_time(body.get("closing_time"), "Closing time")
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
    If any check fails, it is refused and nothing changes (AC4).
    """
    venue = get_venue(venue_id)

    name = _required_text(body, "name", "Name")
    location = _required_text(body, "location", "Location")
    max_capacity = _positive_whole_number(body.get("max_capacity"))
    opening_time = _optional_time(body.get("opening_time"), "Opening time")
    closing_time = _optional_time(body.get("closing_time"), "Closing time")
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
        "facilities": [row.name for row in venue.facilities],
        "accessibility_features": [row.name for row in venue.accessibility_features],
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
    db.session.commit()
    return block


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


def block_to_dict(block):
    """Public JSON for a block: its period and reason, and who recorded it when."""
    return {
        "id": block.id,
        "venue_id": block.venue_id,
        "start": block.starts_at.strftime(DATE_TIME_FORMAT),
        "end": block.ends_at.strftime(DATE_TIME_FORMAT),
        "reason": block.reason,
        "created_by": block.created_by.username,
        "created_at": block.created_at.isoformat(),
    }
