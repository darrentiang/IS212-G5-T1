"""SCRUM-84: Place a Tentative Venue Hold — the assigned Event Coordinator holds
a venue for an Approved or Planning event until an expiry; while Held, the
venue is unavailable to other events as with an approved booking, and the hold
is Released when the event's own booking is approved or when the coordinator
releases it.

Every test builds its own venue and events with tests/factories.py. The venue
records 30 minutes of setup and 30 of turnaround, so an event on 5 Dec 2026,
10:00–12:00 occupies it 09:30–12:30. The clock is pinned to 1 Dec 2026, 09:00.
"""

from datetime import datetime

import pytest

import clock
from db import db
from factories import account, make_block, make_booking, make_event, make_hold, make_venue
from models import EventRequest, VenueBookingRequest, VenueHold

DATE = "2026-12-05"
NOW = datetime(2026, 12, 1, 9, 0)
EXPIRY = {"expiry_date": "2026-12-04", "expiry_time": "17:00"}


@pytest.fixture(autouse=True)
def pinned_clock(monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)


def login_as(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def room(name="TC84 Room"):
    return make_venue(name=name, setup_time=30, turnaround_time=30)


def event(name, status="Planning", coordinator="coord1", start="10:00", end="12:00", date=DATE):
    return make_event(
        name=name,
        status=status,
        date=date,
        start_time=start,
        end_time=end,
        attendance=40,
        assigned_coordinator=account(coordinator) if coordinator else None,
    )


def place(client, row, venue, **expiry):
    body = {"venue_id": venue.id, **(expiry or EXPIRY)}
    return client.post(f"/api/requests/{row.id}/holds", json=body)


def holds_of(row):
    db.session.expire_all()
    return db.session.query(VenueHold).filter_by(event_request_id=row.id).all()


def status_of(row):
    db.session.expire_all()
    return db.session.get(EventRequest, row.id).status


def hold_status(hold):
    db.session.expire_all()
    return db.session.get(VenueHold, hold.id).status


def held(row, venue, expires_at="2026-12-04T17:00"):
    return make_hold(event=row, venue=venue, expires_at=expires_at)


# ---- AC1, AC8: placing a hold -------------------------------------------------


# @story: SCRUM-84
# @ac: 1, 8
def test_a_hold_on_a_planning_event_is_held_for_the_occupied_period_and_the_event_stays_planning(
    client, app
):
    venue = room()
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue, expiry_date="2026-12-05", expiry_time="09:59")

    assert resp.status_code == 201
    body = resp.get_json()
    assert body["status"] == "Held"
    assert body["venue_name"] == "TC84 Room"
    assert body["event_request_name"] == "Hold Seminar"
    # 10:00 start minus 30 min setup, 12:00 end plus 30 min turnaround.
    assert (body["occupied_start"], body["occupied_end"]) == ("2026-12-05T09:30", "2026-12-05T12:30")
    assert body["expires_at"] == "2026-12-05T09:59"
    assert body["placed_by"] == "coord1"
    assert body["released_at"] is None
    [stored] = holds_of(row)
    assert (stored.status, stored.venue_id, stored.expires_at) == ("Held", venue.id, datetime(2026, 12, 5, 9, 59))
    assert stored.placed_by.username == "coord1"
    assert stored.placed_at is not None
    assert status_of(row) == "Planning"


# @story: SCRUM-84
# @ac: 8
def test_the_first_hold_on_an_approved_event_moves_it_to_planning(client, app):
    venue = room()
    row = event("Hold Seminar", status="Approved")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 201
    assert status_of(row) == "Planning"
    assert [hold.status for hold in holds_of(row)] == ["Held"]


@pytest.mark.parametrize(
    "status",
    ["Draft", "Submitted", "Rejected", "Safety Check", "Confirmed", "Completed", "Cancelled"],
)
# @story: SCRUM-84
# @ac: 1
def test_a_hold_is_refused_unless_the_event_is_approved_or_planning(client, app, status):
    venue = room()
    row = event("Hold Seminar", status=status)
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A venue can be held only for an Approved or Planning event."
    assert holds_of(row) == []
    assert status_of(row) == status


