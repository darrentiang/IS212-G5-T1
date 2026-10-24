"""SCRUM-66: complete an assigned Confirmed event, preserving arrangements."""
from datetime import datetime, timezone

from sqlalchemy import update

import clock
from db import db
from errors import ApiRefusal
from models import EventRequest
from permissions import REQUESTS_COMPLETE, can


def complete_event(account, request_id):
    """An optimistic conditional write prevents a second completion or stale edit.

    Event periods are Singapore local time; completion metadata is UTC, like
    existing decision metadata. The same controllable clock supplies both.
    No request-body value is used, and no related arrangement is mutated.
    """
    if not can(account, REQUESTS_COMPLETE):
        raise ApiRefusal(403, "You do not have permission to perform this action.")
    event = db.session.get(EventRequest, request_id)
    if event is None or event.assigned_coordinator_id != account.id or event.status == "Draft":
        raise ApiRefusal(404, "Event request not found.")
    if event.status != "Confirmed":
        raise ApiRefusal(409, "Only a Confirmed event can be marked as Completed.")
    try:
        start = datetime.fromisoformat(f"{event.date}T{event.start_time}")
        end = datetime.fromisoformat(f"{event.date}T{event.end_time}")
        if start.tzinfo is not None or end.tzinfo is not None or start >= end:
            raise ValueError
    except ValueError:
        raise ApiRefusal(400, "The event has an invalid scheduled period.") from None
    now = clock.now_local()
    if now < end:
        raise ApiRefusal(409, "The event cannot be completed before its scheduled end.")
    completed_at = now.replace(tzinfo=clock.SINGAPORE).astimezone(timezone.utc).replace(tzinfo=None)
    try:
        result = db.session.execute(
            update(EventRequest).where(
                EventRequest.id == request_id,
                EventRequest.assigned_coordinator_id == account.id,
                EventRequest.status == "Confirmed",
                EventRequest.date == event.date,
                EventRequest.start_time == event.start_time,
                EventRequest.end_time == event.end_time,
            ).values(status="Completed", completed_at=completed_at, completed_by_id=account.id),
            execution_options={"synchronize_session": False},
        )
        if result.rowcount != 1:
            raise ApiRefusal(409, "The event changed. Reload it before trying again.")
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    db.session.refresh(event)
    return event
