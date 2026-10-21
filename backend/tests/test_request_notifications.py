"""SCRUM-62: Notify on Event Request Decisions — submitting or resubmitting a
request, assigning it a coordinator, and approving or rejecting it each tell
the Event Organiser who created it once, naming the event, in the same commit
as the action; a saved Draft and a refused action tell nobody.

Every test builds its own requests with tests/factories.py or through the API.
The assignment and reassignment notices themselves are SCRUM-86's and
SCRUM-44's; they are checked here only as AC2.
"""

from datetime import date, timedelta

import pytest

from db import db
from factories import account, make_event
from models import EventRequest, Notification

# A fixed date becomes a past date and fails the "not before today" rule.
DATE = (date.today() + timedelta(days=30)).isoformat()

REQUEST = {
    "name": "Annual Gala",
    "purpose": "Alumni dinner",
    "description": "Yearly alumni dinner",
    "date": DATE,
    "start_time": "10:00",
    "end_time": "12:00",
    "attendance": 40,
    "equipment_requirements": "Projector",
    "registration_needs": "Online sign-up",
}


def login_as(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def event(name="Annual Gala", status="Submitted", coordinator="coord1", attendance=40, **fields):
    """A request with every required field filled, so submitting it can succeed."""
    return make_event(
        name=name,
        status=status,
        date=DATE,
        start_time="10:00",
        end_time="12:00",
        attendance=attendance,
        purpose="Alumni dinner",
        description="Yearly alumni dinner",
        equipment_requirements="Projector",
        registration_needs="Online sign-up",
        assigned_coordinator=account(coordinator) if coordinator else None,
        **fields,
    )


def notifications_about(gala_id):
    """Every notification of the event, oldest first, as (recipient, message)."""
    db.session.expire_all()
    rows = (
        db.session.query(Notification)
        .filter_by(event_request_id=gala_id)
        .order_by(Notification.id)
        .all()
    )
    return [(row.recipient.username, row.message) for row in rows]


def notification_count():
    db.session.expire_all()
    return db.session.query(Notification).count()


def status_of(gala_id):
    db.session.expire_all()
    return db.session.get(EventRequest, gala_id).status


# @story: SCRUM-62
# @ac: 1, 8
def test_submitting_a_new_request_tells_its_organiser_it_was_received(app, client):
    login_as(client, "org1")

    resp = client.post("/api/requests", json=REQUEST)

    assert resp.status_code == 201
    assert notifications_about(resp.get_json()["id"]) == [("org1", 'Your request "Annual Gala" was received.')]


# @story: SCRUM-62
# @ac: 8
def test_the_received_notice_appears_in_the_organisers_notifications_with_the_event(app, client):
    login_as(client, "org1")
    gala_id = client.post("/api/requests", json=REQUEST).get_json()["id"]

    rows = [row for row in client.get("/api/notifications").get_json() if row["event_request_id"] == gala_id]

    assert len(rows) == 1
    assert (rows[0]["event_request_id"], rows[0]["event_request_name"]) == (gala_id, "Annual Gala")
    assert rows[0]["read"] is False


# @story: SCRUM-62
# @ac: 1
def test_submitting_a_saved_draft_tells_its_organiser_it_was_received(app, client):
    draft = event(status="Draft", coordinator=None)
    login_as(client, "org1")

    resp = client.post(f"/api/requests/{draft.id}/submit")

    assert resp.status_code == 200
    assert notifications_about(draft.id) == [("org1", 'Your request "Annual Gala" was received.')]


# @story: SCRUM-62
# @ac: 1
def test_resubmitting_a_rejected_request_tells_its_organiser_it_was_received_again(app, client):
    gala = event(status="Rejected", decision="Rejected", decision_reason="Date clashes with exams")
    login_as(client, "org1")

    resp = client.post(f"/api/requests/{gala.id}/resubmit", json={**REQUEST, "name": "Annual Gala Revised"})

    assert resp.status_code == 200
    # The notice names the event as resubmitted, under its new name.
    assert notifications_about(gala.id) == [("org1", 'Your request "Annual Gala Revised" was received.')]


# @story: SCRUM-62
# @ac: 2
def test_assigning_a_coordinator_tells_the_organiser_once_naming_the_coordinator(app, client):
    gala = event(coordinator=None)
    login_as(client, "lead1")

    resp = client.post(f"/api/requests/{gala.id}/assign", json={"coordinator_id": account("coord1").id})

    assert resp.status_code == 200
    to_organiser = [message for who, message in notifications_about(gala.id) if who == "org1"]
    assert to_organiser == ['coord1 has been assigned to your event "Annual Gala".']


# @story: SCRUM-62
# @ac: 2
def test_reassigning_tells_the_organiser_once_naming_the_new_coordinator(app, client):
    gala = event(status="Planning", coordinator="coord1")
    login_as(client, "lead1")

    resp = client.post(f"/api/requests/{gala.id}/reassign", json={"coordinator_id": account("coord2").id})

    assert resp.status_code == 200
    to_organiser = [message for who, message in notifications_about(gala.id) if who == "org1"]
    assert to_organiser == ['coord2 has been assigned to your event "Annual Gala".']


# @story: SCRUM-62
# @ac: 6
def test_a_refused_reassignment_tells_the_organiser_nothing(app, client):
    gala = event(status="Planning", coordinator="coord1")
    login_as(client, "lead1")

    # The coordinator it already has: SCRUM-44 refuses the move.
    resp = client.post(f"/api/requests/{gala.id}/reassign", json={"coordinator_id": account("coord1").id})

    assert resp.status_code == 409
    assert notifications_about(gala.id) == []


# @story: SCRUM-62
# @ac: 3
def test_approving_with_a_reason_tells_the_organiser_with_the_reason(app, client):
    gala = event()
    login_as(client, "coord1")

    resp = client.post(f"/api/requests/{gala.id}/approve", json={"reason": "Fits the calendar."})

    assert resp.status_code == 200
    assert notifications_about(gala.id) == [
        ("org1", 'Your request "Annual Gala" was approved. Reason: Fits the calendar.')
    ]


# @story: SCRUM-62
# @ac: 3
@pytest.mark.parametrize("body", [{}, {"reason": ""}, {"reason": "   "}])
def test_approving_without_a_reason_tells_the_organiser_with_no_reason_part(app, client, body):
    gala = event()
    login_as(client, "coord1")

    resp = client.post(f"/api/requests/{gala.id}/approve", json=body)

    assert resp.status_code == 200
    assert notifications_about(gala.id) == [("org1", 'Your request "Annual Gala" was approved.')]


# @story: SCRUM-62
# @ac: 4
def test_rejecting_tells_the_organiser_with_the_reason(app, client):
    gala = event()
    login_as(client, "coord1")

    resp = client.post(f"/api/requests/{gala.id}/reject", json={"reason": "Date clashes with exams"})

    assert resp.status_code == 200
    assert notifications_about(gala.id) == [
        ("org1", 'Your request "Annual Gala" was rejected. Reason: Date clashes with exams')
    ]


# @story: SCRUM-62
# @ac: 5
def test_only_the_creating_organiser_is_told_of_a_submission_and_a_decision(app, client):
    # org2's request, so a notice wrongly sent to org1 (the usual owner) would show.
    login_as(client, "org2")
    gala_id = client.post("/api/requests", json=REQUEST).get_json()["id"]
    gala = db.session.get(EventRequest, gala_id)
    gala.assigned_coordinator = account("coord1")
    db.session.commit()
    login_as(client, "coord1")

    client.post(f"/api/requests/{gala_id}/reject", json={"reason": "Date clashes with exams"})

    assert {who for who, _ in notifications_about(gala_id)} == {"org2"}


# @story: SCRUM-62
# @ac: 6
def test_saving_and_editing_a_draft_tells_nobody(app, client):
    # org2: the seed already gives org1 its one open Draft.
    login_as(client, "org2")
    before = notification_count()

    draft_id = client.post("/api/requests/draft", json=REQUEST).get_json()["id"]
    resp = client.put(f"/api/requests/{draft_id}", json={**REQUEST, "attendance": 35})

    assert resp.status_code == 200
    assert status_of(draft_id) == "Draft"
    assert notification_count() == before


# @story: SCRUM-62
# @ac: 6
@pytest.mark.parametrize(
    "change",
    [
        {"attendance": ""},  # a required field missing
        {"date": (date.today() - timedelta(days=1)).isoformat()},  # a business rule broken
    ],
)
def test_a_refused_submission_records_nothing_and_tells_nobody(app, client, change):
    login_as(client, "org1")
    before = notification_count()

    resp = client.post("/api/requests", json={**REQUEST, **change})

    assert resp.status_code == 400
    assert db.session.query(EventRequest).filter_by(name="Annual Gala").count() == 0
    assert notification_count() == before


# @story: SCRUM-62
# @ac: 6
def test_a_refused_draft_submission_tells_nobody(app, client):
    draft = event(status="Draft", coordinator=None, attendance=None)
    login_as(client, "org1")

    resp = client.post(f"/api/requests/{draft.id}/submit")

    assert resp.status_code == 400
    assert status_of(draft.id) == "Draft"
    assert notifications_about(draft.id) == []


# @story: SCRUM-62
# @ac: 6
def test_a_refused_resubmission_leaves_the_request_rejected_and_tells_nobody(app, client):
    gala = event(status="Rejected", decision="Rejected", decision_reason="Date clashes with exams")
    login_as(client, "org1")

    resp = client.post(f"/api/requests/{gala.id}/resubmit", json={**REQUEST, "attendance": ""})

    assert resp.status_code == 400
    assert status_of(gala.id) == "Rejected"
    assert notifications_about(gala.id) == []


# @story: SCRUM-62
# @ac: 6
@pytest.mark.parametrize(
    "who,action,body",
    [
        ("coord2", "approve", {"reason": "Fits the calendar."}),  # not the assigned coordinator
        ("coord2", "reject", {"reason": "Not mine"}),
        ("coord1", "reject", {"reason": "  "}),  # a rejection needs a reason
    ],
)
def test_a_refused_decision_leaves_the_request_submitted_and_tells_nobody(app, client, who, action, body):
    gala = event()
    login_as(client, who)

    resp = client.post(f"/api/requests/{gala.id}/{action}", json=body)

    assert resp.status_code in (400, 403)
    assert status_of(gala.id) == "Submitted"
    assert notifications_about(gala.id) == []


# @story: SCRUM-62
# @ac: 6
def test_deciding_a_request_still_in_the_unassigned_queue_is_refused_and_tells_nobody(app, client):
    gala = event(coordinator=None)
    login_as(client, "coord1")

    resp = client.post(f"/api/requests/{gala.id}/approve", json={})

    assert resp.status_code == 403
    assert notifications_about(gala.id) == []


# @story: SCRUM-62
# @ac: 7
def test_repeating_a_refused_approval_adds_no_notice(app, client):
    gala = event()
    login_as(client, "coord1")
    assert client.post(f"/api/requests/{gala.id}/approve", json={}).status_code == 200

    second = client.post(f"/api/requests/{gala.id}/approve", json={})
    third = client.post(f"/api/requests/{gala.id}/reject", json={"reason": "Changed my mind"})

    assert (second.status_code, third.status_code) == (409, 409)
    assert notifications_about(gala.id) == [("org1", 'Your request "Annual Gala" was approved.')]


# @story: SCRUM-62
# @ac: 7
def test_submitting_a_draft_twice_tells_the_organiser_once(app, client):
    draft = event(status="Draft", coordinator=None)
    login_as(client, "org1")
    assert client.post(f"/api/requests/{draft.id}/submit").status_code == 200

    again = client.post(f"/api/requests/{draft.id}/submit")

    assert again.status_code == 400
    assert notifications_about(draft.id) == [("org1", 'Your request "Annual Gala" was received.')]
