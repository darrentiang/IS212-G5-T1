"""Attendee registration — Jira area(s) 18.

SCRUM-27: list confirmed events with registration enabled (read-only).
SCRUM-55: an Attendee lists their own registrations and withdraws one.
SCRUM-92: the assigned Event Coordinator sets an event's registration.
Internal planning fields are never included in this payload.
"""

from flask import Blueprint, g, jsonify, request as flask_request

from areas.registration import services, settings
from areas.requests.services import request_detail_dict
from db import db
from models import EventRequest
from permissions import REGISTRATION_MANAGE, REGISTRATION_VIEW, REGISTRATION_WITHDRAW, require

bp = Blueprint("registration", __name__, url_prefix="/api")


@bp.get("/registration/events")
@require(REGISTRATION_VIEW)
def list_open_events():
    rows = (
        db.session.query(EventRequest)
        .filter(
            EventRequest.status == "Confirmed",
            EventRequest.registration_enabled.is_(True),
        )
        .all()
    )
    return jsonify(
        [
            {
                "id": row.id,
                "name": row.name,
                "purpose": row.purpose,
                "status": row.status,
                "registration_enabled": True,
            }
            for row in rows
        ]
    )


@bp.get("/registrations/mine")
@require(REGISTRATION_WITHDRAW)
def list_my_registrations():
    return jsonify(services.list_mine(g.account))


@bp.post("/registrations/<int:registration_id>/withdraw")
@require(REGISTRATION_WITHDRAW)
def withdraw_registration(registration_id):
    return jsonify(services.withdraw(g.account, registration_id)), 200


@bp.put("/requests/<int:request_id>/registration")
@require(REGISTRATION_MANAGE)
def set_registration(request_id):
    """SCRUM-92: on or off, capacity and closing time, saved together."""
    row = settings.set_registration(g.account, request_id, flask_request.get_json(silent=True))
    return jsonify(request_detail_dict(row, g.account)), 200
