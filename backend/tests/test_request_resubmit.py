"""SCRUM-72: revise and resubmit a Rejected event request."""

from datetime import date, datetime, timedelta, timezone

from db import db
from models import Account, EventRequest

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

SUBMITTED_AT = datetime(2026, 9, 20, 9, 30)
DECIDED_AT = datetime(2026, 9, 23, 14, 5)


def login_as(client, app, username):
    with app.app_context():
        account_id = db.session.query(Account).filter_by(username=username).one().id
    with client.session_transaction() as session:
        session["account_id"] = account_id
    return account_id


def make_rejected(app, status="Rejected", owner="org1", **extra):
    owner_id = db.session.query(Account).filter_by(username=owner).one().id
    coordinator_id = db.session.query(Account).filter_by(username="coord1").one().id
    event_request = EventRequest(
        created_by_id=owner_id,
        status=status,
        submitted_at=SUBMITTED_AT,
        decision="Rejected",
        decision_reason="Venue capacity cannot be met.",
        decided_at=DECIDED_AT,
        decided_by_id=coordinator_id,
        **{**FIELDS, **extra},
    )
    db.session.add(event_request)
    db.session.commit()
    return event_request.id


def stored(request_id):
    """The row as the database now holds it, not a cached copy."""
    db.session.expire_all()
    return db.session.get(EventRequest, request_id)