# @story: SCRUM-84
# @ac: 1
def test_a_hold_needs_a_venue(client, app):
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = client.post(f"/api/requests/{row.id}/holds", json=EXPIRY)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose a venue."
    assert holds_of(row) == []


# @story: SCRUM-84
# @ac: 1
def test_a_hold_on_an_unknown_venue_is_not_found(client, app):
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = client.post(f"/api/requests/{row.id}/holds", json={"venue_id": 99999, **EXPIRY})

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."
    assert holds_of(row) == []


@pytest.mark.parametrize(
    ("expiry", "message"),
    [
        ({}, "Enter an expiry date and time."),
        ({"expiry_date": "2026-12-04"}, "Enter an expiry date and time."),
        ({"expiry_time": "17:00"}, "Enter an expiry date and time."),
        ({"expiry_date": "  ", "expiry_time": "17:00"}, "Enter an expiry date and time."),
        ({"expiry_date": "2026-12-04", "expiry_time": ""}, "Enter an expiry date and time."),
        ({"expiry_date": "2026-02-30", "expiry_time": "17:00"}, "The expiry must be a valid date and time."),
        ({"expiry_date": "2026-12-04", "expiry_time": "25:00"}, "The expiry must be a valid date and time."),
        ({"expiry_date": "4 Dec 2026", "expiry_time": "17:00"}, "The expiry must be a valid date and time."),
    ],
)
# @story: SCRUM-84
# @ac: 1
def test_a_hold_needs_a_valid_expiry_date_and_time(client, app, expiry, message):
    venue = room()
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = client.post(f"/api/requests/{row.id}/holds", json={"venue_id": venue.id, **expiry})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    assert holds_of(row) == []


# ---- AC2: the expiry window ---------------------------------------------------


@pytest.mark.parametrize(
    ("expiry_time", "accepted"),
    # Now is 1 Dec 2026, 09:00: just before, exactly at, just after.
    [("08:59", False), ("09:00", False), ("09:01", True)],
)
# @story: SCRUM-84
# @ac: 2
def test_the_expiry_must_be_strictly_in_the_future(client, app, expiry_time, accepted):
    venue = room()
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue, expiry_date="2026-12-01", expiry_time=expiry_time)

    if accepted:
        assert resp.status_code == 201
        assert len(holds_of(row)) == 1
    else:
        assert resp.status_code == 400
        assert resp.get_json()["message"] == "The expiry must be in the future."
        assert holds_of(row) == []
        assert status_of(row) == "Planning"


@pytest.mark.parametrize(
    ("expiry_time", "accepted"),
    # The published start is 5 Dec 2026, 10:00: just before, exactly at, just after.
    [("09:59", True), ("10:00", False), ("10:01", False)],
)
# @story: SCRUM-84
# @ac: 2
def test_the_expiry_must_be_strictly_before_the_events_published_start(
    client, app, expiry_time, accepted
):
    venue = room()
    row = event("Hold Seminar", status="Approved")
    login_as(client, "coord1")

    resp = place(client, row, venue, expiry_date=DATE, expiry_time=expiry_time)

    if accepted:
        assert resp.status_code == 201
        assert status_of(row) == "Planning"
    else:
        assert resp.status_code == 400
        assert resp.get_json()["message"] == "The expiry must be before the event's start."
        assert holds_of(row) == []
        assert status_of(row) == "Approved"


# @story: SCRUM-84
# @ac: 2
def test_an_expiry_inside_the_setup_time_is_still_before_the_published_start(client, app):
    venue = room()
    row = event("Hold Seminar")
    login_as(client, "coord1")

    # 09:45 is after the 09:30 occupied start but before the 10:00 published start (PO decision).
    resp = place(client, row, venue, expiry_date=DATE, expiry_time="09:45")

    assert resp.status_code == 201


