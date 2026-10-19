"""SCRUM-51: full-quantity reserve/release, with scoped reads.

Lock order is event, type, requirement. No-op UPDATEs take write locks even on
SQLite (SELECT FOR UPDATE does not), before refreshing and checking state.
The type lock serializes competing commitments; the event lock serializes
safety transitions; the requirement lock serializes review corrections.
No inventory quantity is changed. All refusal paths roll the transaction back.
SCRUM-52's out-of-service input is consumed through SCRUM-50, never redefined.
SCRUM-63: reserve and release tell the event's assigned Event Coordinator in
the same transaction, so a refusal tells nobody.
"""
from contextlib import contextmanager
from datetime import datetime

from sqlalchemy import update

from areas.equipment import services
from areas.equipment.requirements import EDITABLE_STATUSES, MAX_QUANTITY, _event
from db import db
from errors import ApiRefusal
from models import EquipmentRequirement, EquipmentType, EventRequest, Reservation
from notifications import create_notification
from permissions import EQUIPMENT_RESERVE, can


def to_dict(row):
    equipment = db.session.get(EquipmentType, row.equipment_type_id)
    return {"id": row.id, "event_request_id": row.event_request_id,
            "equipment_type_id": row.equipment_type_id, "equipment_type_name": equipment.name,
            "quantity": row.quantity, "date": row.date,
            "start_time": row.start_time, "end_time": row.end_time, "status": row.status}


def list_for_event(account, event_id):
    event = _event(account, event_id)
    return [to_dict(row) for row in db.session.query(Reservation)
            .filter_by(event_request_id=event.id).order_by(Reservation.id).all()]


def _tell_coordinator(event, reservation, action):
    """SCRUM-63 AC4, AC5, the curated texts (ui-guidelines.md, SCRUM-63):
    'Equipment reserved for Annual Gala: Projector × 2, 15 Dec 2026, 10:00–12:00.'
    With no assigned coordinator nobody is told."""
    if event.assigned_coordinator is None:
        return
    equipment = db.session.get(EquipmentType, reservation.equipment_type_id)
    day = datetime.strptime(reservation.date, "%Y-%m-%d").strftime("%d %b %Y")
    create_notification(event.assigned_coordinator,
        f"Equipment {action} for {event.name}: {equipment.name} × {reservation.quantity}, "
        f"{day}, {reservation.start_time}–{reservation.end_time}.", event)


@contextmanager
def _transaction():
    try:
        yield
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise


def _lock_event(account, event_id):
    if not can(account, EQUIPMENT_RESERVE):
        raise ApiRefusal(403, "You cannot reserve or release equipment.")
    event = db.session.get(EventRequest, event_id) if event_id <= MAX_QUANTITY else None
    if event is None:
        raise ApiRefusal(404, "Event not found.")
    db.session.execute(update(EventRequest).where(EventRequest.id == event.id)
                       .values(id=EventRequest.id))
    db.session.refresh(event)
    # Draft is an object-access refusal, not an accessible lifecycle refusal.
    # Match permissions.md: writes conceal inaccessible objects with 404.
    if event.status == "Draft":
        raise ApiRefusal(404, "Event not found.")
    if event.status not in EDITABLE_STATUSES:
        raise ApiRefusal(409, "Equipment can only be reserved or released while the event is Approved or Planning.")
    return event


def _lock_type(type_id):
    db.session.execute(update(EquipmentType).where(EquipmentType.id == type_id)
                       .values(id=EquipmentType.id))
    # Authentication and earlier reads may have populated the identity map.
    # All decision inputs must be read again after acquiring the write lock.
    db.session.expire_all()


def reserve(account, event_id, requirement_id):
    with _transaction():
        event = _lock_event(account, event_id)
        row = db.session.get(EquipmentRequirement, requirement_id) if requirement_id <= MAX_QUANTITY else None
        if row is None or row.event_request_id != event.id:
            raise ApiRefusal(404, "Equipment requirement not found.")
        _lock_type(row.equipment_type_id)
        db.session.execute(update(EquipmentRequirement).where(EquipmentRequirement.id == row.id)
                           .values(id=EquipmentRequirement.id))
        db.session.refresh(row)
        if row.status != "Approved":
            raise ApiRefusal(409, "Only an Approved equipment requirement can be reserved.")
        if row.has_unreleased_reservation:
            raise ApiRefusal(409, "This requirement already has an unreleased reservation.")
        start, end = services._period_of_event(event)
        if start >= end:
            raise ApiRefusal(409, "The event must have a valid period before equipment can be reserved.")
        available = services.check_availability(row.equipment_type_id,
            {"start": start.isoformat(timespec="minutes"), "end": end.isoformat(timespec="minutes")})
        if available["available_units"] < row.quantity:
            raise ApiRefusal(409, f"Insufficient equipment: {available['available_units']} units available for this period.")
        reservation = Reservation(event_request_id=event.id, equipment_type_id=row.equipment_type_id,
            quantity=row.quantity, date=event.date, start_time=event.start_time,
            end_time=event.end_time, status="Reserved")
        db.session.add(reservation)
        db.session.flush()
        _tell_coordinator(event, reservation, "reserved")
        result = {"reservation": to_dict(reservation), "requirement": row.to_dict()}
    return result


def release(account, event_id, reservation_id):
    with _transaction():
        event = _lock_event(account, event_id)
        row = db.session.get(Reservation, reservation_id) if reservation_id <= MAX_QUANTITY else None
        if row is None or row.event_request_id != event.id:
            raise ApiRefusal(404, "Equipment reservation not found.")
        _lock_type(row.equipment_type_id)
        db.session.refresh(row)
        if row.status != "Reserved":
            raise ApiRefusal(409, "This equipment reservation has already been released.")
        row.status = "Released"
        db.session.flush()
        _tell_coordinator(event, row, "released")
        requirement = db.session.query(EquipmentRequirement).filter_by(
            event_request_id=event.id, equipment_type_id=row.equipment_type_id).first()
        result = {"reservation": to_dict(row), "requirement": requirement.to_dict() if requirement else None}
    return result
