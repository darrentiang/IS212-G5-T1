"""Venue rules — SCRUM-31 (Add a Venue).

Every rule the acceptance criteria state lives here, next to the query, and
refuses by raising ApiRefusal; the route never decides (ADR-002). Editing a
venue is SCRUM-75, retiring one SCRUM-76 and room layouts SCRUM-32, so nothing
here changes or removes a venue.
"""

from datetime import datetime

from db import db
from errors import ApiRefusal
from models import AccessibilityFeature, Facility, Venue

TIME_FORMAT = "%H:%M"


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
