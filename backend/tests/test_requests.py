# @story: SCRUM-27, SCRUM-28, SCRUM-30
# @ac: SCRUM-28 1-10; SCRUM-30 1-10 (below the SCRUM-27/28 sections)

from datetime import date, timedelta

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


# --- Negative: AC7, date cannot be earlier than today ---


def test_direct_submit_with_past_date_is_refused(client, app):
    login_as(client, app, "org1")
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    resp = client.post("/api/requests", json={**VALID_REQUEST, "date": yesterday})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Date cannot be earlier than today."


def test_direct_submit_with_todays_date_is_accepted(client, app):
    login_as(client, app, "org1")
    resp = client.post("/api/requests", json={**VALID_REQUEST, "date": date.today().isoformat()})
    assert resp.status_code == 201


def test_direct_submit_with_malformed_date_is_refused(client, app):
    login_as(client, app, "org1")
    resp = client.post("/api/requests", json={**VALID_REQUEST, "date": "20 Nov 2026"})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Date must be a valid date."


def test_submit_draft_with_past_date_is_refused(client, app):
    login_as(client, app, "org1")
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    draft_id = make_draft(app, "org1", date=yesterday)
    resp = client.post(f"/api/requests/{draft_id}/submit")
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Date cannot be earlier than today."


# --- Negative: AC8, start time cannot be later than or equal to end time ---


def test_direct_submit_with_start_after_end_is_refused(client, app):
    login_as(client, app, "org1")
    resp = client.post(
        "/api/requests", json={**VALID_REQUEST, "start_time": "17:00", "end_time": "09:00"}
    )
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Start time must be before the end time."


def test_direct_submit_with_start_equal_end_is_refused(client, app):
    login_as(client, app, "org1")
    resp = client.post(
        "/api/requests", json={**VALID_REQUEST, "start_time": "09:00", "end_time": "09:00"}
    )
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Start time must be before the end time."


def test_direct_submit_with_malformed_time_is_refused(client, app):
    login_as(client, app, "org1")
    resp = client.post("/api/requests", json={**VALID_REQUEST, "start_time": "9am"})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Start and end time must be valid times."


