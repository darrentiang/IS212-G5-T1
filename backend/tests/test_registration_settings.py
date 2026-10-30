"""SCRUM-92: the assigned Event Coordinator sets an event's registration."""

from datetime import datetime

import pytest

import clock
from db import db
from factories import account, make_attendee, make_event, make_registration
from models import EventChange, EventRequest

NOW = datetime(2026, 12, 1, 9, 0)  # Singapore; the event below starts 05 Dec 18:00
START = datetime(2026, 12, 5, 18, 0)


@pytest.fixture(autouse=True)
def pinned_clock(monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)


def login(client, username="coord1"):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def gala(status="Planning", coordinator="coord1", **fields):
    """Reg Gala: 05 Dec 2026, 18:00-21:00, attendance 120, registration off."""
    values = dict(
        name="Reg Gala", status=status, date="2026-12-05", start_time="18:00", end_time="21:00",
        attendance=120, purpose="Gala", description="Gala night",
        equipment_requirements="None", registration_needs="Open to all",
    )
    values.update(fields)
    if coordinator:
        values["assigned_coordinator"] = account(coordinator)
    return make_event(**values)


def put(client, event, body):
    return client.put(f"/api/requests/{event.id}/registration", json=body)


def on(capacity="", closing_date="", closing_time=""):
    return {"enabled": True, "capacity": capacity, "closing_date": closing_date,
            "closing_time": closing_time}


def off():
    return {"enabled": False, "capacity": "", "closing_date": "", "closing_time": ""}


def stored(event):
    db.session.expire_all()
    row = db.session.get(EventRequest, event.id)
    return (row.registration_enabled, row.registration_capacity, row.registration_closes_at)


def registered(event, count, withdrawn=0):
    """count Registered and withdrawn Withdrawn registrations, each by its own Attendee."""
    for index in range(count + withdrawn):
        attendee = make_attendee(f"att92_{event.id}_{index}").username
        make_registration(event=event, attendee=attendee,
                          status="Registered" if index < count else "Withdrawn")


# --- AC1, AC5: statuses ----------------------------------------------------


# @story: SCRUM-92
# @ac: 1
@pytest.mark.parametrize("status", ["Approved", "Planning", "Safety Check", "Confirmed"])
def test_assigned_coordinator_sets_registration_in_each_allowed_status(client, status):
    event = gala(status=status)
    login(client)

    reply = put(client, event, on(capacity=80, closing_date="2026-12-04", closing_time="23:59"))

    assert reply.status_code == 200
    assert reply.get_json()["registration"] == {
        "enabled": True, "capacity": 80, "closes_at": "2026-12-04T23:59", "can_edit": True,
    }
    assert stored(event) == (True, 80, datetime(2026, 12, 4, 23, 59))


# @story: SCRUM-92
# @ac: 1, 5
@pytest.mark.parametrize("status", ["Submitted", "Rejected", "Completed", "Cancelled"])
def test_registration_cannot_be_set_outside_the_allowed_statuses(client, status):
    event = gala(status=status)
    login(client)

    reply = put(client, event, on(capacity=80))

    assert reply.status_code == 409
    assert reply.get_json()["message"] == (
        "Registration can be set only while the event is Approved, Planning, Safety Check or Confirmed."
    )
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 5
def test_a_draft_answers_not_found_as_a_write(client):
    event = gala(status="Draft")
    login(client)

    reply = put(client, event, on())

    assert reply.status_code == 404
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 1, 5
@pytest.mark.parametrize(
    "status,can_edit",
    [("Submitted", False), ("Approved", True), ("Planning", True), ("Safety Check", True),
     ("Confirmed", True), ("Completed", False), ("Cancelled", False)],
)
def test_detail_says_whether_the_assigned_coordinator_may_edit(client, status, can_edit):
    event = gala(status=status)
    login(client)

    body = client.get(f"/api/requests/{event.id}").get_json()

    assert body["registration"] == {
        "enabled": False, "capacity": None, "closes_at": None, "can_edit": can_edit,
    }


# --- AC5: who --------------------------------------------------------------


# @story: SCRUM-92
# @ac: 5
def test_an_unassigned_coordinator_gets_not_found(client):
    event = gala(coordinator="coord1")
    login(client, "coord2")

    reply = put(client, event, on(capacity=80))

    assert reply.status_code == 404
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 5
@pytest.mark.parametrize("username", ["org1", "lead1", "venue1", "tech1", "safety1", "att1"])
def test_roles_without_registration_manage_are_refused(client, username):
    event = gala()
    login(client, username)

    reply = put(client, event, on(capacity=80))

    assert reply.status_code == 403
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 5
def test_not_logged_in_is_refused(client):
    event = gala()

    assert put(client, event, on()).status_code == 401
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 5
def test_an_event_that_does_not_exist_answers_not_found(client):
    login(client)

    reply = client.put("/api/requests/999999/registration", json=on())

    assert reply.status_code == 404


