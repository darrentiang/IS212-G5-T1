"""Operating-hours rule — SCRUM-91 (Refuse Operating Hours That Close Before They Open).

One rule shared by adding (SCRUM-31) and updating (SCRUM-75) a venue: the
hours are both given or both blank, and the closing time is after the opening
time. Venues do not cross midnight (SCRUM-42 decision). The browser journeys
are the Playwright specs.
"""

from datetime import time

import pytest
from db import db
from factories import make_venue
from models import Venue

CLOSES_BEFORE_OPENING = "Closing time must be after opening time."
ONLY_ONE_TIME = "Enter both opening and closing time, or leave both blank."


def login(client, username="venue1"):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def add_venue(client, name, opening_time, closing_time):
    return client.post(
        "/api/venues",
        json={
            "name": name,
            "location": "Block A Level 3",
            "max_capacity": 50,
            "opening_time": opening_time,
            "closing_time": closing_time,
        },
    )


def update_venue(client, venue, opening_time, closing_time, name=None, max_capacity=None):
    return client.put(
        f"/api/venues/{venue.id}",
        json={
            "name": name or venue.name,
            "location": venue.location,
            "max_capacity": max_capacity or venue.max_capacity,
            "opening_time": opening_time,
            "closing_time": closing_time,
        },
    )


def venues_named(name):
    return db.session.query(Venue).filter_by(name=name).count()


# @story: SCRUM-91
# @ac: 1
@pytest.mark.parametrize(
    "opening,closing",
    [
        ("09:00", "08:59"),  # one minute before opening
        ("09:00", "09:00"),  # equal: "not after" is refused
        ("20:00", "08:00"),  # not read as overnight hours
    ],
)
def test_adding_a_venue_that_closes_at_or_before_opening_is_refused(app, client, opening, closing):
    login(client)

    resp = add_venue(client, "Backwards Hall", opening, closing)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == CLOSES_BEFORE_OPENING
    assert venues_named("Backwards Hall") == 0


# @story: SCRUM-91
# @ac: 1
def test_adding_a_venue_that_closes_one_minute_after_opening_is_accepted(app, client):
    login(client)

    resp = add_venue(client, "Short Hall", "09:00", "09:01")

    assert resp.status_code == 201
    venue = db.session.query(Venue).filter_by(name="Short Hall").one()
    assert (venue.opening_time, venue.closing_time) == (time(9, 0), time(9, 1))


# @story: SCRUM-91
# @ac: 2
@pytest.mark.parametrize("blank", ["", None, "   "])
def test_adding_a_venue_with_both_times_blank_is_accepted(app, client, blank):
    login(client)

    resp = add_venue(client, "No Hours Hall", blank, blank)

    assert resp.status_code == 201
    venue = db.session.query(Venue).filter_by(name="No Hours Hall").one()
    assert venue.opening_time is None
    assert venue.closing_time is None


# @story: SCRUM-91
# @ac: 2
@pytest.mark.parametrize(
    "opening,closing",
    [
        ("08:00", ""),
        ("08:00", None),
        ("", "20:00"),
        ("   ", "20:00"),  # only spaces is blank, so this is still one time
    ],
)
def test_adding_a_venue_with_only_one_time_is_refused(app, client, opening, closing):
    login(client)

    resp = add_venue(client, "Half Hours Hall", opening, closing)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == ONLY_ONE_TIME
    assert venues_named("Half Hours Hall") == 0


# @story: SCRUM-91
# @ac: 2
def test_adding_a_venue_with_a_closing_time_and_no_opening_field_is_refused(app, client):
    login(client)

    resp = client.post(
        "/api/venues",
        json={"name": "Half Hours Hall", "location": "Block A", "max_capacity": 50, "closing_time": "20:00"},
    )

    assert resp.status_code == 400
    assert resp.get_json()["message"] == ONLY_ONE_TIME
    assert venues_named("Half Hours Hall") == 0


# @story: SCRUM-91
# @ac: 1
def test_a_malformed_time_is_still_reported_as_malformed(app, client):
    # The format rule (SCRUM-31) runs first: 25:00 is not a time, not a late closing.
    login(client)

    resp = add_venue(client, "Bad Format Hall", "09:00", "25:00")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Closing time must be a 24-hour time, for example 08:00."


