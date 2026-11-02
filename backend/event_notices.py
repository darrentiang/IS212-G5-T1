"""Notices about an event's own changes and about registrations — SCRUM-64.

An event that becomes Confirmed, goes back to Planning or is cancelled, and an
Attendee who registers or withdraws, each tell the people it concerns on the
Notifications page (SCRUM-58). The state change calls one of these functions
before its commit, so the notice and the change are saved together or not at
all (ADR-003): a refused action raises first and tells nobody.

Recipients are read at the moment of the change: "Registered" means Registered
then. An account is told once per action (SCRUM-64 AC7). Where one action has
already told the Organiser, the Organiser is left out of the Attendee notices
for that same action, through the ``told`` argument. What each notice says is
ui-guidelines.md, SCRUM-64.

Like notifications.py, this lives at the top of backend/, so any area can call
it without importing another area's services.
"""

from datetime import datetime

from db import db
from models import ChangeRequest, Registration, Venue, VenueBookingRequest
from notifications import create_notification

REGISTERED = "Registered"


def venue_names(event):
    """The names of the event's Approved venue booking requests, comma-separated,
    in name order: what an Attendee is told about where the event is (SCRUM-54 AC4;
    SCRUM-56 reuses it)."""
    rows = (
        db.session.query(Venue.name)
        .join(VenueBookingRequest, VenueBookingRequest.venue_id == Venue.id)
        .filter(VenueBookingRequest.event_request_id == event.id, VenueBookingRequest.status == "Approved")
        .distinct()
        .order_by(Venue.name)
        .all()
    )
    return ", ".join(name for (name,) in rows)


def _facts(event):
    """'15 Dec 2026, 10:00–12:00, Seminar Room 1, Auditorium': the period, then the venues (ui-guidelines §9)."""
    day = datetime.strptime(event.date, "%Y-%m-%d").strftime("%d %b %Y")
    period = f"{day}, {event.start_time}–{event.end_time}"
    return ", ".join(part for part in (period, venue_names(event)) if part)


def _attendees(event, told=()):
    """Each account Registered for the event now, once, except those in ``told``."""
    skip = {account.id for account in told}
    accounts = {}
    rows = (
        db.session.query(Registration)
        .filter_by(event_request_id=event.id, status=REGISTERED)
        .order_by(Registration.id)
        .all()
    )
    for row in rows:
        if row.attendee_id not in skip:
            accounts.setdefault(row.attendee_id, row.attendee)
    return list(accounts.values())


def confirmed(event):
    """SCRUM-64 AC1, AC4: the event became Confirmed (a safety check was approved).

    The Organiser is told its name, date, time and venues. Each Registered
    Attendee is told the current details: a Registered Attendee can exist only
    because the event was Confirmed before, so this is the re-confirmation of
    AC4 too, and a first confirmation finds none.
    """
    create_notification(event.created_by, f'Your event "{event.name}" is confirmed: {_facts(event)}.', event)
    for attendee in _attendees(event, told=(event.created_by,)):
        create_notification(attendee, f'"{event.name}" is confirmed again: {_facts(event)}.', event)


def back_in_planning(event, told=()):
    """SCRUM-64 AC3: a Confirmed event went back to Planning. Each Registered Attendee is told.

    Only a Confirmed event sends this (a rejected or changed safety check on a
    Safety Check event tells nobody, TC-07), and only at the moment it moves,
    never for edits made while it is already in Planning (AC3's one warning).
    """
    for attendee in _attendees(event, told=told):
        create_notification(attendee, f'"{event.name}" is back in planning. Its details may change.', event)


def change_accepted(event):
    """SCRUM-64 AC2: the Organiser's change request was accepted. No reason is given."""
    create_notification(event.created_by, f'Your change request on "{event.name}" was accepted.', event)


def change_declined(event, change_request):
    """SCRUM-64 AC2: the Organiser's change or withdrawal request was declined, with the coordinator's reason."""
    label = "change request" if change_request.kind == ChangeRequest.CHANGE else "withdrawal request"
    create_notification(
        event.created_by,
        f'Your {label} on "{event.name}" was declined. Reason: {change_request.decision_reason}',
        event,
    )


def cancelled(event, reason):
    """SCRUM-64 AC5: the event was cancelled. The Organiser gets the reason; each Registered Attendee does not."""
    create_notification(event.created_by, f'Your event "{event.name}" was cancelled. Reason: {reason}', event)
    for attendee in _attendees(event, told=(event.created_by,)):
        create_notification(attendee, f'"{event.name}" was cancelled.', event)


def registered_for(event, attendee):
    """SCRUM-64 AC6: the Attendee registered; they are told the event's name, date, time and venues."""
    create_notification(attendee, f'You are Registered for "{event.name}": {_facts(event)}.', event)


def withdrawn_from(event, attendee):
    """SCRUM-64 AC6: the Attendee withdrew their registration; they are told the event's name."""
    create_notification(attendee, f'You are Withdrawn from "{event.name}".', event)
