"""Equipment and reservations — Jira area(s) 15, 16, 17 (docs/design/frontend.md §2).

SCRUM-49: read the inventory and change a type's total units. There is no
create, rename, delete or retire endpoint for types (handoff scope), and no
reservation endpoints — reserve/release workflows are SCRUM-51's.
Reading is equipment.view (Technical Support Staff and Event Coordinator);
writing is equipment.edit (Technical Support Staff only) — enforced here by
the route decorators, independent of any hidden control in the UI
(docs/design/permissions.md v1.14). Rules are in services.py; the contract
is frontend/src/areas/equipment/api.js.

SCRUM-50: check how many units of a type are free for a period. A read, so
GET, and equipment.check (Technical Support Staff only; an Event Coordinator
holds equipment.view and still may not run it).
"""

from flask import Blueprint, g, jsonify, request

from areas.equipment import requirements, services
from permissions import (EQUIPMENT_CHECK, EQUIPMENT_EDIT, EQUIPMENT_VIEW,
                         EQUIPMENT_REQUIREMENTS_VIEW, EQUIPMENT_REQUIREMENTS_EDIT, require)

bp = Blueprint("equipment", __name__, url_prefix="/api")


@bp.get("/equipment")
@require(EQUIPMENT_VIEW)
def list_equipment():
    return jsonify(
        [row.to_dict() for row in services.list_equipment()]
    )


@bp.patch("/equipment/<int:equipment_id>")
@require(EQUIPMENT_EDIT)
def update_total(equipment_id):
    body = request.get_json(silent=True)
    equipment = services.update_total_units(equipment_id, body)
    return jsonify(equipment.to_dict()), 200


@bp.get("/equipment/<int:equipment_id>/availability")
@require(EQUIPMENT_CHECK)
def check_availability(equipment_id):
    """SCRUM-50: start and end, or event_request_id and quantity (a requirement)."""
    result = services.check_availability(equipment_id, request.args)
    return jsonify(result), 200


@bp.get("/equipment/requests")
@require(EQUIPMENT_REQUIREMENTS_VIEW)
def list_requirement_events():
    return jsonify(requirements.list_events(g.account))


@bp.get("/requests/<int:event_id>/equipment")
@require(EQUIPMENT_REQUIREMENTS_VIEW)
def requirement_detail(event_id):
    return jsonify(requirements.detail(g.account, event_id))


@bp.post("/requests/<int:event_id>/equipment")
@require(EQUIPMENT_REQUIREMENTS_EDIT)
def add_requirement(event_id):
    row = requirements.add(g.account, event_id, request.get_json(silent=True))
    return jsonify(row.to_dict()), 201


@bp.patch("/requests/<int:event_id>/equipment/<int:requirement_id>")
@require(EQUIPMENT_REQUIREMENTS_EDIT)
def update_requirement(event_id, requirement_id):
    row = requirements.update(g.account, event_id, requirement_id, request.get_json(silent=True))
    return jsonify(row.to_dict()), 200


@bp.delete("/requests/<int:event_id>/equipment/<int:requirement_id>")
@require(EQUIPMENT_REQUIREMENTS_EDIT)
def remove_requirement(event_id, requirement_id):
    requirements.remove(g.account, event_id, requirement_id)
    return "", 204
