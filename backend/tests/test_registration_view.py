"""SCRUM-57: the Event Organiser who created an event and its assigned Event
Coordinator see who has registered and how many places remain."""

from datetime import datetime

import pytest

from factories import account, make_attendee, make_event, make_registration

CLOSES = datetime(2026, 12, 9, 23, 59)


def login(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def gala(status="Confirmed", capacity=3, enabled=True, coordinator="coord1", **fields):
    """Count Gala: created by org1, 10 Dec 2026, 19:00-21:00."""
    values = dict(
        name="Count Gala", status=status, date="2026-12-10", start_time="19:00", end_time="21:00",
        purpose="Gala", description="Gala night", equipment_requirements="None",
        registration_needs="Open to all", registration_enabled=enabled,
        registration_capacity=capacity, registration_closes_at=CLOSES,
        assigned_coordinator=account(coordinator),
    )
    values.update(fields)
    return make_event(**values)


def registration(client, event):
    reply = client.get(f"/api/requests/{event.id}")
    assert reply.status_code == 200
    return reply.get_json().get("registration")


def staged(event):
    """att1 Registered 20 Nov 10:00, att57a Registered 21 Nov 11:30, att57b Withdrawn."""
    make_attendee("att57a")
    make_attendee("att57b")
    make_registration(event=event, attendee="att57a", registered_at=datetime(2026, 11, 21, 11, 30))
    make_registration(event=event, attendee="att1", registered_at=datetime(2026, 11, 20, 10, 0))
    make_registration(event=event, attendee="att57b", status="Withdrawn",
                      registered_at=datetime(2026, 11, 19, 9, 0))


ATTENDEES = [
    {"username": "att1", "registered_at": "2026-11-20T10:00:00Z"},
    {"username": "att57a", "registered_at": "2026-11-21T11:30:00Z"},
]


# --- AC1, AC2: the two who see it ------------------------------------------


# @story: SCRUM-57
# @ac: 1, 2
def test_the_assigned_coordinator_sees_the_counts_and_the_attendees(client):
    event = gala()
    staged(event)
    login(client, "coord1")

    assert registration(client, event) == {
        "enabled": True, "capacity": 3, "closes_at": "2026-12-09T23:59", "can_edit": True,
        "registered": 2, "places_remaining": 1, "attendees": ATTENDEES,
    }


# @story: SCRUM-57
# @ac: 1, 2
def test_the_creating_organiser_sees_the_same_read_only(client):
    event = gala()
    staged(event)
    login(client, "org1")

    assert registration(client, event) == {
        "enabled": True, "capacity": 3, "closes_at": "2026-12-09T23:59", "can_edit": False,
        "registered": 2, "places_remaining": 1, "attendees": ATTENDEES,
    }


# @story: SCRUM-57
# @ac: 2
def test_withdrawn_registrations_are_neither_listed_nor_counted(client):
    event = gala(capacity=5)
    make_attendee("att57b")
    make_registration(event=event, attendee="att57b", status="Withdrawn")
    make_registration(event=event, attendee="att1")
    login(client, "coord1")

    body = registration(client, event)

    assert (body["registered"], body["places_remaining"]) == (1, 4)
    assert [row["username"] for row in body["attendees"]] == ["att1"]


# @story: SCRUM-57
# @ac: 2
def test_an_attendee_who_withdrew_and_registered_again_is_listed_once(client):
    event = gala()
    make_registration(event=event, attendee="att1", status="Withdrawn",
                      registered_at=datetime(2026, 11, 1, 8, 0))
    make_registration(event=event, attendee="att1", registered_at=datetime(2026, 11, 2, 8, 0))
    login(client, "org1")

    body = registration(client, event)

    assert body["registered"] == 1
    assert body["attendees"] == [{"username": "att1", "registered_at": "2026-11-02T08:00:00Z"}]


# @story: SCRUM-57
# @ac: 2
def test_registrations_for_another_event_are_not_shown(client):
    event = gala()
    other = gala(name="Other Gala")
    make_registration(event=other, attendee="att1")
    login(client, "coord1")

    body = registration(client, event)

    assert (body["registered"], body["places_remaining"], body["attendees"]) == (0, 3, [])


# @story: SCRUM-57
# @ac: 1
def test_places_remaining_is_zero_when_the_event_is_full(client):
    event = gala(capacity=2, name="Full Gala")
    make_attendee("att57a")
    make_registration(event=event, attendee="att1")
    make_registration(event=event, attendee="att57a")
    login(client, "coord1")

    body = registration(client, event)

    assert (body["registered"], body["capacity"], body["places_remaining"]) == (2, 2, 0)


# @story: SCRUM-57
# @ac: 1
def test_places_remaining_never_goes_below_zero(client):
    # Registered rows above the capacity cannot be saved through the API; stored directly.
    event = gala(capacity=1)
    make_attendee("att57a")
    make_registration(event=event, attendee="att1")
    make_registration(event=event, attendee="att57a")
    login(client, "org1")

    body = registration(client, event)

    assert (body["registered"], body["places_remaining"]) == (2, 0)


# @story: SCRUM-57
# @ac: 1, 2
def test_nobody_registered_shows_zero_and_an_empty_list(client):
    event = gala(capacity=3)
    login(client, "org1")

    body = registration(client, event)

    assert (body["registered"], body["places_remaining"], body["attendees"]) == (0, 3, [])


# @story: SCRUM-57
# @ac: 2
def test_registrations_with_the_same_time_are_listed_by_id(client):
    event = gala(capacity=5)
    same = datetime(2026, 11, 20, 10, 0)
    for username in ("att57c", "att57a", "att57b"):
        make_attendee(username)
        make_registration(event=event, attendee=username, registered_at=same)
    make_registration(event=event, attendee="att1", registered_at=datetime(2026, 11, 19, 10, 0))
    login(client, "coord1")

    body = registration(client, event)

    assert [row["username"] for row in body["attendees"]] == ["att1", "att57c", "att57a", "att57b"]


# --- AC3: registration off -------------------------------------------------


# @story: SCRUM-57
# @ac: 3
@pytest.mark.parametrize("username,can_edit", [("coord1", True), ("org1", False)])
def test_registration_off_has_no_counts_and_no_list(client, username, can_edit):
    event = gala(status="Planning", enabled=False, capacity=3, name="Quiet Fair")
    make_registration(event=event, attendee="att1", status="Withdrawn")
    login(client, username)

    assert registration(client, event) == {
        "enabled": False, "capacity": 3, "closes_at": "2026-12-09T23:59", "can_edit": can_edit,
    }


# --- Cancelled and Completed: still shown, read-only -----------------------


# @story: SCRUM-57
# @ac: 1, 2
@pytest.mark.parametrize("status", ["Cancelled", "Completed"])
@pytest.mark.parametrize("username", ["coord1", "org1"])
def test_cancelled_and_completed_events_still_show_it_read_only(client, status, username):
    event = gala(status=status)
    staged(event)
    login(client, username)

    body = registration(client, event)

    assert body["can_edit"] is False
    assert (body["registered"], body["places_remaining"], body["attendees"]) == (2, 1, ATTENDEES)


# --- AC4: anyone else ------------------------------------------------------


# @story: SCRUM-57
# @ac: 4
@pytest.mark.parametrize("username", ["org2", "coord2", "venue1", "tech1", "att1"])
def test_anyone_who_cannot_open_the_event_is_refused(client, username):
    event = gala()
    staged(event)
    login(client, username)

    reply = client.get(f"/api/requests/{event.id}")

    assert reply.status_code == 403
    assert "registration" not in reply.get_json()


# @story: SCRUM-57
# @ac: 4
@pytest.mark.parametrize("username", ["lead1", "leadcoord1"])
def test_the_leads_read_only_view_has_no_registration(client, username):
    event = gala()
    staged(event)
    login(client, username)

    reply = client.get(f"/api/requests/{event.id}")

    assert reply.status_code == 200
    assert "registration" not in reply.get_json()


# @story: SCRUM-57
# @ac: 4
def test_the_safety_officer_reviewing_the_event_does_not_see_it(client):
    event = gala(status="Safety Check")
    staged(event)
    login(client, "safety1")

    reply = client.get(f"/api/requests/{event.id}")

    assert reply.status_code == 200
    assert "registration" not in reply.get_json()


# @story: SCRUM-57
# @ac: 4
def test_a_multi_role_account_sees_it_only_for_the_event_assigned_to_it(client):
    mine = gala(coordinator="multi1", name="Multi Gala")
    theirs = gala(coordinator="coord1")
    login(client, "multi1")

    assert registration(client, mine)["registered"] == 0
    assert client.get(f"/api/requests/{theirs.id}").status_code == 403
