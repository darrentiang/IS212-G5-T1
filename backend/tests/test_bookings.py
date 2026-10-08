"""Venue booking request rules — SCRUM-36 (Request Venue Booking), SCRUM-37
(Approve or Reject a Venue Booking Request).

The acceptance criteria as rules at the API: who may raise a booking request,
which event statuses accept one, that it carries the event's own fields, that
it is visible with a status showing a decision is outstanding, that it does
not block other bookings, that a duplicate (same venue, same event) awaiting
a decision is refused, that a retired venue cannot be booked, who may decide
one, that only a Requested booking can be decided, that a rejection needs a
reason, that the decision and who/when it was made are retained, and that
deciding one leaves an event's other booking requests unchanged. The browser
journeys are the Playwright specs (functional/tests/SCRUM-36.spec.js,
SCRUM-37.spec.js).

AC8 of SCRUM-36 ("only the assigned coordinator") is not enforced here: no
story has built coordinator assignment yet (docs/design/permissions.md, the
bookings.edit Rule). Any Event Coordinator may raise for any Approved or
Planning event; see test_any_event_coordinator_may_raise_not_just_one.

SCRUM-37's Approve is not qualified by "(conflict check passes)" either: no
story defines what a conflict is (state-model.md 1.3).
"""

from datetime import datetime, timezone

import pytest

from db import db
from models import Account, EventRequest, Facility, RoomLayout, Venue, VenueBookingRequest

