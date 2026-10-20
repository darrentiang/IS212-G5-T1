"""SCRUM-86: the Event Coordinator Lead assigns each newly submitted event
request to an Event Coordinator from the unassigned queue.

The acceptance criteria as rules at the API: the Lead role and its seeded
accounts, that a submission is queued and assigned to no one, the queue's order
and details, that assigning records who and when and leaves the request
Submitted, that only a queued request can be assigned, who is told, that a
resubmitted request keeps its coordinator, that approving assigns no one and the
first booking request starts planning, and that only the Lead may do any of it.
The browser journeys are functional/tests/SCRUM-86.spec.js.
"""

from datetime import date, datetime, timedelta, timezone

import pytest

from db import db
from models import Account, EventRequest, Notification, Venue

FIELDS = {
    "name": "Autumn Showcase",
    "purpose": "Client showcase",
    "description": "Evening showcase for partners",
    "date": (date.today() + timedelta(days=30)).isoformat(),
    "start_time": "18:00",
    "end_time": "21:00",
    "attendance": 120,
    "equipment_requirements": "Projector",
    "registration_needs": "Guest list supplied by the client",
}

OLDER = datetime(2026, 9, 20, 9, 30)
NEWER = datetime(2026, 9, 21, 9, 30)


def account(username):
    return db.session.query(Account).filter_by(username=username).one()