# ---- AC3: conflicts -----------------------------------------------------------


# @story: SCRUM-84
# @ac: 3
def test_a_hold_overlapping_another_events_held_hold_is_refused_naming_it(client, app):
    venue = room()
    rival = event("Rival Workshop", coordinator="coord2")
    rival_hold = held(rival, venue)
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        "This venue is already committed for an overlapping period: Rival Workshop, 05 Dec 2026, 10:00–12:00."
    )
    assert holds_of(row) == []
    assert hold_status(rival_hold) == "Held"


# @story: SCRUM-84
# @ac: 3
def test_a_hold_overlapping_another_events_approved_booking_is_refused_naming_it(client, app):
    venue = room()
    make_booking(event=event("Rival Workshop", coordinator="coord2"), venue=venue, status="Approved")
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        "This venue is already committed for an overlapping period: Rival Workshop, 05 Dec 2026, 10:00–12:00."
    )
    assert holds_of(row) == []


# @story: SCRUM-84
# @ac: 3
def test_a_hold_overlapping_a_block_is_refused_naming_it(client, app):
    venue = room()
    make_block(venue=venue, starts_at="2026-12-05T12:00", ends_at="2026-12-05T13:00", reason="Projector repair")
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        "This venue is already committed for an overlapping period: "
        "blocked 05 Dec 2026, 12:00 to 05 Dec 2026, 13:00 (Projector repair)."
    )
    assert holds_of(row) == []


# @story: SCRUM-84
# @ac: 3
def test_a_refused_hold_names_every_holder_bookings_then_holds_then_blocks(client, app):
    venue = room()
    held(event("Late Hold", coordinator="coord2", start="11:00", end="11:30"), venue)
    make_booking(event=event("Early Booking", coordinator="coord2", start="08:30", end="09:15"), venue=venue, status="Approved")
    make_block(venue=venue, starts_at="2026-12-05T12:15", ends_at="2026-12-05T13:00", reason="Cleaning")
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        "This venue is already committed for an overlapping period: "
        "Early Booking, 05 Dec 2026, 08:30–09:15; "
        "Late Hold, 05 Dec 2026, 11:00–11:30; "
        "blocked 05 Dec 2026, 12:15 to 05 Dec 2026, 13:00 (Cleaning)."
    )


@pytest.mark.parametrize(
    ("start", "end", "accepted"),
    # Another event's Approved booking before this hold's 09:30 occupied start.
    # 08:30–09:00 occupies 08:00–09:30 (touches); 08:31–09:01 occupies to 09:31 (overlaps).
    [("08:30", "09:00", True), ("08:31", "09:01", False)],
)
# @story: SCRUM-84
# @ac: 3
def test_an_approved_booking_that_only_touches_the_hold_does_not_conflict(client, app, start, end, accepted):
    venue = room()
    booking = make_booking(
        event=event("Early Briefing", coordinator="coord2", start=start, end=end), venue=venue, status="Approved"
    )
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == (201 if accepted else 409)
    assert len(holds_of(row)) == (1 if accepted else 0)
    db.session.expire_all()
    assert db.session.get(VenueBookingRequest, booking.id).status == "Approved"


@pytest.mark.parametrize(
    ("start", "end", "accepted"),
    # Another event's hold after this hold's 12:30 occupied end.
    # 13:00 start occupies from 12:30 (touches); 12:59 occupies from 12:29 (overlaps).
    [("13:00", "14:00", True), ("12:59", "14:00", False)],
)
# @story: SCRUM-84
# @ac: 3
def test_another_events_held_hold_that_only_touches_does_not_conflict(client, app, start, end, accepted):
    venue = room()
    held(event("Afternoon Talk", coordinator="coord2", start=start, end=end), venue)
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == (201 if accepted else 409)


