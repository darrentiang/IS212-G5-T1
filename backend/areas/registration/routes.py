"""Attendee registration — Jira area(s) 18.

SCRUM-27: list confirmed events with registration enabled (read-only).
SCRUM-54: an Attendee registers for one; each listed event says whether the
account may register, is registered, or it is closed or full.
SCRUM-55: an Attendee lists their own registrations and withdraws one.
SCRUM-56: each listed registration says where the event is, by its status.
SCRUM-92: the assigned Event Coordinator sets an event's registration.
Internal planning fields are never included in this payload.
"""

from flask import Blueprint, g, jsonify, request as flask_request

from areas.registration import services, settings
from areas.requests.services import request_detail_dict
from permissions import (
    REGISTRATION_MANAGE,
    REGISTRATION_REGISTER,
    REGISTRATION_VIEW,
    REGISTRATION_WITHDRAW,
    require,
)

bp = Blueprint("registration", __name__, url_prefix="/api")


@bp.get("/registration/events")
@require(REGISTRATION_VIEW)
def list_open_events():
    return jsonify(services.list_open(g.account))


@bp.post("/registration/events/<int:event_id>/register")
@require(REGISTRATION_REGISTER)
def register_for_event(event_id):
    """SCRUM-54: — -> Registered; the reply is the event as listed, for the confirmation."""
    return jsonify(services.register(g.account, event_id)), 201


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
