"""SCRUM-55: an Attendee withdraws their own registration until the event starts.
SCRUM-56: each registration in the list shows the event's venue by its status.
"""

from datetime import datetime

import pytest

import clock
from db import db
from factories import account, make_attendee, make_booking, make_event, make_registration, make_venue
from models import Registration

EVENT_DAY = "2027-12-20"  # the event starts at 10:00 on this day


def login(client, username="att1"):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def at(hour, minute, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: datetime(2027, 12, 20, hour, minute))


def event_in(status="Confirmed", name="Gala"):
    return make_event(
        name=name,
        status=status,
        date=EVENT_DAY,
        start_time="10:00",
        end_time="12:00",
        registration_enabled=True,
    )


def withdraw(client, registration):
    return client.post(f"/api/registrations/{registration.id}/withdraw")


def stored(registration):
    db.session.refresh(registration)
    return registration


# --- AC1 -------------------------------------------------------------------


# @story: SCRUM-55
# @ac: 1
def test_attendee_withdraws_their_own_registration(client, monkeypatch):
    at(9, 0, monkeypatch)
    registration = make_registration(event=event_in())
    login(client)

    reply = withdraw(client, registration)

    assert reply.status_code == 200
    body = reply.get_json()
    assert (body["id"], body["status"]) == (registration.id, "Withdrawn")
    row = stored(registration)
    assert row.status == "Withdrawn"
    assert row.withdrawn_at is not None


# @story: SCRUM-55
# @ac: 1, 3
@pytest.mark.parametrize(
    "hour,minute,allowed",
    [(9, 59, True), (10, 0, False), (10, 1, False)],
)
def test_withdrawing_is_allowed_until_the_event_starts(client, monkeypatch, hour, minute, allowed):
    # The event starts at 10:00: one minute before is allowed, the start and later are not.
    at(hour, minute, monkeypatch)
    registration = make_registration(event=event_in())
    login(client)

    reply = withdraw(client, registration)

    assert reply.status_code == (200 if allowed else 409)
    if not allowed:
        assert reply.get_json() == {
            "message": "The event has started, so the registration can no longer be withdrawn."
        }
    assert stored(registration).status == ("Withdrawn" if allowed else "Registered")
    assert (stored(registration).withdrawn_at is not None) == allowed


# --- AC3 -------------------------------------------------------------------


# @story: SCRUM-55
# @ac: 3
def test_an_already_withdrawn_registration_is_refused_and_unchanged(client, monkeypatch):
    at(9, 0, monkeypatch)
    registration = make_registration(event=event_in())
    login(client)
    assert withdraw(client, registration).status_code == 200
    first = stored(registration).withdrawn_at

    reply = withdraw(client, registration)

    assert reply.status_code == 409
    assert reply.get_json() == {"message": "This registration is already withdrawn."}
    assert stored(registration).withdrawn_at == first


# @story: SCRUM-55
# @ac: 3
def test_a_registration_for_a_cancelled_event_cannot_be_withdrawn(client, monkeypatch):
    at(9, 0, monkeypatch)
    registration = make_registration(event=event_in("Cancelled"))
    login(client)

    reply = withdraw(client, registration)

    assert reply.status_code == 409
    assert reply.get_json() == {
        "message": "This event was cancelled, so its registration cannot be withdrawn."
    }
    assert stored(registration).status == "Registered"


# @story: SCRUM-55
# @ac: 3
def test_a_registration_for_a_completed_event_cannot_be_withdrawn(client, monkeypatch):
    # A Completed event is over, so the event has started.
    at(13, 0, monkeypatch)
    registration = make_registration(event=event_in("Completed"))
    login(client)

    reply = withdraw(client, registration)

    assert reply.status_code == 409
    assert stored(registration).status == "Registered"


# --- AC4 -------------------------------------------------------------------


