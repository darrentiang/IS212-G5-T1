"""Event request — Jira area(s) 02–07.

SCRUM-27: read-only list and detail with role rules. Create/edit is SCRUM-28+.
"""

from flask import Blueprint, g, jsonify

from areas.requests import services
from permissions import REQUESTS_VIEW, require

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