# @story: SCRUM-72
# @ac: 1
def test_creator_reads_a_rejected_request_with_its_reason(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    body = client.get(f"/api/requests/{request_id}").get_json()
    assert body["status"] == "Rejected"
    assert body["decision_reason"] == "Venue capacity cannot be met."
    assert body["decided_by"] == "coord1"


# @story: SCRUM-72
# @ac: 1, 3
def test_resubmit_with_edited_fields_becomes_submitted_with_new_date(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    resp = client.post(
        f"/api/requests/{request_id}/resubmit",
        json={"attendance": "40", "equipment_requirements": "Microphones"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Submitted"
    assert body["attendance"] == 40
    assert body["equipment_requirements"] == "Microphones"
    assert datetime.fromisoformat(body["submitted_at"]).replace(tzinfo=None) > SUBMITTED_AT

    saved = stored(request_id)
    assert saved.status == "Submitted"
    assert saved.attendance == 40
    assert saved.name == FIELDS["name"]


# @story: SCRUM-72
# @ac: 1, 3
def test_resubmit_may_change_every_field_including_the_name(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    changed = {
        **FIELDS,
        "name": "Winter Showcase",
        "purpose": "Partner showcase",
        "description": "Revised description",
        "end_time": "22:00",
        "equipment_requirements": "Microphones",
        "registration_needs": "Public registration",
    }
    resp = client.post(f"/api/requests/{request_id}/resubmit", json=changed)
    assert resp.status_code == 200
    saved = stored(request_id)
    for field in ("name", "purpose", "description", "end_time", "equipment_requirements", "registration_needs"):
        assert getattr(saved, field) == changed[field]


# @story: SCRUM-72
# @ac: 3
def test_resubmit_with_no_changes_is_accepted(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    resp = client.post(f"/api/requests/{request_id}/resubmit")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Submitted"


# @story: SCRUM-72
# @ac: 3
def test_resubmitted_request_is_listed_for_the_coordinator_as_submitted(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    client.post(f"/api/requests/{request_id}/resubmit")

    login_as(client, app, "coord1")
    rows = client.get("/api/requests").get_json()
    assert [row["status"] for row in rows if row["id"] == request_id] == ["Submitted"]


# @story: SCRUM-72
# @ac: 4
def test_earlier_decision_reason_date_and_decider_stay_after_resubmission(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    body = client.post(f"/api/requests/{request_id}/resubmit", json={"attendance": 40}).get_json()
    assert body["decision"] == "Rejected"
    assert body["decision_reason"] == "Venue capacity cannot be met."
    assert body["decided_at"].startswith("2026-09-23T14:05")
    assert body["decided_by"] == "coord1"

    saved = stored(request_id)
    assert saved.decision == "Rejected"
    assert saved.decided_by.username == "coord1"


# @story: SCRUM-72
# @ac: 4
def test_resubmitted_request_can_be_decided_again_and_the_new_decision_replaces_the_old(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    client.post(f"/api/requests/{request_id}/resubmit")

    login_as(client, app, "coord2")
    resp = client.post(f"/api/requests/{request_id}/approve", json={"reason": "Revised plan accepted."})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Approved"
    assert body["decision"] == "Approved"
    assert body["decision_reason"] == "Revised plan accepted."
    assert body["decided_by"] == "coord2"


# @story: SCRUM-72
# @ac: 2
def test_resubmit_with_blank_required_fields_is_refused_and_nothing_changes(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    resp = client.post(f"/api/requests/{request_id}/resubmit", json={"name": "  ", "purpose": ""})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Missing required fields: name, purpose"

    saved = stored(request_id)
    assert saved.status == "Rejected"
    assert saved.name == FIELDS["name"]
    assert saved.purpose == FIELDS["purpose"]
    assert saved.submitted_at == SUBMITTED_AT
    assert saved.decision_reason == "Venue capacity cannot be met."


# @story: SCRUM-72
# @ac: 2
def test_resubmit_with_a_past_date_is_refused_and_nothing_changes(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    resp = client.post(f"/api/requests/{request_id}/resubmit", json={"date": "2020-01-01", "attendance": 40})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Date cannot be earlier than today."

    saved = stored(request_id)
    assert saved.status == "Rejected"
    assert saved.date == FIELDS["date"]
    assert saved.attendance == FIELDS["attendance"]


# @story: SCRUM-72
# @ac: 2
def test_resubmit_with_end_time_before_start_is_refused_and_nothing_changes(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    resp = client.post(f"/api/requests/{request_id}/resubmit", json={"start_time": "14:00", "end_time": "10:00"})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Start time must be before the end time."

    saved = stored(request_id)
    assert saved.status == "Rejected"
    assert saved.start_time == "18:00"
    assert saved.submitted_at == SUBMITTED_AT


# @story: SCRUM-72
# @ac: 2
def test_resubmit_with_invalid_attendance_is_refused(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    for value in (0, -3, "abc", "2.5"):
        resp = client.post(f"/api/requests/{request_id}/resubmit", json={"attendance": value})
        assert resp.status_code == 400
        assert resp.get_json()["message"] == "Attendance must be a positive whole number."
    assert stored(request_id).status == "Rejected"


# @story: SCRUM-72
# @ac: 5
def test_a_request_that_is_not_rejected_cannot_be_resubmitted(client, app):
    login_as(client, app, "org1")
    for status in ("Draft", "Submitted", "Approved", "Confirmed"):
        request_id = make_rejected(app, status=status)
        resp = client.post(f"/api/requests/{request_id}/resubmit", json={"attendance": 40})
        assert resp.status_code == 400
        assert resp.get_json()["message"] == "Only a Rejected request can be resubmitted."
        saved = stored(request_id)
        assert saved.status == status
        assert saved.attendance == FIELDS["attendance"]
        assert saved.submitted_at == SUBMITTED_AT


# @story: SCRUM-72
# @ac: 5
def test_resubmitting_twice_is_refused_the_second_time(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    assert client.post(f"/api/requests/{request_id}/resubmit", json={"attendance": 40}).status_code == 200
    resp = client.post(f"/api/requests/{request_id}/resubmit", json={"attendance": 55})
    assert resp.status_code == 400
    assert stored(request_id).attendance == 40


# @story: SCRUM-72
# @ac: 5
def test_another_organiser_cannot_resubmit_and_nothing_changes(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org2")
    resp = client.post(f"/api/requests/{request_id}/resubmit", json={"attendance": 40})
    assert resp.status_code == 404
    saved = stored(request_id)
    assert saved.status == "Rejected"
    assert saved.attendance == FIELDS["attendance"]


# @story: SCRUM-72
# @ac: 5
def test_event_coordinator_cannot_resubmit(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "coord1")
    resp = client.post(f"/api/requests/{request_id}/resubmit")
    assert resp.status_code == 403
    assert resp.get_json()["message"] == "Only an Event Organiser may do this."
    assert stored(request_id).status == "Rejected"


# @story: SCRUM-72
# @ac: 5
def test_logged_out_cannot_resubmit(client, app):
    request_id = make_rejected(app)
    assert client.post(f"/api/requests/{request_id}/resubmit").status_code == 401
    assert stored(request_id).status == "Rejected"


# @story: SCRUM-72
# @ac: 5
def test_resubmitting_an_unknown_request_is_404(client, app):
    login_as(client, app, "org1")
    assert client.post("/api/requests/99999/resubmit").status_code == 404


# @story: SCRUM-72
# @ac: 1, 4
def test_resubmit_may_change_the_layout_and_the_chosen_lists(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    resp = client.post(
        f"/api/requests/{request_id}/resubmit",
        json={
            "layout": "Theatre",
            "facilities": ["Projector", "Sound system"],
            "accessibility_features": ["Hearing loop"],
        },
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["layout"] == "Theatre"
    assert body["facilities"] == ["Projector", "Sound system"]
    assert body["accessibility_features"] == ["Hearing loop"]
    assert body["decision"] == "Rejected"


# @story: SCRUM-72
# @ac: 2
def test_resubmit_with_a_choice_not_on_the_list_is_refused_and_nothing_changes(client, app):
    request_id = make_rejected(app)
    login_as(client, app, "org1")
    resp = client.post(
        f"/api/requests/{request_id}/resubmit",
        json={"attendance": 40, "facilities": ["Flamethrower"]},
    )
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose each facility from the list."

    saved = stored(request_id)
    assert saved.status == "Rejected"
    assert saved.attendance == FIELDS["attendance"]
    assert saved.facilities == []
