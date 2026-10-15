"""SCRUM-83: Manage Several Venues for One Event — an event lists every venue
booking request raised for it, may hold Approved bookings at several venues at
once, and its assigned Event Coordinator cancels one Approved booking, with a
reason, without touching the others or the event's status.

Every test builds its own venues and events with tests/factories.py. The main
room records 30 minutes of setup and 30 of turnaround, so an event on
5 Dec 2026, 10:00–12:00 occupies it 09:30–12:30; the hall records none, so the
same event occupies it 10:00–12:00.
"""

from datetime import datetime

import pytest

import clock
from db import db
from factories import account, make_booking, make_event, make_hold, make_venue
from models import EventRequest, Notification, VenueBookingRequest, VenueHold

DATE = "2026-12-05"
REASON = "Room too small"


@pytest.fixture(autouse=True)
def pinned_clock(monkeypatch):
    # Holds compare their expiry with now; pinned well before the event.
    monkeypatch.setattr(clock, "now_local", lambda: datetime(2026, 12, 1, 9, 0))


def login_as(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def room(name="TC83 Room"):
    return make_venue(name=name, setup_time=30, turnaround_time=30)


def hall(name="TC83 Hall"):
    return make_venue(name=name, max_capacity=400)


def event(name="Multi Venue Gala", status="Planning", coordinator="coord1"):
    return make_event(
        name=name,
        status=status,
        date=DATE,
        start_time="10:00",
        end_time="12:00",
        attendance=40,
        assigned_coordinator=account(coordinator) if coordinator else None,
    )


def cancel(client, booking, reason=REASON, venue_id=None):
    body = {} if reason is None else {"reason": reason}
    return client.post(
        f"/api/venues/{venue_id or booking.venue_id}/bookings/{booking.id}/cancel", json=body
    )


def stored(booking):
    db.session.expire_all()
    return db.session.get(VenueBookingRequest, booking.id)


def status_of(row):
    db.session.expire_all()
    return db.session.get(EventRequest, row.id).status


def approve(client, booking):
    return client.post(f"/api/venues/{booking.venue_id}/bookings/{booking.id}/approve", json={})


# ---- AC3: cancelling an approved booking --------------------------------------


# @story: SCRUM-83
# @ac: 3
def test_the_assigned_coordinator_cancels_an_approved_booking_with_a_reason(client, app):
    gala = event()
    booking = make_booking(event=gala, venue=room(), status="Approved")
    login_as(client, "coord1")

    resp = cancel(client, booking, reason="  Room too small  ")

    assert resp.status_code == 200
    body = resp.get_json()
    assert (body["status"], body["cancel_reason"], body["cancelled_by"]) == (
        "Cancelled",
        "Room too small",
        "coord1",
    )
    row = stored(booking)
    assert (row.status, row.cancel_reason, row.cancelled_by.username) == (
        "Cancelled",
        "Room too small",
        "coord1",
    )
    assert row.cancelled_at is not None
    assert body["cancelled_at"] == row.cancelled_at.isoformat()


# @story: SCRUM-83
# @ac: 3
def test_cancelling_keeps_the_approval_on_record(client, app):
    booking = make_booking(event=event(), venue=room(), status="Requested")
    login_as(client, "venue1")
    assert approve(client, booking).status_code == 200
    login_as(client, "coord1")

    cancel(client, booking)

    row = stored(booking)
    assert (row.status, row.decision, row.decided_by.username) == ("Cancelled", "Approved", "venue1")
    assert row.decided_at is not None


# @story: SCRUM-83
# @ac: 3
def test_a_booking_of_an_approved_event_can_be_cancelled_and_the_event_stays_approved(client, app):
    # Approving a request moves it straight to Planning until SCRUM-86, so an
    # Approved event with an approved booking exists only as test data.
    gala = event(status="Approved")
    booking = make_booking(event=gala, venue=room(), status="Approved")
    login_as(client, "coord1")

    resp = cancel(client, booking)

    assert resp.status_code == 200
    assert stored(booking).status == "Cancelled"
    assert status_of(gala) == "Approved"


# ---- AC4: refusals, nothing changed -------------------------------------------


# @story: SCRUM-83
# @ac: 4
@pytest.mark.parametrize("reason", [None, "", "   "])
def test_a_missing_blank_or_whitespace_reason_is_refused(client, app, reason):
    booking = make_booking(event=event(), venue=room(), status="Approved")
    login_as(client, "coord1")

    resp = cancel(client, booking, reason=reason)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Reason is required."
    row = stored(booking)
    assert (row.status, row.cancel_reason, row.cancelled_at) == ("Approved", None, None)


# @story: SCRUM-83
# @ac: 4
@pytest.mark.parametrize("status", ["Requested", "Rejected", "Withdrawn", "Cancelled"])
def test_a_booking_that_is_not_approved_cannot_be_cancelled(client, app, status):
    booking = make_booking(event=event(), venue=room(), status=status)
    login_as(client, "coord1")

    resp = cancel(client, booking)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "Only an approved booking can be cancelled."
    row = stored(booking)
    assert (row.status, row.cancel_reason) == (status, None)


# @story: SCRUM-83
# @ac: 4
@pytest.mark.parametrize(
    "status",
    [status for status in EventRequest.STATUSES if status not in ("Approved", "Planning")],
)
def test_a_booking_cannot_be_cancelled_unless_the_event_is_approved_or_planning(client, app, status):
    gala = event(status=status)
    booking = make_booking(event=gala, venue=room(), status="Approved")
    login_as(client, "coord1")

    resp = cancel(client, booking)

    assert resp.status_code == 409
    assert (
        resp.get_json()["message"]
        == "A booking can be cancelled only while the event is Approved or Planning."
    )
    assert stored(booking).status == "Approved"
    assert status_of(gala) == status


# @story: SCRUM-83
# @ac: 4
def test_the_status_is_checked_before_the_reason(client, app):
    booking = make_booking(event=event(), venue=room(), status="Requested")
    login_as(client, "coord1")

    resp = cancel(client, booking, reason="")

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "Only an approved booking can be cancelled."


# ---- Who may cancel (SCRUM-87 owns the functional rows) -------------------------


# @story: SCRUM-83
# @ac: 3
@pytest.mark.parametrize("username", ["coord2", "multi1"])
def test_a_coordinator_not_assigned_to_the_event_cannot_cancel_its_booking(client, app, username):
    booking = make_booking(event=event(), venue=room(), status="Approved")
    login_as(client, username)

    resp = cancel(client, booking)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Booking request not found."
    assert stored(booking).status == "Approved"


# @story: SCRUM-83
# @ac: 3
def test_a_coordinator_not_assigned_learns_nothing_about_the_bookings_status(client, app):
    booking = make_booking(event=event(), venue=room(), status="Requested")
    login_as(client, "coord2")

    resp = cancel(client, booking)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Booking request not found."


# @story: SCRUM-83
# @ac: 3
def test_a_booking_of_an_event_with_no_assigned_coordinator_cannot_be_cancelled(client, app):
    booking = make_booking(event=event(coordinator=None), venue=room(), status="Approved")
    login_as(client, "coord1")

    resp = cancel(client, booking)

    assert resp.status_code == 404
    assert stored(booking).status == "Approved"


# @story: SCRUM-83
# @ac: 3
@pytest.mark.parametrize("username", ["venue1", "org1", "tech1", "safety1", "att1"])
def test_roles_without_bookings_edit_cannot_cancel(client, app, username):
    booking = make_booking(event=event(), venue=room(), status="Approved")
    login_as(client, username)

    resp = cancel(client, booking)

    assert resp.status_code == 403
    assert stored(booking).status == "Approved"


# @story: SCRUM-83
# @ac: 3
def test_cancelling_an_unknown_booking_is_not_found(client, app):
    venue = room()
    login_as(client, "coord1")

    resp = client.post(f"/api/venues/{venue.id}/bookings/99999/cancel", json={"reason": REASON})

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Booking request not found."


# @story: SCRUM-83
# @ac: 3
def test_a_booking_addressed_through_another_venue_is_not_found(client, app):
    booking = make_booking(event=event(), venue=room(), status="Approved")
    other = hall()
    login_as(client, "coord1")

    resp = cancel(client, booking, venue_id=other.id)

    assert resp.status_code == 404
    assert stored(booking).status == "Approved"


# @story: SCRUM-83
# @ac: 3
def test_cancelling_at_an_unknown_venue_is_not_found(client, app):
    login_as(client, "coord1")

    resp = client.post("/api/venues/99999/bookings/1/cancel", json={"reason": REASON})

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."


# ---- AC5: only the one booking changes -----------------------------------------


# @story: SCRUM-83
# @ac: 5
def test_cancelling_one_booking_leaves_the_other_bookings_holds_and_the_event_unchanged(client, app):
    gala = event()
    seminar = room()
    auditorium = hall()
    other = make_venue(name="TC83 Studio")
    cancelled = make_booking(event=gala, venue=seminar, status="Approved")
    kept = make_booking(event=gala, venue=auditorium, status="Approved")
    waiting = make_booking(event=gala, venue=other, status="Requested")
    hold = make_hold(event=gala, venue=make_venue(name="TC83 Loft"), expires_at="2026-12-04T17:00")
    login_as(client, "coord1")

    cancel(client, cancelled)

    assert stored(cancelled).status == "Cancelled"
    assert (stored(kept).status, stored(kept).cancel_reason) == ("Approved", None)
    assert stored(waiting).status == "Requested"
    assert db.session.get(VenueHold, hold.id).status == "Held"
    assert status_of(gala) == "Planning"


# @story: SCRUM-83
# @ac: 5
def test_a_hold_released_by_the_bookings_approval_stays_released_after_the_cancel(client, app):
    gala = event()
    seminar = room()
    hold = make_hold(event=gala, venue=seminar, expires_at="2026-12-04T17:00")
    booking = make_booking(event=gala, venue=seminar, status="Requested")
    login_as(client, "venue1")
    assert approve(client, booking).status_code == 200
    login_as(client, "coord1")

    cancel(client, booking)

    db.session.expire_all()
    assert db.session.get(VenueHold, hold.id).status == "Released"


# @story: SCRUM-83
# @ac: 3
def test_cancelling_notifies_nobody(client, app):
    booking = make_booking(event=event(), venue=room(), status="Approved")
    before = db.session.query(Notification).count()
    login_as(client, "coord1")

    cancel(client, booking)

    db.session.expire_all()
    assert db.session.query(Notification).count() == before


# ---- AC3: a cancelled booking no longer makes the venue unavailable --------------


def search_names(client, row):
    resp = client.get(f"/api/venues/search?event_request_id={row.id}")
    assert resp.status_code == 200
    return [venue["name"] for venue in resp.get_json()["venues"]]


# @story: SCRUM-83
# @ac: 3
def test_search_lists_the_venue_again_once_its_booking_is_cancelled(client, app):
    seminar = room()
    booking = make_booking(event=event(), venue=seminar, status="Approved")
    rival = event("Rival Workshop", coordinator="coord2")
    login_as(client, "coord2")
    assert "TC83 Room" not in search_names(client, rival)
    login_as(client, "coord1")

    cancel(client, booking)

    login_as(client, "coord2")
    assert "TC83 Room" in search_names(client, rival)


# @story: SCRUM-83
# @ac: 3
def test_another_events_overlapping_request_is_approved_once_the_booking_is_cancelled(client, app):
    seminar = room()
    booking = make_booking(event=event(), venue=seminar, status="Approved")
    rival = make_booking(
        event=event("Rival Workshop", coordinator="coord2"),
        venue=seminar,
        status="Requested",
        raised_by="coord2",
    )
    login_as(client, "venue1")
    assert approve(client, rival).status_code == 409
    login_as(client, "coord1")
    cancel(client, booking)
    login_as(client, "venue1")

    resp = approve(client, rival)

    assert resp.status_code == 200
    assert stored(rival).status == "Approved"


# @story: SCRUM-83
# @ac: 3
def test_a_cancelled_booking_is_no_longer_a_warning_or_a_clash(client, app):
    seminar = room()
    gala = event()
    rival_event = event("Rival Workshop", coordinator="coord2")
    booking = make_booking(event=gala, venue=seminar, status="Approved")
    rival = make_booking(event=rival_event, venue=seminar, status="Approved", raised_by="coord2")
    login_as(client, "coord1")

    cancel(client, booking)

    login_as(client, "venue1")
    clashes = client.get(f"/api/venues/{seminar.id}/clashes").get_json()
    assert clashes == []
    login_as(client, "coord1")
    warnings = client.get(f"/api/requests/{gala.id}/venues/{seminar.id}/warnings").get_json()
    assert [row for row in warnings if row["type"] == "approved_booking"] == [
        {
            "type": "approved_booking",
            "id": rival.id,
            "event_request_name": "Rival Workshop",
            "date": DATE,
            "start_time": "10:00",
            "end_time": "12:00",
        }
    ]


# @story: SCRUM-83
# @ac: 3
@pytest.mark.parametrize("action", ["approve", "reject"])
def test_a_cancelled_booking_cannot_be_decided_again(client, app, action):
    booking = make_booking(event=event(), venue=room(), status="Approved")
    login_as(client, "coord1")
    cancel(client, booking)
    login_as(client, "venue1")

    resp = client.post(
        f"/api/venues/{booking.venue_id}/bookings/{booking.id}/{action}", json={"reason": "Again"}
    )

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "This booking request has already been decided (Cancelled)."
    assert stored(booking).status == "Cancelled"


# @story: SCRUM-83
# @ac: 3
def test_the_event_may_request_the_venue_again_after_cancelling(client, app):
    seminar = room()
    gala = event()
    booking = make_booking(event=gala, venue=seminar, status="Approved")
    login_as(client, "coord1")
    cancel(client, booking)

    resp = client.post(f"/api/requests/{gala.id}/bookings", json={"venue_id": seminar.id})

    assert resp.status_code == 201
    assert resp.get_json()["status"] == "Requested"


# ---- Safety check readiness (curation decision) ---------------------------------


def send(client, row):
    return client.post(f"/api/requests/{row.id}/send-for-safety-check", json={})


# @story: SCRUM-83
# @ac: 3
def test_a_cancelled_booking_does_not_block_sending_for_safety_check(client, app):
    gala = event()
    make_booking(event=gala, venue=room(), status="Cancelled")
    make_booking(event=gala, venue=hall(), status="Approved")
    login_as(client, "coord1")

    resp = send(client, gala)

    assert resp.status_code == 200
    assert status_of(gala) == "Safety Check"


# @story: SCRUM-83
# @ac: 3
def test_a_cancelled_booking_does_not_count_as_the_approved_booking_safety_check_needs(client, app):
    gala = event()
    make_booking(event=gala, venue=room(), status="Cancelled")
    login_as(client, "coord1")

    resp = send(client, gala)

    assert resp.status_code == 400
    assert "No Approved venue booking" in resp.get_json()["message"]
    assert status_of(gala) == "Planning"


# ---- AC2: each request is checked only against its own venue ---------------------


# @story: SCRUM-83
# @ac: 2
def test_the_events_approved_booking_at_one_venue_never_refuses_its_request_at_another(client, app):
    gala = event()
    make_booking(event=gala, venue=room(), status="Approved")
    auditorium = make_venue(name="TC83 Hall", max_capacity=400, setup_time=30, turnaround_time=30)
    request = make_booking(event=gala, venue=auditorium, status="Requested")
    login_as(client, "venue1")

    resp = approve(client, request)

    assert resp.status_code == 200
    assert stored(request).status == "Approved"


# ---- AC1: the event's booking list ----------------------------------------------


# @story: SCRUM-83
# @ac: 1
def test_an_events_bookings_are_listed_oldest_first_with_venue_period_status_and_reason(client, app):
    gala = event()
    seminar = room()
    auditorium = hall()
    approved = make_booking(event=gala, venue=seminar, status="Approved")
    requested = make_booking(event=gala, venue=auditorium, status="Requested")
    cancelled = make_booking(event=gala, venue=make_venue(name="TC83 Studio"), status="Approved")
    make_booking(event=event("Rival Workshop", coordinator="coord2"), venue=seminar, status="Requested")
    login_as(client, "coord1")
    cancel(client, cancelled)
    login_as(client, "coord2")  # any account with venues.view may read them

    resp = client.get(f"/api/requests/{gala.id}/bookings")

    assert resp.status_code == 200
    rows = [
        (row["id"], row["venue_name"], row["occupied_start"], row["occupied_end"], row["status"], row["cancel_reason"])
        for row in resp.get_json()
    ]
    assert rows == [
        # 10:00–12:00 widened by 30 minutes each side.
        (approved.id, "TC83 Room", "2026-12-05T09:30", "2026-12-05T12:30", "Approved", None),
        (requested.id, "TC83 Hall", "2026-12-05T10:00", "2026-12-05T12:00", "Requested", None),
        (cancelled.id, "TC83 Studio", "2026-12-05T10:00", "2026-12-05T12:00", "Cancelled", REASON),
    ]


# @story: SCRUM-83
# @ac: 1
def test_venue_staff_may_read_an_events_bookings(client, app):
    gala = event()
    make_booking(event=gala, venue=room(), status="Approved")
    login_as(client, "venue1")

    resp = client.get(f"/api/requests/{gala.id}/bookings")

    assert resp.status_code == 200
    assert [row["status"] for row in resp.get_json()] == ["Approved"]


# @story: SCRUM-83
# @ac: 1
def test_an_account_without_venues_view_cannot_read_an_events_bookings(client, app):
    gala = event()
    login_as(client, "org1")

    resp = client.get(f"/api/requests/{gala.id}/bookings")

    assert resp.status_code == 403


# @story: SCRUM-83
# @ac: 1
def test_listing_the_bookings_of_an_unknown_event_is_not_found(client, app):
    login_as(client, "coord1")

    resp = client.get("/api/requests/99999/bookings")

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Event request not found."
