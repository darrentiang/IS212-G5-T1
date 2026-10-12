"""Equipment inventory rules — SCRUM-49 (Maintain Equipment Inventory).

Reading the inventory is equipment.view (Technical Support Staff and Event
Coordinator); changing a total is equipment.edit (Technical Support Staff
only) — docs/design/permissions.md v1.14. An edit changes only
total_units: the name and every other attribute are untouched, and no
workflow creates, renames, deletes or retires a type (handoff scope).

Validation runs entirely before the write, so an invalid input, a reduction
below the reservation minimum or an unauthorised attempt leaves stock and
every requirement and reservation unchanged (AC4-AC7). The numeric rules
follow SCRUM-80's Decimal-based whole-number validator with two deliberate
differences: zero is allowed (AC3) and blank is refused rather than read as
zero. JSON numbers have already been parsed to float by the framework: a
fraction the parser rounded away cannot be recovered, which is why the form
sends the field as a string — the exact wire path (docs in the plan §4).
"""

from decimal import Decimal, InvalidOperation

import clock
from areas.equipment.commitments import peak_units
from db import db
from errors import ApiRefusal
from models import EquipmentType

# Beyond this, JSON numbers cannot round-trip exactly through the browser
# (Number.MAX_SAFE_INTEGER): a representational limit, not a business maximum.
MAX_SAFE_INTEGER = 2**53 - 1

INVALID_TOTAL = "Total units must be zero or a positive whole number."
TOO_LARGE = "Total units is too large."


def list_equipment():
    """Every recognised type, id ascending — the inventory rows."""
    return db.session.query(EquipmentType).order_by(EquipmentType.id).all()


def get_equipment(equipment_id):
    """One type, or refuse 404."""
    equipment = db.session.get(EquipmentType, equipment_id)
    if equipment is None:
        raise ApiRefusal(404, "Equipment type not found.")
    return equipment


def _parse_total_units(value):
    """The whole number the value represents, else refuse 400 (AC3).

    Blank is refused, never zero. Booleans are refused before any numeric
    read (bool is an int subclass, but True is not inventory). The value is
    read as a Decimal, never a float, so a textual fraction is refused
    whatever its digits, while exact whole-number representations (8, "8",
    8.0, 1e5) are accepted as the integer they denote.
    """
    if isinstance(value, bool):
        raise ApiRefusal(400, INVALID_TOTAL)
    if value is None or (isinstance(value, str) and value.strip() == ""):
        raise ApiRefusal(400, INVALID_TOTAL)
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise ApiRefusal(400, INVALID_TOTAL) from None
    if not number.is_finite() or number != number.to_integral_value():
        raise ApiRefusal(400, INVALID_TOTAL)
    if number < 0:
        raise ApiRefusal(400, INVALID_TOTAL)
    if number > MAX_SAFE_INTEGER:
        raise ApiRefusal(400, TOO_LARGE)
    return int(number)


def update_total_units(equipment_id, body):
    """Change one type's total units (AC2-AC7), or refuse without writing.

    Order: body shape, then value, then the reservation minimum — so every
    refusal happens before any column is touched.
    """
    equipment = get_equipment(equipment_id)
    if not isinstance(body, dict):
        raise ApiRefusal(400, "Request body must be a JSON object with total_units.")
    if "total_units" not in body:
        raise ApiRefusal(400, "Request body must contain total_units.")

    total = _parse_total_units(body.get("total_units"))

    minimum = peak_units(equipment.id, clock.now_local(), None)
    if total < minimum:
        raise ApiRefusal(
            400,
            f"Total units cannot be reduced below {minimum} units: "
            f"{minimum} units are reserved.",
        )

    equipment.total_units = total
    db.session.commit()
    return equipment
