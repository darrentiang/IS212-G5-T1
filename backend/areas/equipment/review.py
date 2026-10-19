"""SCRUM-81: review decisions and notes, never stock commitments.

Reserved rows match the unique event/type pair used by SCRUM-48 and the
reservation store. An atomic conditional UPDATE rechecks event stage and,
for decisions only, absence of Reserved rows at the actual write.

SCRUM-63: a decision tells the event's assigned Event Coordinator in the same
commit, so a refused decision tells nobody; a note tells nobody.
"""
from datetime import datetime, timezone

from sqlalchemy import exists, update

from areas.equipment.requirements import EDITABLE_STATUSES, MAX_QUANTITY, _event
from db import db
from errors import ApiRefusal
from models import EquipmentRequirement, EventRequest, Reservation
from notifications import create_notification
from permissions import EQUIPMENT_REQUIREMENTS_REVIEW, can


def _target(account, event_id, requirement_id):
    if not can(account, EQUIPMENT_REQUIREMENTS_REVIEW):
        raise ApiRefusal(403, "You cannot review equipment requirements.")
    event = _event(account, event_id)
    row = db.session.get(EquipmentRequirement, requirement_id) if requirement_id <= MAX_QUANTITY else None
    if row is None or row.event_request_id != event.id:
        raise ApiRefusal(404, "Equipment requirement not found.")
    if event.status not in EDITABLE_STATUSES:
        raise ApiRefusal(409, "Equipment reviews and notes can only be changed while the event is Approved or Planning.")
    return row


def _write(row, values, *, message=None):
    stage_allowed = exists().where(
        EventRequest.id == row.event_request_id,
        EventRequest.status.in_(EDITABLE_STATUSES),
    )
    conditions = [EquipmentRequirement.id == row.id, stage_allowed]
    if message is not None:
        conditions.append(~exists().where(
            Reservation.event_request_id == row.event_request_id,
            Reservation.equipment_type_id == row.equipment_type_id,
            Reservation.status == "Reserved",
        ))
    result = db.session.execute(update(EquipmentRequirement).where(*conditions).values(**values),
                                execution_options={"synchronize_session": False})
    if result.rowcount != 1:
        db.session.rollback()
        raise ApiRefusal(409, "The event or reservation state changed. Reload the equipment requirements and try again.")
    # SCRUM-63 AC5: only the coordinator assigned now; with none, nobody is told.
    coordinator = row.event_request.assigned_coordinator
    if message is not None and coordinator is not None:
        create_notification(coordinator, message, row.event_request)
    db.session.commit()
    db.session.expire(row)
    return row


def decide(account, event_id, requirement_id, body):
    row = _target(account, event_id, requirement_id)
    if row.has_unreleased_reservation:
        raise ApiRefusal(409, "Release this requirement's equipment reservation before changing its review decision.")
    if not isinstance(body, dict) or body.get("decision") not in ("Approved", "Declined"):
        raise ApiRefusal(400, "Choose Approved or Declined.")
    reason = None
    if body["decision"] == "Declined":
        value = body.get("reason")
        if not isinstance(value, str) or not value.strip():
            raise ApiRefusal(400, "A decline reason is required.")
        reason = value.strip()
    return _write(row, {"status": body["decision"], "decline_reason": reason,
                        "decided_by_id": account.id, "decided_at": datetime.now(timezone.utc)},
                  message=_decision_message(row, body["decision"], reason))


def _decision_message(row, decision, reason):
    """SCRUM-63 AC3, the curated texts (ui-guidelines.md, SCRUM-63):
    'Equipment decision for Annual Gala: Projector × 2 Approved.', and for a
    decline the reason after it."""
    message = (f"Equipment decision for {row.event_request.name}: "
               f"{row.equipment_type.name} × {row.quantity} {decision}.")
    return message if reason is None else f"{message} Reason: {reason}"


def update_note(account, event_id, requirement_id, body):
    row = _target(account, event_id, requirement_id)
    if not isinstance(body, dict) or not isinstance(body.get("arrangement_note"), str):
        raise ApiRefusal(400, "Arrangement note must be text.")
    return _write(row, {"arrangement_note": body["arrangement_note"].strip()})
