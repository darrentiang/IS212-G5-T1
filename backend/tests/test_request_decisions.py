"""SCRUM-29: approve or reject a Submitted event request."""

from datetime import datetime, timezone

from db import db
from models import Account, EventRequest

REQUEST_FIELDS = {
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


def login_as(client, app, username):
    with app.app_context():
        account_id = db.session.query(Account).filter_by(username=username).one().id
    with client.session_transaction() as session:
        session["account_id"] = account_id
    return account_id


def make_request(app, status="Submitted", owner="org1", **extra):
    owner_id = db.session.query(Account).filter_by(username=owner).one().id
    event_request = EventRequest(
        created_by_id=owner_id,
        status=status,
        submitted_at=datetime(2026, 9, 20, 9, 30, tzinfo=timezone.utc),
        **REQUEST_FIELDS,
        **extra,
    )
    db.session.add(event_request)
    db.session.commit()
    return event_request.id


def stored(app, request_id):
    """The row as the database now holds it, not a cached copy."""
    db.session.expire_all()
    return db.session.get(EventRequest, request_id)


# @story: SCRUM-29
# @ac: 2
def test_coordinator_sees_every_submitted_field_date_and_organiser(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app)
    body = client.get(f"/api/requests/{request_id}").get_json()
    for field, value in REQUEST_FIELDS.items():
        assert body[field] == value
    assert body["submitted_at"].startswith("2026-09-20T09:30")
    assert body["created_by"] == "org1"
    assert body["decision"] is None


# @story: SCRUM-29
# @ac: 1, 3, 5
def test_approve_without_reason_records_the_decision(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app)
    resp = client.post(f"/api/requests/{request_id}/approve", json={"reason": "   "})
    assert resp.status_code == 200
    body = resp.get_json()
    # SCRUM-86: approving assigns no one and does not start planning.
    assert body["status"] == "Approved"
    assert body["decision"] == "Approved"
    assert body["decision_reason"] is None
    assert body["decided_by"] == "coord1"
    assert body["decided_at"] is not None

    saved = stored(app, request_id)
    assert saved.status == "Approved"
    assert saved.decided_at is not None
    assert saved.decided_by.username == "coord1"


# @story: SCRUM-29
# @ac: 3
def test_approve_with_no_body_is_accepted(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app)
    resp = client.post(f"/api/requests/{request_id}/approve")
    assert resp.status_code == 200
    assert resp.get_json()["decision_reason"] is None


# @story: SCRUM-29
# @ac: 3, 5
def test_approve_with_reason_keeps_the_reason(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app)
    resp = client.post(f"/api/requests/{request_id}/approve", json={"reason": " Fits the autumn calendar. "})
    assert resp.status_code == 200
    assert resp.get_json()["decision_reason"] == "Fits the autumn calendar."
    assert stored(app, request_id).decision_reason == "Fits the autumn calendar."


# @story: SCRUM-29
# @ac: 4, 5
def test_reject_with_reason_records_the_decision(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app)
    resp = client.post(f"/api/requests/{request_id}/reject", json={"reason": "Venue capacity cannot be met."})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Rejected"
    assert body["decision"] == "Rejected"
    assert body["decision_reason"] == "Venue capacity cannot be met."
    assert body["decided_by"] == "coord1"
    assert body["decided_at"] is not None


# @story: SCRUM-29
# @ac: 4
def test_reject_without_reason_is_refused_and_nothing_changes(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app)
    for body in ({}, {"reason": ""}, {"reason": "   "}, {"reason": None}):
        resp = client.post(f"/api/requests/{request_id}/reject", json=body)
        assert resp.status_code == 400
        assert resp.get_json()["message"] == "A reason is required to reject."
    saved = stored(app, request_id)
    assert saved.status == "Submitted"
    assert saved.decision is None
    assert saved.decision_reason is None
    assert saved.decided_at is None
    assert saved.decided_by_id is None


# @story: SCRUM-29
# @ac: 1
def test_deciding_a_request_that_is_not_submitted_is_refused(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app, status="Confirmed")
    for action in ("approve", "reject"):
        resp = client.post(f"/api/requests/{request_id}/{action}", json={"reason": "Changed my mind."})
        assert resp.status_code == 409
        assert resp.get_json()["message"] == "Only a Submitted request can be decided."
    saved = stored(app, request_id)
    assert saved.status == "Confirmed"
    assert saved.decision is None


# @story: SCRUM-29
# @ac: 1
def test_coordinator_cannot_decide_a_draft(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app, status="Draft")
    resp = client.post(f"/api/requests/{request_id}/approve")
    assert resp.status_code == 403
    assert stored(app, request_id).status == "Draft"


# @story: SCRUM-29
# @ac: 1
def test_deciding_an_unknown_request_is_404(client, app):
    login_as(client, app, "coord1")
    resp = client.post("/api/requests/99999/approve")
    assert resp.status_code == 404


# @story: SCRUM-29
# @ac: 1
def test_organiser_cannot_decide_even_their_own_request(client, app):
    login_as(client, app, "org1")
    request_id = make_request(app)
    for action in ("approve", "reject"):
        resp = client.post(f"/api/requests/{request_id}/{action}", json={"reason": "Mine."})
        assert resp.status_code == 403
    saved = stored(app, request_id)
    assert saved.status == "Submitted"
    assert saved.decision is None


# @story: SCRUM-29
# @ac: 1
def test_logged_out_cannot_decide(client, app):
    request_id = make_request(app)
    resp = client.post(f"/api/requests/{request_id}/approve")
    assert resp.status_code == 401


# @story: SCRUM-29
# @ac: 1
def test_multi_role_coordinator_may_decide(client, app):
    login_as(client, app, "multi1")
    request_id = make_request(app)
    resp = client.post(f"/api/requests/{request_id}/approve")
    assert resp.status_code == 200
    assert resp.get_json()["decided_by"] == "multi1"


# @story: SCRUM-29
# @ac: 7
def test_second_decision_is_refused_with_existing_decision_and_date(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(
        app,
        status="Approved",
        decision="Approved",
        decided_at=datetime(2026, 9, 23, 14, 5, tzinfo=timezone.utc),
        decided_by_id=db.session.query(Account).filter_by(username="coord1").one().id,
    )
    for action in ("approve", "reject"):
        resp = client.post(f"/api/requests/{request_id}/{action}", json={"reason": "Changed my mind."})
        assert resp.status_code == 409
        assert resp.get_json()["message"] == (
            "This request has already been decided (Approved on 23 Sep 2026, 14:05)."
        )
    saved = stored(app, request_id)
    assert saved.status == "Approved"
    assert saved.decision_reason is None
    assert saved.decided_at.replace(tzinfo=None) == datetime(2026, 9, 23, 14, 5)
    assert saved.decided_by.username == "coord1"


# @story: SCRUM-29
# @ac: 7
def test_second_decision_after_a_live_decision_is_refused(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app)
    client.post(f"/api/requests/{request_id}/reject", json={"reason": "Venue capacity cannot be met."})
    login_as(client, app, "coord2")
    resp = client.post(f"/api/requests/{request_id}/approve")
    assert resp.status_code == 409
    assert resp.get_json()["message"].startswith("This request has already been decided (Rejected on ")
    saved = stored(app, request_id)
    assert saved.status == "Rejected"
    assert saved.decided_by.username == "coord1"


# @story: SCRUM-29
# @ac: 7
def test_decided_request_without_a_date_is_refused_naming_the_decision(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app, status="Rejected", decision="Rejected", decision_reason="Too late.")
    resp = client.post(f"/api/requests/{request_id}/approve")
    assert resp.status_code == 409
    assert resp.get_json()["message"] == "This request has already been decided (Rejected)."


# @story: SCRUM-29
# @ac: 6
def test_organiser_sees_the_decision_status_and_reason(client, app):
    login_as(client, app, "coord1")
    request_id = make_request(app)
    client.post(f"/api/requests/{request_id}/reject", json={"reason": "Venue capacity cannot be met."})

    login_as(client, app, "org1")
    body = client.get(f"/api/requests/{request_id}").get_json()
    assert body["status"] == "Rejected"
    assert body["decision"] == "Rejected"
    assert body["decision_reason"] == "Venue capacity cannot be met."
    assert body["decided_by"] == "coord1"
    assert body["decided_at"] is not None
    assert "coordinator_notes" not in body