@pytest.mark.parametrize(
    ("ends_at", "accepted"),
    # A block is never widened: ending at 09:30 touches the hold's 09:30 occupied start.
    [("2026-12-05T09:30", True), ("2026-12-05T09:31", False)],
)
# @story: SCRUM-84
# @ac: 3
def test_a_block_that_only_touches_the_hold_does_not_conflict(client, app, ends_at, accepted):
    venue = room()
    make_block(venue=venue, starts_at="2026-12-05T08:00", ends_at=ends_at)
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == (201 if accepted else 409)


# @story: SCRUM-84
# @ac: 3
def test_a_released_hold_and_a_requested_booking_of_other_events_do_not_conflict(client, app):
    venue = room()
    make_hold(event=event("Old Hold", coordinator="coord2"), venue=venue, expires_at="2026-12-04T17:00", status="Released")
    make_booking(event=event("Pending Talk", coordinator="coord2"), venue=venue, status="Requested")
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 201


# @story: SCRUM-84
# @ac: 3
def test_a_hold_at_another_venue_does_not_conflict(client, app):
    venue = room()
    held(event("Rival Workshop", coordinator="coord2"), room("TC84 Other Room"))
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 201


# @story: SCRUM-84
# @ac: 1
def test_an_event_cannot_hold_the_same_venue_twice_while_held(client, app):
    venue = room()
    row = event("Hold Seminar")
    held(row, venue)
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "This event already holds this venue."
    assert len(holds_of(row)) == 1


# @story: SCRUM-84
# @ac: 1, 7
def test_an_event_may_hold_a_venue_again_after_releasing_it(client, app):
    venue = room()
    row = event("Hold Seminar")
    make_hold(event=row, venue=venue, expires_at="2026-12-04T17:00", status="Released")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 201
    assert sorted(hold.status for hold in holds_of(row)) == ["Held", "Released"]


# @story: SCRUM-84
# @ac: 1
def test_a_venue_the_event_already_has_an_approved_booking_for_cannot_be_held(client, app):
    venue = room()
    row = event("Hold Seminar")
    make_booking(event=row, venue=venue, status="Approved")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "This event already has an approved booking for TC84 Room."
    assert holds_of(row) == []


@pytest.mark.parametrize("status", ["Requested", "Rejected", "Withdrawn"])
# @story: SCRUM-84
# @ac: 1
def test_the_events_own_booking_that_is_not_approved_does_not_stop_a_hold(client, app, status):
    venue = room()
    row = event("Hold Seminar")
    make_booking(event=row, venue=venue, status=status)
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 201
    assert [hold.status for hold in holds_of(row)] == ["Held"]


# @story: SCRUM-84
# @ac: 1
def test_the_events_approved_booking_at_another_venue_does_not_stop_a_hold(client, app):
    venue = room()
    row = event("Hold Seminar")
    make_booking(event=row, venue=room("TC84 Other Room"), status="Approved")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 201


# @story: SCRUM-84
# @ac: 1
def test_a_retired_venue_cannot_be_held(client, app):
    venue = make_venue(name="TC84 Retired Room", is_active=False)
    row = event("Hold Seminar", status="Approved")
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "This venue has been retired and cannot be booked."
    assert holds_of(row) == []
    assert status_of(row) == "Approved"


# ---- Who may place a hold (SCRUM-87 owns the functional rows) ---------------


@pytest.mark.parametrize("username", ["coord2", "multi1"])
# @story: SCRUM-84
# @ac: 1
def test_a_coordinator_not_assigned_to_the_event_cannot_place_a_hold(client, app, username):
    venue = room()
    row = event("Hold Seminar", status="Approved")
    login_as(client, username)

    resp = place(client, row, venue)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Event request not found."
    assert holds_of(row) == []
    assert status_of(row) == "Approved"


# @story: SCRUM-84
# @ac: 1
def test_an_event_with_no_assigned_coordinator_cannot_be_held(client, app):
    venue = room()
    row = event("Hold Seminar", status="Approved", coordinator=None)
    login_as(client, "coord1")

    resp = place(client, row, venue)

    assert resp.status_code == 404
    assert holds_of(row) == []