def test_submit_draft_with_start_after_end_is_refused(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1", start_time="17:00", end_time="09:00")
    resp = client.post(f"/api/requests/{draft_id}/submit")
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Start time must be before the end time."


# --- Negative: AC9, attendance must be a positive whole number ---


def test_direct_submit_with_negative_attendance_is_refused(client, app):
    login_as(client, app, "org1")
    resp = client.post("/api/requests", json={**VALID_REQUEST, "attendance": -5})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Attendance must be a positive whole number."


def test_direct_submit_with_zero_attendance_is_refused(client, app):
    login_as(client, app, "org1")
    resp = client.post("/api/requests", json={**VALID_REQUEST, "attendance": 0})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Attendance must be a positive whole number."


def test_direct_submit_with_decimal_attendance_is_refused(client, app):
    login_as(client, app, "org1")
    resp = client.post("/api/requests", json={**VALID_REQUEST, "attendance": 20.5})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Attendance must be a positive whole number."


def test_direct_submit_with_non_numeric_attendance_is_refused(client, app):
    login_as(client, app, "org1")
    resp = client.post("/api/requests", json={**VALID_REQUEST, "attendance": "abc"})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Attendance must be a positive whole number."


def test_submit_draft_with_invalid_attendance_is_refused(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1", attendance=-1)
    resp = client.post(f"/api/requests/{draft_id}/submit")
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Attendance must be a positive whole number."


# --- Negative: AC10, a required field of only whitespace is treated as missing ---


def test_direct_submit_with_whitespace_only_field_is_refused_and_named(client, app):
    for field in EventRequest.REQUIRED_FIELDS:
        login_as(client, app, "org1")
        resp = client.post("/api/requests", json={**VALID_REQUEST, field: "   "})
        assert resp.status_code == 400, f"expected refusal when '{field}' is whitespace only"
        assert field in resp.get_json()["message"]


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


# ==========================================================================
# SCRUM-30: save, edit and delete a Draft
# ==========================================================================

# --- Happy: AC1, AC9, a draft can be saved with just a name ---


def test_save_draft_with_only_name_succeeds(client, app):
    # org2, not org1: the seed data already gives org1 an open Draft.
    login_as(client, app, "org2")
    resp = client.post("/api/requests/draft", json={"name": "Tech Fair 2026"})
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["status"] == "Draft"
    assert body["name"] == "Tech Fair 2026"


def test_save_draft_leaves_unset_fields_empty(client, app):
    login_as(client, app, "org2")
    resp = client.post("/api/requests/draft", json={"name": "Tech Fair 2026"})
    body = resp.get_json()
    assert body["purpose"] is None
    assert body["attendance"] is None


# --- Happy: AC6, an invalid field value is accepted; validated only at submit ---


def test_save_draft_with_invalid_attendance_is_accepted(client, app):
    login_as(client, app, "org2")
    resp = client.post(
        "/api/requests/draft", json={"name": "Tech Fair 2026", "attendance": -5}
    )
    assert resp.status_code == 201
    assert resp.get_json()["attendance"] == -5


# --- Negative: AC9, a draft cannot be saved with no fields at all ---


def test_save_draft_without_a_name_is_refused(client, app):
    login_as(client, app, "org2")
    resp = client.post("/api/requests/draft", json={})
    assert resp.status_code == 400
    assert "name" in resp.get_json()["message"]


def test_save_draft_with_whitespace_only_name_is_refused(client, app):
    login_as(client, app, "org2")
    resp = client.post("/api/requests/draft", json={"name": "   "})
    assert resp.status_code == 400
    assert "name" in resp.get_json()["message"]


# --- Negative: AC7, only one open draft at a time ---


def test_save_second_draft_while_one_is_open_is_refused(client, app):
    login_as(client, app, "org1")
    make_draft(app, "org1", name="First draft")
    resp = client.post("/api/requests/draft", json={"name": "Second draft"})
    assert resp.status_code == 400
    assert "draft" in resp.get_json()["message"].lower()


def test_save_draft_allowed_when_existing_requests_are_not_drafts(client, app):
    login_as(client, app, "org2")
    make_draft(app, "org2", status="Submitted", name="Already submitted")
    resp = client.post("/api/requests/draft", json={"name": "New draft"})
    assert resp.status_code == 201


def test_save_draft_allowed_after_deleting_the_open_one(client, app):
    login_as(client, app, "org2")
    draft_id = make_draft(app, "org2", name="First draft")
    delete_resp = client.delete(f"/api/requests/{draft_id}")
    assert delete_resp.status_code == 204

    resp = client.post("/api/requests/draft", json={"name": "New draft"})
    assert resp.status_code == 201


def test_one_draft_limit_is_per_organiser_not_global(client, app):
    # org1 already holds the seeded Draft "Design Workshop" throughout this
    # file; org2 saving their own must not be blocked by it.
    login_as(client, app, "org2")
    resp = client.post("/api/requests/draft", json={"name": "Org 2 Draft"})
    assert resp.status_code == 201

    with app.app_context():
        org1_id = db.session.query(Account).filter_by(username="org1").one().id
        org1_drafts = (
            db.session.query(EventRequest)
            .filter_by(created_by_id=org1_id, status="Draft")
            .count()
        )
        assert org1_drafts == 1


# --- Happy: AC6, an invalid date or time is also accepted; validated only at submit ---


def test_save_draft_with_invalid_date_is_accepted(client, app):
    login_as(client, app, "org2")
    resp = client.post(
        "/api/requests/draft", json={"name": "Tech Fair 2026", "date": "not-a-date"}
    )
    assert resp.status_code == 201
    assert resp.get_json()["date"] == "not-a-date"


def test_save_draft_with_invalid_time_is_accepted(client, app):
    login_as(client, app, "org2")
    resp = client.post(
        "/api/requests/draft", json={"name": "Tech Fair 2026", "start_time": "9am", "end_time": "5pm"}
    )
    assert resp.status_code == 201
    assert resp.get_json()["start_time"] == "9am"


# --- Negative: only an Event Organiser may save a draft ---


def test_non_organiser_cannot_save_a_draft(client, app):
    login_as(client, app, "coord1")
    resp = client.post("/api/requests/draft", json={"name": "Tech Fair 2026"})
    assert resp.status_code == 403


def test_attendee_cannot_save_a_draft(client, app):
    login_as(client, app, "att1")
    resp = client.post("/api/requests/draft", json={"name": "Tech Fair 2026"})
    assert resp.status_code == 403


def test_logged_out_cannot_save_a_draft(client, app):
    resp = client.post("/api/requests/draft", json={"name": "Tech Fair 2026"})
    assert resp.status_code == 401


# --- Cross: AC2, a draft never appears in a Coordinator's list ---


def test_coordinator_does_not_see_a_newly_saved_draft(client, app):
    login_as(client, app, "org2")
    created = client.post("/api/requests/draft", json={"name": "Tech Fair 2026"})
    assert created.status_code == 201
    login_as(client, app, "coord1")
    resp = client.get("/api/requests")
    names = [r["name"] for r in resp.get_json()]
    assert "Tech Fair 2026" not in names


def test_other_organiser_does_not_see_a_draft_in_their_list(client, app):
    make_draft(app, "org1", name="Org 1 Secret Draft")
    login_as(client, app, "org2")
    resp = client.get("/api/requests")
    assert resp.status_code == 200
    names = [r["name"] for r in resp.get_json()]
    assert "Org 1 Secret Draft" not in names


# --- Happy: AC3, the creating Organiser can reopen (view) their own draft ---


def test_organiser_can_view_their_own_draft(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1", name="My own draft")
    resp = client.get(f"/api/requests/{draft_id}")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["name"] == "My own draft"
    assert body["status"] == "Draft"


# --- Negative: AC10, viewing a draft directly by id is refused for anyone else ---
# (a Coordinator's refusal is already proven by SCRUM-27's
# test_coordinator_cannot_view_a_draft_request, above)


def test_other_organiser_cannot_view_a_draft_directly(client, app):
    draft_id = make_draft(app, "org1", name="Not yours")
    login_as(client, app, "org2")
    resp = client.get(f"/api/requests/{draft_id}")
    assert resp.status_code == 403


# --- Happy: AC3, the creating Organiser can edit any field of their own draft ---


def test_update_draft_changes_the_name(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1", name="Old name")
    resp = client.put(f"/api/requests/{draft_id}", json={"name": "New name"})
    assert resp.status_code == 200
    assert resp.get_json()["name"] == "New name"


def test_update_draft_cannot_change_status_directly(client, app):
    """AC3 lets the Organiser edit fields, not bypass Submit (SCRUM-28) by
    smuggling a status change through the edit endpoint. 200, not 400:
    `status` is silently dropped the same way _apply_fields already drops
    any other field outside EventRequest.REQUIRED_FIELDS (id, created_by_id,
    submitted_at, ...) — it is not a validation failure on an editable
    field, so it is not treated as one."""
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1")
    resp = client.put(f"/api/requests/{draft_id}", json={"status": "Submitted"})
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Draft"
    with app.app_context():
        assert db.session.get(EventRequest, draft_id).status == "Draft"


def test_update_draft_changes_any_other_field(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1")
    resp = client.put(f"/api/requests/{draft_id}", json={"attendance": 50})
    assert resp.status_code == 200
    assert resp.get_json()["attendance"] == 50


def test_update_draft_with_invalid_fields_is_accepted(client, app):
    """AC6 applies to an edit, not just the initial save."""
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1")
    resp = client.put(
        f"/api/requests/{draft_id}", json={"attendance": -10, "date": "not-a-date"}
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["attendance"] == -10
    assert body["date"] == "not-a-date"


def test_update_draft_with_empty_payload_makes_no_changes(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1", name="Original Name")
    resp = client.put(f"/api/requests/{draft_id}", json={})
    assert resp.status_code == 200
    assert resp.get_json()["name"] == "Original Name"


def test_update_draft_with_blank_name_is_refused(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1")
    resp = client.put(f"/api/requests/{draft_id}", json={"name": "   "})
    assert resp.status_code == 400
    assert "name" in resp.get_json()["message"]


def test_update_a_submitted_request_is_refused(client, app):
    login_as(client, app, "org1")
    request_id = make_draft(app, "org1", status="Submitted")
    resp = client.put(f"/api/requests/{request_id}", json={"name": "New name"})
    assert resp.status_code == 400
    assert "Draft" in resp.get_json()["message"]


# --- Negative: AC3, AC10, only the creating Organiser may edit a draft ---


def test_other_organiser_cannot_edit_a_draft(client, app):
    draft_id = make_draft(app, "org1")
    login_as(client, app, "org2")
    resp = client.put(f"/api/requests/{draft_id}", json={"name": "Hijacked"})
    assert resp.status_code == 404


def test_coordinator_cannot_edit_a_draft(client, app):
    draft_id = make_draft(app, "org1")
    login_as(client, app, "coord1")
    resp = client.put(f"/api/requests/{draft_id}", json={"name": "Hijacked"})
    assert resp.status_code == 403


# --- Happy: AC3, AC8, the creating Organiser can permanently delete their draft ---


def test_delete_own_draft_succeeds(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1")
    resp = client.delete(f"/api/requests/{draft_id}")
    assert resp.status_code == 204


def test_delete_non_existent_draft_is_404(client, app):
    login_as(client, app, "org1")
    resp = client.delete("/api/requests/999999")
    assert resp.status_code == 404


def test_deleted_draft_is_not_recoverable(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1")
    client.delete(f"/api/requests/{draft_id}")
    resp = client.get(f"/api/requests/{draft_id}")
    assert resp.status_code == 404


def test_deleted_draft_does_not_appear_in_list(client, app):
    login_as(client, app, "org1")
    draft_id = make_draft(app, "org1", name="Gone soon")
    client.delete(f"/api/requests/{draft_id}")
    resp = client.get("/api/requests")
    ids = [r["id"] for r in resp.get_json()]
    assert draft_id not in ids


# --- Negative: AC4, a Submitted request cannot be deleted as a draft ---


def test_delete_a_submitted_request_is_refused(client, app):
    login_as(client, app, "org1")
    request_id = make_draft(app, "org1", status="Submitted")
    resp = client.delete(f"/api/requests/{request_id}")
    assert resp.status_code == 400
    assert "Draft" in resp.get_json()["message"]
    with app.app_context():
        assert db.session.get(EventRequest, request_id) is not None


# --- Negative: AC3, AC10, only the creating Organiser may delete a draft ---


def test_other_organiser_cannot_delete_a_draft(client, app):
    draft_id = make_draft(app, "org1")
    login_as(client, app, "org2")
    resp = client.delete(f"/api/requests/{draft_id}")
    assert resp.status_code == 404
    with app.app_context():
        assert db.session.get(EventRequest, draft_id) is not None


def test_coordinator_cannot_delete_a_draft(client, app):
    draft_id = make_draft(app, "org1")
    login_as(client, app, "coord1")
    resp = client.delete(f"/api/requests/{draft_id}")
    assert resp.status_code == 403
    with app.app_context():
        assert db.session.get(EventRequest, draft_id) is not None