# @story: SCRUM-92
# @ac: 5
@pytest.mark.parametrize("username", ["multi1", "leadcoord1"])
def test_a_multi_role_account_sets_registration_only_when_assigned(client, username):
    mine = gala(coordinator=username)
    theirs = gala(coordinator="coord1", name="Other Gala")
    login(client, username)

    assert put(client, mine, on(capacity=10)).status_code == 200
    assert put(client, theirs, on(capacity=10)).status_code == 404
    assert stored(mine)[:2] == (True, 10)
    assert stored(theirs) == (False, None, None)


# @story: SCRUM-92
# @ac: 5
@pytest.mark.parametrize("username", ["org1", "lead1"])
def test_only_the_assigned_coordinator_reads_the_settings(client, username):
    event = gala(registration_enabled=True, registration_capacity=50,
                 registration_closes_at=START)
    login(client, username)

    reply = client.get(f"/api/requests/{event.id}")

    assert reply.status_code == 200
    assert "registration" not in reply.get_json()


# --- AC2, AC3: defaults ----------------------------------------------------


# @story: SCRUM-92
# @ac: 2, 3
def test_turning_on_with_blanks_uses_attendance_and_the_start(client):
    event = gala(attendance=120)
    login(client)

    reply = put(client, event, on())

    assert reply.status_code == 200
    assert stored(event) == (True, 120, START)


# @story: SCRUM-92
# @ac: 2
def test_the_capacity_default_is_the_attendance_at_that_moment(client):
    event = gala(attendance=120)
    event.attendance = 95
    db.session.commit()
    login(client)

    put(client, event, on())

    assert stored(event)[1] == 95


# @story: SCRUM-92
# @ac: 2, 3
def test_values_sent_when_turning_on_replace_the_defaults(client):
    event = gala(attendance=120)
    login(client)

    put(client, event, on(capacity=60, closing_date="2026-12-03", closing_time="12:00"))

    assert stored(event) == (True, 60, datetime(2026, 12, 3, 12, 0))


# @story: SCRUM-92
# @ac: 2, 3
def test_defaults_do_not_apply_on_a_later_save_while_on(client):
    # Stored 60 and 03 Dec 12:00; attendance 120 and the start 05 Dec 18:00 would be the defaults.
    event = gala(attendance=120, registration_enabled=True, registration_capacity=60,
                 registration_closes_at=datetime(2026, 12, 3, 12, 0))
    login(client)

    reply = put(client, event, on())

    assert reply.status_code == 200
    assert stored(event) == (True, 60, datetime(2026, 12, 3, 12, 0))


# @story: SCRUM-92
# @ac: 2, 3
def test_defaults_do_not_apply_on_a_save_that_keeps_registration_off(client):
    event = gala()
    login(client)

    reply = put(client, event, off())

    assert reply.status_code == 200
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 2, 3, 4
def test_turning_off_and_on_again_keeps_the_values(client):
    event = gala(attendance=120, registration_enabled=True, registration_capacity=60,
                 registration_closes_at=datetime(2026, 12, 3, 12, 0))
    login(client)

    put(client, event, off())
    assert stored(event) == (False, 60, datetime(2026, 12, 3, 12, 0))
    put(client, event, on())

    assert stored(event) == (True, 60, datetime(2026, 12, 3, 12, 0))


# --- AC2: capacity ---------------------------------------------------------


# @story: SCRUM-92
# @ac: 2
@pytest.mark.parametrize("capacity", [0, -1, "0", 1.5, "1.5", "abc", True])
def test_capacity_must_be_a_whole_number_of_at_least_one(client, capacity):
    event = gala()
    login(client)

    reply = put(client, event, on(capacity=capacity))

    assert reply.status_code == 400
    assert reply.get_json()["message"] == "Capacity must be a whole number of at least 1."
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 2
@pytest.mark.parametrize("capacity", [1, "1"])
def test_a_capacity_of_one_is_accepted(client, capacity):
    event = gala()
    login(client)

    assert put(client, event, on(capacity=capacity)).status_code == 200
    assert stored(event)[1] == 1


