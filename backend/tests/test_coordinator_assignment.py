"""SCRUM-43: approving a request assigns the Event Coordinator with the fewest
open events and moves it from Approved to Planning.

Each test first clears the seeded assignments, then builds the exact open-event
counts it needs, so it does not depend on what the seed happens to hold.
"""

from datetime import datetime, timezone

from areas.requests import services
from db import db
from factories import account
from models import Account, EventRequest, Role

FIELDS = {
    "name": "Autumn Showcase",
    "purpose": "Client showcase",
    "description": "Evening showcase for partners",
    "date": "2026-11-20",
    "start_time": "18:00",
    "end_time": "21:00",
    "attendance": 120,
    "equipment_requirements": "Projector",
    "registration_needs": "Guest list supplied by the client",
}

ASSIGNED_ON = datetime(2026, 9, 1, 9, 0)


def login_as(client, username):
    account_id = account(username).id
    with client.session_transaction() as session:
        session["account_id"] = account_id


def clear_assignments():
    """No event is assigned to anyone: every Coordinator has 0 open events."""
    db.session.query(EventRequest).update(
        {EventRequest.assigned_coordinator_id: None, EventRequest.assigned_at: None}
    )
    db.session.commit()


def give(username, status, count=1):
    """`count` events in `status` assigned to `username`."""
    for number in range(count):
        db.session.add(
            EventRequest(
                created_by_id=account("org1").id,
                status=status,
                assigned_coordinator_id=account(username).id,
                assigned_at=ASSIGNED_ON,
                **{**FIELDS, "name": f"{username} {status} {number}"},
            )
        )
    db.session.commit()


def submitted(name="Assign Me"):
    event_request = EventRequest(
        created_by_id=account("org1").id, status="Submitted", **{**FIELDS, "name": name}
    )
    db.session.add(event_request)
    db.session.commit()
    return event_request.id


def approve(client, approver, request_id, reason=None):
    login_as(client, approver)
    return client.post(f"/api/requests/{request_id}/approve", json={"reason": reason})


def stored(request_id):
    db.session.expire_all()
    return db.session.get(EventRequest, request_id)


# @story: SCRUM-43
# @ac: 1, 3
def test_approval_assigns_the_coordinator_with_the_fewest_open_events(client, app):
    clear_assignments()
    give("coord1", "Planning", 2)
    give("coord2", "Planning", 1)
    request_id = submitted()

    resp = approve(client, "coord1", request_id)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Planning"
    assert body["assigned_coordinator"] == "multi1"
    assert body["decision"] == "Approved"
    assert body["decided_by"] == "coord1"
    saved = stored(request_id)
    assert saved.status == "Planning"
    assert saved.assigned_coordinator.username == "multi1"


# @story: SCRUM-43
# @ac: 3
def test_assignment_records_the_date_it_happened(client, app):
    clear_assignments()
    request_id = submitted()

    body = approve(client, "coord1", request_id).get_json()

    assert datetime.fromisoformat(body["assigned_at"]).date() == datetime.now(timezone.utc).date()
    assert datetime.fromisoformat(body["assigned_at"]) >= datetime.fromisoformat(body["decided_at"])


# @story: SCRUM-43
# @ac: 2
def test_a_three_way_tie_goes_to_the_first_username_alphabetically(client, app):
    clear_assignments()
    for username in ("coord1", "coord2", "multi1"):
        give(username, "Planning", 1)
    request_id = submitted()

    body = approve(client, "coord2", request_id).get_json()

    assert body["assigned_coordinator"] == "coord1"
    assert body["decided_by"] == "coord2"


# @story: SCRUM-43
# @ac: 2
def test_a_tie_between_only_the_lowest_goes_to_the_first_of_them(client, app):
    clear_assignments()
    give("coord1", "Planning", 2)
    request_id = submitted()

    body = approve(client, "coord1", request_id).get_json()

    assert body["assigned_coordinator"] == "coord2"


# @story: SCRUM-43
# @ac: 2
def test_the_alphabetical_order_ignores_upper_and_lower_case(client, app):
    clear_assignments()
    role = db.session.query(Role).filter_by(name="Event Coordinator").one()
    for username in ("Bob", "alice"):
        extra = Account(username=username)
        extra.set_password("Passw0rd!")
        extra.roles = [role]
        db.session.add(extra)
    db.session.commit()
    for username in ("coord1", "coord2", "multi1"):
        give(username, "Planning", 1)
    request_id = submitted()

    body = approve(client, "coord1", request_id).get_json()

    assert body["assigned_coordinator"] == "alice"


# @story: SCRUM-43
# @ac: 1
def test_only_planning_and_confirmed_events_count_as_open(client, app):
    clear_assignments()
    give("coord1", "Planning", 1)
    give("coord2", "Confirmed", 1)
    give("multi1", "Completed", 1)
    give("multi1", "Cancelled", 1)
    request_id = submitted()

    body = approve(client, "coord1", request_id).get_json()

    assert body["assigned_coordinator"] == "multi1"


