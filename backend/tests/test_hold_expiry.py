"""SCRUM-85: Expire a Tentative Venue Hold — at its expiry a Held hold becomes
Expired without anyone acting and stops holding the venue; the assigned Event
Coordinator is warned once when 24 hours or less remain and told once when it
expires. There is no scheduler: the check runs at the start of every API request.

Every test builds its own venue and events with tests/factories.py. The venue
records 30 minutes of setup and 30 of turnaround, so an event on 5 Dec 2026,
10:00–12:00 occupies it 09:30–12:30. Clock Gala's hold expires 1 Dec 2026,
17:00, so its warning is due from 30 Nov 2026, 17:00 (24 hours before). The
clock is controlled by monkeypatching clock.now_local.
"""

from datetime import datetime

import pytest

import clock
import occupancy
from areas.bookings.services import check_hold_expiry
from db import db
from factories import account, make_booking, make_event, make_hold, make_venue
from models import EventRequest, Notification, VenueBookingRequest, VenueHold

DATE = "2026-12-05"
EXPIRES_AT = "2026-12-01T17:00"

# Hand-written from the curated texts (ui-guidelines.md §7, Hold expiry).
WARNING = "The hold on TC85 Room for Clock Gala expires 01 Dec 2026, 17:00."
EXPIRED = "The hold on TC85 Room for Clock Gala expired 01 Dec 2026, 17:00 and the venue was released."

PLACED = datetime(2026, 11, 29, 12, 0)
DAY_AND_A_MINUTE_LEFT = datetime(2026, 11, 30, 16, 59)
DAY_LEFT = datetime(2026, 11, 30, 17, 0)
HOUR_LATER = datetime(2026, 11, 30, 18, 0)
MINUTE_BEFORE = datetime(2026, 12, 1, 16, 59)
AT_EXPIRY = datetime(2026, 12, 1, 17, 0)
AFTER_EXPIRY = datetime(2026, 12, 1, 17, 30)


@pytest.fixture
def now(monkeypatch):
    """The pinned time; a test moves it with now.set(...)."""

    class Clock:
        value = PLACED

        def set(self, value):
            self.value = value

    pinned = Clock()
    monkeypatch.setattr(clock, "now_local", lambda: pinned.value)
    return pinned