@pytest.mark.parametrize("username", ["org1", "venue1", "tech1", "safety1", "att1"])
# @story: SCRUM-84
# @ac: 1
def test_roles_without_bookings_edit_cannot_place_a_hold(client, app, username):
    venue = room()
    row = event("Hold Seminar")
    login_as(client, username)

    resp = place(client, row, venue)

    assert resp.status_code == 403
    assert holds_of(row) == []


# @story: SCRUM-84
# @ac: 1
def test_a_hold_on_an_unknown_event_is_not_found(client, app):
    venue = room()
    login_as(client, "coord1")

    resp = client.post("/api/requests/99999/holds", json={"venue_id": venue.id, **EXPIRY})

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Event request not found."


# ---- AC7: releasing a hold ----------------------------------------------------


def release(client, row, hold):
    return client.post(f"/api/requests/{row.id}/holds/{hold.id}/release", json={})


# @story: SCRUM-84
# @ac: 7
def test_the_coordinator_releases_a_hold_and_it_is_released(client, app):
    venue = room()
    row = event("Hold Seminar")
    hold = held(row, venue)
    login_as(client, "coord1")

    resp = release(client, row, hold)

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Released"
    assert resp.get_json()["released_at"] is not None
    db.session.expire_all()
    stored = db.session.get(VenueHold, hold.id)
    assert stored.status == "Released"
    assert stored.released_at is not None
    assert status_of(row) == "Planning"


# @story: SCRUM-84
# @ac: 7
def test_a_released_hold_frees_the_venue_for_another_events_hold(client, app):
    venue = room()
    row = event("Hold Seminar")
    hold = held(row, venue)
    rival = event("Rival Workshop", coordinator="coord2")
    login_as(client, "coord1")
    release(client, row, hold)
    login_as(client, "coord2")

    resp = place(client, rival, venue)

    assert resp.status_code == 201


# @story: SCRUM-84
# @ac: 7
def test_releasing_a_hold_twice_is_refused(client, app):
    venue = room()
    row = event("Hold Seminar")
    hold = make_hold(event=row, venue=venue, expires_at="2026-12-04T17:00", status="Released")
    login_as(client, "coord1")

    resp = release(client, row, hold)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "This hold is already Released."
    db.session.expire_all()
    assert db.session.get(VenueHold, hold.id).released_at is None


# @story: SCRUM-84
# @ac: 7
def test_a_coordinator_not_assigned_to_the_event_cannot_release_its_hold(client, app):
    venue = room()
    row = event("Hold Seminar")
    hold = held(row, venue)
    login_as(client, "coord2")

    resp = release(client, row, hold)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Event request not found."
    assert hold_status(hold) == "Held"


# @story: SCRUM-84
# @ac: 7
def test_a_hold_of_another_event_cannot_be_released_through_this_event(client, app):
    venue = room()
    row = event("Hold Seminar")
    other_hold = held(event("Other Event", coordinator="coord1", start="14:00", end="15:00"), venue)
    login_as(client, "coord1")

    resp = release(client, row, other_hold)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue hold not found."
    assert hold_status(other_hold) == "Held"


# @story: SCRUM-84
# @ac: 7
def test_releasing_an_unknown_hold_is_not_found(client, app):
    row = event("Hold Seminar")
    login_as(client, "coord1")

    resp = client.post(f"/api/requests/{row.id}/holds/99999/release", json={})

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue hold not found."


# @story: SCRUM-84
# @ac: 7
def test_venue_staff_cannot_release_a_hold(client, app):
    venue = room()
    row = event("Hold Seminar")
    hold = held(row, venue)
    login_as(client, "venue1")

    resp = release(client, row, hold)

    assert resp.status_code == 403
    assert hold_status(hold) == "Held"


# ---- AC4, AC6: approving booking requests -------------------------------------