# @story: SCRUM-92
# @ac: 2
def test_capacity_cannot_be_below_the_registered_count(client):
    # 3 Registered and 1 Withdrawn: the Withdrawn one does not count, so 3 is the floor.
    event = gala(status="Confirmed", registration_enabled=True, registration_capacity=50,
                 registration_closes_at=START)
    registered(event, 3, withdrawn=1)
    login(client)

    reply = put(client, event, on(capacity=2))

    assert reply.status_code == 409
    assert reply.get_json()["message"] == "Capacity cannot be less than the 3 people registered."
    assert stored(event) == (True, 50, START)


# @story: SCRUM-92
# @ac: 2
def test_capacity_below_one_registered_person_says_person(client):
    # 1 Registered and 1 Withdrawn: the floor is 1, so the message is singular.
    # Capacity 0 would be refused first as not a whole number of at least 1, so
    # this reaches the count rule through a stored capacity of 0 left in place.
    event = gala(registration_enabled=True, registration_capacity=0, registration_closes_at=START)
    registered(event, 1, withdrawn=1)
    login(client)

    reply = put(client, event, on())

    assert reply.status_code == 409
    assert reply.get_json()["message"] == "Capacity cannot be less than the 1 person registered."
    assert stored(event) == (True, 0, START)


# @story: SCRUM-92
# @ac: 2
def test_capacity_equal_to_the_registered_count_is_accepted(client):
    event = gala(status="Confirmed", registration_enabled=True, registration_capacity=50,
                 registration_closes_at=START)
    registered(event, 3, withdrawn=1)
    login(client)

    reply = put(client, event, on(capacity=3))

    assert reply.status_code == 200
    assert stored(event) == (True, 3, START)


# @story: SCRUM-92
# @ac: 2
def test_registrations_for_another_event_do_not_count(client):
    event = gala(registration_enabled=True, registration_capacity=50, registration_closes_at=START)
    other = gala(name="Other Gala", registration_enabled=True, registration_capacity=50,
                 registration_closes_at=START)
    registered(other, 3)
    login(client)

    assert put(client, event, on(capacity=1)).status_code == 200
    assert stored(event)[1] == 1


# --- AC3: closing time -----------------------------------------------------


# @story: SCRUM-92
# @ac: 3
def test_closing_exactly_at_the_start_is_accepted(client):
    event = gala()
    login(client)

    reply = put(client, event, on(capacity=120, closing_date="2026-12-05", closing_time="18:00"))

    assert reply.status_code == 200
    assert stored(event) == (True, 120, START)


# @story: SCRUM-92
# @ac: 3
@pytest.mark.parametrize("day,time", [("2026-12-05", "18:01"), ("2026-12-06", "09:00")])
def test_closing_after_the_start_is_refused(client, day, time):
    event = gala()
    login(client)

    reply = put(client, event, on(capacity=120, closing_date=day, closing_time=time))

    assert reply.status_code == 400
    assert reply.get_json()["message"] == "Registration cannot close after the event starts."
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 3
@pytest.mark.parametrize(
    "day,time", [("2026-12-04", ""), ("", "12:00"), ("2026-12-04", None), ("  ", "12:00")]
)
def test_the_closing_time_needs_both_a_date_and_a_time(client, day, time):
    event = gala()
    login(client)

    reply = put(client, event, on(capacity=100, closing_date=day, closing_time=time))

    assert reply.status_code == 400
    assert reply.get_json()["message"] == "The closing time needs both a date and a time."
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 3
@pytest.mark.parametrize("day,time", [("2026-13-01", "12:00"), ("2026-12-04", "25:00"),
                                      ("04/12/2026", "12:00")])
def test_an_invalid_closing_date_or_time_is_refused(client, day, time):
    event = gala()
    login(client)

    reply = put(client, event, on(capacity=100, closing_date=day, closing_time=time))

    assert reply.status_code == 400
    assert reply.get_json()["message"] == "The closing date and time must be a valid date and time."
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 3
@pytest.mark.parametrize("time", ["09:00", "08:59"])
def test_a_closing_time_at_or_before_now_is_accepted(client, time):
    # Now is 01 Dec 09:00: registration is simply closed (SCRUM-54 enforces it).
    event = gala()
    login(client)

    reply = put(client, event, on(capacity=100, closing_date="2026-12-01", closing_time=time))

    assert reply.status_code == 200
    assert stored(event)[2] == datetime(2026, 12, 1, int(time[:2]), int(time[3:]))


# --- AC4: turning off ------------------------------------------------------


# @story: SCRUM-92
# @ac: 4
def test_registration_cannot_be_turned_off_while_people_are_registered(client):
    event = gala(status="Confirmed", registration_enabled=True, registration_capacity=50,
                 registration_closes_at=START)
    registered(event, 3, withdrawn=1)
    login(client)

    reply = put(client, event, off())

    assert reply.status_code == 409
    assert reply.get_json()["message"] == (
        "Registration cannot be turned off while 3 people are registered."
    )
    assert stored(event) == (True, 50, START)


