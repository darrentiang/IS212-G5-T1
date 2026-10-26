"""SCRUM-46: the Event Organiser sees their event's status and, once it is
Confirmed, its Approved arrangements."""

from datetime import datetime, timezone

import pytest

from db import db
from factories import (
    account,
    make_booking,
    make_equipment_requirement,
    make_event,
    make_hold,
    make_venue,
)
from models import EquipmentType, SafetyDecision


def login(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def detail(client, event):
    return client.get(f"/api/requests/{event.id}")


def event_in(status, name="Gala", **fields):
    return make_event(
        name=name, status=status, date="2027-03-12", start_time="10:00", end_time="12:00", **fields
    )


def projector(event, quantity=2, status="Approved"):
    kind = db.session.query(EquipmentType).filter_by(name="Projector").one()
    return make_equipment_requirement(event=event, equipment=kind, quantity=quantity, status=status)


# --- AC1 -------------------------------------------------------------------


# @story: SCRUM-46
# @ac: 1
def test_organiser_sees_status_details_and_assigned_coordinator(client):
    event = event_in("Submitted", attendance=40, assigned_coordinator=account("coord1"))
    login(client, "org1")

    body = detail(client, event).get_json()

    assert (body["status"], body["name"], body["attendance"]) == ("Submitted", "Gala", 40)
    assert body["assigned_coordinator"] == "coord1"


# @story: SCRUM-46
# @ac: 1
def test_event_without_a_coordinator_shows_none_assigned(client):
    event = event_in("Submitted")
    login(client, "org1")

    assert detail(client, event).get_json()["assigned_coordinator"] is None


# --- AC2 -------------------------------------------------------------------


@pytest.mark.parametrize("status", ["Confirmed", "Completed"])
# @story: SCRUM-46
# @ac: 2
def test_confirmed_or_completed_event_lists_its_approved_arrangements(client, status):
    event = event_in(status)
    room = make_venue(name="Seminar Room 1", location="Block A Level 2")
    make_booking(event=event, venue=room, status="Approved")
    needed = projector(event, quantity=2)
    login(client, "org1")

    arrangements = detail(client, event).get_json()["arrangements"]

    assert arrangements == {
        "in_progress": False,
        "venue_bookings": [
            {
                "id": event.booking_requests[0].id,
                "venue": "Seminar Room 1",
                "location": "Block A Level 2",
                "date": "2027-03-12",
                "start_time": "10:00",
                "end_time": "12:00",
            }
        ],
        "equipment": [{"id": needed.id, "equipment_type": "Projector", "quantity": 2}],
    }


# @story: SCRUM-46
# @ac: 2
def test_every_approved_booking_is_listed_oldest_first(client):
    event = event_in("Confirmed")
    first = make_booking(event=event, venue=make_venue(name="Room A"), status="Approved")
    second = make_booking(event=event, venue=make_venue(name="Room B"), status="Approved")
    login(client, "org1")

    listed = detail(client, event).get_json()["arrangements"]["venue_bookings"]

    assert [row["id"] for row in listed] == [first.id, second.id]
    assert [row["venue"] for row in listed] == ["Room A", "Room B"]


# @story: SCRUM-46
# @ac: 2, 5
def test_only_approved_bookings_and_equipment_are_listed(client):
    event = event_in("Confirmed")
    make_booking(event=event, venue=make_venue(name="Kept"), status="Approved")
    for status in ("Requested", "Rejected", "Withdrawn", "Cancelled"):
        make_booking(event=event, venue=make_venue(name=f"Not {status}"), status=status)
    kept = projector(event, quantity=2, status="Approved")
    other = db.session.query(EquipmentType).filter_by(name="Microphones").one()
    make_equipment_requirement(event=event, equipment=other, quantity=3, status="Requested")
    login(client, "org1")

    arrangements = detail(client, event).get_json()["arrangements"]

    assert [row["venue"] for row in arrangements["venue_bookings"]] == ["Kept"]
    assert arrangements["equipment"] == [{"id": kept.id, "equipment_type": "Projector", "quantity": 2}]


# --- AC3 -------------------------------------------------------------------


@pytest.mark.parametrize("status", ["Submitted", "Approved", "Planning", "Safety Check"])
# @story: SCRUM-46
# @ac: 3
def test_event_still_being_arranged_says_so_and_lists_none(client, status):
    event = event_in(status)
    make_booking(event=event, venue=make_venue(name="Seminar Room 1"), status="Approved")
    projector(event)
    login(client, "org1")

    assert detail(client, event).get_json()["arrangements"] == {"in_progress": True}


# @story: SCRUM-46
# @ac: 3
def test_event_returned_from_confirmed_to_planning_hides_its_arrangements_again(client):
    event = event_in("Confirmed")
    make_booking(event=event, venue=make_venue(name="Seminar Room 1"), status="Approved")
    login(client, "org1")
    assert detail(client, event).get_json()["arrangements"]["in_progress"] is False

    event.status = "Planning"
    db.session.commit()

    assert detail(client, event).get_json()["arrangements"] == {"in_progress": True}


# --- AC4 -------------------------------------------------------------------


@pytest.mark.parametrize("status", ["Draft", "Rejected", "Cancelled"])
# @story: SCRUM-46
# @ac: 4
def test_draft_rejected_or_cancelled_event_lists_no_arrangements(client, status):
    event = event_in(status)
    make_booking(event=event, venue=make_venue(name="Seminar Room 1"), status="Cancelled")
    projector(event)
    login(client, "org1")

    assert detail(client, event).get_json()["arrangements"] is None


# --- AC5 -------------------------------------------------------------------


# @story: SCRUM-46
# @ac: 5
def test_organiser_never_receives_internal_planning_information(client):
    event = event_in(
        "Planning", assigned_coordinator=account("coord1"), coordinator_notes="Call the venue manager"
    )
    db.session.add(
        SafetyDecision(
            event_request=event,
            decision="Changes requested",
            reason="Add a second exit",
            notes={"emergency-access": "Needs two exits"},
            areas=["venue_arrangements"],
            decided_by=account("safety1"),
            decided_at=datetime.now(timezone.utc),
        )
    )
    db.session.commit()
    login(client, "org1")

    body = detail(client, event).get_json()

    for internal in ("coordinator_notes", "safety_decisions", "requested_changes", "safety_check"):
        assert internal not in body


# @story: SCRUM-46
# @ac: 5
def test_organiser_cannot_list_booking_requests_or_holds(client):
    event = event_in("Confirmed")
    room = make_venue(name="Seminar Room 1")
    make_booking(event=event, venue=room, status="Rejected")
    make_hold(event=event, venue=room, expires_at="2027-03-01T10:00", status="Released")
    login(client, "org1")

    assert client.get(f"/api/requests/{event.id}/bookings").status_code == 403
    assert client.get(f"/api/requests/{event.id}/holds").status_code == 403


# --- AC6 -------------------------------------------------------------------


# @story: SCRUM-46
# @ac: 6
def test_another_organiser_cannot_open_the_event_or_its_arrangements(client):
    event = event_in("Confirmed")
    make_booking(event=event, venue=make_venue(name="Seminar Room 1"), status="Approved")
    login(client, "org2")

    reply = detail(client, event)

    assert reply.status_code == 403
    assert reply.get_json() == {"message": "You do not have permission to perform this action."}


# @story: SCRUM-46
# @ac: 1, 2
def test_arrangements_are_for_the_organiser_only(client):
    event = event_in("Confirmed", assigned_coordinator=account("coord1"))
    make_booking(event=event, venue=make_venue(name="Seminar Room 1"), status="Approved")
    login(client, "coord1")

    assert "arrangements" not in detail(client, event).get_json()