# @story: SCRUM-43
# @ac: 1
def test_a_confirmed_event_counts_against_its_coordinator(client, app):
    clear_assignments()
    give("coord1", "Confirmed", 1)
    request_id = submitted()

    body = approve(client, "coord2", request_id).get_json()

    assert body["assigned_coordinator"] == "coord2"


# @story: SCRUM-43
# @ac: 1
def test_the_approving_coordinator_can_be_the_one_assigned(client, app):
    clear_assignments()
    give("coord2", "Planning", 1)
    give("multi1", "Planning", 1)
    request_id = submitted()

    body = approve(client, "coord1", request_id).get_json()

    assert body["assigned_coordinator"] == "coord1"
    assert body["decided_by"] == "coord1"


# @story: SCRUM-43
# @ac: 1
def test_an_account_with_two_roles_is_an_eligible_coordinator(client, app):
    clear_assignments()
    give("coord1", "Planning", 1)
    give("coord2", "Planning", 1)
    request_id = submitted()

    body = approve(client, "coord1", request_id).get_json()

    assert body["assigned_coordinator"] == "multi1"


# @story: SCRUM-43
# @ac: 1
def test_successive_approvals_share_the_events_out_fairly(client, app):
    clear_assignments()
    ids = [submitted(f"Share {number}") for number in range(6)]

    assigned = [approve(client, "coord1", request_id).get_json()["assigned_coordinator"] for request_id in ids]

    assert assigned == ["coord1", "coord2", "multi1", "coord1", "coord2", "multi1"]


# @story: SCRUM-43
# @ac: 1
def test_rejecting_a_request_assigns_no_coordinator(client, app):
    clear_assignments()
    request_id = submitted()
    login_as(client, "coord1")

    resp = client.post(f"/api/requests/{request_id}/reject", json={"reason": "Venue capacity cannot be met."})

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Rejected"
    assert body["assigned_coordinator"] is None
    assert body["assigned_at"] is None
    assert stored(request_id).assigned_coordinator_id is None


# @story: SCRUM-43
# @ac: 4
def test_a_second_decision_is_refused_and_the_one_assignee_is_unchanged(client, app):
    clear_assignments()
    request_id = submitted()
    first = approve(client, "coord1", request_id).get_json()["assigned_coordinator"]

    for action in ("approve", "reject"):
        resp = client.post(f"/api/requests/{request_id}/{action}", json={"reason": "Again."})
        assert resp.status_code == 409
        assert "already been decided" in resp.get_json()["message"]

    saved = stored(request_id)
    assert saved.status == "Planning"
    assert saved.assigned_coordinator.username == first


# @story: SCRUM-43
# @ac: 5
def test_the_assigned_coordinator_cannot_decline_the_assignment(client, app):
    clear_assignments()
    request_id = submitted()
    assigned = approve(client, "coord2", request_id).get_json()["assigned_coordinator"]
    login_as(client, assigned)

    for action in ("decline", "unassign", "assignment"):
        assert client.post(f"/api/requests/{request_id}/{action}").status_code == 404
    refused = client.post(f"/api/requests/{request_id}/reject", json={"reason": "I decline."})

    assert refused.status_code == 409
    saved = stored(request_id)
    assert saved.assigned_coordinator.username == assigned
    assert saved.status == "Planning"


# @story: SCRUM-43
# @ac: 6
def test_the_organiser_and_every_coordinator_can_see_who_is_assigned(client, app):
    clear_assignments()
    request_id = submitted()
    assigned = approve(client, "coord1", request_id).get_json()["assigned_coordinator"]

    for username in ("org1", "coord1", "coord2", "multi1"):
        login_as(client, username)
        body = client.get(f"/api/requests/{request_id}").get_json()
        assert body["assigned_coordinator"] == assigned
        assert body["assigned_at"] is not None
        listed = next(row for row in client.get("/api/requests").get_json() if row["id"] == request_id)
        assert listed["status"] == "Planning"
        assert listed["assigned_coordinator"] == assigned


# @story: SCRUM-43
# @ac: 6
def test_a_request_not_yet_assigned_shows_no_coordinator_and_no_date(client, app):
    clear_assignments()
    request_id = submitted()
    login_as(client, "org1")

    body = client.get(f"/api/requests/{request_id}").get_json()

    assert body["assigned_coordinator"] is None
    assert body["assigned_at"] is None


# @story: SCRUM-43
# @ac: 6
def test_another_organiser_still_cannot_open_the_request(client, app):
    clear_assignments()
    request_id = submitted()
    approve(client, "coord1", request_id)
    login_as(client, "org2")

    assert client.get(f"/api/requests/{request_id}").status_code == 403


# @story: SCRUM-43
# @ac: 7
def test_with_no_event_coordinator_the_request_stays_approved_without_error(client, app, monkeypatch):
    clear_assignments()
    request_id = submitted()
    monkeypatch.setattr(services, "_event_coordinators", lambda: [])

    resp = approve(client, "coord1", request_id)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Approved"
    assert body["decision"] == "Approved"
    assert body["assigned_coordinator"] is None
    assert body["assigned_at"] is None
    saved = stored(request_id)
    assert saved.status == "Approved"
    assert saved.assigned_coordinator_id is None
