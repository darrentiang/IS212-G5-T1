"""Equipment inventory rules — SCRUM-49 (Maintain Equipment Inventory).

Reading the inventory is equipment.view (Technical Support Staff and Event
Coordinator); changing a total is equipment.edit (Technical Support Staff
only) — docs/design/permissions.md v1.14. An edit changes only
total_units: the name and every other attribute are untouched, and no
workflow creates, renames, deletes or retires a type (handoff scope).

Validation runs before changing stock, so an invalid input, a reduction
below the reservation minimum or an unauthorised attempt leaves stock and
every requirement and reservation unchanged (AC4-AC7). The numeric rules
follow SCRUM-80's Decimal-based whole-number validator with two deliberate
differences: zero is allowed (AC3) and blank is refused rather than read as
zero. JSON numbers have already been parsed to float by the framework: a
fraction the parser rounded away cannot be recovered, which is why the form
sends the field as a string — the exact wire path (docs in the plan §4).

SCRUM-52 (Withdraw Equipment from Service), also equipment.edit: units are
withdrawn from and returned to service per type, counted, never one by one.
Each takes the same type lock as a total change before reading the counts.
A withdrawal never touches a reservation; it lists the events not yet
started that the units in service can no longer cover and tells their
coordinators. A total cannot go below the units out of service plus the
committed peak from now on (AC7).
"""

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import update

import clock
from areas.equipment.commitments import _period, peak_units
from db import db
from errors import ApiRefusal
from models import EquipmentServiceChange, EquipmentType, EventRequest, Reservation
from notifications import create_notification

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


def _lock(equipment):
    """Take the type's write lock, then read its counts again.

    A no-op UPDATE takes a write lock even on SQLite (SELECT FOR UPDATE does
    not), so a total change, a withdrawal, a return and a reservation of the
    same type cannot pass a check made on stale counts.
    """
    db.session.execute(update(EquipmentType).where(EquipmentType.id == equipment.id)
                       .values(id=EquipmentType.id))
    db.session.refresh(equipment)


def update_total_units(equipment_id, body):
    """Change one type's total units (AC2-AC7), or refuse without writing.

    Order: body shape, then value, then the reservation minimum — so every
    refusal happens before any inventory value is changed.
    """
    equipment = get_equipment(equipment_id)
    if not isinstance(body, dict):
        raise ApiRefusal(400, "Request body must be a JSON object with total_units.")
    if "total_units" not in body:
        raise ApiRefusal(400, "Request body must contain total_units.")

    total = _parse_total_units(body.get("total_units"))

    # SCRUM-51 now creates commitments concurrently: acquire the same type
    # write lock before checking the minimum, not after reading stale stock.
    _lock(equipment)
    # SCRUM-52 AC7: units out of service count towards the minimum too.
    reserved = peak_units(equipment.id, clock.now_local(), None)
    out = equipment.out_of_service_units
    minimum = reserved + out
    if total < minimum:
        db.session.rollback()
        if out == 0:
            raise ApiRefusal(
                400,
                f"Total units cannot be reduced below {minimum} units: "
                f"{minimum} units are reserved.",
            )
        raise ApiRefusal(
            400,
            f"Total units cannot be reduced below {minimum} units: "
            f"{reserved} {'is' if reserved == 1 else 'are'} reserved at the same time and "
            f"{out} {'is' if out == 1 else 'are'} out of service.",
        )

    equipment.total_units = total
    db.session.commit()
    return equipment


# ---- SCRUM-50: availability for a period -------------------------------------

MOMENT_FORMAT = "%Y-%m-%dT%H:%M"


def _units_out_of_service(equipment):
    """Units of this type withdrawn from service now (SCRUM-50 AC3, SCRUM-52 AC3)."""
    return equipment.out_of_service_units


def _parse_moment(value):
    """A 'YYYY-MM-DDTHH:MM' text as a naive local date-time, else None."""
    try:
        return datetime.strptime(value.strip(), MOMENT_FORMAT)
    except (AttributeError, ValueError):
        return None