def approve(client, booking):
    return client.post(f"/api/venues/{booking.venue_id}/bookings/{booking.id}/approve", json={})


def booking_status(booking):
    db.session.expire_all()
    return db.session.get(VenueBookingRequest, booking.id).status


# @story: SCRUM-84
# @ac: 4
def test_approving_another_events_overlapping_request_is_refused_naming_the_holding_event(client, app):
    venue = room()
    hold = held(event("Hold Seminar"), venue)
    booking = make_booking(event=event("Rival Workshop", coordinator="coord2"), venue=venue, status="Requested")
    login_as(client, "venue1")

    resp = approve(client, booking)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        "This venue is already committed for an overlapping period: Hold Seminar, 05 Dec 2026, 10:00–12:00."
    )
    assert booking_status(booking) == "Requested"
    db.session.expire_all()
    assert db.session.get(VenueBookingRequest, booking.id).decision is None
    assert hold_status(hold) == "Held"


# @story: SCRUM-84
# @ac: 6
def test_approving_the_events_own_request_is_not_blocked_and_releases_its_hold(client, app):
    venue = room()
    row = event("Hold Seminar")
    hold = held(row, venue)
    booking = make_booking(event=row, venue=venue, status="Requested")
    login_as(client, "venue1")

    resp = approve(client, booking)

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Approved"
    db.session.expire_all()
    stored = db.session.get(VenueHold, hold.id)
    assert stored.status == "Released"
    assert stored.released_at is not None


# @story: SCRUM-84
# @ac: 6
def test_the_events_own_hold_does_not_shield_its_request_from_another_events_hold(client, app):
    venue = room()
    row = event("Hold Seminar")
    own_hold = held(row, venue)
    # Built directly: both overlap, so placing the second through the API would be refused.
    held(event("Rival Workshop", coordinator="coord2", start="11:00", end="13:00"), venue)
    booking = make_booking(event=row, venue=venue, status="Requested")
    login_as(client, "venue1")

    resp = approve(client, booking)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        "This venue is already committed for an overlapping period: Rival Workshop, 05 Dec 2026, 11:00–13:00."
    )
    assert booking_status(booking) == "Requested"
    assert hold_status(own_hold) == "Held"


# @story: SCRUM-84
# @ac: 6
def test_approving_a_request_for_another_venue_leaves_the_events_hold_held(client, app):
    venue = room()
    other = room("TC84 Other Room")
    row = event("Hold Seminar")
    hold = held(row, venue)
    booking = make_booking(event=row, venue=other, status="Requested")
    login_as(client, "venue1")

    resp = approve(client, booking)

    assert resp.status_code == 200
    assert hold_status(hold) == "Held"


# @story: SCRUM-84
# @ac: 6
def test_approving_another_events_request_leaves_a_hold_at_another_venue_held(client, app):
    venue = room()
    hold = held(event("Hold Seminar"), room("TC84 Other Room"))
    booking = make_booking(event=event("Rival Workshop", coordinator="coord2"), venue=venue, status="Requested")
    login_as(client, "venue1")

    resp = approve(client, booking)

    assert resp.status_code == 200
    assert hold_status(hold) == "Held"


# @story: SCRUM-84
# @ac: 7
def test_a_released_hold_does_not_block_another_events_approval(client, app):
    venue = room()
    make_hold(event=event("Hold Seminar"), venue=venue, expires_at="2026-12-04T17:00", status="Released")
    booking = make_booking(event=event("Rival Workshop", coordinator="coord2"), venue=venue, status="Requested")
    login_as(client, "venue1")

    resp = approve(client, booking)

    assert resp.status_code == 200


# ---- AC4: search and warnings -------------------------------------------------


def search_names(client, row):
    resp = client.get(f"/api/venues/search?event_request_id={row.id}")
    assert resp.status_code == 200
    return [venue["name"] for venue in resp.get_json()["venues"]]


