"""SCRUM-54: an Attendee registers for a confirmed event, and the list they register from."""

from datetime import datetime

import pytest

import clock
from areas.registration import services
from db import db
from factories import account, make_attendee, make_booking, make_event, make_registration, make_venue
from models import Registration

NOW = datetime(2026, 12, 1, 9, 0)


@pytest.fixture(autouse=True)
def pinned_clock(monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)


def at(moment, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: datetime.fromisoformat(moment))


def login(client, username="att1"):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def concert(name="Reg Concert", status="Confirmed", enabled=True, capacity=2, closes="2026-12-09T23:59"):
    """Reg Concert as the test cases describe it: 10 Dec 2026, 19:00-21:00, registration on."""
    return make_event(
        name=name,
        status=status,
        date="2026-12-10",
        start_time="19:00",
        end_time="21:00",
        purpose="Evening concert",
        coordinator_notes="Internal: VIP list pending",
        assigned_coordinator=account("coord1"),
        registration_enabled=enabled,
        registration_capacity=capacity,
        registration_closes_at=datetime.fromisoformat(closes),
    )


def register(client, event):
    return client.post(f"/api/registration/events/{event.id}/register")


def registrations(event, status="Registered"):
    return db.session.query(Registration).filter_by(event_request_id=event.id, status=status).all()


def listed(client, event):
    rows = client.get("/api/registration/events").get_json()
    return next(row for row in rows if row["id"] == event.id)


def refusal(reply):
    return reply.status_code, reply.get_json()["message"]


# --- AC1, AC4: registering ----------------------------------------------------


# @story: SCRUM-54
# @ac: 1, 4
def test_attendee_registers_and_is_told_the_event_details(client):
    event = concert()
    make_booking(event=event, venue=make_venue(name="Hall A"), status="Approved")
    login(client)

    reply = register(client, event)

    assert reply.status_code == 201
    body = reply.get_json()
    assert (body["name"], body["date"], body["start_time"], body["end_time"], body["venues"]) == (
        "Reg Concert", "2026-12-10", "19:00", "21:00", "Hall A")
    assert body["state"] == "registered"
    [row] = registrations(event)
    assert row.attendee_id == account("att1").id
    assert row.registered_at is not None
    assert row.withdrawn_at is None


# @story: SCRUM-54
# @ac: 1
def test_registration_is_committed(client):
    event = concert()
    login(client)

    register(client, event)
    db.session.rollback()

    assert len(registrations(event)) == 1


# @story: SCRUM-54
# @ac: 1
@pytest.mark.parametrize(
    "moment,allowed",
    [("2026-12-01T09:59", True), ("2026-12-01T10:00", False), ("2026-12-01T10:01", False)],
)
def test_registration_closes_at_the_closing_time(client, monkeypatch, moment, allowed):
    # Closes at 10:00: one minute before is open, the closing time and later are closed.
    at(moment, monkeypatch)
    event = concert(name="Close Talk", capacity=50, closes="2026-12-01T10:00")
    login(client)

    reply = register(client, event)

    if allowed:
        assert reply.status_code == 201
        assert len(registrations(event)) == 1
    else:
        assert refusal(reply) == (409, "Registration for this event has closed.")
        assert registrations(event) == []


# @story: SCRUM-54
# @ac: 1, 6
@pytest.mark.parametrize(
    "status,enabled",
    [("Confirmed", False), ("Cancelled", True), ("Completed", True)],
)
def test_an_event_not_open_for_registration_is_refused(client, status, enabled):
    # An event the Attendee could have seen listed: registration turned off, or the
    # event Cancelled or Completed, after the page opened.
    event = concert(status=status, enabled=enabled)
    login(client)

    reply = register(client, event)

    assert reply.get_json() == {"message": "This event is not open for registration."}
    assert reply.status_code == 409
    assert registrations(event) == []


