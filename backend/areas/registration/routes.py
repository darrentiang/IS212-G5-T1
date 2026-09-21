"""Attendee registration — Jira area(s) 18.

SCRUM-27: list confirmed events with registration enabled (read-only).
Internal planning fields are never included in this payload.
"""

from flask import Blueprint, jsonify

from db import db
from models import EventRequest
from permissions import REGISTRATION_VIEW, require

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