def login_as(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def room(name="TC85 Room"):
    return make_venue(name=name, setup_time=30, turnaround_time=30)


def event(name="Clock Gala", coordinator="coord1"):
    return make_event(
        name=name,
        status="Planning",
        date=DATE,
        start_time="10:00",
        end_time="12:00",
        attendance=40,
        assigned_coordinator=account(coordinator) if coordinator else None,
    )


def gala_hold(venue=None, row=None, **fields):
    return make_hold(event=row or event(), venue=venue or room(), expires_at=EXPIRES_AT, **fields)


def fresh(hold):
    db.session.expire_all()
    return db.session.get(VenueHold, hold.id)


def messages(row):
    """Every notification about this event, oldest first: (recipient, message)."""
    db.session.expire_all()
    rows = (
        db.session.query(Notification)
        .filter_by(event_request_id=row.id)
        .order_by(Notification.id)
        .all()
    )
    return [(notification.recipient.username, notification.message) for notification in rows]


# ---- AC1: the one holding rule ------------------------------------------------


# @story: SCRUM-85
# @ac: 1
@pytest.mark.parametrize(
    "moment, holding",
    [(MINUTE_BEFORE, True), (AT_EXPIRY, False), (AFTER_EXPIRY, False)],
    ids=["one minute before", "exactly at", "after"],
)
def test_a_held_hold_holds_until_its_expiry_is_reached(app, now, moment, holding):
    hold = gala_hold()
    now.set(moment)

    assert occupancy.is_holding(hold) is holding


# @story: SCRUM-85
# @ac: 1
def test_a_hold_stops_holding_at_its_expiry_even_before_the_check_saves_it(app, now):
    venue = room()
    gala_hold(venue)
    rival = event("Rival Workshop", coordinator="coord2")
    # 5 Dec 10:00-12:00 widened by 30 minutes each side = 09:30-12:30.
    period = occupancy.buffered_period(venue, DATE, "10:00", "12:00")

    now.set(MINUTE_BEFORE)
    assert [hold.event_request.name for hold in occupancy.venue_holders(venue, *period, rival).holds] == [
        "Clock Gala"
    ]
    now.set(AT_EXPIRY)
    assert occupancy.venue_holders(venue, *period, rival).holds == []


# ---- AC1-AC3: the check, branch by branch --------------------------------------


# @story: SCRUM-85
# @ac: 2
def test_no_warning_with_24_hours_and_one_minute_left(app, now):
    hold = gala_hold()
    now.set(DAY_AND_A_MINUTE_LEFT)

    assert check_hold_expiry() == 0

    assert fresh(hold).warning_sent_at is None
    assert messages(hold.event_request) == []


# @story: SCRUM-85
# @ac: 2
def test_warning_is_sent_once_with_exactly_24_hours_left(app, now):
    hold = gala_hold()
    now.set(DAY_LEFT)

    assert check_hold_expiry() == 1

    stored = fresh(hold)
    assert stored.status == "Held"
    assert stored.warning_sent_at == DAY_LEFT
    assert messages(hold.event_request) == [("coord1", WARNING)]


# @story: SCRUM-85
# @ac: 2
def test_a_warning_already_sent_is_not_sent_again(app, now):
    hold = gala_hold()
    now.set(DAY_LEFT)
    check_hold_expiry()

    now.set(HOUR_LATER)
    assert check_hold_expiry() == 0
    now.set(MINUTE_BEFORE)
    assert check_hold_expiry() == 0

    assert fresh(hold).warning_sent_at == DAY_LEFT
    assert messages(hold.event_request) == [("coord1", WARNING)]


# @story: SCRUM-85
# @ac: 1, 3
def test_at_its_expiry_a_warned_hold_expires_and_the_coordinator_is_told(app, now):
    hold = gala_hold()
    now.set(DAY_LEFT)
    check_hold_expiry()

    now.set(AT_EXPIRY)
    assert check_hold_expiry() == 1

    stored = fresh(hold)
    assert stored.status == "Expired"
    assert stored.expired_at == AT_EXPIRY
    assert messages(hold.event_request) == [("coord1", WARNING), ("coord1", EXPIRED)]


# @story: SCRUM-85
# @ac: 2, 3
def test_a_hold_first_checked_after_expiry_gets_only_the_expiry_notice(app, now):
    hold = gala_hold()
    now.set(AFTER_EXPIRY)

    check_hold_expiry()

    stored = fresh(hold)
    assert stored.status == "Expired"
    assert stored.expired_at == AFTER_EXPIRY
    assert stored.warning_sent_at is None
    # The notice names the expiry itself, 17:00, not when the check ran.
    assert messages(hold.event_request) == [("coord1", EXPIRED)]


# @story: SCRUM-85
# @ac: 3
def test_the_expiry_notice_is_never_sent_twice(app, now):
    hold = gala_hold()
    now.set(AT_EXPIRY)
    check_hold_expiry()

    now.set(AFTER_EXPIRY)
    assert check_hold_expiry() == 0
    assert check_hold_expiry() == 0

    assert fresh(hold).expired_at == AT_EXPIRY
    assert messages(hold.event_request) == [("coord1", EXPIRED)]


# @story: SCRUM-85
# @ac: 2, 3
def test_a_released_hold_gets_no_warning_and_no_expiry_notice(app, now):
    hold = gala_hold(status="Released")

    for moment in (DAY_LEFT, AFTER_EXPIRY):
        now.set(moment)
        assert check_hold_expiry() == 0

    assert fresh(hold).status == "Released"
    assert messages(hold.event_request) == []


# @story: SCRUM-85
# @ac: 1
def test_expiry_does_not_change_the_events_status(app, now):
    hold = gala_hold()
    now.set(AT_EXPIRY)

    check_hold_expiry()

    db.session.expire_all()
    assert db.session.get(EventRequest, hold.event_request_id).status == "Planning"


# @story: SCRUM-85
# @ac: 1, 2, 3
def test_with_no_assigned_coordinator_the_hold_still_expires_and_nobody_is_told(app, now):
    hold = gala_hold(row=event(coordinator=None))
    before = db.session.query(Notification).count()

    now.set(DAY_LEFT)
    check_hold_expiry()
    now.set(AT_EXPIRY)
    check_hold_expiry()

    assert fresh(hold).status == "Expired"
    assert db.session.query(Notification).count() == before


# @story: SCRUM-85
# @ac: 1, 2
def test_one_check_handles_each_due_hold_by_its_own_expiry(app, now):
    venue = room()
    gala = gala_hold(venue)
    later = make_hold(event=event("Later Gala"), venue=room("TC85 Hall"), expires_at="2026-12-02T09:00")
    # At 1 Dec 17:00 Clock Gala's hold has expired; Later Gala's has 16 hours left.
    now.set(AT_EXPIRY)

    assert check_hold_expiry() == 2

    assert fresh(gala).status == "Expired"
    assert fresh(later).status == "Held"
    assert fresh(later).warning_sent_at == AT_EXPIRY
    assert messages(later.event_request) == [
        ("coord1", "The hold on TC85 Hall for Later Gala expires 02 Dec 2026, 09:00.")
    ]


# ---- The check runs on every API request ----------------------------------------


# @story: SCRUM-85
# @ac: 1, 3
def test_an_ordinary_request_saves_the_expiry_before_answering(client, now):
    hold = gala_hold()
    login_as(client, "coord1")
    now.set(AT_EXPIRY)

    resp = client.get(f"/api/requests/{hold.event_request_id}/holds")

    assert resp.status_code == 200
    row = resp.get_json()[0]
    assert row["status"] == "Expired"
    assert row["expired_at"] == "2026-12-01T17:00"
    assert messages(hold.event_request) == [("coord1", EXPIRED)]


# @story: SCRUM-85
# @ac: 2
def test_a_hold_placed_with_under_24_hours_left_warns_on_the_next_request(client, now):
    row = event()
    venue = room()
    login_as(client, "coord1")
    now.set(datetime(2026, 12, 1, 10, 0))

    placed = client.post(
        f"/api/requests/{row.id}/holds",
        json={"venue_id": venue.id, "expiry_date": "2026-12-01", "expiry_time": "17:00"},
    )
    assert placed.status_code == 201
    listed = client.get("/api/notifications")

    assert listed.status_code == 200
    assert [item["message"] for item in listed.get_json() if item["event_request_id"] == row.id] == [WARNING]


# @story: SCRUM-85
# @ac: 1
def test_the_health_check_does_not_run_the_hold_check(client, now):
    hold = gala_hold()
    now.set(AT_EXPIRY)

    assert client.get("/api/health").status_code == 200

    assert fresh(hold).status == "Held"


# ---- AC1: search, approval and the calendar after expiry ------------------------


def _rival_with_request(venue):
    rival = event("Rival Workshop", coordinator="coord2")
    booking = make_booking(event=rival, venue=venue, status="Requested", raised_by="coord2")
    return rival, booking


def _search_names(client, row):
    resp = client.get("/api/venues/search", query_string={"event_request_id": row.id})
    assert resp.status_code == 200
    return [venue["name"] for venue in resp.get_json()["venues"]]


# @story: SCRUM-85
# @ac: 1
def test_search_lists_the_venue_once_the_hold_has_expired(client, now):
    venue = room()
    gala_hold(venue)
    rival, _ = _rival_with_request(venue)
    login_as(client, "coord2")

    now.set(MINUTE_BEFORE)
    assert "TC85 Room" not in _search_names(client, rival)
    now.set(AT_EXPIRY)
    assert "TC85 Room" in _search_names(client, rival)


# @story: SCRUM-85
# @ac: 1
def test_one_minute_before_expiry_the_hold_still_refuses_another_events_approval(client, now):
    venue = room()
    gala_hold(venue)
    _, booking = _rival_with_request(venue)
    login_as(client, "venue1")
    now.set(MINUTE_BEFORE)

    resp = client.post(f"/api/venues/{venue.id}/bookings/{booking.id}/approve", json={})

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        "This venue is already committed for an overlapping period: Clock Gala, 05 Dec 2026, 10:00–12:00."
    )
    db.session.expire_all()
    assert db.session.get(VenueBookingRequest, booking.id).status == "Requested"