# @story: SCRUM-54
# @ac: 5, 6
@pytest.mark.parametrize("status", ["Draft", "Submitted", "Approved", "Planning", "Safety Check", "Rejected"])
def test_an_event_an_attendee_could_never_have_seen_is_not_found(client, status):
    # Answered like a missing event: a write never confirms a record the account
    # may not read (permissions.md), even with registration on.
    event = concert(status=status, enabled=True)
    login(client)

    reply = register(client, event)

    assert reply.get_json() == {"message": "Event not found."}
    assert reply.status_code == 404
    assert registrations(event) == []


# @story: SCRUM-54
# @ac: 6
def test_a_missing_event_is_not_found(client):
    login(client)

    reply = client.post("/api/registration/events/99999/register")

    assert refusal(reply) == (404, "Event not found.")
    assert db.session.query(Registration).count() == 0


# --- AC2: capacity -------------------------------------------------------------


# @story: SCRUM-54
# @ac: 2
def test_the_last_place_can_be_taken_and_then_the_event_is_full(client):
    event = concert(capacity=2)
    make_attendee("att54a")
    make_attendee("att54b")
    make_registration(event=event, attendee="att54a")
    login(client)

    taken = register(client, event)
    login(client, "att54b")
    one_over = register(client, event)

    assert taken.status_code == 201
    assert refusal(one_over) == (409, "This event is full.")
    assert len(registrations(event)) == 2
    assert listed(client, event)["state"] == "full"


# @story: SCRUM-54
# @ac: 2, 3
def test_a_withdrawn_registration_neither_counts_nor_blocks(client):
    event = concert(capacity=1)
    make_attendee("att54a")
    make_registration(event=event, attendee="att54a", status="Withdrawn")
    make_registration(event=event, attendee="att1", status="Withdrawn")
    login(client)

    assert listed(client, event)["state"] == "register"
    reply = register(client, event)

    assert reply.status_code == 201
    # Registering again makes a new row; the Withdrawn one stays (SCRUM-55's model).
    assert len(registrations(event)) == 1
    assert len(registrations(event, "Withdrawn")) == 2


# @story: SCRUM-54
# @ac: 2
def test_the_places_are_counted_under_the_event_lock(client, monkeypatch):
    # att54b takes the last place while att1's request waits for the lock: the
    # count is read after the lock, so att1 is refused, never let in over capacity.
    event = concert(capacity=1)
    make_attendee("att54b")
    real_lock = services.lock_event

    def lock_after_the_other_attendee(event_id):
        make_registration(event=event, attendee="att54b")
        return real_lock(event_id)

    monkeypatch.setattr(services, "lock_event", lock_after_the_other_attendee)
    login(client)

    reply = register(client, event)

    assert refusal(reply) == (409, "This event is full.")
    assert [row.attendee.username for row in registrations(event)] == ["att54b"]


# --- AC3: once only ----------------------------------------------------------------


# @story: SCRUM-54
# @ac: 3, 6
def test_an_attendee_cannot_register_twice(client):
    event = concert()
    make_registration(event=event, attendee="att1")
    login(client)

    reply = register(client, event)

    assert refusal(reply) == (409, "You are already registered for this event.")
    assert len(registrations(event)) == 1


# --- AC6: which refusal comes first ---------------------------------------------------


# @story: SCRUM-54
# @ac: 6
def test_not_open_comes_before_closed(client, monkeypatch):
    at("2026-12-10T08:00", monkeypatch)
    event = concert(enabled=False)
    login(client)

    assert refusal(register(client, event)) == (409, "This event is not open for registration.")


# @story: SCRUM-54
# @ac: 6
def test_closed_comes_before_already_registered_and_full(client, monkeypatch):
    at("2026-12-10T08:00", monkeypatch)
    event = concert(capacity=1)
    make_registration(event=event, attendee="att1")
    login(client)

    assert refusal(register(client, event)) == (409, "Registration for this event has closed.")


