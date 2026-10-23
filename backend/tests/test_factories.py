"""Unit tests for the test-data helpers in tests/factories.py.

Test infrastructure has no Jira key; the reference is the test-data rule in
AGENTS.md §4 and docs/test-cases/AUTOMATION.md.
"""

from db import db
from datetime import datetime

from factories import account, make_block, make_booking, make_clarification, make_event, make_hold, make_venue
from models import EventRequest, VenueBlock, VenueBookingRequest, VenueHold


# @story: setup
# @ac: test-speed
def test_account_returns_the_seeded_account(app):
    found = account("multi1")

    assert found.username == "multi1"
    assert found.role_names == ["Event Coordinator", "Venue Staff"]


# @story: setup
# @ac: test-speed
def test_make_event_stores_the_given_values_with_neutral_defaults(app):
    event = make_event(
        name="Factory Default Event",
        status="Draft",
        date="2026-12-01",
        start_time="09:00",
        end_time="11:00",
    )

    db.session.expire_all()  # read back what was committed, not the cached object
    stored = db.session.get(EventRequest, event.id)
    assert stored.name == "Factory Default Event"
    assert stored.status == "Draft"
    assert (stored.date, stored.start_time, stored.end_time) == ("2026-12-01", "09:00", "11:00")
    assert stored.created_by.username == "org1"
    assert stored.attendance == 50
    assert stored.layout is None
    assert stored.facilities == []
    assert stored.accessibility_features == []


# @story: setup
# @ac: test-speed
def test_make_event_links_requirements_by_name_and_passes_other_fields(app):
    event = make_event(
        name="Factory Full Event",
        status="Approved",
        date="2026-12-02",
        start_time="13:00",
        end_time="17:00",
        owner="org2",
        attendance=120,
        layout="Theatre",
        facilities=("Projector", "Wi-Fi"),
        features=("Hearing loop",),
        purpose="Client showcase",
    )

    db.session.expire_all()  # read back what was committed, not the cached object
    stored = db.session.get(EventRequest, event.id)
    assert stored.created_by.username == "org2"
    assert stored.attendance == 120
    assert stored.layout.name == "Theatre"
    assert sorted(f.name for f in stored.facilities) == ["Projector", "Wi-Fi"]
    assert [f.name for f in stored.accessibility_features] == ["Hearing loop"]
    assert stored.purpose == "Client showcase"


# @story: setup
# @ac: test-speed
def test_venue_booking_block_and_hold_helpers_store_the_given_values(app):
    venue = make_venue(name="Factory Room", setup_time=15, turnaround_time=20)
    event = make_event(
        name="Factory Event", status="Planning", date="2026-12-05", start_time="10:00", end_time="12:00"
    )
    booking = make_booking(event=event, venue=venue, status="Approved")
    block = make_block(venue=venue, starts_at="2026-12-06T08:00", ends_at="2026-12-06T09:00")
    hold = make_hold(event=event, venue=venue, expires_at="2026-12-04T17:00")

    db.session.expire_all()
    assert (venue.setup_time, venue.turnaround_time, venue.is_active) == (15, 20, True)
    stored_booking = db.session.get(VenueBookingRequest, booking.id)
    assert (stored_booking.status, stored_booking.date, stored_booking.start_time) == ("Approved", "2026-12-05", "10:00")
    assert db.session.get(VenueBlock, block.id).ends_at == datetime(2026, 12, 6, 9, 0)
    stored_hold = db.session.get(VenueHold, hold.id)
    assert (stored_hold.status, stored_hold.expires_at) == ("Held", datetime(2026, 12, 4, 17, 0))
    assert stored_hold.placed_by.username == "coord1"


# @story: setup
# @ac: test-speed
def test_make_clarification_stores_an_open_answered_or_ended_clarification(app):
    event = make_event(
        name="Factory Clarified", status="Submitted", date="2026-12-01", start_time="09:00", end_time="11:00"
    )

    open_one = make_clarification(event=event, message="Which room?")
    answered = make_clarification(event=event, message="How many?", reply="Forty")
    ended = make_clarification(event=event, message="Which date?", ended=True)

    assert [row.is_open for row in (open_one, answered, ended)] == [True, False, False]
    assert (answered.reply, answered.replied_by.username) == ("Forty", "org2")
    assert event.open_clarification.message == "Which room?"
