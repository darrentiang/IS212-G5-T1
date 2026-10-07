"""Venue booking request rules — SCRUM-36 (Request Venue Booking).

The acceptance criteria as rules at the API: who may raise a booking request,
which event statuses accept one, that it carries the event's own fields, that
it is visible with a status showing a decision is outstanding, that it does
not block other bookings, that a duplicate (same venue, same event) awaiting
a decision is refused, and that a retired venue cannot be booked. The browser
journeys are the Playwright spec's (functional/tests/SCRUM-36.spec.js).

AC8 ("only the assigned coordinator") is not enforced here: no story has
built coordinator assignment yet (docs/design/permissions.md, the
bookings.edit Rule). Any Event Coordinator may raise for any Approved or
Planning event; see test_any_event_coordinator_may_raise_not_just_one.
"""

from datetime import datetime, timezone

import pytest

from db import db
from models import Account, EventRequest, Venue, VenueBookingRequest

EVENT_DEFAULTS = {
    "name": "Tech Fair 2026",
    "purpose": "Career networking",
    "description": "Annual tech career fair",
    "date": "2026-11-20",
    "start_time": "09:00",
    "end_time": "17:00",
    "attendance": 200,
    "venue_requirements": "Large hall with stage",
    "accessibility_needs": "Wheelchair access",
    "equipment_requirements": "Projector, microphones",
    "registration_needs": "Online registration with capacity cap",
}


def login(client, username="coord1"):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def make_event(status="Approved", created_by="org1", **overrides):
    owner = db.session.query(Account).filter_by(username=created_by).one()
    fields = dict(EVENT_DEFAULTS)
    fields.update(overrides)
    event = EventRequest(created_by=owner, status=status, **fields)
    db.session.add(event)
    db.session.commit()
    return event.id


def venue_id(name="Seminar Room 1"):
    return db.session.query(Venue).filter_by(name=name).one().id


def retire(name="Seminar Room 1"):
    venue = db.session.query(Venue).filter_by(name=name).one()
    venue.is_active = False
    db.session.commit()


def post_booking(client, event, venue=None, **overrides):
    body = {"venue_id": venue if venue is not None else venue_id()}
    body.update(overrides)
    return client.post(f"/api/requests/{event}/bookings", json=body)


def booking_count():
    return db.session.query(VenueBookingRequest).count()


# --- AC1, AC11: a booking request is raised for one venue against one event ---


# @story: SCRUM-36
# @ac: 1, 11
def test_coordinator_raises_a_booking_request(client):
    login(client)
    event = make_event()
    before = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)

    resp = post_booking(client, event)

    assert resp.status_code == 201
    body = resp.get_json()
    assert body["venue_id"] == venue_id()
    assert body["event_request_id"] == event
    assert body["status"] == "Requested"
    assert body["raised_by"] == "coord1"
    assert body["raised_at"] is not None

    booking = db.session.get(VenueBookingRequest, body["id"])
    assert booking.raised_by.username == "coord1"
    assert booking.raised_at >= before


# --- AC2: only an Approved or Planning event may receive a booking request ---


# @story: SCRUM-36
# @ac: 2
@pytest.mark.parametrize("status", ["Approved", "Planning"])
def test_booking_is_raised_for_an_approved_or_planning_event(client, status):
    login(client)
    event = make_event(status=status)

    resp = post_booking(client, event)

    assert resp.status_code == 201


# @story: SCRUM-36
# @ac: 2
@pytest.mark.parametrize("status", ["Draft", "Submitted", "Rejected", "Confirmed", "Completed", "Cancelled"])
def test_booking_is_refused_for_any_other_event_status(client, status):
    login(client)
    event = make_event(status=status)

    resp = post_booking(client, event)

    assert resp.status_code == 400
    assert "Approved" in resp.get_json()["message"]
    assert booking_count() == 0


# @story: SCRUM-36
# @ac: 2
def test_booking_against_an_unknown_event_is_refused(client):
    login(client)

    resp = post_booking(client, 9999)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Event request not found."
    assert booking_count() == 0


# --- AC3: the request carries the event's date, times, attendance and venue requirements ---


