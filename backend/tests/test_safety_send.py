"""SCRUM-53: Send an Event for Safety Check — the assigned Event Coordinator
sends a Planning event whose arrangements are approved; it moves to Safety
Check and records when it was sent.

Built on SCRUM-89's Safety Check status. Two parts of AC2 wait for stories
that are not merged and are pending here: the Venue unavailable marker
(SCRUM-82) and equipment requirements with their status (SCRUM-48, SCRUM-81).
These tests build their events with tests/factories.py.
"""

from datetime import datetime, timedelta, timezone

import pytest

from db import db
from factories import account, make_event
from models import EventRequest, Notification, Venue, VenueBookingRequest


def login_as(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def planning_event(name, **fields):
    """A Planning event assigned to coord1."""
    fields.setdefault("assigned_coordinator", account("coord1"))
    return make_event(
        name=name,
        status="Planning",
        date="2027-10-12",
        start_time="10:00",
        end_time="14:00",
        **fields,
    )


def add_booking(row, venue_name="Seminar Room 1", status="Approved"):
    booking = VenueBookingRequest(
        venue=db.session.query(Venue).filter_by(name=venue_name).one(),
        event_request=row,
        status=status,
        date=row.date,
        start_time=row.start_time,
        end_time=row.end_time,
        attendance=row.attendance,
        raised_by=account("coord1"),
        raised_at=datetime(2026, 10, 1, 9, 0),
    )
    db.session.add(booking)
    db.session.commit()
    return booking


def ready_event(name, **fields):
    row = planning_event(name, **fields)
    add_booking(row)
    return row


def stored(row):
    db.session.expire_all()
    return db.session.get(EventRequest, row.id)


def send(client, row):
    return client.post(f"/api/requests/{row.id}/send-for-safety-check", json={})


def notification_count():
    db.session.expire_all()
    return db.session.query(Notification).count()


# ---- AC1, AC4, AC8: the send itself ------------------------------------------


# @story: SCRUM-53
# @ac: 1, 4, 8
def test_a_ready_event_moves_to_safety_check_and_records_when_it_was_sent(client, app):
    row = ready_event("Send Gala")
    login_as(client, "coord1")
    before = datetime.now(timezone.utc).replace(tzinfo=None)

    reply = send(client, row)

    assert reply.status_code == 200
    body = reply.get_json()
    assert body["status"] == "Safety Check"
    assert body["status"] != "Confirmed"
    sent = stored(row).safety_check_at
    after = datetime.now(timezone.utc).replace(tzinfo=None)
    assert before - timedelta(seconds=5) <= sent <= after + timedelta(seconds=5)
    assert body["safety_check_at"].startswith(sent.isoformat()[:16])


# @story: SCRUM-53
# @ac: 4
def test_sending_changes_nothing_else_about_the_event_or_its_bookings(client, app):
    row = ready_event("Unchanged Gala", purpose="Open evening", attendance=75)
    booking_id = row.booking_requests[0].id
    login_as(client, "coord1")

    send(client, row)

    row = stored(row)
    assert (row.name, row.purpose, row.date, row.start_time, row.end_time, row.attendance) == (
        "Unchanged Gala",
        "Open evening",
        "2027-10-12",
        "10:00",
        "14:00",
        75,
    )
    assert row.assigned_coordinator.username == "coord1"
    assert db.session.get(VenueBookingRequest, booking_id).status == "Approved"


# @story: SCRUM-53
# @ac: 4
def test_a_sent_event_appears_in_the_safety_officers_list_with_its_sent_time(client, app):
    row = ready_event("Listed Gala")
    login_as(client, "coord1")
    send(client, row)

    login_as(client, "safety1")
    listed = client.get("/api/requests").get_json()
    mine = [item for item in listed if item["name"] == "Listed Gala"]
    assert len(mine) == 1
    assert mine[0]["status"] == "Safety Check"
    assert mine[0]["safety_check_at"] is not None
    detail = client.get(f"/api/requests/{row.id}").get_json()
    assert detail["safety_check"]["sent_at"] == mine[0]["safety_check_at"]


# @story: SCRUM-53
# @ac: 4
def test_the_event_sent_longest_ago_is_listed_first(client, app):
    first = ready_event("Sent First")
    second = ready_event("Sent Second")
    login_as(client, "coord1")
    send(client, first)
    send(client, second)

    login_as(client, "safety1")
    names = [item["name"] for item in client.get("/api/requests").get_json()]

    assert names.index("Sent First") < names.index("Sent Second")


# ---- AC1: only an event in Planning ------------------------------------------


# @story: SCRUM-53
# @ac: 1
@pytest.mark.parametrize("status", ["Submitted", "Approved", "Safety Check", "Confirmed", "Cancelled"])
def test_an_event_not_in_planning_is_refused_and_nothing_changes(client, app, status):
    row = make_event(
        name="Not Planning",
        status=status,
        date="2027-10-12",
        start_time="10:00",
        end_time="14:00",
        assigned_coordinator=account("coord1"),
    )
    add_booking(row)
    login_as(client, "coord1")
    before = notification_count()

    reply = send(client, row)

    assert reply.status_code == 409
    assert status in reply.get_json()["message"]
    assert stored(row).status == status
    assert stored(row).safety_check_at is None
    assert notification_count() == before


# @story: SCRUM-53
# @ac: 1
def test_a_second_send_of_the_same_event_is_refused_and_keeps_the_first_time(client, app):
    row = ready_event("Twice Gala")
    login_as(client, "coord1")
    assert send(client, row).status_code == 200
    first = stored(row).safety_check_at

    reply = send(client, row)

    assert reply.status_code == 409
    assert stored(row).status == "Safety Check"
    assert stored(row).safety_check_at == first


# ---- AC2, AC3: ready, and what is outstanding --------------------------------


# @story: SCRUM-53
# @ac: 2, 3
def test_an_event_with_no_booking_is_refused_and_the_missing_booking_is_listed(client, app):
    row = planning_event("Bare Gala")
    login_as(client, "coord1")

    reply = send(client, row)

    assert reply.status_code == 400
    message = reply.get_json()["message"]
    assert "No Approved venue booking" in message
    assert stored(row).status == "Planning"
    assert stored(row).safety_check_at is None


# @story: SCRUM-53
# @ac: 2, 3
def test_a_request_awaiting_a_decision_is_refused_and_listed_with_the_missing_booking(client, app):
    row = planning_event("Waiting Gala")
    add_booking(row, "Seminar Room 1", "Requested")
    login_as(client, "coord1")

    reply = send(client, row)

    assert reply.status_code == 400
    message = reply.get_json()["message"]
    assert "No Approved venue booking" in message
    assert "Seminar Room 1 is awaiting a decision" in message
    assert stored(row).status == "Planning"


# @story: SCRUM-53
# @ac: 2, 3
def test_every_outstanding_request_is_listed(client, app):
    row = ready_event("Many Waiting")
    add_booking(row, "Auditorium", "Requested")
    login_as(client, "coord1")

    message = send(client, row).get_json()["message"]

    assert "Auditorium is awaiting a decision" in message
    assert "Seminar Room 1" not in message


# @story: SCRUM-53
# @ac: 2
@pytest.mark.parametrize("status", ["Rejected", "Withdrawn"])
def test_a_rejected_or_withdrawn_request_does_not_block(client, app, status):
    row = ready_event("Past Requests")
    add_booking(row, "Auditorium", status)
    login_as(client, "coord1")

    assert send(client, row).status_code == 200
    assert stored(row).status == "Safety Check"


# @story: SCRUM-53
# @ac: 2
def test_two_approved_bookings_are_enough(client, app):
    row = ready_event("Two Venues")
    add_booking(row, "Auditorium", "Approved")
    login_as(client, "coord1")

    assert send(client, row).status_code == 200


# @story: SCRUM-53
# @ac: 2
def test_an_event_with_no_equipment_requirement_is_not_blocked(client, app):
    row = ready_event("No Equipment")
    login_as(client, "coord1")

    assert send(client, row).status_code == 200


# @story: SCRUM-53
# @ac: 2, 3
@pytest.mark.skip(reason="PENDING SCRUM-82: no Venue unavailable marker exists yet")
def test_an_approved_booking_marked_venue_unavailable_is_refused_and_listed(client, app):
    raise AssertionError("mark a booking Venue unavailable and prove the send is refused and lists it")


# @story: SCRUM-53
# @ac: 2, 3
@pytest.mark.skip(reason="PENDING SCRUM-48 and SCRUM-81: no equipment requirement exists yet")
def test_an_equipment_requirement_that_is_not_approved_is_refused_and_listed(client, app):
    raise AssertionError("record a Requested requirement and prove the send is refused and lists it")


# @story: SCRUM-53
# @ac: 2
@pytest.mark.skip(reason="PENDING SCRUM-48 and SCRUM-81: no equipment requirement exists yet")
def test_an_event_whose_equipment_requirements_are_all_approved_is_sent(client, app):
    raise AssertionError("approve every requirement and prove the event is sent")


# ---- AC5: sent again ---------------------------------------------------------


# @story: SCRUM-53
# @ac: 5
def test_an_event_returned_by_the_safety_officer_can_be_sent_again(client, app):
    row = ready_event("Loop Gala")
    login_as(client, "coord1")
    send(client, row)
    first = stored(row).safety_check_at
    login_as(client, "safety1")
    client.post(f"/api/requests/{row.id}/safety/reject", json={"reason": "Exit blocked"})
    assert stored(row).status == "Planning"

    login_as(client, "coord1")
    reply = send(client, row)

    assert reply.status_code == 200
    row = stored(row)
    assert row.status == "Safety Check"
    assert row.safety_check_at > first
    assert [item.decision for item in row.safety_decisions] == ["Rejected"]


# @story: SCRUM-53
# @ac: 5
def test_a_returned_event_is_held_to_the_same_rules_when_sent_again(client, app):
    row = ready_event("Loop Rules")
    login_as(client, "coord1")
    send(client, row)
    login_as(client, "safety1")
    client.post(f"/api/requests/{row.id}/safety/reject", json={"reason": "Exit blocked"})
    add_booking(stored(row), "Auditorium", "Requested")

    login_as(client, "coord1")
    reply = send(client, row)

    assert reply.status_code == 400
    assert stored(row).status == "Planning"


# ---- AC6: locked while in Safety Check ---------------------------------------


# @story: SCRUM-53
# @ac: 6
def test_a_venue_booking_request_cannot_be_added_while_the_event_is_in_safety_check(client, app):
    row = ready_event("Locked Gala")
    login_as(client, "coord1")
    send(client, row)
    venue_id = db.session.query(Venue).filter_by(name="Auditorium").one().id
    count = db.session.query(VenueBookingRequest).count()

    reply = client.post(f"/api/requests/{row.id}/bookings", json={"venue_id": venue_id})

    assert reply.status_code == 400
    assert db.session.query(VenueBookingRequest).count() == count


# ---- AC7: only the assigned Event Coordinator --------------------------------


# @story: SCRUM-53
# @ac: 7
@pytest.mark.parametrize("username", ["coord2", "multi1"])
def test_another_event_coordinator_is_refused_and_nothing_changes(client, app, username):
    row = ready_event("Other Gala")
    login_as(client, username)

    reply = send(client, row)

    assert reply.status_code == 404
    assert reply.get_json()["message"] == "Event request not found."
    assert stored(row).status == "Planning"
    assert stored(row).safety_check_at is None


# @story: SCRUM-53
# @ac: 7
@pytest.mark.parametrize("username", ["org1", "venue1", "tech1", "att1", "safety1"])
def test_an_account_that_is_not_an_event_coordinator_is_refused(client, app, username):
    row = ready_event("Org Gala")
    login_as(client, username)

    reply = send(client, row)

    assert reply.status_code == 403
    assert stored(row).status == "Planning"
    assert stored(row).safety_check_at is None


# @story: SCRUM-53
# @ac: 7
def test_sending_needs_login(client, app):
    row = ready_event("Anonymous Gala")

    assert send(client, row).status_code == 401
    assert stored(row).status == "Planning"


# @story: SCRUM-53
# @ac: 7
def test_an_event_with_no_assigned_coordinator_cannot_be_sent_by_anyone(client, app):
    row = ready_event("Unassigned Gala", assigned_coordinator=None)
    login_as(client, "coord1")

    assert send(client, row).status_code == 404
    assert stored(row).status == "Planning"


# @story: SCRUM-53
# @ac: 7
def test_an_unknown_event_is_not_found(client, app):
    login_as(client, "coord1")

    reply = client.post("/api/requests/99999/send-for-safety-check", json={})

    assert reply.status_code == 404
    assert reply.get_json()["message"] == "Event request not found."


# @story: SCRUM-53
# @ac: 7
def test_a_multi_role_account_assigned_to_the_event_can_send_it(client, app):
    row = ready_event("Multi Gala", assigned_coordinator=account("multi1"))
    login_as(client, "multi1")

    assert send(client, row).status_code == 200
    assert stored(row).status == "Safety Check"


# ---- the outstanding list, whatever supplies the marker and the requirements --


# @story: SCRUM-53
# @ac: 2, 3
def test_a_booking_marked_venue_unavailable_is_listed_by_the_stub_seam(client, app, monkeypatch):
    # The marker itself arrives with SCRUM-82; this proves the listing and the
    # refusal around it, so the replacement only has to supply the answer.
    from areas.requests import services

    row = ready_event("Marker Seam")
    monkeypatch.setattr(services, "_booking_is_marked_venue_unavailable", lambda booking: True)
    login_as(client, "coord1")

    reply = send(client, row)

    assert reply.status_code == 400
    assert "The booking at Seminar Room 1 is marked Venue unavailable" in reply.get_json()["message"]
    assert stored(row).status == "Planning"


# @story: SCRUM-53
# @ac: 2, 3
def test_unapproved_equipment_is_listed_by_the_stub_seam(client, app, monkeypatch):
    # The requirements themselves arrive with SCRUM-48 and SCRUM-81.
    from areas.requests import services

    row = ready_event("Equipment Seam")
    monkeypatch.setattr(
        services,
        "_unapproved_equipment_requirements",
        lambda event: ["Projector, 2 (Requested)", "Microphones, 4 (Declined)"],
    )
    login_as(client, "coord1")

    reply = send(client, row)

    assert reply.status_code == 400
    message = reply.get_json()["message"]
    assert "Projector, 2 (Requested)" in message
    assert "Microphones, 4 (Declined)" in message
    assert stored(row).status == "Planning"
