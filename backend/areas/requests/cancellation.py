"""SCRUM-65: cancel the whole event and remove its commitments atomically.

Do not call the standalone booking/hold/equipment release actions: they commit
individually and intentionally have narrower permissions/stage restrictions.
Lock order matches SCRUM-51: event, then equipment types in ascending id order.
The fresh event under the lock supplies ownership and lifecycle eligibility.
Notifications remain SCRUM-64; cancellation never deletes history or changes stock.
"""
from datetime import timezone

from sqlalchemy import update

import clock
from change_requests import close_open_change_request
from db import db
from errors import ApiRefusal
from models import EquipmentType, EventRequest, Reservation, VenueBookingRequest, VenueHold
from permissions import REQUESTS_CANCEL, can

CANCELLABLE_STATUSES = ("Submitted", "Approved", "Planning", "Safety Check", "Confirmed")


def cancel_event(account, request_id, body, commit=True):
    """Reusable domain action for the assigned Coordinator, e.g. SCRUM-60 later.

    Actor/time/status are server-owned. All writes, including arrangement metadata,
    share one transaction; refusals and unexpected exceptions roll it back. A caller that
    has more to write in the same transaction (SCRUM-60 accepting a withdrawal) passes
    commit=False, flushes what it has first (the lock below expires the session), and commits
    itself; a failure here still rolls everything back.
    """
    try:
        if not can(account, REQUESTS_CANCEL):
            raise ApiRefusal(403, "You do not have permission to perform this action.")
        event = db.session.get(EventRequest, request_id)
        if event is None:
            raise ApiRefusal(404, "Event request not found.")
        db.session.execute(update(EventRequest).where(EventRequest.id == request_id)
                           .values(id=EventRequest.id))
        db.session.refresh(event)
        if event.status == "Draft" or event.assigned_coordinator_id != account.id:
            raise ApiRefusal(404, "Event request not found.")
        if event.status not in CANCELLABLE_STATUSES:
            raise ApiRefusal(409, "Only a Submitted, Approved, Planning, Safety Check or Confirmed event can be cancelled.")
        if not isinstance(body, dict):
            raise ApiRefusal(400, "A JSON object containing reason is required.")
        reason = body.get("reason", "")
        if not isinstance(reason, str):
            raise ApiRefusal(400, "Cancellation reason must be text.")
        reason = reason.strip()
        if not reason:
            raise ApiRefusal(400, "Cancellation reason is required.")
        types = (db.session.query(Reservation.equipment_type_id)
                 .filter_by(event_request_id=event.id, status="Reserved")
                 .distinct().order_by(Reservation.equipment_type_id).all())
        for (type_id,) in types:
            db.session.execute(update(EquipmentType).where(EquipmentType.id == type_id)
                               .values(id=EquipmentType.id))
        # Avoid identity-map snapshots created by auth or earlier service reads.
        db.session.expire_all()
        instant = clock.now_local().replace(tzinfo=clock.SINGAPORE).astimezone(timezone.utc).replace(tzinfo=None)
        event.status = "Cancelled"
        event.cancelled_at = instant
        event.cancelled_by_id = account.id
        event.cancel_reason = reason
        for booking in db.session.query(VenueBookingRequest).filter_by(event_request_id=event.id).order_by(VenueBookingRequest.id):
            if booking.status == "Requested":
                booking.status = "Withdrawn"
            elif booking.status == "Approved":
                booking.status = "Cancelled"
                booking.cancel_reason = reason
                booking.cancelled_at = instant
                booking.cancelled_by_id = account.id
        for hold in db.session.query(VenueHold).filter_by(event_request_id=event.id, status="Held"):
            hold.status = "Released"
            hold.released_at = instant
        for reservation in db.session.query(Reservation).filter_by(event_request_id=event.id, status="Reserved"):
            reservation.status = "Released"
        # SCRUM-59 AC7: the event has ended, so its open change request closes undecided.
        close_open_change_request(event)
        db.session.commit() if commit else db.session.flush()
    except Exception:
        db.session.rollback()
        raise
    db.session.refresh(event)
    return event