# @story: SCRUM-36
# @ac: 3
def test_booking_carries_the_events_own_fields(client):
    login(client)
    event = make_event(
        date="2026-12-04", start_time="10:00", end_time="12:00", attendance=20,
        venue_requirements="Meeting room with whiteboard",
    )

    resp = post_booking(client, event)

    body = resp.get_json()
    assert body["date"] == "2026-12-04"
    assert body["start_time"] == "10:00"
    assert body["end_time"] == "12:00"
    assert body["attendance"] == 20
    assert body["venue_requirements"] == "Meeting room with whiteboard"


# @story: SCRUM-36
# @ac: 3
def test_booking_keeps_its_own_fields_after_the_event_changes(client):
    login(client)
    event_id = make_event(attendance=200)
    booking_id = post_booking(client, event_id).get_json()["id"]

    event = db.session.get(EventRequest, event_id)
    event.attendance = 9999
    db.session.commit()

    booking = db.session.get(VenueBookingRequest, booking_id)
    assert booking.attendance == 200


# --- AC4, AC5: the request is visible with a status showing a decision is outstanding ---


# @story: SCRUM-36
# @ac: 4, 5
def test_venue_staff_sees_the_booking_awaiting_a_decision(client):
    login(client)
    event = make_event()
    created = post_booking(client, event).get_json()
    client.post("/api/logout")
    login(client, "venue1")

    resp = client.get(f"/api/venues/{venue_id()}/bookings")

    assert resp.status_code == 200
    rows = resp.get_json()
    assert [row["id"] for row in rows] == [created["id"]]
    assert rows[0]["status"] == "Requested"


# @story: SCRUM-36
# @ac: 5
def test_coordinator_sees_the_booking_awaiting_a_decision(client):
    login(client)
    event = make_event()
    created = post_booking(client, event).get_json()

    resp = client.get(f"/api/venues/{venue_id()}/bookings")

    assert resp.status_code == 200
    assert resp.get_json()[0]["status"] == "Requested"


# @story: SCRUM-36
# @ac: 4
def test_a_venue_with_no_booking_requests_lists_none(client):
    login(client, "venue1")

    resp = client.get(f"/api/venues/{venue_id()}/bookings")

    assert resp.status_code == 200
    assert resp.get_json() == []


# @story: SCRUM-36
# @ac: 4
def test_booking_list_for_an_unknown_venue_is_refused(client):
    login(client, "venue1")

    resp = client.get("/api/venues/9999/bookings")

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."


# @story: SCRUM-36
# @ac: 4
@pytest.mark.parametrize("username", ["org1", "tech1", "att1"])
def test_an_account_without_venues_view_cannot_list_bookings(client, username):
    login(client, username)

    resp = client.get(f"/api/venues/{venue_id()}/bookings")

    assert resp.status_code == 403


# --- AC6, AC7: raising a request does not affect another venue or another event ---


# @story: SCRUM-36
# @ac: 6
def test_raising_a_request_does_not_block_another_event_booking_the_same_venue(client):
    login(client)
    first_event = make_event(name="First event")
    second_event = make_event(name="Second event")

    first = post_booking(client, first_event)
    second = post_booking(client, second_event)

    assert first.status_code == 201
    assert second.status_code == 201
    assert booking_count() == 2


# @story: SCRUM-36
# @ac: 7
def test_one_event_can_have_booking_requests_for_several_venues(client):
    login(client)
    event = make_event()

    seminar = post_booking(client, event, venue=venue_id("Seminar Room 1"))
    auditorium = post_booking(client, event, venue=venue_id("Auditorium"))

    assert seminar.status_code == 201
    assert auditorium.status_code == 201
    rows = db.session.query(VenueBookingRequest).filter_by(event_request_id=event).all()
    assert len(rows) == 2
    assert {row.status for row in rows} == {"Requested"}


# --- AC8 (decision, see module docstring): any Event Coordinator may raise ---


# @story: SCRUM-36
# @ac: 8
def test_any_event_coordinator_may_raise_not_just_one(client):
    # coord2 did not create or decide this event; raising is still allowed
    # (team decision, permissions.md 1.7: assignment is not built yet).
    login(client, "coord2")
    event = make_event()

    resp = post_booking(client, event)

    assert resp.status_code == 201
    assert resp.get_json()["raised_by"] == "coord2"


