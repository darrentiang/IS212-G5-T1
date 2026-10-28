"""Small builders for the data a backend test depends on.

New tests build the records they depend on here and pass the values that
matter explicitly, so a reader sees them in the test (AGENTS.md §4,
docs/test-cases/AUTOMATION.md). From the seed a test relies only on reference
data (roles, facilities, accessibility features, layouts, equipment types) and
the seeded accounts it logs in as.

Every helper runs inside the pytest ``app`` fixture's app context.
"""

from datetime import datetime, timezone

from db import db
from models import (
    AccessibilityFeature,
    Account,
    Clarification,
    EventRequest,
    Facility,
    Registration,
    Role,
    RoomLayout,
    Venue,
    VenueBlock,
    VenueBookingRequest,
    VenueHold,
)


def account(username):
    return db.session.query(Account).filter_by(username=username).one()


def make_event(
    *,
    name,
    status,
    date,
    start_time,
    end_time,
    owner="org1",
    attendance=50,
    layout=None,
    facilities=(),
    features=(),
    **fields,
):
    """Store one event request and return the row.

    layout, facilities and features are names from the seeded fixed lists.
    Any other EventRequest column (purpose, submitted_at, ...) goes in fields.
    """
    event = EventRequest(
        name=name,
        status=status,
        date=date,
        start_time=start_time,
        end_time=end_time,
        attendance=attendance,
        created_by=account(owner),
        layout=_named(RoomLayout, layout) if layout else None,
        facilities=[_named(Facility, item) for item in facilities],
        accessibility_features=[_named(AccessibilityFeature, item) for item in features],
        **fields,
    )
    db.session.add(event)
    db.session.commit()
    return event


def _named(model, name):
    return db.session.query(model).filter_by(name=name).one()


def make_venue(*, name, max_capacity=60, setup_time=0, turnaround_time=0, location="Test Block", **fields):
    """Store one active venue and return the row. Any other Venue column goes in fields."""
    venue = Venue(
        name=name,
        location=location,
        max_capacity=max_capacity,
        setup_time=setup_time,
        turnaround_time=turnaround_time,
        **fields,
    )
    db.session.add(venue)
    db.session.commit()
    return venue


def make_booking(*, event, venue, status, raised_by="coord1"):
    """Store one booking request of the venue for the event, its period copied from the event."""
    booking = VenueBookingRequest(
        venue=venue,
        event_request=event,
        status=status,
        date=event.date,
        start_time=event.start_time,
        end_time=event.end_time,
        attendance=event.attendance,
        raised_by=account(raised_by),
        raised_at=datetime.now(timezone.utc),
    )
    db.session.add(booking)
    db.session.commit()
    return booking


def make_block(*, venue, starts_at, ends_at, reason="Maintenance"):
    """Store one block of the venue; starts_at and ends_at are ISO local date-times."""
    block = VenueBlock(
        venue=venue,
        starts_at=datetime.fromisoformat(starts_at),
        ends_at=datetime.fromisoformat(ends_at),
        reason=reason,
        created_by=account("venue1"),
        created_at=datetime.now(timezone.utc),
    )
    db.session.add(block)
    db.session.commit()
    return block


def make_hold(*, event, venue, expires_at, status="Held", placed_by="coord1"):
    """Store one venue hold (SCRUM-84); expires_at is an ISO local date-time."""
    hold = VenueHold(
        venue=venue,
        event_request=event,
        status=status,
        expires_at=datetime.fromisoformat(expires_at),
        placed_by=account(placed_by),
        placed_at=datetime.now(timezone.utc),
    )
    db.session.add(hold)
    db.session.commit()
    return hold


def make_equipment_requirement(*, event, equipment, quantity, status="Requested", technical_requirements=""):
    """Stage a requirement; review states are fixtures, not a review workflow."""
    from models import EquipmentRequirement
    row = EquipmentRequirement(event_request=event, equipment_type=equipment,
                               quantity=quantity, status=status,
                               technical_requirements=technical_requirements)
    db.session.add(row)
    db.session.commit()
    return row


def make_clarification(*, event, message, reply=None, asked_by="coord1", replied_by="org2", ended=False):
    """Store one clarification on the event (SCRUM-45); with a reply it is answered, with ended it was ended by a decision."""
    now = datetime.now(timezone.utc)
    row = Clarification(
        event_request=event,
        requested_by=account(asked_by),
        message=message,
        requested_at=now,
        reply=reply,
        replied_by=account(replied_by) if reply is not None else None,
        replied_at=now if reply is not None else None,
        ended_at=now if ended else None,
    )
    db.session.add(row)
    db.session.commit()
    return row


def make_attendee(username):
    """Store one more Attendee account (the seed has only att1) and return it."""
    row = Account(username=username)
    row.set_password("Passw0rd!")
    row.roles = [db.session.query(Role).filter_by(name="Attendee").one()]
    db.session.add(row)
    db.session.commit()
    return row


def make_registration(*, event, attendee="att1", status="Registered"):
    """Store one registration of the Attendee for the event (SCRUM-55)."""
    now = datetime.now(timezone.utc)
    row = Registration(
        event_request=event,
        attendee=account(attendee),
        status=status,
        registered_at=now,
        withdrawn_at=now if status == "Withdrawn" else None,
    )
    db.session.add(row)
    db.session.commit()
    return row