def _period_of_event(event_request):
    """The event's period (date, start time to end time), else refuse 400 (AC2)."""
    try:
        return (
            datetime.strptime(f"{event_request.date} {event_request.start_time}", "%Y-%m-%d %H:%M"),
            datetime.strptime(f"{event_request.date} {event_request.end_time}", "%Y-%m-%d %H:%M"),
        )
    except (TypeError, ValueError):
        raise ApiRefusal(400, "This event has no period yet, so availability cannot be checked for it.") from None


def _requested_quantity(raw):
    """A positive whole number from the query, else refuse 400 (AC2)."""
    try:
        quantity = int(str(raw).strip())
    except (TypeError, ValueError):
        quantity = 0
    if quantity < 1 or str(raw).strip() != str(quantity):
        raise ApiRefusal(400, "Quantity must be a positive whole number.")
    return quantity


def check_availability(equipment_id, args):
    """Total, reserved, out of service and available units for a period (SCRUM-50).

    Two ways in, both read-only (AC8):

    * ``start`` and ``end`` (``YYYY-MM-DDTHH:MM``): both required, valid, start
      before end (AC1).
    * ``event_request_id`` and ``quantity``, as when opened from a recorded
      requirement (AC2): the event's own period is used, its own reservations
      are left out (AC6), and the result says whether the quantity is covered
      or how many units short it is (AC7).

    Reserved is the committed peak (commitments.peak_units, state-model.md
    v1.8): the most units held at the same time by Reserved reservations that
    overlap the period; touching is not overlapping (AC5). Available is
    never below zero (AC4).
    """
    equipment = get_equipment(equipment_id)
    event_id = args.get("event_request_id")
    quantity = None

    if event_id not in (None, ""):
        event_request = db.session.get(EventRequest, int(event_id)) if str(event_id).isdigit() else None
        if event_request is None:
            raise ApiRefusal(404, "Event request not found.")
        quantity = _requested_quantity(args.get("quantity"))
        start, end = _period_of_event(event_request)
        exclude = event_request.id
    else:
        start_text, end_text = args.get("start"), args.get("end")
        if not (start_text or "").strip() or not (end_text or "").strip():
            raise ApiRefusal(400, "A start and an end are required.")
        start, end = _parse_moment(start_text), _parse_moment(end_text)
        if start is None or end is None:
            raise ApiRefusal(
                400, "The start and the end must each be a date and time, as 2027-03-10T10:00."
            )
        if start >= end:
            raise ApiRefusal(400, "The start must be before the end.")
        exclude = None

    reserved = peak_units(equipment.id, start, end, exclude_event_id=exclude)
    out_of_service = _units_out_of_service(equipment)
    available = max(0, equipment.total_units - reserved - out_of_service)
    result = {
        "equipment_type": {"id": equipment.id, "name": equipment.name},
        "start": start.strftime(MOMENT_FORMAT),
        "end": end.strftime(MOMENT_FORMAT),
        "total_units": equipment.total_units,
        "reserved_units": reserved,
        "out_of_service_units": out_of_service,
        "available_units": available,
    }
    if quantity is not None:
        result["requested_units"] = quantity
        result["covered"] = quantity <= available
        result["short_by"] = max(0, quantity - available)
    return result


# ---- SCRUM-52: withdraw from and return to service ---------------------------

REASON_REQUIRED = "A reason is required."


def _parse_quantity(value, most):
    """A whole number from 1 to ``most``, else refuse 400 (AC2, AC6).

    Read as a Decimal, never a float, as _parse_total_units does: booleans,
    blanks, fractions and non-numbers are refused, while 2, "2" and 2.0 are 2.
    """
    refusal = ApiRefusal(400, f"Quantity must be a whole number from 1 to {most}.")
    if isinstance(value, bool) or value is None:
        raise refusal
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise refusal from None
    if not number.is_finite() or number != number.to_integral_value() or not 1 <= number <= most:
        raise refusal
    return int(number)