# @story: SCRUM-92
# @ac: 4
def test_turning_off_with_one_registered_person_says_person_is(client):
    event = gala(registration_enabled=True, registration_capacity=30, registration_closes_at=START)
    registered(event, 1, withdrawn=1)
    login(client)

    reply = put(client, event, off())

    assert reply.status_code == 409
    assert reply.get_json()["message"] == (
        "Registration cannot be turned off while 1 person is registered."
    )
    assert stored(event) == (True, 30, START)


# @story: SCRUM-92
# @ac: 4
def test_registration_turns_off_when_only_withdrawn_registrations_exist(client):
    event = gala(registration_enabled=True, registration_capacity=30, registration_closes_at=START)
    registered(event, 0, withdrawn=1)
    login(client)

    reply = put(client, event, off())

    assert reply.status_code == 200
    assert reply.get_json()["registration"]["enabled"] is False
    assert stored(event) == (False, 30, START)


# --- AC5: a refused save changes nothing -----------------------------------


# @story: SCRUM-92
# @ac: 5
@pytest.mark.parametrize(
    "body",
    [None, [], {}, {"enabled": "yes"}, {"enabled": 1}],
)
def test_registration_must_be_turned_on_or_off(client, body):
    event = gala()
    login(client)

    reply = put(client, event, body)

    assert reply.status_code == 400
    assert reply.get_json()["message"] == "Registration must be turned on or off."
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 5
def test_a_refused_save_changes_none_of_the_three_values(client):
    # Capacity is valid and would be saved alone; the closing time is refused, so neither is.
    event = gala(registration_enabled=True, registration_capacity=50,
                 registration_closes_at=datetime(2026, 12, 4, 12, 0))
    login(client)

    reply = put(client, event, {"enabled": False, "capacity": 70, "closing_date": "2026-12-06",
                                "closing_time": "10:00"})

    assert reply.status_code == 400
    assert stored(event) == (True, 50, datetime(2026, 12, 4, 12, 0))


# --- AC3: SCRUM-47 edits move the closing time -----------------------------


def edit(client, event, body):
    return client.patch(f"/api/requests/{event.id}", json=body)


# @story: SCRUM-92
# @ac: 3
@pytest.mark.parametrize(
    "change,new_start",
    [({"date": "2026-12-04"}, datetime(2026, 12, 4, 18, 0)),
     ({"start_time": "17:00"}, datetime(2026, 12, 5, 17, 0))],
)
def test_moving_the_start_before_the_closing_time_moves_it_to_the_new_start(
    client, change, new_start
):
    event = gala(registration_enabled=True, registration_capacity=120,
                 registration_closes_at=START)
    login(client)

    reply = edit(client, event, change)

    assert reply.status_code == 200
    assert reply.get_json()["registration"]["closes_at"] == new_start.strftime("%Y-%m-%dT%H:%M")
    assert stored(event) == (True, 120, new_start)
    # Only the edit's own line: the closing time is never in the change record.
    fields = [row.field for row in db.session.query(EventChange).filter_by(event_request_id=event.id)]
    assert fields == list(change)


# @story: SCRUM-92
# @ac: 3
@pytest.mark.parametrize(
    "closes_at,change",
    [(START, {"date": "2026-12-06"}),  # the start moves later
     (datetime(2026, 12, 3, 12, 0), {"date": "2026-12-04"}),  # still before the new start
     (START, {"end_time": "22:00"}),  # the start does not move
     (START, {"name": "Reg Gala renamed"})],  # not a period change
)
def test_an_edit_that_leaves_the_closing_time_before_the_start_leaves_it(client, closes_at, change):
    event = gala(registration_enabled=True, registration_capacity=120,
                 registration_closes_at=closes_at)
    login(client)

    assert edit(client, event, change).status_code == 200
    assert stored(event) == (True, 120, closes_at)


# @story: SCRUM-92
# @ac: 3
def test_an_edit_with_no_closing_time_stored_leaves_it_blank(client):
    event = gala()
    login(client)

    assert edit(client, event, {"date": "2026-12-04"}).status_code == 200
    assert stored(event) == (False, None, None)


# @story: SCRUM-92
# @ac: 3
def test_a_refused_edit_leaves_the_closing_time(client):
    # Safety Check refuses a significant change (SCRUM-47), so nothing moves.
    event = gala(status="Safety Check", registration_enabled=True, registration_capacity=120,
                 registration_closes_at=START)
    login(client)

    assert edit(client, event, {"date": "2026-12-04"}).status_code == 409
    assert stored(event) == (True, 120, START)