def login(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def make_request(name="Queue Member", status="Submitted", submitted_at=OLDER, coordinator=None, **extra):
    event_request = EventRequest(
        created_by_id=account("org1").id,
        status=status,
        submitted_at=submitted_at,
        assigned_coordinator_id=account(coordinator).id if coordinator else None,
        **{**FIELDS, "name": name},
        **extra,
    )
    db.session.add(event_request)
    db.session.commit()
    return event_request.id


def stored(request_id):
    db.session.expire_all()
    return db.session.get(EventRequest, request_id)


def assign(client, request_id, coordinator="coord1", **body):
    payload = {"coordinator_id": account(coordinator).id} if coordinator else {}
    return client.post(f"/api/requests/{request_id}/assign", json={**payload, **body})


def queue_names(client):
    return [row["name"] for row in client.get("/api/assignments/queue").get_json()]


def notices(username, about):
    """What `username` was told about the event named `about`; the seed holds
    standing notifications of its own, so only this event's are counted."""
    db.session.expire_all()
    rows = db.session.query(Notification).filter_by(recipient_id=account(username).id)
    return [row.message for row in rows if f'"{about}"' in row.message]


# --- AC1: the Lead role, alone or with others, and its seeded accounts ---


# @story: SCRUM-86
# @ac: 1
def test_the_lead_only_account_holds_just_the_lead_role(client):
    resp = client.post("/api/login", json={"username": "lead1", "password": "Passw0rd!"})

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["roles"] == ["Event Coordinator Lead"]
    assert "assignments.manage" in body["features"]
    assert "requests.decide" not in body["features"]


# @story: SCRUM-86
# @ac: 1
def test_the_lead_and_coordinator_account_holds_both_roles(client):
    resp = client.post("/api/login", json={"username": "leadcoord1", "password": "Passw0rd!"})

    body = resp.get_json()
    assert set(body["roles"]) == {"Event Coordinator Lead", "Event Coordinator"}
    assert {"assignments.manage", "requests.decide"} <= set(body["features"])


# @story: SCRUM-86
# @ac: 1, 9
def test_only_the_lead_role_holds_the_assignment_feature(client):
    for username in ("coord1", "multi1", "org1", "venue1", "tech1", "safety1", "att1"):
        features = client.post("/api/login", json={"username": username, "password": "Passw0rd!"}).get_json()["features"]
        assert "assignments.manage" not in features, username


# --- AC2: a newly submitted request is queued and assigned to no one ---


# @story: SCRUM-86
# @ac: 2
def test_a_newly_submitted_request_has_no_coordinator_and_is_in_the_queue(client):
    login(client, "org1")
    created = client.post(
        "/api/requests",
        json={**FIELDS, "name": "Queue New Request"},
    )
    assert created.status_code == 201
    body = created.get_json()
    assert body["status"] == "Submitted"
    assert body["assigned_coordinator"] is None

    login(client, "lead1")
    assert "Queue New Request" in queue_names(client)
    assert stored(body["id"]).assigned_coordinator_id is None


# @story: SCRUM-86
# @ac: 2
def test_submitting_a_saved_draft_also_queues_it_without_assigning(client):
    login(client, "org2")  # org1 already holds the seeded Draft; one open Draft each (SCRUM-30)
    draft = client.post("/api/requests/draft", json={"name": "Drafted Then Queued"}).get_json()
    client.put(f"/api/requests/{draft['id']}", json=FIELDS | {"name": "Drafted Then Queued"})
    assert client.post(f"/api/requests/{draft['id']}/submit").status_code == 200

    login(client, "lead1")
    assert "Drafted Then Queued" in queue_names(client)
    assert stored(draft["id"]).assigned_coordinator_id is None


# --- AC3: oldest first, with the details the Lead needs ---


# @story: SCRUM-86
# @ac: 3
def test_the_queue_is_oldest_first(client):
    make_request("Queue Newer", submitted_at=NEWER)
    make_request("Queue Older", submitted_at=OLDER)
    login(client, "lead1")

    names = queue_names(client)

    assert names.index("Queue Older") < names.index("Queue Newer")


# @story: SCRUM-86
# @ac: 3
def test_requests_submitted_at_the_same_moment_keep_the_order_they_were_made_in(client):
    first = make_request("Tie First", submitted_at=NEWER)
    second = make_request("Tie Second", submitted_at=NEWER)
    login(client, "lead1")

    rows = client.get("/api/assignments/queue").get_json()
    ids = [row["id"] for row in rows]

    assert ids.index(first) < ids.index(second)


# @story: SCRUM-86
# @ac: 3
def test_a_request_with_no_recorded_submission_time_is_listed_last(client):
    make_request("No Time", submitted_at=None)
    make_request("Has Time", submitted_at=NEWER)
    login(client, "lead1")

    names = queue_names(client)

    assert names.index("Has Time") < names.index("No Time")


# @story: SCRUM-86
# @ac: 3
def test_each_queued_request_shows_the_details_and_nothing_more(client):
    request_id = make_request("Queue Details")
    login(client, "lead1")

    row = next(item for item in client.get("/api/assignments/queue").get_json() if item["id"] == request_id)

    assert row == {
        "id": request_id,
        "name": "Queue Details",
        "purpose": FIELDS["purpose"],
        "date": FIELDS["date"],
        "attendance": FIELDS["attendance"],
        "created_by": "org1",
        "submitted_at": OLDER.isoformat(),
    }


# @story: SCRUM-86
# @ac: 3
def test_a_seeded_submitted_request_that_has_a_coordinator_is_not_in_the_queue(client):
    # SCRUM-87: the seed gives Annual Dinner to coord1 and Client B Conference to coord2.
    login(client, "lead1")

    names = queue_names(client)

    assert "Annual Dinner" not in names
    assert "Client B Conference" not in names


# --- AC4: assign to any Event Coordinator; who and when are recorded ---


# @story: SCRUM-86
# @ac: 4
def test_the_lead_assigns_a_queued_request_and_it_stays_submitted(client):
    request_id = make_request("Assign From Queue")
    login(client, "lead1")

    resp = assign(client, request_id, "coord1")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Submitted"
    assert body["assigned_coordinator"] == "coord1"
    assert body["assigned_by"] == "lead1"
    assert datetime.fromisoformat(body["assigned_at"]).date() == datetime.now(timezone.utc).date()
    assert "Assign From Queue" not in queue_names(client)

    saved = stored(request_id)
    assert (saved.status, saved.decision) == ("Submitted", None)
    assert saved.assigned_coordinator.username == "coord1"
    assert saved.assigned_by.username == "lead1"


# @story: SCRUM-86
# @ac: 4
def test_a_coordinator_who_also_holds_another_role_can_be_chosen(client):
    request_id = make_request("Assign To Two Roles")
    login(client, "lead1")

    resp = assign(client, request_id, "multi1")

    assert resp.status_code == 200
    assert resp.get_json()["assigned_coordinator"] == "multi1"


# @story: SCRUM-86
# @ac: 4
def test_a_lead_who_is_also_a_coordinator_can_assign_to_themselves(client):
    request_id = make_request("Assign To Self")
    login(client, "leadcoord1")

    resp = assign(client, request_id, "leadcoord1")

    assert resp.status_code == 200
    assert resp.get_json()["assigned_coordinator"] == "leadcoord1"
    assert resp.get_json()["assigned_by"] == "leadcoord1"


# @story: SCRUM-86
# @ac: 4
def test_the_assignable_accounts_are_exactly_those_holding_the_coordinator_role(client):
    login(client, "lead1")

    rows = client.get("/api/assignments/coordinators").get_json()

    assert [row["username"] for row in rows] == ["coord1", "coord2", "leadcoord1", "multi1"]
    assert all(set(row) == {"id", "username"} for row in rows)


# @story: SCRUM-86
# @ac: 4
@pytest.mark.parametrize("chosen", ["org1", "venue1", "lead1", "safety1"])
def test_an_account_without_the_coordinator_role_cannot_be_chosen(client, chosen):
    request_id = make_request("Not A Coordinator")
    login(client, "lead1")

    resp = assign(client, request_id, chosen)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "The chosen account is not an Event Coordinator."
    assert stored(request_id).assigned_coordinator_id is None
    assert notices("org1", "Not A Coordinator") == []


# @story: SCRUM-86
# @ac: 4
@pytest.mark.parametrize("bad", [None, "", "  ", "abc", 99999, 0])
def test_a_missing_or_unknown_choice_is_refused_and_nothing_changes(client, bad):
    request_id = make_request("Bad Choice")
    login(client, "lead1")

    resp = client.post(f"/api/requests/{request_id}/assign", json={"coordinator_id": bad})

    assert resp.status_code == 400
    assert resp.get_json()["message"] in (
        "Choose an Event Coordinator.",
        "The chosen account is not an Event Coordinator.",
    )
    assert stored(request_id).assigned_coordinator_id is None
    assert stored(request_id).assigned_by_id is None


# @story: SCRUM-86
# @ac: 4
def test_a_body_with_no_choice_at_all_is_refused(client):
    request_id = make_request("No Body")
    login(client, "lead1")

    resp = client.post(f"/api/requests/{request_id}/assign")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose an Event Coordinator."


# --- AC5: only a Submitted request with no coordinator ---


# @story: SCRUM-86
# @ac: 5
def test_an_already_assigned_request_cannot_be_assigned_again(client):
    request_id = make_request("Assign Only Once")
    login(client, "lead1")
    assert assign(client, request_id, "coord2").status_code == 200

    resp = assign(client, request_id, "coord1")

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "This request is already assigned to coord2."
    assert stored(request_id).assigned_coordinator.username == "coord2"
    assert notices("coord1", "Assign Only Once") == []


# @story: SCRUM-86
# @ac: 5
@pytest.mark.parametrize("status", ["Approved", "Rejected", "Planning", "Confirmed", "Cancelled"])
def test_a_request_that_is_not_submitted_cannot_be_assigned_this_way(client, status):
    request_id = make_request("Wrong Status", status=status)
    login(client, "lead1")

    resp = assign(client, request_id, "coord1")

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "Only a Submitted request with no coordinator can be assigned."
    assert stored(request_id).assigned_coordinator_id is None


# @story: SCRUM-86
# @ac: 5
def test_a_draft_is_not_found_and_an_unknown_request_is_not_found(client):
    draft = make_request("Hidden Draft", status="Draft")
    login(client, "lead1")

    assert assign(client, draft, "coord1").status_code == 404
    assert assign(client, 99999, "coord1").status_code == 404
    assert stored(draft).assigned_coordinator_id is None


# @story: SCRUM-86
# @ac: 5
def test_the_queue_lists_only_submitted_requests_with_no_coordinator(client):
    make_request("Queue Still Waiting")
    make_request("Queue Already Assigned", coordinator="coord1")
    make_request("Queue Is Draft", status="Draft")
    make_request("Queue Is Approved", status="Approved")
    login(client, "lead1")

    names = queue_names(client)

    assert "Queue Still Waiting" in names
    for hidden in ("Queue Already Assigned", "Queue Is Draft", "Queue Is Approved", "Open House", "Design Workshop"):
        assert hidden not in names


# --- AC6: the coordinator and the Organiser are told ---


# @story: SCRUM-86
# @ac: 6
def test_the_coordinator_and_the_organiser_are_each_told_naming_the_event(client):
    request_id = make_request("Notify Both")
    login(client, "lead1")

    assign(client, request_id, "coord1")

    assert notices("coord1", "Notify Both") == ['You have been assigned the event "Notify Both".']
    assert notices("org1", "Notify Both") == ['coord1 has been assigned to your event "Notify Both".']
    assert notices("lead1", "Notify Both") == []
    row = db.session.query(Notification).filter_by(
        recipient_id=account("coord1").id, event_request_id=request_id
    ).one()
    assert row.read_at is None


# @story: SCRUM-86
# @ac: 6
def test_a_refused_assignment_tells_no_one(client):
    request_id = make_request("Refused Tells Nobody", status="Approved")
    login(client, "lead1")

    assign(client, request_id, "coord1")

    assert notices("coord1", "Refused Tells Nobody") == []
    assert notices("org1", "Refused Tells Nobody") == []


# @story: SCRUM-86
# @ac: 6
def test_the_organiser_can_see_who_is_assigned(client):
    request_id = make_request("Organiser Sees")
    login(client, "lead1")
    assign(client, request_id, "coord1")

    login(client, "org1")
    body = client.get(f"/api/requests/{request_id}").get_json()

    assert body["assigned_coordinator"] == "coord1"
    assert body["status"] == "Submitted"


# --- AC7: a resubmitted request keeps its coordinator ---


# @story: SCRUM-86
# @ac: 7
def test_a_resubmitted_request_returns_to_its_coordinator_not_to_the_queue(client):
    request_id = make_request("Resubmit Returns")
    login(client, "lead1")
    assign(client, request_id, "coord1")
    login(client, "coord1")
    rejected = client.post(f"/api/requests/{request_id}/reject", json={"reason": "Venue capacity cannot be met."})
    assert rejected.get_json()["status"] == "Rejected"
    login(client, "org1")

    resubmitted = client.post(f"/api/requests/{request_id}/resubmit", json={})

    assert resubmitted.status_code == 200
    assert resubmitted.get_json()["status"] == "Submitted"
    assert resubmitted.get_json()["assigned_coordinator"] == "coord1"
    login(client, "lead1")
    assert "Resubmit Returns" not in queue_names(client)
    login(client, "coord1")
    assert request_id in [row["id"] for row in client.get("/api/requests").get_json()]


# --- AC8: approving assigns no one; the first booking request starts planning ---


# @story: SCRUM-86
# @ac: 8
def test_approving_leaves_the_request_approved_with_its_coordinator(client):
    request_id = make_request("Approve No Assign", coordinator="coord1")
    login(client, "coord1")

    resp = client.post(f"/api/requests/{request_id}/approve", json={})

    body = resp.get_json()
    assert body["status"] == "Approved"
    assert body["assigned_coordinator"] == "coord1"
    assert body["decision"] == "Approved"


# @story: SCRUM-87
# @ac: 3
def test_a_request_still_in_the_queue_cannot_be_approved_or_rejected(client):
    # SCRUM-86 AC8 said approving assigns no one; SCRUM-87 AC3 goes further: no coordinator can decide a queued request.
    request_id = make_request("Approve Refused Unassigned")
    login(client, "coord1")

    assert client.post(f"/api/requests/{request_id}/approve", json={}).status_code == 403
    assert client.post(f"/api/requests/{request_id}/reject", json={"reason": "No."}).status_code == 403

    saved = stored(request_id)
    assert saved.status == "Submitted"
    assert saved.assigned_coordinator_id is None


def raise_booking(client, request_id, venue="Seminar Room 1"):
    login(client, "coord1")
    venue_id = db.session.query(Venue).filter_by(name=venue).one().id
    return client.post(f"/api/requests/{request_id}/bookings", json={"venue_id": venue_id})


# @story: SCRUM-86
# @ac: 8
def test_the_first_booking_request_moves_an_approved_request_to_planning(client):
    request_id = make_request("First Booking Planning", status="Approved", coordinator="coord1")

    resp = raise_booking(client, request_id)

    assert resp.status_code == 201
    assert stored(request_id).status == "Planning"
    assert stored(request_id).assigned_coordinator.username == "coord1"


# @story: SCRUM-86
# @ac: 8
def test_a_later_booking_request_leaves_a_planning_request_in_planning(client):
    request_id = make_request("Second Booking", status="Approved", coordinator="coord1")
    raise_booking(client, request_id, "Seminar Room 1")

    resp = raise_booking(client, request_id, "Auditorium")

    assert resp.status_code == 201
    assert stored(request_id).status == "Planning"


# @story: SCRUM-86
# @ac: 8
def test_a_refused_booking_request_does_not_start_planning(client):
    request_id = make_request("Refused Booking", status="Approved", coordinator="coord1")
    venue = db.session.query(Venue).filter_by(name="Seminar Room 1").one()
    venue.is_active = False
    db.session.commit()

    resp = raise_booking(client, request_id)

    assert resp.status_code == 400
    assert stored(request_id).status == "Approved"


# --- AC9: only the Lead views the queue or assigns ---


# @story: SCRUM-86
# @ac: 9
@pytest.mark.parametrize("username", ["coord1", "multi1", "org1", "venue1", "tech1", "safety1", "att1"])
def test_anyone_without_the_lead_role_is_refused_the_queue_and_the_assignment(client, username):
    request_id = make_request("Refused For Others")
    login(client, username)

    assert client.get("/api/assignments/queue").status_code == 403
    assert client.get("/api/assignments/coordinators").status_code == 403
    resp = assign(client, request_id, "coord2")

    assert resp.status_code == 403
    assert resp.get_json()["message"] == "You do not have permission to perform this action."
    assert stored(request_id).assigned_coordinator_id is None
    assert notices("coord2", "Refused For Others") == []


# @story: SCRUM-86
# @ac: 9
def test_a_logged_out_visitor_is_refused(client):
    request_id = make_request("Refused Logged Out")

    assert client.get("/api/assignments/queue").status_code == 401
    assert client.post(f"/api/requests/{request_id}/assign", json={"coordinator_id": 1}).status_code == 401
    assert stored(request_id).assigned_coordinator_id is None


# @story: SCRUM-86
# @ac: 9
def test_the_lead_reads_a_queued_or_assigned_request_but_cannot_decide_it(client):
    queued = make_request("Lead Reads Queued")
    assigned = make_request("Lead Reads Assigned", coordinator="coord1")
    draft = make_request("Lead Cannot Read Draft", status="Draft")
    login(client, "lead1")

    assert client.get(f"/api/requests/{queued}").status_code == 200
    body = client.get(f"/api/requests/{assigned}").get_json()
    assert body["assigned_coordinator"] == "coord1"
    assert "coordinator_notes" not in body
    assert client.get(f"/api/requests/{draft}").status_code == 403
    assert client.post(f"/api/requests/{queued}/approve", json={}).status_code == 403
    assert client.post(f"/api/requests/{queued}/reject", json={"reason": "No."}).status_code == 403
    assert stored(queued).status == "Submitted"


# @story: SCRUM-86
# @ac: 9
def test_the_lead_cannot_open_a_request_that_is_neither_queued_nor_assigned(client):
    approved = make_request("Approved Without Coordinator", status="Approved")
    login(client, "lead1")

    assert client.get(f"/api/requests/{approved}").status_code == 403