# @story: SCRUM-55
# @ac: 4
def test_withdrawing_one_registration_leaves_the_attendees_other_one_for_the_event(client, monkeypatch):
    # An Attendee who registered again holds a Withdrawn row and a Registered row for one event.
    at(9, 0, monkeypatch)
    event = event_in()
    old = make_registration(event=event, status="Withdrawn")
    current = make_registration(event=event)
    login(client)

    reply = withdraw(client, current)

    assert reply.status_code == 200
    assert (stored(old).status, stored(current).status) == ("Withdrawn", "Withdrawn")
    assert db.session.query(Registration).filter_by(event_request_id=event.id).count() == 2


# --- AC5 -------------------------------------------------------------------


# @story: SCRUM-55
# @ac: 5
def test_another_attendee_cannot_withdraw_it_and_is_told_nothing_of_it(client, monkeypatch):
    at(9, 0, monkeypatch)
    registration = make_registration(event=event_in())
    make_attendee("att2")
    login(client, "att2")

    reply = withdraw(client, registration)

    assert reply.status_code == 404
    assert reply.get_json() == {"message": "Registration not found."}
    assert stored(registration).status == "Registered"


@pytest.mark.parametrize("username", ["coord1", "org1", "venue1", "tech1", "lead1", "safety1"])
# @story: SCRUM-55
# @ac: 5
def test_an_account_that_is_not_an_attendee_is_refused(client, monkeypatch, username):
    at(9, 0, monkeypatch)
    registration = make_registration(event=event_in())
    login(client, username)

    reply = withdraw(client, registration)

    assert reply.status_code == 403
    assert reply.get_json() == {"message": "You do not have permission to perform this action."}
    assert stored(registration).status == "Registered"


# @story: SCRUM-55
# @ac: 5
def test_withdrawing_needs_a_login(client, monkeypatch):
    at(9, 0, monkeypatch)
    registration = make_registration(event=event_in())

    assert withdraw(client, registration).status_code == 401
    assert stored(registration).status == "Registered"


# @story: SCRUM-55
# @ac: 1
def test_withdrawing_an_unknown_registration_is_not_found(client):
    login(client)

    reply = client.post("/api/registrations/9999/withdraw")

    assert reply.status_code == 404
    assert reply.get_json() == {"message": "Registration not found."}


# --- the list the Withdraw button lives on ------------------------------------


# @story: SCRUM-55
# @ac: 1, 4, 5
def test_my_registrations_lists_only_the_attendees_own_with_whether_they_can_withdraw(client, monkeypatch):
    at(9, 0, monkeypatch)
    event = event_in(name="Mine Gala")
    mine = make_registration(event=event)
    gone = make_registration(event=event, status="Withdrawn")
    make_attendee("att2")
    make_registration(event=event_in(name="Theirs Gala"), attendee="att2")
    login(client)

    rows = client.get("/api/registrations/mine").get_json()

    assert [row["id"] for row in rows] == [mine.id, gone.id]
    assert rows[0] == {
        "id": mine.id,
        "event_request_id": event.id,
        "event_name": "Mine Gala",
        "event_status": "Confirmed",
        "date": EVENT_DAY,
        "start_time": "10:00",
        "end_time": "12:00",
        "venues": "",  # Confirmed, but no venue booked for it
        "venue_state": "confirmed",
        "status": "Registered",
        "can_withdraw": True,
    }
    assert rows[1]["status"] == "Withdrawn"
    assert rows[1]["can_withdraw"] is False


@pytest.mark.parametrize(
    "event_status,hour,minute,offered",
    [
        ("Confirmed", 9, 59, True),
        ("Confirmed", 10, 0, False),
        ("Cancelled", 9, 0, False),
        ("Completed", 13, 0, False),
    ],
)
# @story: SCRUM-55
# @ac: 1, 3
def test_withdraw_is_offered_only_where_the_withdrawal_would_be_accepted(
    client, monkeypatch, event_status, hour, minute, offered
):
    at(hour, minute, monkeypatch)
    make_registration(event=event_in(event_status))
    login(client)

    row = client.get("/api/registrations/mine").get_json()[0]

    assert row["can_withdraw"] is offered
    assert row["event_status"] == event_status