# --- AC9: a request already awaiting a decision for the same venue and event blocks a new one ---


# @story: SCRUM-36
# @ac: 9
def test_a_second_booking_for_the_same_venue_and_event_is_refused(client):
    login(client)
    event = make_event()
    first = post_booking(client, event)
    assert first.status_code == 201

    second = post_booking(client, event)

    assert second.status_code == 400
    assert "already awaiting a decision" in second.get_json()["message"]
    assert booking_count() == 1


# @story: SCRUM-36
# @ac: 9
def test_a_new_booking_is_allowed_once_the_earlier_one_is_no_longer_awaiting(client):
    login(client)
    event = make_event()
    first_id = post_booking(client, event).get_json()["id"]
    # No decide/withdraw endpoint exists yet (later stories); set the status
    # directly to prove the rule checks status, not just (venue, event) existence.
    first = db.session.get(VenueBookingRequest, first_id)
    first.status = "Approved"
    db.session.commit()

    resp = post_booking(client, event)

    assert resp.status_code == 201
    assert booking_count() == 2


# @story: SCRUM-36
# @ac: 9
def test_a_duplicate_against_a_different_venue_is_allowed(client):
    login(client)
    event = make_event()
    first = post_booking(client, event, venue=venue_id("Seminar Room 1"))
    assert first.status_code == 201

    second = post_booking(client, event, venue=venue_id("Auditorium"))

    assert second.status_code == 201


# --- AC10: a booking request can be raised only against an active venue ---


# @story: SCRUM-36
# @ac: 10
def test_a_retired_venue_cannot_be_booked(client):
    login(client)
    event = make_event()
    retire()

    resp = post_booking(client, event)

    assert resp.status_code == 400
    assert "retired" in resp.get_json()["message"].lower()
    assert booking_count() == 0


# @story: SCRUM-36
# @ac: 10
def test_booking_against_an_unknown_venue_is_refused(client):
    login(client)
    event = make_event()

    resp = post_booking(client, event, venue=9999)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."


# @story: SCRUM-36
# @ac: 1
def test_a_venue_must_be_chosen(client):
    login(client)
    event = make_event()

    resp = client.post(f"/api/requests/{event}/bookings", json={})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose a venue."
    assert booking_count() == 0


# --- Negative: only an Event Coordinator may raise ---


# @story: SCRUM-36
# @ac: 8
@pytest.mark.parametrize("username", ["org1", "venue1", "tech1", "att1"])
def test_an_account_without_event_coordinator_cannot_raise(client, username):
    login(client, username)
    event = make_event()

    resp = post_booking(client, event)

    assert resp.status_code == 403
    assert booking_count() == 0


# @story: SCRUM-36
# @ac: 8
def test_the_role_check_comes_before_the_event_lookup(client):
    login(client, "org1")

    # Refused for the role, so the reply says nothing about whether event 9999 exists.
    resp = post_booking(client, 9999)

    assert resp.status_code == 403


# @story: SCRUM-36
# @ac: 8
def test_not_logged_in_cannot_raise(client):
    event = make_event()

    resp = post_booking(client, event)

    assert resp.status_code == 401
    assert booking_count() == 0


# @story: SCRUM-36
# @ac: 8
def test_an_account_holding_event_coordinator_among_its_roles_can_raise(client):
    # multi1 is Event Coordinator and Venue Staff: any role allowing it is enough (D-09).
    login(client, "multi1")
    event = make_event()

    resp = post_booking(client, event)

    assert resp.status_code == 201
    assert resp.get_json()["raised_by"] == "multi1"


def test_venue_booking_request_repr_shows_venue_event_and_status(app):
    with app.app_context():
        booking = VenueBookingRequest(
            venue_id=1, event_request_id=1, status="Requested", raised_by_id=1,
            raised_at=datetime.now(timezone.utc),
        )
        assert repr(booking) == f"<VenueBookingRequest {booking.id} venue 1 event 1 Requested>"