def _record(equipment, account, action, quantity, reason=None):
    db.session.add(EquipmentServiceChange(
        equipment_type=equipment, action=action, quantity=quantity, reason=reason,
        changed_by=account, changed_at=datetime.now(timezone.utc)))


def _shortfalls(equipment):
    """Every event not yet started whose reserved units of this type the units
    in service can no longer cover (AC4), in order of its reservation's period.

    A Reserved reservation is short when the most units held at the same time
    over its own period, itself counted, is more than the units in service.
    Released reservations and requirements with nothing reserved never commit.
    """
    now = clock.now_local()
    in_service = equipment.total_units - equipment.out_of_service_units
    reservations = (
        db.session.query(Reservation)
        .filter_by(equipment_type_id=equipment.id, status="Reserved")
        .order_by(Reservation.date, Reservation.start_time, Reservation.id)
        .all()
    )
    short = {}
    for reservation in reservations:
        event = reservation.event_request
        if _period_of_event(event)[0] <= now:
            continue
        start, end = _period(reservation)
        if peak_units(equipment.id, start, end) <= in_service:
            continue
        entry = short.setdefault(event.id, {
            "event_request_id": event.id,
            "name": event.name,
            "date": event.date,
            "start_time": event.start_time,
            "end_time": event.end_time,
            "reserved_units": 0,
            "coordinator": event.assigned_coordinator.username if event.assigned_coordinator else None,
        })
        entry["reserved_units"] += reservation.quantity
    return list(short.values())


def _tell_coordinators(equipment, shortfalls):
    """One notification per assigned coordinator, naming each of their short
    events (AC4); an event with no assigned coordinator tells nobody."""
    by_coordinator = {}
    for entry in shortfalls:
        event = db.session.get(EventRequest, entry["event_request_id"])
        if event.assigned_coordinator is not None:
            by_coordinator.setdefault(event.assigned_coordinator, []).append(event)
    for coordinator, events in by_coordinator.items():
        named = ", ".join(
            f"{event.name} ({datetime.strptime(event.date, '%Y-%m-%d').strftime('%d %b %Y')}, "
            f"{event.start_time}–{event.end_time})"
            for event in events
        )
        create_notification(
            coordinator,
            f"Equipment withdrawn from service: {equipment.name}. "
            f"Reserved units may no longer be covered for {named}.",
            events[0] if len(events) == 1 else None,
        )


def withdraw(account, equipment_id, body):
    """Take units of a type out of service, with a reason (AC1, AC2, AC4, AC5).

    Allowed even when fewer units are left in service than are reserved; no
    reservation is released or changed. Returns the type and the events left
    short, whose coordinators are told in the same commit.
    """
    equipment = get_equipment(equipment_id)
    body = body if isinstance(body, dict) else {}
    reason = body.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise ApiRefusal(400, REASON_REQUIRED)
    _lock(equipment)
    try:
        in_service = equipment.total_units - equipment.out_of_service_units
        if in_service == 0:
            raise ApiRefusal(400, f"No units of {equipment.name} are in service to withdraw.")
        quantity = _parse_quantity(body.get("quantity"), in_service)
    except ApiRefusal:
        db.session.rollback()
        raise
    equipment.out_of_service_units += quantity
    _record(equipment, account, "Withdrawn", quantity, reason.strip())
    shortfalls = _shortfalls(equipment)
    _tell_coordinators(equipment, shortfalls)
    db.session.commit()
    return equipment, shortfalls


def return_to_service(account, equipment_id, body):
    """Put units of a type back in service, no reason (AC6)."""
    equipment = get_equipment(equipment_id)
    body = body if isinstance(body, dict) else {}
    _lock(equipment)
    try:
        if equipment.out_of_service_units == 0:
            raise ApiRefusal(400, f"No units of {equipment.name} are out of service to return.")
        quantity = _parse_quantity(body.get("quantity"), equipment.out_of_service_units)
    except ApiRefusal:
        db.session.rollback()
        raise
    equipment.out_of_service_units -= quantity
    _record(equipment, account, "Returned", quantity)
    db.session.commit()
    return equipment
