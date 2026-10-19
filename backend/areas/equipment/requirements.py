"""SCRUM-48 — detailed event equipment requirements, never reservations.

Read access is deliberately narrower than requests.view: Technical Support
gets only timing, Approved venues and detailed equipment, not private request
fields. Object refusals follow permissions.md (GET 403, mutation 404).
"""
from decimal import Decimal, InvalidOperation
from sqlalchemy.exc import IntegrityError

from db import db
from errors import ApiRefusal
from models import EquipmentRequirement, EquipmentType, EventRequest

EDITABLE_STATUSES = ("Approved", "Planning")
MAX_QUANTITY = 2**53 - 1


def _event(account, event_id, *, writing=False):
    event = db.session.get(EventRequest, event_id) if event_id <= MAX_QUANTITY else None
    if event is None:
        raise ApiRefusal(404, "Event not found.")
    assigned = event.assigned_coordinator_id == account.id
    technical_reader = not writing and account.has_role("Technical Support Staff")
    if event.status == "Draft" or not (assigned or technical_reader):
        raise ApiRefusal(404 if writing else 403, "You cannot access this event's equipment requirements.")
    if writing and event.status not in EDITABLE_STATUSES:
        raise ApiRefusal(409, "Equipment requirements can only be changed while the event is Approved or Planning.")
    return event


def list_events(account):
    query = db.session.query(EventRequest).filter(EventRequest.status != "Draft")
    if not account.has_role("Technical Support Staff"):
        query = query.filter(EventRequest.assigned_coordinator_id == account.id)
    return [
        {"id": row.id, "name": row.name, "status": row.status,
         "date": row.date, "start_time": row.start_time, "end_time": row.end_time}
        for row in query.order_by(EventRequest.id).all()
    ]


def detail(account, event_id):
    from areas.equipment.reservations import list_for_event
    event = _event(account, event_id)
    return {
        "id": event.id, "name": event.name, "status": event.status,
        "date": event.date, "start_time": event.start_time, "end_time": event.end_time,
        "reservations": list_for_event(account, event_id),
        "requirements": [row.to_dict() for row in sorted(event.equipment_items, key=lambda row: row.id)],
        "approved_venue_bookings": [
            {"id": row.id, "venue_name": row.venue.name,
             "date": row.date, "start_time": row.start_time, "end_time": row.end_time}
            for row in sorted(event.booking_requests, key=lambda row: row.id) if row.status == "Approved"
        ],
    }


def _values(body, technical_default=""):
    if not isinstance(body, dict):
        raise ApiRefusal(400, "A JSON object containing quantity is required.")
    value = body.get("quantity")
    try:
        if isinstance(value, bool):
            raise ValueError
        quantity = Decimal(str(value).strip())
        if not quantity.is_finite() or quantity < 1 or quantity > MAX_QUANTITY or quantity != quantity.to_integral_value():
            raise ValueError
    except (InvalidOperation, ValueError):
        raise ApiRefusal(400, "Quantity must be a positive whole number no greater than 9007199254740991.") from None
    technical = body.get("technical_requirements", technical_default)
    if not isinstance(technical, str):
        raise ApiRefusal(400, "Technical requirements must be text.")
    return int(quantity), technical.strip()


def add(account, event_id, body):
    event = _event(account, event_id, writing=True)
    quantity, technical = _values(body)
    type_id = body.get("equipment_type_id")
    if isinstance(type_id, bool) or not isinstance(type_id, int) or not 1 <= type_id <= MAX_QUANTITY:
        raise ApiRefusal(400, "Choose a recognised equipment type.")
    equipment = db.session.get(EquipmentType, type_id)
    if equipment is None:
        raise ApiRefusal(400, "Choose a recognised equipment type.")
    if db.session.query(EquipmentRequirement).filter_by(event_request_id=event.id, equipment_type_id=type_id).first():
        raise ApiRefusal(400, "This equipment type is already recorded for this event.")
    row = EquipmentRequirement(event_request=event, equipment_type=equipment,
                               quantity=quantity, technical_requirements=technical, status="Requested")
    db.session.add(row)
    try:
        db.session.commit()
    except IntegrityError:
        # The unique pair also protects concurrent requests after the precheck.
        db.session.rollback()
        raise ApiRefusal(400, "This equipment type is already recorded for this event.") from None
    return row


def _requested(account, event_id, requirement_id):
    event = _event(account, event_id, writing=True)
    row = db.session.get(EquipmentRequirement, requirement_id) if requirement_id <= MAX_QUANTITY else None
    if row is None or row.event_request_id != event.id:
        raise ApiRefusal(404, "Equipment requirement not found.")
    if row.status != "Requested":
        raise ApiRefusal(409, "Only Requested requirements can be changed or removed.")
    return row


def update(account, event_id, requirement_id, body):
    row = _requested(account, event_id, requirement_id)
    quantity, technical = _values(body, row.technical_requirements)
    # An equipment type is immutable here; remove Requested and add another.
    if "equipment_type_id" in body and body["equipment_type_id"] != row.equipment_type_id:
        raise ApiRefusal(400, "The equipment type cannot be changed; remove the Requested requirement and add another.")
    row.quantity, row.technical_requirements = quantity, technical
    db.session.commit()
    return row


def remove(account, event_id, requirement_id):
    row = _requested(account, event_id, requirement_id)
    db.session.delete(row)
    db.session.commit()
