"""Event request — Jira area(s) 02–07.

SCRUM-27: read-only list and detail with role rules.
SCRUM-28: create a request and submit it (direct or from Draft).
SCRUM-29: approve or reject a Submitted request.
SCRUM-30: save, edit and delete a Draft.
SCRUM-42: the fixed lists a request's required layout, facilities and
accessibility features are chosen from.
SCRUM-43: approving a request assigns an Event Coordinator (no route of its own).
SCRUM-72: revise and resubmit a Rejected request.
SCRUM-89: the Safety Officer approves or rejects an event in Safety Check.
SCRUM-90: the Safety Officer returns it to Planning with the changes it needs.
SCRUM-53: the assigned Event Coordinator sends a Planning event for safety check.
"""

from flask import Blueprint, g, jsonify, request as flask_request

from areas.requests import services
from permissions import (
    REQUESTS_DECIDE,
    REQUESTS_EDIT,
    REQUESTS_VIEW,
    SAFETY_DECIDE,
    SAFETY_SEND,
    require,
)

bp = Blueprint("requests", __name__, url_prefix="/api")


@bp.get("/requests")
@require(REQUESTS_VIEW)
def list_requests():
    account = g.account
    rows = services.visible_requests(account)
    return jsonify([services.request_to_dict(row) for row in rows])


@bp.get("/request-options")
@require(REQUESTS_EDIT)
def request_options():
    """SCRUM-42: the same lists as /api/venue-options, for Event Organisers."""
    return jsonify(services.request_options())


@bp.get("/requests/<int:request_id>")
@require(REQUESTS_VIEW)
def get_request(request_id):
    account = g.account
    row = services.get_visible_request(account, request_id)
    return jsonify(services.request_detail_dict(row, account))


@bp.post("/requests")
@require(REQUESTS_EDIT)
def submit_request():
    """SCRUM-28: submit a new event request directly."""
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    created = services.submit_new_request(account, data)
    return jsonify(services.request_to_dict(created)), 201


@bp.post("/requests/<int:request_id>/submit")
@require(REQUESTS_EDIT)
def submit_draft_request(request_id):
    """SCRUM-28: submit a previously saved Draft."""
    account = g.account
    submitted = services.submit_draft(account, request_id)
    return jsonify(services.request_to_dict(submitted)), 200


@bp.post("/requests/<int:request_id>/approve")
@require(REQUESTS_DECIDE)
def approve_request(request_id):
    """SCRUM-29: Submitted -> Approved; reason optional.

    SCRUM-43: the system also assigns an Event Coordinator, so the reply is
    normally the request in Planning with assigned_coordinator and assigned_at
    set; with no Event Coordinator it stays Approved, with both null.
    """
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    updated = services.approve_request(account, request_id, data)
    return jsonify(services.request_detail_dict(updated, account)), 200


@bp.post("/requests/<int:request_id>/reject")
@require(REQUESTS_DECIDE)
def reject_request(request_id):
    """SCRUM-29: Submitted -> Rejected; reason required."""
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    updated = services.reject_request(account, request_id, data)
    return jsonify(services.request_detail_dict(updated, account)), 200
@bp.post("/requests/<int:request_id>/send-for-safety-check")
@require(SAFETY_SEND)
def send_for_safety_check(request_id):
    """SCRUM-53: Planning -> Safety Check; the assigned coordinator only."""
    account = g.account
    updated = services.send_for_safety_check(account, request_id)
    return jsonify(services.request_detail_dict(updated, account)), 200


@bp.post("/requests/<int:request_id>/safety/approve")
@require(SAFETY_DECIDE)
def approve_safety_check(request_id):
    """SCRUM-89: Safety Check -> Confirmed; a note per area is optional."""
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    updated = services.approve_safety_check(account, request_id, data)
    return jsonify(services.request_detail_dict(updated, account)), 200


@bp.post("/requests/<int:request_id>/safety/reject")
@require(SAFETY_DECIDE)
def reject_safety_check(request_id):
    """SCRUM-89: Safety Check -> Planning; a reason is required, notes optional."""
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    updated = services.reject_safety_check(account, request_id, data)
    return jsonify(services.request_detail_dict(updated, account)), 200


@bp.post("/requests/<int:request_id>/safety/request-changes")
@require(SAFETY_DECIDE)
def request_safety_changes(request_id):
    """SCRUM-90: Safety Check -> Planning; a reason and at least one area are required."""
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    updated = services.request_safety_changes(account, request_id, data)
    return jsonify(services.request_detail_dict(updated, account)), 200


@bp.post("/requests/<int:request_id>/resubmit")
@require(REQUESTS_EDIT)
def resubmit_request(request_id):
    """SCRUM-72: Rejected -> Submitted, with any edited fields."""
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    updated = services.resubmit_request(account, request_id, data)
    return jsonify(services.request_detail_dict(updated, account)), 200


@bp.post("/requests/draft")
@require(REQUESTS_EDIT)
def save_draft_request():
    """SCRUM-30: save a new Draft; only the event name is required."""
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    created = services.save_new_draft(account, data)
    return jsonify(services.request_to_dict(created)), 201


@bp.put("/requests/<int:request_id>")
@require(REQUESTS_EDIT)
def update_draft_request(request_id):
    """SCRUM-30: edit any field of an own Draft, including the name."""
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    updated = services.update_draft(account, request_id, data)
    return jsonify(services.request_to_dict(updated)), 200


@bp.delete("/requests/<int:request_id>")
@require(REQUESTS_EDIT)
def delete_draft_request(request_id):
    """SCRUM-30: permanently delete an own Draft."""
    account = g.account
    services.delete_draft(account, request_id)
    return "", 204