# @story: SCRUM-84
# @ac: 4
def test_search_leaves_out_a_venue_another_event_holds(client, app):
    venue = room()
    held(event("Hold Seminar"), venue)
    rival = event("Rival Workshop", coordinator="coord2")
    login_as(client, "coord2")

    assert "TC84 Room" not in search_names(client, rival)


# @story: SCRUM-84
# @ac: 4, 6
def test_search_still_lists_a_venue_for_the_event_holding_it(client, app):
    venue = room()
    row = event("Hold Seminar")
    held(row, venue)
    login_as(client, "coord1")

    assert "TC84 Room" in search_names(client, row)


# @story: SCRUM-84
# @ac: 4
def test_search_lists_a_venue_whose_hold_only_touches_the_events_period(client, app):
    venue = room()
    held(event("Hold Seminar"), venue)
    # 13:00 start minus 30 min setup = occupied from 12:30, where the hold's period ends.
    rival = event("Afternoon Workshop", coordinator="coord2", start="13:00", end="14:00")
    login_as(client, "coord2")

    assert "TC84 Room" in search_names(client, rival)


# @story: SCRUM-84
# @ac: 7
def test_search_lists_the_venue_again_once_the_hold_is_released(client, app):
    venue = room()
    row = event("Hold Seminar")
    hold = held(row, venue)
    rival = event("Rival Workshop", coordinator="coord2")
    login_as(client, "coord1")
    release(client, row, hold)
    login_as(client, "coord2")

    assert "TC84 Room" in search_names(client, rival)


def warnings_for(client, row, venue):
    resp = client.get(f"/api/requests/{row.id}/venues/{venue.id}/warnings")
    assert resp.status_code == 200
    return resp.get_json()


# @story: SCRUM-84
# @ac: 4
def test_choosing_a_venue_another_event_holds_warns_naming_the_hold_after_bookings_and_before_blocks(
    client, app
):
    venue = room()
    hold = held(event("Hold Seminar"), venue)
    booking = make_booking(
        event=event("Early Booking", coordinator="coord2", start="08:30", end="09:15"), venue=venue, status="Approved"
    )
    block = make_block(venue=venue, starts_at="2026-12-05T12:15", ends_at="2026-12-05T13:00", reason="Cleaning")
    rival = event("Rival Workshop", coordinator="coord2")
    login_as(client, "coord2")

    warnings = warnings_for(client, rival, venue)

    assert [(row["type"], row["id"]) for row in warnings] == [
        ("approved_booking", booking.id),
        ("hold", hold.id),
        ("block", block.id),
    ]
    assert warnings[1] == {
        "type": "hold",
        "id": hold.id,
        "event_request_name": "Hold Seminar",
        "date": DATE,
        "start_time": "10:00",
        "end_time": "12:00",
    }


# @story: SCRUM-84
# @ac: 4, 6
def test_the_event_holding_the_venue_gets_no_warning_for_its_own_hold(client, app):
    venue = room()
    row = event("Hold Seminar")
    held(row, venue)
    login_as(client, "coord1")

    assert warnings_for(client, row, venue) == []


# ---- AC1: the derived period, and the lists ----------------------------------


# @story: SCRUM-84
# @ac: 1
def test_the_holds_period_follows_a_later_change_to_the_venues_times(client, app):
    venue = room()
    row = event("Hold Seminar")
    held(row, venue)
    login_as(client, "venue1")
    assert client.patch(f"/api/venues/{venue.id}/times", json={"setup_time": 60, "turnaround_time": 15}).status_code == 200
    login_as(client, "coord1")

    [body] = client.get(f"/api/requests/{row.id}/holds").get_json()

    # 10:00 minus 60 min setup, 12:00 plus 15 min turnaround.
    assert (body["occupied_start"], body["occupied_end"]) == ("2026-12-05T09:00", "2026-12-05T12:15")


