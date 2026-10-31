"""SCRUM-47: the assigned Event Coordinator edits an event after submission.

Ordinary fields (name, purpose, description, registration needs) may change
in any active stage; significant ones (date, times, attendance, equipment
requirements, required layout, facilities, accessibility features) only while
Submitted, Approved or Planning. A Confirmed event reaches Planning again
through an accepted change request (SCRUM-59/60), never here. While the event
has a Held venue its date and times stay as they are. Each significant change
is kept as an EventChange row. An edit never changes the status and never
touches a booking request, hold or reservation: they keep the period and
attendance they were made with. SCRUM-92: a registration closing time after
the new start moves to it, in the same commit, with no change-record line.

Same lock as SCRUM-65: the event row, so a hold placed or a status changed
while this edit runs is seen before it is checked.
"""
from datetime import timezone

from sqlalchemy import update

import clock
from areas.requests import services
from db import db
from errors import ApiRefusal
from models import EventChange, EventRequest, VenueHold

EDITABLE_STATUSES = ("Submitted", "Approved", "Planning", "Safety Check", "Confirmed")
# AC3: a significant change after Planning needs an accepted change request.
SIGNIFICANT_ONLY_BEFORE = ("Submitted", "Approved", "Planning")
SIGNIFICANT_FIELDS = (
    "date",
    "start_time",
    "end_time",
    "attendance",
    "equipment_requirements",
    "layout",
    "facilities",
    "accessibility_features",
)
PERIOD_FIELDS = ("date", "start_time", "end_time")

NOT_EDITABLE = "Only a Submitted, Approved, Planning, Safety Check or Confirmed event can be edited."
NEEDS_CHANGE_REQUEST = (
    "A significant change to an event in Safety Check or Confirmed needs an accepted change request."
)
RELEASE_HOLD_FIRST = "Release the held venue before changing the event's date or times."


def _shown(event, field):
    """The value as the change record keeps it: text, lists joined, no value as None."""
    if field == "layout":
        return event.layout.name if event.layout else None
    if field in ("facilities", "accessibility_features"):
        # In list order, so the same choices ticked in another order are no change.
        rows = sorted(getattr(event, field), key=lambda row: row.id)
        return ", ".join(row.name for row in rows) or None
    value = getattr(event, field)
    return None if value is None else str(value)


def lock_event(request_id):
    """The event under its write lock (a no-op UPDATE of its row), or None when
    there is no such event. Who may act on it is the caller's rule (SCRUM-54
    registers an Attendee under the same lock)."""
    event = db.session.get(EventRequest, request_id)
    if event is None:
        return None
    db.session.execute(update(EventRequest).where(EventRequest.id == request_id)
                       .values(id=EventRequest.id))
    db.session.refresh(event)
    return event


def _lock(account, request_id):
    """The event under its write lock, else refuse 404 (a write never confirms
    a record that is not the account's, permissions.md)."""
    event = lock_event(request_id)
    if event is None or event.status == "Draft" or event.assigned_coordinator_id != account.id:
        raise ApiRefusal(404, "Event request not found.")
    return event


def _has_held_venue(event):
    return db.session.query(VenueHold.id).filter_by(
        event_request_id=event.id, status="Held").first() is not None


def edit_event(account, request_id, body):
    """Apply the fields sent; a field left out is unchanged. A refusal changes nothing (AC1)."""
    try:
        event = _lock(account, request_id)
        if event.status not in EDITABLE_STATUSES:
            raise ApiRefusal(409, NOT_EDITABLE)
        if not isinstance(body, dict):
            raise ApiRefusal(400, "A JSON object of the fields to change is required.")

        before = {field: _shown(event, field) for field in SIGNIFICANT_FIELDS}
        choices = services._resolve_choices(body)
        services._apply_fields(event, body)
        services._apply_choices(event, choices)

        # AC1: the submission checks, on what is changed; an unchanged date
        # that has since passed does not stop an ordinary edit.
        services._refuse_if_incomplete(event)
        if "attendance" in body:
            services._refuse_if_invalid_attendance(event)
        after = {field: _shown(event, field) for field in SIGNIFICANT_FIELDS}
        changed = [field for field in SIGNIFICANT_FIELDS if before[field] != after[field]]
        if "date" in changed:
            services._refuse_if_invalid_date(event, today=clock.now_local().date())
        if "start_time" in changed or "end_time" in changed:
            services._refuse_if_invalid_times(event)

        if changed and event.status not in SIGNIFICANT_ONLY_BEFORE:
            raise ApiRefusal(409, NEEDS_CHANGE_REQUEST)
        if any(field in changed for field in PERIOD_FIELDS) and _has_held_venue(event):
            raise ApiRefusal(409, RELEASE_HOLD_FIRST)

        if any(field in changed for field in PERIOD_FIELDS):
            # Imported here: the registration settings reuse this module's lock.
            from areas.registration.settings import close_by_start

            close_by_start(event)

        instant = clock.now_local().replace(tzinfo=clock.SINGAPORE).astimezone(timezone.utc).replace(tzinfo=None)
        for field in changed:
            db.session.add(EventChange(
                event_request_id=event.id, field=field, old_value=before[field],
                new_value=after[field], changed_by_id=account.id, changed_at=instant,
            ))
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    db.session.refresh(event)
    return event
