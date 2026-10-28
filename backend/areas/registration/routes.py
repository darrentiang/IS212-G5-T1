"""Attendee registration — Jira area(s) 18.

SCRUM-27: list confirmed events with registration enabled (read-only).
SCRUM-55: an Attendee lists their own registrations and withdraws one.
Internal planning fields are never included in this payload.
"""

from flask import Blueprint, g, jsonify

from areas.registration import services
from db import db
from models import EventRequest
from permissions import REGISTRATION_VIEW, REGISTRATION_WITHDRAW, require

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
