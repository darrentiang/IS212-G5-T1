"""Event request — Jira area(s) 02–07.

SCRUM-27: read-only list and detail with role rules.
SCRUM-28: create a request and submit it (direct or from Draft).
SCRUM-29: approve or reject a Submitted request.
"""

from flask import Blueprint, g, jsonify, request as flask_request

from areas.requests import services
from permissions import REQUESTS_DECIDE, REQUESTS_EDIT, REQUESTS_VIEW, require

bp = Blueprint("requests", __name__, url_prefix="/api")


@bp.get("/requests")
@require(REQUESTS_VIEW)
def list_requests():
    account = g.account
    rows = services.visible_requests(account)
    return jsonify([services.request_to_dict(row) for row in rows])


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
    """SCRUM-29: Submitted -> Approved; reason optional."""
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