EVENT_DEFAULTS = {
    "name": "Tech Fair 2026",
    "purpose": "Career networking",
    "description": "Annual tech career fair",
    "date": "2026-11-20",
    "start_time": "09:00",
    "end_time": "17:00",
    "attendance": 200,
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


def decide(client, venue, booking_id, action, **body):
    return client.post(f"/api/venues/{venue}/bookings/{booking_id}/{action}", json=body)


def raise_and_get_id(client, event=None, venue=None):
    """A fresh Requested booking, raised as coord1, ready to be decided."""
    login(client, "coord1")
    event_id = event if event is not None else make_event()
    booking_id = post_booking(client, event_id, venue=venue).get_json()["id"]
    return event_id, booking_id


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
# The event's venue requirements are its chosen layout and facilities (SCRUM-42).


# @story: SCRUM-36
# @ac: 3
def test_booking_carries_the_events_own_fields(client):
    login(client)
    event = make_event(
        date="2026-12-04", start_time="10:00", end_time="12:00", attendance=20,
        layout=db.session.query(RoomLayout).filter_by(name="Boardroom").one(),
        facilities=[db.session.query(Facility).filter_by(name="Whiteboard").one()],
    )

    resp = post_booking(client, event)

    body = resp.get_json()
    assert body["date"] == "2026-12-04"
    assert body["start_time"] == "10:00"
    assert body["end_time"] == "12:00"
    assert body["attendance"] == 20
    assert body["layout"] == "Boardroom"
    assert body["facilities"] == ["Whiteboard"]


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


# ==========================================================================
# SCRUM-37: approve or reject a venue booking request
# ==========================================================================

# --- AC1: Venue Staff can see the event timing, attendance and venue requirements ---


# @story: SCRUM-37
# @ac: 1
def test_venue_staff_sees_attendance_layout_and_facilities_before_deciding(client):
    # The event's venue requirements are its chosen layout and facilities (SCRUM-42).
    event = make_event(
        attendance=75,
        layout=db.session.query(RoomLayout).filter_by(name="Theatre").one(),
        facilities=[
            db.session.query(Facility).filter_by(name=name).one()
            for name in ("Projector", "Whiteboard")
        ],
    )
    _, booking_id = raise_and_get_id(client, event=event)
    login(client, "venue1")

    resp = client.get(f"/api/venues/{venue_id()}/bookings")

    row = next(row for row in resp.get_json() if row["id"] == booking_id)
    assert row["attendance"] == 75
    assert row["layout"] == "Theatre"
    assert row["facilities"] == ["Projector", "Whiteboard"]


# --- AC2: Venue Staff can approve, committing the venue to the event ---


# @story: SCRUM-37
# @ac: 2, 4, 9
def test_venue_staff_approves_a_booking_request(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")
    before = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)

    resp = decide(client, venue_id(), booking_id, "approve")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Approved"
    assert body["decision"] == "Approved"
    assert body["decided_by"] == "venue1"
    assert body["decided_at"] is not None

    booking = db.session.get(VenueBookingRequest, booking_id)
    assert booking.decided_at >= before


# @story: SCRUM-37
# @ac: 2
def test_approving_with_no_reason_is_accepted(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")

    resp = decide(client, venue_id(), booking_id, "approve")

    assert resp.status_code == 200
    assert resp.get_json()["decision_reason"] is None


# --- AC3, AC8: Venue Staff can reject, and a reason is required ---


# @story: SCRUM-37
# @ac: 3
def test_venue_staff_rejects_a_booking_request_with_a_reason(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")

    resp = decide(client, venue_id(), booking_id, "reject", reason="Already committed that week")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Rejected"
    assert body["decision"] == "Rejected"
    assert body["decision_reason"] == "Already committed that week"


# @story: SCRUM-37
# @ac: 8
def test_rejecting_with_a_blank_reason_is_refused_and_unchanged(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")

    resp = decide(client, venue_id(), booking_id, "reject", reason="")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A reason is required to reject."
    assert db.session.get(VenueBookingRequest, booking_id).status == "Requested"


# @story: SCRUM-37
# @ac: 8
def test_rejecting_with_a_whitespace_only_reason_is_refused_and_unchanged(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")

    resp = decide(client, venue_id(), booking_id, "reject", reason="   ")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A reason is required to reject."
    assert db.session.get(VenueBookingRequest, booking_id).status == "Requested"


# @story: SCRUM-37
# @ac: 8
def test_a_refused_whitespace_only_rejection_records_no_decision(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")

    resp = decide(client, venue_id(), booking_id, "reject", reason=" \t\n ")

    assert resp.status_code == 400
    booking = db.session.get(VenueBookingRequest, booking_id)
    assert booking.status == "Requested"
    assert booking.decision is None
    assert booking.decision_reason is None
    assert booking.decided_at is None
    assert booking.decided_by is None


# @story: SCRUM-37
# @ac: 8
def test_rejecting_with_no_reason_at_all_is_refused(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")

    resp = client.post(f"/api/venues/{venue_id()}/bookings/{booking_id}/reject", json={})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A reason is required to reject."


# --- AC4, AC9: the decision and the deciding Venue Staff member are retained ---


# @story: SCRUM-37
# @ac: 4, 9
def test_decision_records_the_deciding_venue_staff_and_when(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")

    decide(client, venue_id(), booking_id, "approve")

    booking = db.session.get(VenueBookingRequest, booking_id)
    assert booking.decided_by.username == "venue1"
    assert booking.decided_at is not None


# --- AC5: the Event Coordinator can see the decision and the reason where given ---


# @story: SCRUM-37
# @ac: 5
def test_coordinator_sees_the_decision_and_reason(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")
    decide(client, venue_id(), booking_id, "reject", reason="Venue under maintenance")

    login(client, "coord1")
    resp = client.get(f"/api/venues/{venue_id()}/bookings")

    row = next(row for row in resp.get_json() if row["id"] == booking_id)
    assert row["status"] == "Rejected"
    assert row["decision"] == "Rejected"
    assert row["decision_reason"] == "Venue under maintenance"
    assert row["decided_by"] == "venue1"


# --- AC6: only Venue Staff may approve or reject ---


# @story: SCRUM-37
# @ac: 6
@pytest.mark.parametrize("username", ["org1", "coord1", "tech1", "att1"])
def test_an_account_without_venue_staff_cannot_decide(client, username):
    _, booking_id = raise_and_get_id(client)
    login(client, username)

    resp = decide(client, venue_id(), booking_id, "approve")

    assert resp.status_code == 403
    assert db.session.get(VenueBookingRequest, booking_id).status == "Requested"


# @story: SCRUM-37
# @ac: 6
def test_the_role_check_comes_before_the_booking_lookup(client):
    login(client, "org1")

    resp = decide(client, venue_id(), 9999, "approve")

    assert resp.status_code == 403


# @story: SCRUM-37
# @ac: 6
def test_not_logged_in_cannot_decide(client):
    _, booking_id = raise_and_get_id(client)
    client.post("/api/logout")

    resp = decide(client, venue_id(), booking_id, "approve")

    assert resp.status_code == 401


# @story: SCRUM-37
# @ac: 6
def test_an_account_holding_venue_staff_among_its_roles_can_decide(client):
    # multi1 is Event Coordinator and Venue Staff: any role allowing it is enough (D-09).
    _, booking_id = raise_and_get_id(client)
    login(client, "multi1")

    resp = decide(client, venue_id(), booking_id, "approve")

    assert resp.status_code == 200
    assert resp.get_json()["decided_by"] == "multi1"


# --- AC7: only a request awaiting a decision can be approved or rejected ---


# @story: SCRUM-37
# @ac: 7
def test_an_already_approved_booking_cannot_be_approved_again(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")
    decide(client, venue_id(), booking_id, "approve")

    resp = decide(client, venue_id(), booking_id, "approve")

    assert resp.status_code == 409
    assert "already been decided" in resp.get_json()["message"]
    assert "Approved" in resp.get_json()["message"]


# @story: SCRUM-37
# @ac: 7
def test_an_already_rejected_booking_cannot_be_approved(client):
    _, booking_id = raise_and_get_id(client)
    login(client, "venue1")
    decide(client, venue_id(), booking_id, "reject", reason="No availability")

    resp = decide(client, venue_id(), booking_id, "approve")

    assert resp.status_code == 409
    booking = db.session.get(VenueBookingRequest, booking_id)
    assert booking.status == "Rejected"


# @story: SCRUM-37
# @ac: 7
def test_a_withdrawn_booking_cannot_be_decided(client):
    _, booking_id = raise_and_get_id(client)
    booking = db.session.get(VenueBookingRequest, booking_id)
    booking.status = "Withdrawn"
    db.session.commit()
    login(client, "venue1")

    resp = decide(client, venue_id(), booking_id, "approve")

    assert resp.status_code == 409


# @story: SCRUM-37
# @ac: 7
def test_deciding_an_unknown_booking_is_refused(client):
    login(client, "venue1")

    resp = decide(client, venue_id(), 9999, "approve")

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Booking request not found."


# @story: SCRUM-37
# @ac: 7
def test_deciding_a_booking_that_belongs_to_another_venue_is_refused(client):
    _, booking_id = raise_and_get_id(client, venue=venue_id("Seminar Room 1"))
    login(client, "venue1")

    resp = decide(client, venue_id("Auditorium"), booking_id, "approve")

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Booking request not found."


# --- AC10: deciding one booking leaves an event's other booking requests unchanged ---


# @story: SCRUM-37
# @ac: 10
def test_deciding_one_booking_leaves_the_events_other_bookings_unchanged(client):
    login(client, "coord1")
    event_id = make_event()
    seminar_id = post_booking(client, event_id, venue=venue_id("Seminar Room 1")).get_json()["id"]
    auditorium_id = post_booking(client, event_id, venue=venue_id("Auditorium")).get_json()["id"]

    login(client, "venue1")
    decide(client, venue_id("Seminar Room 1"), seminar_id, "approve")

    auditorium_booking = db.session.get(VenueBookingRequest, auditorium_id)
    assert auditorium_booking.status == "Requested"
    assert auditorium_booking.decision is None


def test_venue_booking_request_repr_shows_venue_event_and_status(app):
    with app.app_context():
        booking = VenueBookingRequest(
            venue_id=1, event_request_id=1, status="Requested", raised_by_id=1,
            raised_at=datetime.now(timezone.utc),
        )
        assert repr(booking) == f"<VenueBookingRequest {booking.id} venue 1 event 1 Requested>"