# @story: SCRUM-54
# @ac: 6
def test_already_registered_comes_before_full(client):
    event = concert(capacity=1)
    make_registration(event=event, attendee="att1")
    login(client)

    assert refusal(register(client, event)) == (409, "You are already registered for this event.")


# --- Who may register ----------------------------------------------------------------


# @story: SCRUM-54
# @ac: 1
@pytest.mark.parametrize(
    "username", ["org1", "coord1", "lead1", "venue1", "tech1", "safety1", "multi1"],
)
def test_only_an_attendee_may_register(client, username):
    event = concert()
    login(client, username)

    reply = register(client, event)

    assert refusal(reply) == (403, "You do not have permission to perform this action.")
    assert registrations(event) == []


# @story: SCRUM-54
# @ac: 1
def test_registering_needs_a_login(client):
    event = concert()

    reply = register(client, event)

    assert reply.status_code == 401
    assert registrations(event) == []


# --- The list: the account's state ------------------------------------------------------


# @story: SCRUM-54
# @ac: 1, 2, 3
@pytest.mark.parametrize(
    "registered,moment,others,state",
    [
        (False, "2026-12-01T09:00", 0, "register"),
        (True, "2026-12-01T09:00", 0, "registered"),
        (False, "2026-12-09T23:59", 0, "closed"),
        (False, "2026-12-01T09:00", 2, "full"),
        # Several at once: Registered, then Registration closed, then Full.
        (True, "2026-12-09T23:59", 0, "registered"),
        (True, "2026-12-01T09:00", 1, "registered"),
        (False, "2026-12-09T23:59", 2, "closed"),
        (True, "2026-12-09T23:59", 1, "registered"),
    ],
)
def test_each_event_says_the_accounts_state(client, monkeypatch, registered, moment, others, state):
    at(moment, monkeypatch)
    event = concert(capacity=2)
    for n in range(others):
        make_registration(event=event, attendee=make_attendee(f"other{n}").username)
    if registered:
        make_registration(event=event, attendee="att1")
    login(client)

    assert listed(client, event)["state"] == state


# @story: SCRUM-54
# @ac: 1
def test_the_list_holds_only_confirmed_events_with_registration_on(client):
    shown = concert(name="Shown")
    hidden = [concert(name="Off", enabled=False), concert(name="Planned", status="Planning")]
    login(client)

    ids = [row["id"] for row in client.get("/api/registration/events").get_json()]

    assert shown.id in ids
    assert not {event.id for event in hidden} & set(ids)


# @story: SCRUM-54
# @ac: 5
def test_the_list_gives_only_public_fields(client):
    event = concert()
    make_booking(event=event, venue=make_venue(name="Hall A"), status="Approved")
    login(client)

    row = listed(client, event)

    assert row == {
        "id": event.id,
        "name": "Reg Concert",
        "purpose": "Evening concert",
        "status": "Confirmed",
        "date": "2026-12-10",
        "start_time": "19:00",
        "end_time": "21:00",
        "venues": "Hall A",
        "state": "register",
    }
    assert "Internal" not in str(client.get("/api/registration/events").get_json())


# @story: SCRUM-54
# @ac: 4, 5
def test_venues_come_from_approved_bookings_only(client):
    event = concert()
    for name, status in [("Zeta Hall", "Approved"), ("Alpha Room", "Approved"), ("Requested Room", "Requested"),
                         ("Rejected Room", "Rejected"), ("Cancelled Room", "Cancelled"),
                         ("Withdrawn Room", "Withdrawn")]:
        make_booking(event=event, venue=make_venue(name=name), status=status)
    login(client)

    assert listed(client, event)["venues"] == "Alpha Room, Zeta Hall"
    assert register(client, event).get_json()["venues"] == "Alpha Room, Zeta Hall"


# @story: SCRUM-54
# @ac: 1
def test_a_coordinator_sees_the_list_but_cannot_register(client):
    event = concert()
    login(client, "coord1")

    assert listed(client, event)["state"] == "register"
    assert register(client, event).status_code == 403
