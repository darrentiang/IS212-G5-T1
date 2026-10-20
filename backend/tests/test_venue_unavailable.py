"""SCRUM-82: Replace a Venue That Became Unavailable — a block created over an
Approved booking's occupied period marks it Venue unavailable, tells the
event's assigned Event Coordinator once, and returns an event in Safety Check
or Confirmed to Planning; the marker clears when the booking is cancelled or
the block no longer overlaps; venue search carries what the page needs to
offer Request booking and Place hold on each result.

Every test builds its own venues and events with tests/factories.py. The room
records 30 minutes of setup and 30 of turnaround, so an event on 5 Dec 2026,
10:00–12:00 occupies it 09:30–12:30; the hall records none, so the same event
occupies it 10:00–12:00.
"""

from datetime import datetime

import pytest

import clock
from db import db
from factories import account, make_block, make_booking, make_event, make_hold, make_venue
from models import EventRequest, Notification, SafetyDecision, VenueBlock, VenueBookingRequest, VenueHold

DATE = "2026-12-05"
MESSAGE = (
    "TC82 Room, booked for Swap Gala, is unavailable "
    "05 Dec 2026, 11:00 to 05 Dec 2026, 15:00 (Pipe burst)."
)


@pytest.fixture(autouse=True)
def pinned_clock(monkeypatch):
    # Remove and end early read the time; pinned well before the event.
    monkeypatch.setattr(clock, "now_local", lambda: datetime(2026, 12, 1, 9, 0))


