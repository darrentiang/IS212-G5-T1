"""Equipment and reservations — Jira area(s) 15, 16, 17 (docs/design/frontend.md §2).

SCRUM-49: read the inventory and change a type's total units. There is no
create, rename, delete or retire endpoint for types (handoff scope), and no
reservation endpoints — reserve/release workflows are SCRUM-51's.
Reading is equipment.view (Technical Support Staff and Event Coordinator);
writing is equipment.edit (Technical Support Staff only) — enforced here by
the route decorators, independent of any hidden control in the UI
(docs/design/permissions.md v1.14). Rules are in services.py; the contract
is frontend/src/areas/equipment/api.js.
"""

from flask import Blueprint, jsonify, request

from areas.equipment import services
from permissions import EQUIPMENT_EDIT, EQUIPMENT_VIEW, require

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