# @story: SCRUM-85
# @ac: 1
def test_at_expiry_another_events_approval_succeeds(client, now):
    venue = room()
    hold = gala_hold(venue)
    _, booking = _rival_with_request(venue)
    login_as(client, "venue1")
    now.set(AT_EXPIRY)

    resp = client.post(f"/api/venues/{venue.id}/bookings/{booking.id}/approve", json={})

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Approved"
    assert fresh(hold).status == "Expired"


# @story: SCRUM-85
# @ac: 1
def test_the_calendars_holds_show_the_hold_as_expired_after_expiry(client, now):
    venue = room()
    hold = gala_hold(venue)
    login_as(client, "venue1")
    now.set(AT_EXPIRY)

    resp = client.get(f"/api/venues/{venue.id}/holds")

    assert resp.status_code == 200
    # The availability page shows only Held holds (ui-guidelines.md §7).
    assert [(row["id"], row["status"]) for row in resp.get_json()] == [(hold.id, "Expired")]


# ---- After expiry or release ------------------------------------------------------


# @story: SCRUM-85
# @ac: 2, 3
def test_a_hold_released_by_its_own_booking_approval_gets_no_notices(client, now):
    venue = room()
    hold = gala_hold(venue)
    booking = make_booking(event=hold.event_request, venue=venue, status="Requested")
    login_as(client, "venue1")
    now.set(PLACED)
    assert client.post(f"/api/venues/{venue.id}/bookings/{booking.id}/approve", json={}).status_code == 200

    for moment in (HOUR_LATER, AFTER_EXPIRY):
        now.set(moment)
        assert client.get(f"/api/venues/{venue.id}/holds").status_code == 200

    assert fresh(hold).status == "Released"
    # The approval's own notice (SCRUM-63 AC1) is the only one: no hold notice.
    assert messages(hold.event_request) == [
        ("coord1", "Venue booking approved for Clock Gala: TC85 Room, 05 Dec 2026, 10:00–12:00.")
    ]


# @story: SCRUM-85
# @ac: 1
def test_an_expired_hold_cannot_be_released(client, now):
    hold = gala_hold()
    login_as(client, "coord1")
    now.set(AT_EXPIRY)

    resp = client.post(f"/api/requests/{hold.event_request_id}/holds/{hold.id}/release")

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "This hold is already Expired."
    assert fresh(hold).status == "Expired"
    assert fresh(hold).released_at is None


# @story: SCRUM-85
# @ac: 1
def test_the_venue_may_be_held_again_after_the_hold_expires(client, now):
    venue = room()
    hold = gala_hold(venue)
    login_as(client, "coord1")
    now.set(AT_EXPIRY)

    resp = client.post(
        f"/api/requests/{hold.event_request_id}/holds",
        json={"venue_id": venue.id, "expiry_date": "2026-12-04", "expiry_time": "17:00"},
    )

    assert resp.status_code == 201
    db.session.expire_all()
    statuses = sorted(
        row.status for row in db.session.query(VenueHold).filter_by(event_request_id=hold.event_request_id)
    )
    assert statuses == ["Expired", "Held"]