def login_as(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def room(name="TC82 Room"):
    return make_venue(name=name, setup_time=30, turnaround_time=30)


def hall(name="TC82 Hall"):
    return make_venue(name=name, max_capacity=400)


def event(name="Swap Gala", status="Planning", coordinator="coord1"):
    return make_event(
        name=name,
        status=status,
        date=DATE,
        start_time="10:00",
        end_time="12:00",
        attendance=40,
        assigned_coordinator=account(coordinator) if coordinator else None,
    )


def block(client, venue, start="11:00", end="15:00", reason="Pipe burst", day=DATE):
    login_as(client, "venue1")
    return client.post(
        f"/api/venues/{venue.id}/blocks",
        json={"start_date": day, "start_time": start, "end_date": day, "end_time": end, "reason": reason},
    )


def event_bookings(client, row):
    login_as(client, "coord1")
    reply = client.get(f"/api/requests/{row.id}/bookings")
    return {booking["id"]: booking for booking in reply.get_json()}


def marked(client, booking):
    return event_bookings(client, booking.event_request)[booking.id]["venue_unavailable"]


def stored_event(row):
    db.session.expire_all()
    return db.session.get(EventRequest, row.id)


def notifications_for(username):
    db.session.expire_all()
    return (
        db.session.query(Notification)
        .filter_by(recipient_id=account(username).id)
        .order_by(Notification.id)
        .all()
    )


# ---- AC1: overlapping marks, touching does not ----------------------------------


# @story: SCRUM-82
# @ac: 1, 4
def test_a_block_over_the_occupied_period_marks_the_booking_and_it_stays_approved(client, app):
    venue = room()
    row = event()
    booking = make_booking(event=row, venue=venue, status="Approved")

    assert block(client, venue).status_code == 201

    bookings = event_bookings(client, row)
    assert bookings[booking.id]["status"] == "Approved"
    assert bookings[booking.id]["venue_unavailable"] is True


# @story: SCRUM-82
# @ac: 4
def test_only_the_booking_the_block_overlaps_is_marked(client, app):
    venue, other = room(), hall()
    row = event()
    hit = make_booking(event=row, venue=venue, status="Approved")
    untouched = make_booking(event=row, venue=other, status="Approved")

    block(client, venue)

    bookings = event_bookings(client, row)
    assert bookings[hit.id]["venue_unavailable"] is True
    assert bookings[untouched.id]["venue_unavailable"] is False


# @story: SCRUM-82
# @ac: 1
@pytest.mark.parametrize(
    "start, end",
    [("08:00", "09:30"), ("12:30", "14:00")],
    ids=["ends-at-occupied-start", "starts-at-occupied-end"],
)
def test_a_block_that_only_touches_the_occupied_period_does_not_mark_it(client, app, start, end):
    venue = room()
    row = event()
    booking = make_booking(event=row, venue=venue, status="Approved")

    block(client, venue, start=start, end=end, reason="Cleaning")

    assert marked(client, booking) is False
    assert [n for n in notifications_for("coord1") if n.event_request_id == row.id] == []


# @story: SCRUM-82
# @ac: 1
@pytest.mark.parametrize(
    "start, end", [("08:00", "09:31"), ("12:29", "14:00")], ids=["one-minute-into-setup", "one-minute-into-turnaround"]
)
def test_a_block_over_only_the_setup_or_turnaround_time_marks_it(client, app, start, end):
    venue = room()
    row = event()
    booking = make_booking(event=row, venue=venue, status="Approved")

    block(client, venue, start=start, end=end)

    assert marked(client, booking) is True


# @story: SCRUM-82
# @ac: 1
@pytest.mark.parametrize("status", ["Requested", "Rejected", "Withdrawn", "Cancelled"])
def test_only_an_approved_booking_is_marked(client, app, status):
    venue = room()
    row = event()
    booking = make_booking(event=row, venue=venue, status=status)

    block(client, venue)

    assert marked(client, booking) is False
    assert stored_event(row).status == "Planning"
    assert [n for n in notifications_for("coord1") if n.event_request_id == row.id] == []


# @story: SCRUM-82
# @ac: 1
def test_a_block_over_a_held_hold_leaves_it_held(client, app):
    venue = room()
    row = event(status="Approved")
    hold = make_hold(event=row, venue=venue, expires_at="2026-12-04T17:00")

    block(client, venue)

    db.session.expire_all()
    assert db.session.get(VenueHold, hold.id).status == "Held"
    assert stored_event(row).status == "Approved"


# @story: SCRUM-82
# @ac: 1
def test_a_block_of_another_venue_does_not_mark_the_booking(client, app):
    venue, other = room(), hall()
    row = event()
    booking = make_booking(event=row, venue=venue, status="Approved")

    block(client, other)

    assert marked(client, booking) is False


# ---- AC2: who is told, what, and how often --------------------------------------


# @story: SCRUM-82
# @ac: 2
def test_the_assigned_coordinator_is_told_once_with_the_event_venue_period_and_reason(client, app):
    venue = room()
    row = event()
    make_booking(event=row, venue=venue, status="Approved")
    before = len(notifications_for("coord1"))

    block(client, venue)

    after = notifications_for("coord1")
    assert len(after) == before + 1
    assert after[-1].message == MESSAGE
    assert after[-1].event_request_id == row.id
    assert after[-1].read_at is None


# @story: SCRUM-82
# @ac: 2
def test_only_the_assigned_coordinator_is_told(client, app):
    venue = room()
    row = event(coordinator="coord2")
    make_booking(event=row, venue=venue, status="Approved", raised_by="coord1")
    coord1_before = len(notifications_for("coord1"))

    block(client, venue)

    assert len(notifications_for("coord1")) == coord1_before
    assert notifications_for("coord2")[-1].message == MESSAGE


# @story: SCRUM-82
# @ac: 2
def test_a_second_block_over_the_same_booking_sends_a_second_notification(client, app):
    venue = room()
    row = event()
    make_booking(event=row, venue=venue, status="Approved")
    before = len(notifications_for("coord1"))

    block(client, venue)
    block(client, venue, start="09:00", end="10:00", reason="Leak")

    after = notifications_for("coord1")
    assert len(after) == before + 2
    assert after[-1].message == (
        "TC82 Room, booked for Swap Gala, is unavailable 05 Dec 2026, 09:00 to 05 Dec 2026, 10:00 (Leak)."
    )


# @story: SCRUM-82
# @ac: 2
def test_each_event_whose_booking_the_block_overlaps_is_told(client, app):
    venue = room()
    first = event(name="Swap Gala")
    second = make_event(
        name="Swap Brunch",
        status="Planning",
        date=DATE,
        start_time="13:00",
        end_time="14:00",
        assigned_coordinator=account("coord2"),
    )
    make_booking(event=first, venue=venue, status="Approved")
    make_booking(event=second, venue=venue, status="Approved", raised_by="coord2")
    coord1_before = len(notifications_for("coord1"))

    block(client, venue)

    assert len(notifications_for("coord1")) == coord1_before + 1
    assert notifications_for("coord2")[-1].message == (
        "TC82 Room, booked for Swap Brunch, is unavailable 05 Dec 2026, 11:00 to 05 Dec 2026, 15:00 (Pipe burst)."
    )


# @story: SCRUM-82
# @ac: 2
def test_with_no_assigned_coordinator_nobody_is_told_and_the_booking_is_still_marked(client, app):
    venue = room()
    row = event(coordinator=None)
    booking = make_booking(event=row, venue=venue, status="Approved")
    before = db.session.query(Notification).count()

    assert block(client, venue).status_code == 201

    db.session.expire_all()
    assert db.session.query(Notification).count() == before
    assert marked(client, booking) is True


# @story: SCRUM-82
# @ac: 2
def test_a_refused_block_tells_nobody(client, app):
    venue = room()
    row = event()
    make_booking(event=row, venue=venue, status="Approved")
    before = len(notifications_for("coord1"))

    assert block(client, venue, reason="  ").status_code == 400

    assert len(notifications_for("coord1")) == before


# ---- AC3: the event's status and details ----------------------------------------


# @story: SCRUM-82
# @ac: 3
@pytest.mark.parametrize(
    "status, expected",
    [
        ("Approved", "Approved"),
        ("Planning", "Planning"),
        ("Safety Check", "Planning"),
        ("Confirmed", "Planning"),
    ],
)
def test_the_event_keeps_or_returns_to_planning_by_its_status(client, app, status, expected):
    venue = room()
    row = event(status=status)
    make_booking(event=row, venue=venue, status="Approved")
    before = len(notifications_for("coord1"))

    block(client, venue)

    assert stored_event(row).status == expected
    assert len(notifications_for("coord1")) == before + 1


# @story: SCRUM-82
# @ac: 3
@pytest.mark.parametrize("status", ["Completed", "Cancelled"])
def test_a_completed_or_cancelled_event_is_left_alone(client, app, status):
    venue = room()
    row = event(status=status)
    make_booking(event=row, venue=venue, status="Approved")
    before = len(notifications_for("coord1"))

    block(client, venue)

    assert stored_event(row).status == status
    assert len(notifications_for("coord1")) == before


# @story: SCRUM-82
# @ac: 3
def test_the_event_details_and_safety_records_are_unchanged(client, app):
    venue = room()
    row = event(status="Confirmed")
    make_booking(event=row, venue=venue, status="Approved")
    db.session.add(
        SafetyDecision(
            event_request=row,
            decision="Approved",
            decided_by=account("safety1"),
            decided_at=datetime(2026, 11, 1, 9, 0),
        )
    )
    db.session.commit()

    block(client, venue)

    stored = stored_event(row)
    assert (stored.name, stored.date, stored.start_time, stored.end_time, stored.attendance) == (
        "Swap Gala",
        DATE,
        "10:00",
        "12:00",
        40,
    )
    assert stored.assigned_coordinator.username == "coord1"
    assert db.session.query(SafetyDecision).filter_by(event_request_id=row.id).count() == 1


# @story: SCRUM-82
# @ac: 3
def test_removing_the_block_does_not_move_the_event_back(client, app):
    venue = room()
    row = event(status="Confirmed")
    make_booking(event=row, venue=venue, status="Approved")
    block_id = block(client, venue).get_json()["id"]

    assert client.delete(f"/api/venues/{venue.id}/blocks/{block_id}").status_code == 204

    assert stored_event(row).status == "Planning"


# ---- AC5: the marker clears -----------------------------------------------------


# @story: SCRUM-82
# @ac: 5
def test_removing_the_block_clears_the_marker_and_tells_nobody(client, app):
    venue = room()
    row = event()
    booking = make_booking(event=row, venue=venue, status="Approved")
    block_id = block(client, venue).get_json()["id"]
    before = len(notifications_for("coord1"))

    login_as(client, "venue1")
    assert client.delete(f"/api/venues/{venue.id}/blocks/{block_id}").status_code == 204

    assert marked(client, booking) is False
    assert len(notifications_for("coord1")) == before


# @story: SCRUM-82
# @ac: 5
def test_ending_the_block_before_the_occupied_start_clears_the_marker(client, app, monkeypatch):
    venue = room()
    row = event()
    booking = make_booking(event=row, venue=venue, status="Approved")
    found = make_block(venue=venue, starts_at=f"{DATE}T08:00", ends_at=f"{DATE}T15:00", reason="Pipe burst")
    monkeypatch.setattr(clock, "now_local", lambda: datetime(2026, 12, 5, 8, 30))
    assert marked(client, booking) is True

    login_as(client, "venue1")
    reply = client.patch(
        f"/api/venues/{venue.id}/blocks/{found.id}", json={"end_date": DATE, "end_time": "09:00"}
    )

    assert reply.status_code == 200
    assert marked(client, booking) is False


# @story: SCRUM-82
# @ac: 5
def test_ending_the_block_still_inside_the_occupied_period_keeps_the_marker(client, app, monkeypatch):
    venue = room()
    row = event()
    booking = make_booking(event=row, venue=venue, status="Approved")
    found = make_block(venue=venue, starts_at=f"{DATE}T08:00", ends_at=f"{DATE}T15:00", reason="Pipe burst")
    monkeypatch.setattr(clock, "now_local", lambda: datetime(2026, 12, 5, 8, 30))

    login_as(client, "venue1")
    client.patch(f"/api/venues/{venue.id}/blocks/{found.id}", json={"end_date": DATE, "end_time": "10:00"})

    assert marked(client, booking) is True


# @story: SCRUM-82
# @ac: 5
def test_cancelling_the_marked_booking_clears_the_marker(client, app):
    venue = room()
    row = event()
    booking = make_booking(event=row, venue=venue, status="Approved")
    block(client, venue)

    login_as(client, "coord1")
    reply = client.post(
        f"/api/venues/{venue.id}/bookings/{booking.id}/cancel", json={"reason": "Venue unavailable"}
    )

    assert reply.status_code == 200
    assert reply.get_json()["status"] == "Cancelled"
    assert reply.get_json()["venue_unavailable"] is False
    db.session.expire_all()
    assert db.session.query(VenueBlock).filter_by(venue_id=venue.id).count() == 1


# ---- a setup or turnaround time that grows into a block -------------------------


# @story: SCRUM-82
# @ac: 1, 2, 3
def test_a_longer_setup_time_marks_the_booking_but_tells_nobody_and_moves_nothing(client, app):
    venue = make_venue(name="TC82 Times Room")
    row = event(status="Confirmed")
    booking = make_booking(event=row, venue=venue, status="Approved")
    make_block(venue=venue, starts_at=f"{DATE}T08:00", ends_at=f"{DATE}T09:30", reason="Cleaning")
    before = len(notifications_for("coord1"))
    assert marked(client, booking) is False

    login_as(client, "venue1")
    reply = client.patch(f"/api/venues/{venue.id}/times", json={"setup_time": 45, "turnaround_time": 0})

    assert reply.status_code == 200
    assert marked(client, booking) is True
    assert len(notifications_for("coord1")) == before
    assert stored_event(row).status == "Confirmed"


# ---- SCRUM-53: a marked booking stops the send ----------------------------------


# @story: SCRUM-82
# @ac: 1
def test_a_marked_booking_stops_the_event_being_sent_for_safety_check(client, app):
    venue = room()
    row = event()
    make_booking(event=row, venue=venue, status="Approved")
    block(client, venue)

    login_as(client, "coord1")
    reply = client.post(f"/api/requests/{row.id}/send-for-safety-check", json={})

    assert reply.status_code == 400
    assert "The booking at TC82 Room is marked Venue unavailable" in reply.get_json()["message"]
    assert stored_event(row).status == "Planning"


# ---- the booking's JSON ---------------------------------------------------------


# @story: SCRUM-82
# @ac: 4
def test_every_booking_reply_carries_venue_unavailable(client, app):
    venue = room()
    row = event()
    booking = make_booking(event=row, venue=venue, status="Approved")
    block(client, venue)

    login_as(client, "venue1")
    rows = client.get(f"/api/venues/{venue.id}/bookings").get_json()

    assert [r["venue_unavailable"] for r in rows if r["id"] == booking.id] == [True]


# ---- AC6: what the search page needs --------------------------------------------


# @story: SCRUM-82
# @ac: 6
def test_the_search_reply_carries_the_event_status_and_assigned_coordinator(client, app):
    row = event()
    login_as(client, "coord1")

    reply = client.get("/api/venues/search", query_string={"event_request_id": row.id})

    assert reply.status_code == 200
    assert reply.get_json()["event"]["status"] == "Planning"
    assert reply.get_json()["event"]["assigned_coordinator"] == "coord1"


# @story: SCRUM-82
# @ac: 6
def test_the_search_reply_names_no_coordinator_when_none_is_assigned(client, app):
    # No coordinator can search an unassigned event any more (SCRUM-87 AC4), so this
    # asks the reply builder directly: an unassigned event names nobody.
    from areas.venues.services import search_to_dict

    row = event(status="Approved", coordinator=None)

    assert search_to_dict(row, [])["event"]["assigned_coordinator"] is None


# @story: SCRUM-82
# @ac: 6
def test_a_blocked_venue_is_left_out_of_the_search_and_a_free_one_listed(client, app):
    venue, other = room(), hall()
    row = event()
    make_booking(event=row, venue=venue, status="Approved")
    block(client, venue)
    login_as(client, "coord1")

    reply = client.get("/api/venues/search", query_string={"event_request_id": row.id})

    names = [v["name"] for v in reply.get_json()["venues"]]
    assert "TC82 Hall" in names
    assert "TC82 Room" not in names


# @story: SCRUM-82
# @ac: 1, 5
def test_booking_rows_are_never_stored_with_a_marker(app):
    # Derived, never stored: the model has no such column (no schema change).
    assert "venue_unavailable" not in VenueBookingRequest.__table__.columns
