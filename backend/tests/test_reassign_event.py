"""SCRUM-44: the Event Coordinator Lead moves an assigned event to another Event Coordinator.

The acceptance criteria as rules at the API: an assigned Submitted, Approved,
Planning, Safety Check or Confirmed event moves to any account holding the
Event Coordinator role, never to the one it has and never when it is not active
or not assigned; the status, fields and arrangements stay as they were; the new
coordinator gains the event and the previous one loses it; the new coordinator,
the previous one and the Organiser are told and the Organiser sees the new
coordinator; and anyone without the Lead role is refused. The browser journeys
are functional/tests/SCRUM-44.spec.js.
"""

import pytest

from db import db
from models import Account, EventRequest, Notification
from tests.factories import make_booking, make_event, make_hold, make_venue

ACTIVE = ["Submitted", "Approved", "Planning", "Safety Check", "Confirmed"]
DAY = {"date": "2026-12-05", "start_time": "10:00", "end_time": "12:00"}


def account(username):
    return db.session.query(Account).filter_by(username=username).one()


def login(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def event(name, status="Planning", coordinator="coord1", owner="org2", **fields):
    assigned = account(coordinator) if coordinator else None
    return make_event(
        name=name, status=status, owner=owner, assigned_coordinator=assigned, assigned_by=account("lead1"), **DAY, **fields
    )


def reassign(client, event_id, coordinator="coord2", **body):
    payload = {"coordinator_id": account(coordinator).id} if coordinator else {}
    return client.post(f"/api/requests/{event_id}/reassign", json={**payload, **body})


def stored(event_id):
    db.session.expire_all()
    return db.session.get(EventRequest, event_id)


def notices(username, about):
    db.session.expire_all()
    rows = db.session.query(Notification).filter_by(recipient_id=account(username).id)
    return [row.message for row in rows if f'"{about}"' in row.message]


# --- AC1: which events move, and to whom ---


# @story: SCRUM-44
# @ac: 1
@pytest.mark.parametrize("status", ACTIVE)
def test_the_lead_reassigns_an_assigned_event_in_each_active_status(client, status):
    made = event(f"Move {status}", status=status)
    login(client, "lead1")

    resp = reassign(client, made.id)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["assigned_coordinator"] == "coord2"
    assert body["status"] == status
    assert stored(made.id).assigned_coordinator_id == account("coord2").id


# @story: SCRUM-44
# @ac: 1
def test_a_coordinator_who_is_also_the_lead_can_be_chosen(client):
    made = event("Move To Lead Coordinator")
    login(client, "lead1")

    assert reassign(client, made.id, "leadcoord1").status_code == 200
    assert stored(made.id).assigned_coordinator_id == account("leadcoord1").id


# @story: SCRUM-44
# @ac: 1
@pytest.mark.parametrize("status", ["Rejected", "Completed", "Cancelled"])
def test_an_event_that_is_not_active_is_refused_and_nothing_changes(client, status):
    made = event(f"Not Active {status}", status=status)
    login(client, "lead1")

    resp = reassign(client, made.id)

    assert resp.status_code == 409
    assert status in resp.get_json()["message"]
    assert stored(made.id).assigned_coordinator_id == account("coord1").id
    assert notices("coord2", f"Not Active {status}") == []


# @story: SCRUM-44
# @ac: 1
def test_a_draft_and_an_unknown_request_answer_404(client):
    draft = event("Move Draft", status="Draft")
    login(client, "lead1")

    assert reassign(client, draft.id).status_code == 404
    assert reassign(client, 99999).status_code == 404
    assert stored(draft.id).assigned_coordinator_id == account("coord1").id


# @story: SCRUM-44
# @ac: 1
def test_an_event_with_no_coordinator_is_refused_and_stays_in_the_queue(client):
    made = event("Move Unassigned", status="Submitted", coordinator=None)
    login(client, "lead1")

    resp = reassign(client, made.id)

    assert resp.status_code == 409
    assert "Unassigned queue" in resp.get_json()["message"]
    assert stored(made.id).assigned_coordinator_id is None


# @story: SCRUM-44
# @ac: 1
@pytest.mark.parametrize("username", ["lead1", "org1", "venue1", "tech1", "safety1", "att1"])
def test_an_account_that_is_not_an_event_coordinator_cannot_be_chosen(client, username):
    made = event("Move To Non Coordinator")
    login(client, "lead1")

    resp = client.post(f"/api/requests/{made.id}/reassign", json={"coordinator_id": account(username).id})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "The chosen account is not an Event Coordinator."
    assert stored(made.id).assigned_coordinator_id == account("coord1").id


# @story: SCRUM-44
# @ac: 1
@pytest.mark.parametrize("body", [{}, {"coordinator_id": ""}, {"coordinator_id": "abc"}, {"coordinator_id": 99999}])
def test_no_choice_or_an_unknown_one_is_refused(client, body):
    made = event("Move Without Choice")
    login(client, "lead1")

    resp = client.post(f"/api/requests/{made.id}/reassign", json=body)

    assert resp.status_code == 400
    assert stored(made.id).assigned_coordinator_id == account("coord1").id


# --- AC2: not to the current coordinator ---


# @story: SCRUM-44
# @ac: 2
def test_reassigning_to_the_current_coordinator_is_refused_and_nothing_changes(client):
    made = event("Move To Same")
    before = stored(made.id).assigned_at
    login(client, "lead1")

    resp = reassign(client, made.id, "coord1")

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "This event is already assigned to coord1."
    row = stored(made.id)
    assert (row.assigned_coordinator_id, row.assigned_at) == (account("coord1").id, before)
    assert notices("coord1", "Move To Same") == []
    assert notices("org2", "Move To Same") == []


# --- AC3: the event is unchanged ---


# @story: SCRUM-44
# @ac: 3
def test_the_status_fields_and_arrangements_are_unchanged(client):
    made = event("Move Keeps Everything", purpose="Keep me", attendance=40)
    venue = make_venue(name="Reassign Room")
    booking = make_booking(event=made, venue=venue, status="Requested")
    hold = make_hold(event=made, venue=venue, expires_at="2099-01-01T10:00")
    keep = {"name": made.name, "purpose": "Keep me", "attendance": 40, "date": DAY["date"], "status": "Planning"}
    login(client, "lead1")

    reassign(client, made.id)

    row = stored(made.id)
    assert {key: getattr(row, key) for key in keep} == keep
    assert db.session.get(type(booking), booking.id).status == "Requested"
    assert db.session.get(type(hold), hold.id).status == "Held"
    assert db.session.get(type(booking), booking.id).event_request_id == made.id
    assert db.session.get(type(hold), hold.id).event_request_id == made.id


# --- AC4: the new coordinator gains the event, the previous one loses it ---


# @story: SCRUM-44
# @ac: 4
def test_the_new_coordinator_gains_the_event_and_the_previous_one_loses_it(client):
    made = event("Move Access", status="Approved")
    login(client, "coord1")
    assert client.get(f"/api/requests/{made.id}").status_code == 200
    login(client, "coord2")
    assert client.get(f"/api/requests/{made.id}").status_code == 403

    login(client, "lead1")
    reassign(client, made.id)

    login(client, "coord2")
    assert client.get(f"/api/requests/{made.id}").status_code == 200
    assert made.name in [row["name"] for row in client.get("/api/requests").get_json()]
    login(client, "coord1")
    assert client.get(f"/api/requests/{made.id}").status_code == 403
    assert made.name not in [row["name"] for row in client.get("/api/requests").get_json()]


# --- AC5: who is told, and what the Organiser sees ---


# @story: SCRUM-44
# @ac: 5
def test_both_coordinators_and_the_organiser_are_told_naming_the_event(client):
    made = event("Move Notices")
    login(client, "lead1")

    reassign(client, made.id)

    assert notices("coord2", "Move Notices") == ['You have been assigned the event "Move Notices".']
    assert notices("coord1", "Move Notices") == ['The event "Move Notices" has been reassigned to coord2.']
    assert notices("org2", "Move Notices") == ['coord2 has been assigned to your event "Move Notices".']
    assert notices("org1", "Move Notices") == []
    assert notices("lead1", "Move Notices") == []


# @story: SCRUM-44
# @ac: 5
def test_the_organiser_sees_the_new_coordinator_and_the_lead_who_moved_it(client):
    made = event("Move Organiser Sees")
    login(client, "leadcoord1")

    reassign(client, made.id)

    login(client, "org2")
    body = client.get(f"/api/requests/{made.id}").get_json()
    assert (body["assigned_coordinator"], body["assigned_by"]) == ("coord2", "leadcoord1")
    assert body["assigned_at"] is not None


# --- AC6: only the Lead ---


# @story: SCRUM-44
# @ac: 6
@pytest.mark.parametrize("username", ["coord1", "coord2", "multi1", "org1", "org2", "venue1", "tech1", "safety1", "att1"])
def test_an_account_without_the_lead_role_is_refused_and_nothing_changes(client, username):
    made = event("Move Refused")
    login(client, username)

    resp = reassign(client, made.id)

    assert resp.status_code == 403
    assert stored(made.id).assigned_coordinator_id == account("coord1").id
    assert notices("coord2", "Move Refused") == []
    assert notices("org2", "Move Refused") == []


# @story: SCRUM-44
# @ac: 6
def test_a_lead_who_is_also_a_coordinator_may_reassign_an_event_that_is_not_theirs(client):
    made = event("Move By Lead Coordinator")
    login(client, "leadcoord1")

    assert reassign(client, made.id).status_code == 200