# @story: SCRUM-91
# @ac: 1
@pytest.mark.parametrize("opening,closing", [("18:00", "09:00"), ("10:00", "10:00")])
def test_updating_a_venue_to_close_at_or_before_opening_saves_nothing(app, client, opening, closing):
    venue = make_venue(name="Hours Room", max_capacity=80, opening_time=time(8, 0), closing_time=time(20, 0))
    login(client)

    resp = update_venue(client, venue, opening, closing, name="Hours Room Renamed")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == CLOSES_BEFORE_OPENING
    db.session.expire_all()
    stored = db.session.get(Venue, venue.id)
    assert stored.name == "Hours Room"
    assert (stored.opening_time, stored.closing_time) == (time(8, 0), time(20, 0))


# @story: SCRUM-91
# @ac: 1
def test_updating_a_venue_to_close_one_minute_after_opening_is_accepted(app, client):
    venue = make_venue(name="Hours Room", opening_time=time(8, 0), closing_time=time(20, 0))
    login(client)

    resp = update_venue(client, venue, "09:00", "09:01")

    assert resp.status_code == 200
    assert (resp.get_json()["opening_time"], resp.get_json()["closing_time"]) == ("09:00", "09:01")
    db.session.expire_all()
    stored = db.session.get(Venue, venue.id)
    assert (stored.opening_time, stored.closing_time) == (time(9, 0), time(9, 1))


# @story: SCRUM-91
# @ac: 2
@pytest.mark.parametrize("opening,closing", [("", "20:00"), ("08:00", "")])
def test_updating_a_venue_to_only_one_time_saves_nothing(app, client, opening, closing):
    venue = make_venue(name="Hours Room", opening_time=time(8, 0), closing_time=time(20, 0))
    login(client)

    resp = update_venue(client, venue, opening, closing)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == ONLY_ONE_TIME
    db.session.expire_all()
    stored = db.session.get(Venue, venue.id)
    assert (stored.opening_time, stored.closing_time) == (time(8, 0), time(20, 0))


def stored_with_bad_hours():
    # The forms now refuse these hours, so the venue is stored directly, as
    # one saved before SCRUM-91 was (the PO's 01:55 to 01:53 venue).
    return make_venue(name="Bad Hours Room", max_capacity=40, opening_time=time(1, 55), closing_time=time(1, 53))


# @story: SCRUM-91
# @ac: 3
def test_a_venue_stored_with_bad_hours_can_still_be_viewed(app, client):
    venue = stored_with_bad_hours()
    login(client)

    detail = client.get(f"/api/venues/{venue.id}")
    listing = client.get("/api/venues")

    assert detail.status_code == 200
    assert (detail.get_json()["opening_time"], detail.get_json()["closing_time"]) == ("01:55", "01:53")
    assert listing.status_code == 200
    assert venue.id in [row["id"] for row in listing.get_json()]


# @story: SCRUM-91
# @ac: 3
def test_updating_a_venue_stored_with_bad_hours_is_refused_until_they_are_fixed(app, client):
    venue = stored_with_bad_hours()
    login(client)

    resp = update_venue(client, venue, "01:55", "01:53", max_capacity=45)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == CLOSES_BEFORE_OPENING
    db.session.expire_all()
    stored = db.session.get(Venue, venue.id)
    assert stored.max_capacity == 40
    assert (stored.opening_time, stored.closing_time) == (time(1, 55), time(1, 53))


# @story: SCRUM-91
# @ac: 3
def test_a_venue_stored_with_bad_hours_can_be_updated_once_they_are_corrected(app, client):
    venue = stored_with_bad_hours()
    login(client)

    resp = update_venue(client, venue, "01:53", "01:55", max_capacity=45)

    assert resp.status_code == 200
    db.session.expire_all()
    stored = db.session.get(Venue, venue.id)
    assert stored.max_capacity == 45
    assert (stored.opening_time, stored.closing_time) == (time(1, 53), time(1, 55))


# @story: SCRUM-91
# @ac: 2, 3
def test_a_venue_stored_with_bad_hours_can_be_updated_once_both_are_cleared(app, client):
    venue = stored_with_bad_hours()
    login(client)

    resp = update_venue(client, venue, "", "")

    assert resp.status_code == 200
    db.session.expire_all()
    stored = db.session.get(Venue, venue.id)
    assert stored.opening_time is None
    assert stored.closing_time is None