@pytest.mark.parametrize("username", ["coord1", "org1"])
# @story: SCRUM-55
# @ac: 5
def test_my_registrations_is_for_attendees_only(client, username):
    login(client, username)

    assert client.get("/api/registrations/mine").status_code == 403


# @story: SCRUM-55
# @ac: 1
def test_a_registration_reads_as_its_id_and_status(client):
    registration = make_registration(event=event_in())

    assert repr(registration) == f"<Registration {registration.id} Registered>"


# --- SCRUM-56: the venue, by the event's status -------------------------------


def mine(client, registration):
    login(client)
    rows = client.get("/api/registrations/mine").get_json()
    return next(row for row in rows if row["id"] == registration.id)


@pytest.mark.parametrize(
    "event_status,venues,venue_state",
    [
        ("Confirmed", "Test Hall", "confirmed"),
        ("Completed", "Test Hall", "confirmed"),
        ("Cancelled", None, "none"),
        # Not yet confirmed, although the Approved booking is still held (TC-SCRUM-56-02).
        ("Planning", None, "not_confirmed"),
        ("Approved", None, "not_confirmed"),
        ("Safety Check", None, "not_confirmed"),
        ("Submitted", None, "not_confirmed"),
    ],
)
# @story: SCRUM-56
# @ac: 2, 3
def test_the_venue_is_shown_only_while_the_event_is_confirmed_or_completed(
    client, event_status, venues, venue_state
):
    event = event_in(event_status)
    make_booking(event=event, venue=make_venue(name="Test Hall"), status="Approved")
    registration = make_registration(event=event)

    row = mine(client, registration)

    assert (row["venues"], row["venue_state"], row["event_status"]) == (venues, venue_state, event_status)


@pytest.mark.parametrize("event_status", ["Confirmed", "Completed"])
# @story: SCRUM-56
# @ac: 2
def test_a_confirmed_or_completed_event_without_an_approved_booking_names_no_venue(client, event_status):
    event = event_in(event_status)
    make_booking(event=event, venue=make_venue(name="Test Requested"), status="Requested")
    registration = make_registration(event=event)

    row = mine(client, registration)

    # Still confirmed by status: the page shows a dash, never "Venue not yet confirmed".
    assert (row["venues"], row["venue_state"]) == ("", "confirmed")


# @story: SCRUM-56
# @ac: 2
def test_several_approved_venues_are_named_comma_separated_in_name_order(client):
    event = event_in()
    make_booking(event=event, venue=make_venue(name="Test Hall B"), status="Approved")
    make_booking(event=event, venue=make_venue(name="Test Annex"), status="Approved")
    registration = make_registration(event=event)

    assert mine(client, registration)["venues"] == "Test Annex, Test Hall B"


# @story: SCRUM-56
# @ac: 2
def test_only_approved_bookings_name_a_venue(client):
    event = event_in()
    make_booking(event=event, venue=make_venue(name="Test Approved"), status="Approved")
    for status in ("Requested", "Rejected", "Withdrawn", "Cancelled"):
        make_booking(event=event, venue=make_venue(name=f"Test {status}"), status=status)
    registration = make_registration(event=event)

    assert mine(client, registration)["venues"] == "Test Approved"


# @story: SCRUM-56
# @ac: 2
def test_the_date_and_time_are_the_events_current_values(client):
    event = event_in("Planning")
    registration = make_registration(event=event)
    event.date, event.start_time, event.end_time = "2027-12-21", "14:00", "16:00"
    db.session.commit()

    row = mine(client, registration)

    assert (row["date"], row["start_time"], row["end_time"]) == ("2027-12-21", "14:00", "16:00")
