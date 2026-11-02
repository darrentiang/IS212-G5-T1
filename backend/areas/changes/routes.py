"""Change request — Jira area(s) 19 (docs/design/frontend.md §2).

SCRUM-59: the Event Organiser asks for a change to their event, or for its withdrawal, after
submitting it. SCRUM-60: the assigned Event Coordinator accepts or declines it.
"""

from flask import Blueprint, g, jsonify, request as flask_request

from areas.changes import services
from areas.requests.services import request_detail_dict
from permissions import CHANGES_DECIDE, CHANGES_RAISE, require

bp = Blueprint("changes", __name__, url_prefix="/api")


@bp.post("/requests/<int:request_id>/change-requests")
@require(CHANGES_RAISE)
def raise_change_request(request_id):
    """SCRUM-59: raise a change or withdrawal request on an own event; its status is unchanged."""
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    updated = services.raise_change_request(account, request_id, data)
    return jsonify(request_detail_dict(updated, account)), 201


@bp.post("/requests/<int:request_id>/change-requests/<int:change_request_id>/decision")
@require(CHANGES_DECIDE)
def decide_change_request(request_id, change_request_id):
    """SCRUM-60: accept or decline an open request on an assigned event."""
    account = g.account
    data = flask_request.get_json(silent=True) or {}
    updated = services.decide_change_request(account, request_id, change_request_id, data)
    return jsonify(request_detail_dict(updated, account))
