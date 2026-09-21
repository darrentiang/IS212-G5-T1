# @story: SCRUM-28
# @ac: 1, 2, 3, 4, 5, 6

from db import db
from models import Account, EventRequest

VALID_REQUEST = {
    "name": "Tech Fair 2026",
    "purpose": "Career networking",
    "description": "Annual tech career fair",
    "date": "2026-11-20",
    "start_time": "09:00",
    "end_time": "17:00",
    "attendance": 200,
    "venue_requirements": "Large hall with stage",
    "accessibility_needs": "Wheelchair access",
    "equipment_requirements": "Projector, microphones",
    "registration_needs": "Online registration with capacity cap",
}


def login_as(client, app, username):
    with app.app_context():
        account_id = db.session.query(Account).filter_by(username=username).one().id
    with client.session_transaction() as session:
        session["account_id"] = account_id
    return account_id


def make_draft(app, username, status="Draft", **overrides):
    with app.app_context():
        organiser_id = db.session.query(Account).filter_by(username=username).one().id
        data = {**VALID_REQUEST, **overrides}
        draft = EventRequest(created_by_id=organiser_id, status=status, **data)
        db.session.add(draft)
        db.session.commit()
        return draft.id


# --- Happy: direct submit and submit-from-draft (AC1, AC2, AC4, AC6) ---


def test_submit_new_request_directly_becomes_submitted(client, app):
    login_as(client, app, "org1")
    resp = client.post("/api/requests", json=VALID_REQUEST)
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["status"] == "Submitted"
    assert body["submitted_at"] is not None


def test_submit_existing_draft_becomes_submitted(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1")
    resp = client.post(f"/api/requests/{draft_id}/submit")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Submitted"
    assert body["submitted_at"] is not None


# --- Negative: AC2, request can be submitted only while new or Draft ---


def test_submitting_an_already_submitted_request_is_refused(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1", status="Submitted")
    resp = client.post(f"/api/requests/{draft_id}/submit")
    assert resp.status_code == 400
    assert "Draft" in resp.get_json()["message"]


def test_submitting_someone_elses_draft_is_refused(client, app):
    login_as(client, app, "org2")
    draft_id = make_draft(app, "org1")
    resp = client.post(f"/api/requests/{draft_id}/submit")
    assert resp.status_code == 404


# --- Negative: AC1, AC3, every required field missing individually ---


def test_direct_submit_missing_single_field_is_refused_and_named(client, app):
    for field in EventRequest.REQUIRED_FIELDS:
        login_as(client, app, "org1")
        incomplete = {k: v for k, v in VALID_REQUEST.items() if k != field}
        resp = client.post("/api/requests", json=incomplete)
        assert resp.status_code == 400, f"expected refusal when '{field}' is missing"
        assert field in resp.get_json()["message"]


def test_direct_submit_reports_every_missing_field_at_once(client, app):
    login_as(client, app, "org1")
    resp = client.post("/api/requests", json={"name": "Only name given"})
    assert resp.status_code == 400
    message = resp.get_json()["message"]
    for field in EventRequest.REQUIRED_FIELDS:
        if field != "name":
            assert field in message


def test_direct_submit_with_missing_field_records_nothing(client, app):
    login_as(client, app, "org1")
    with app.app_context():
        before = db.session.query(EventRequest).count()
    client.post("/api/requests", json={"name": "Incomplete request"})
    with app.app_context():
        assert db.session.query(EventRequest).count() == before


def test_submit_draft_missing_field_is_refused(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1", venue_requirements="")
    resp = client.post(f"/api/requests/{draft_id}/submit")
    assert resp.status_code == 400
    assert "venue_requirements" in resp.get_json()["message"]


# --- Negative: only an Event Organiser may submit ---


def test_non_organiser_cannot_submit_a_request(client, app):
    login_as(client, app, "coord1")
    resp = client.post("/api/requests", json=VALID_REQUEST)
    assert resp.status_code == 403


def test_logged_out_cannot_submit_a_request(client, app):
    resp = client.post("/api/requests", json=VALID_REQUEST)
    assert resp.status_code == 401


# --- Cross: AC5, visible to Event Coordinators; not visible while Draft ---


def test_coordinator_sees_submitted_request(client, app):
    draft_id = make_draft(app, "org1", status="Submitted")
    login_as(client, app, "coord1")
    resp = client.get("/api/requests")
    assert resp.status_code == 200
    ids = [r["id"] for r in resp.get_json()]
    assert draft_id in ids


def test_coordinator_does_not_see_draft_request(client, app):
    draft_id = make_draft(app, "org1")
    login_as(client, app, "coord1")
    resp = client.get("/api/requests")
    ids = [r["id"] for r in resp.get_json()]
    assert draft_id not in ids


def test_other_organiser_cannot_view_request(client, app):
    draft_id = make_draft(app, "org1", status="Submitted")
    login_as(client, app, "org2")
    resp = client.get(f"/api/requests/{draft_id}")
    assert resp.status_code == 403


# --- AC6: the organiser can see it was received and its current status ---


def test_organiser_sees_own_request_status(client, app):
    login_as(client, app, "org1")
    created = client.post("/api/requests", json=VALID_REQUEST).get_json()
    resp = client.get(f"/api/requests/{created['id']}")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Submitted"


def test_get_unknown_request_is_404(client, app):
    login_as(client, app, "org1")
    resp = client.get("/api/requests/999")
    assert resp.status_code == 404


def test_coordinator_cannot_view_a_draft_request(client, app):
    draft_id = make_draft(app, "org1")
    login_as(client, app, "coord1")
    resp = client.get(f"/api/requests/{draft_id}")
    assert resp.status_code == 403


def test_list_requests_for_a_role_with_no_visibility_is_refused(client, app):
    make_draft(app, "org1", status="Submitted")
    login_as(client, app, "att1")
    resp = client.get("/api/requests")
    assert resp.status_code == 403


def test_stale_session_account_is_treated_as_logged_out(client, app):
    with client.session_transaction() as session:
        session["account_id"] = 999999
    resp = client.get("/api/requests")
    assert resp.status_code == 401


def test_coordinator_can_view_a_submitted_requests_detail(client, app):
    draft_id = make_draft(app, "org1", status="Submitted")
    login_as(client, app, "coord1")
    resp = client.get(f"/api/requests/{draft_id}")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Submitted"


def test_organiser_lists_only_their_own_requests(client, app):
    make_draft(app, "org1", status="Submitted", name="Org1 event")
    make_draft(app, "org2", status="Submitted", name="Org2 event")
    login_as(client, app, "org1")
    resp = client.get("/api/requests")
    names = [r["name"] for r in resp.get_json()]
    assert "Org1 event" in names
    assert "Org2 event" not in names


def test_event_request_repr_shows_id_and_status(app):
    from models import EventRequest

    with app.app_context():
        req = EventRequest(created_by_id=1, status="Draft")
        assert repr(req) == f"<EventRequest {req.id} Draft>"