# @story: SCRUM-84
# @ac: 1, 4
def test_a_wider_setup_time_makes_the_hold_conflict_with_a_booking_it_used_to_touch(client, app):
    venue = room()
    make_booking(
        event=event("Early Briefing", coordinator="coord2", start="08:30", end="09:00"), venue=venue, status="Approved"
    )
    row = event("Hold Seminar")
    held(row, venue)
    venue.setup_time = 31  # the hold now occupies from 09:29, inside the booking's turnaround to 09:30
    db.session.commit()
    rival = event("Rival Workshop", coordinator="coord2")
    booking = make_booking(event=rival, venue=venue, status="Requested")
    login_as(client, "venue1")

    resp = approve(client, booking)

    assert resp.status_code == 409
    assert "Hold Seminar, 05 Dec 2026, 10:00–12:00" in resp.get_json()["message"]


# @story: SCRUM-84
# @ac: 1, 6, 7
def test_an_events_holds_are_listed_oldest_first_held_and_released(client, app):
    venue = room()
    row = event("Hold Seminar")
    first = make_hold(event=row, venue=venue, expires_at="2026-12-02T09:00", status="Released")
    second = held(row, venue)
    login_as(client, "coord2")  # any coordinator may read an event's holds

    resp = client.get(f"/api/requests/{row.id}/holds")

    assert resp.status_code == 200
    assert [(hold["id"], hold["status"]) for hold in resp.get_json()] == [
        (first.id, "Released"),
        (second.id, "Held"),
    ]


# @story: SCRUM-84
# @ac: 1
def test_listing_the_holds_of_an_unknown_event_is_not_found(client, app):
    login_as(client, "coord1")

    resp = client.get("/api/requests/99999/holds")

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Event request not found."


# @story: SCRUM-84
# @ac: 5
def test_a_venues_holds_are_listed_for_its_calendar(client, app):
    venue = room()
    hold = held(event("Hold Seminar"), venue)
    held(event("Elsewhere", coordinator="coord2"), room("TC84 Other Room"))
    login_as(client, "venue1")

    resp = client.get(f"/api/venues/{venue.id}/holds")

    assert resp.status_code == 200
    [body] = resp.get_json()
    assert (body["id"], body["status"], body["event_request_name"]) == (hold.id, "Held", "Hold Seminar")
    assert (body["occupied_start"], body["occupied_end"]) == ("2026-12-05T09:30", "2026-12-05T12:30")


# @story: SCRUM-84
# @ac: 5
def test_listing_the_holds_of_an_unknown_venue_is_not_found(client, app):
    login_as(client, "venue1")

    resp = client.get("/api/venues/99999/holds")

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."


@pytest.mark.parametrize("path", ["/api/requests/{event}/holds", "/api/venues/{venue}/holds"])
# @story: SCRUM-84
# @ac: 1, 5
def test_an_event_organiser_cannot_read_holds(client, app, path):
    venue = room()
    row = event("Hold Seminar")
    held(row, venue)
    login_as(client, "org1")

    resp = client.get(path.format(event=row.id, venue=venue.id))

    assert resp.status_code == 403


# ---- AC8: the shared helper ---------------------------------------------------


@pytest.mark.parametrize(
    ("before", "after"),
    [("Approved", "Planning"), ("Planning", "Planning"), ("Submitted", "Submitted"), ("Confirmed", "Confirmed")],
)
# @story: SCRUM-84
# @ac: 8
def test_start_planning_if_approved_moves_only_an_approved_event_and_does_not_commit(app, before, after):
    from areas.requests.services import start_planning_if_approved

    row = event("Hold Seminar", status=before)

    start_planning_if_approved(row)

    assert row.status == after
    db.session.rollback()  # nothing was committed, so the stored status is unchanged
    assert status_of(row) == before


# @story: SCRUM-84
# @ac: 1
def test_a_hold_reads_as_its_venue_event_and_status(app):
    venue = room()
    row = event("Hold Seminar")
    hold = held(row, venue)

    assert repr(hold) == f"<VenueHold {hold.id} venue {venue.id} event {row.id} Held>"
