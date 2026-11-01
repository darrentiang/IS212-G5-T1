"""Event-request rules — SCRUM-27 (read access, object rules), SCRUM-28
(create and submit), SCRUM-29 (approve or reject) and SCRUM-30 (save, edit
and delete a Draft).
SCRUM-42: the optional required layout, facilities and accessibility features,
which replace the free-text venue requirements and accessibility needs.
SCRUM-87: an Event Coordinator sees and acts on only the events assigned to them.
SCRUM-88: the Event Coordinator Lead lists every active event with who holds it, filtered, with
each coordinator's count of active events.
SCRUM-86: the Event Coordinator Lead assigns a Submitted request to an Event Coordinator from the
unassigned queue; approving assigns no one (replaces SCRUM-43's auto-assignment).
SCRUM-72: revise and resubmit a Rejected request.
SCRUM-89: the Safety Officer lists, opens, approves and rejects events in Safety Check.
SCRUM-53: the assigned Event Coordinator sends a Planning event for safety check.
SCRUM-84: an Approved event moves to Planning when its first hold is placed.
SCRUM-82: a booking marked Venue unavailable stops the event being sent.
SCRUM-45: the assigned Event Coordinator asks the Organiser for clarification of a Submitted request;
the Organiser replies; a decision ends a wait nobody answered.
SCRUM-47: the assigned coordinator's edits after submission are in editing.py;
the detail carries their change record.
SCRUM-62: the creating Event Organiser is told when their request is received,
approved or rejected (the assignment and reassignment notices it also relies on
are SCRUM-86's and SCRUM-44's, below).

Object rules from permissions.md / ADR-002 live here next to the query.
"""

from datetime import date, datetime, timezone

from sqlalchemy import func, or_

import arrangement_flags
import occupancy
from change_requests import close_open_change_request, notify_waiting_change_request
from db import db
from errors import ApiRefusal
from models import (
    AccessibilityFeature,
    Account,
    Clarification,
    EventRequest,
    Facility,
    Role,
    RoomLayout,
    SafetyDecision,
)
from models import VenueBookingRequest
from notifications import create_notification
from permissions import INTERNAL_NOTES_VIEW, can

ORGANISER_ROLE = "Event Organiser"
COORDINATOR_ROLE = "Event Coordinator"
SAFETY_OFFICER_ROLE = "Safety Officer"
LEAD_ROLE = "Event Coordinator Lead"

SAFETY_CHECK = "Safety Check"

# SCRUM-88 AC1: the statuses an event is still active in; Draft, Rejected,
# Completed and Cancelled are not.
ACTIVE_STATUSES = ("Submitted", "Approved", "Planning", SAFETY_CHECK, "Confirmed")
# SCRUM-46: the statuses in which the Organiser sees the arrangements, or that they are in progress.
ARRANGEMENTS_SHOWN = ("Confirmed", "Completed")
ARRANGEMENTS_IN_PROGRESS = ("Submitted", "Approved", "Planning", SAFETY_CHECK)

# The areas the Safety Officer may leave a note against (SCRUM-89 AC4); the keys
# are what the API takes and returns.
SAFETY_NOTE_AREAS = (
    "attendance",
    "capacity_and_layout",
    "emergency_access",
    "accessibility",
    "equipment_placement",
    "crowd_movement",
    "venue_restrictions",
)

# The areas a request for changes names (SCRUM-90 AC1), in the fixed order they
# are kept and shown in.
CHANGE_AREAS = ("venue_arrangements", "technical_arrangements")
CHANGE_AREA_LABELS = {
    "venue_arrangements": "venue arrangements",
    "technical_arrangements": "technical arrangements",
}
CHANGES_REQUESTED = "Changes requested"

# One sentence for an event that does not exist and for one that is not in
# Safety Check, so a decision never confirms an event the Safety Officer may
# not see (permissions.md: a write answers 404 when the record is not theirs).
NOT_IN_SAFETY_CHECK = "No event in Safety Check was found with that number."


def visible_requests(account):
    """Event requests this account may see in a list.

    Event Coordinator (including multi-role coordinators): only the requests
    assigned to them (SCRUM-87 AC1).
    Event Organiser only: own requests, any status.
    Safety Officer: events in Safety Check, the one that has been there
    longest first (SCRUM-89 AC2); one with no recorded time sorts last.
    """
    query = db.session.query(EventRequest)
    if account.has_role(COORDINATOR_ROLE):
        return (
            query.filter(
                EventRequest.assigned_coordinator_id == account.id, EventRequest.status != "Draft"
            )
            .order_by(EventRequest.id)
            .all()
        )
    own = EventRequest.created_by_id == account.id
    if account.has_role(SAFETY_OFFICER_ROLE):
        return (
            query.filter(or_(own, EventRequest.status == SAFETY_CHECK))
            .order_by(
                EventRequest.safety_check_at.is_(None),
                EventRequest.safety_check_at,
                EventRequest.id,
            )
            .all()
        )
    return query.filter(own).order_by(EventRequest.id).all()


def get_visible_request(account, request_id):
    """One request if the account may see it, else refuse 403 / 404.

    Deliberately 403, not 404, when it exists but the account may not see
    it: a read reveals existence (SCRUM-27). A write that isn't the
    account's own instead answers 404 (_get_own_request, below), matching
    SCRUM-28's original submit_draft: existence is not revealed by what
    another Organiser is allowed to change.
    """
    event_request = db.session.get(EventRequest, request_id)
    if event_request is None:
        raise ApiRefusal(404, "Event request not found.")

    # SCRUM-87 AC2: a coordinator opens only an event assigned to them; one that
    # is unassigned, or assigned to someone else, is refused below.
    if (
        account.has_role(COORDINATOR_ROLE)
        and event_request.assigned_coordinator_id == account.id
        and event_request.status != "Draft"
    ):
        return event_request
    if account.has_role(ORGANISER_ROLE) and event_request.created_by_id == account.id:
        return event_request
    if account.has_role(SAFETY_OFFICER_ROLE) and event_request.status == SAFETY_CHECK:
        return event_request
    if account.has_role(LEAD_ROLE) and _lead_may_read(event_request):
        return event_request
    raise ApiRefusal(403, "You do not have permission to perform this action.")


def request_to_dict(event_request):
    """Public JSON for a list row or a create/submit response — never internal notes."""
    return event_request.to_dict()


def request_detail_dict(event_request, account):
    """Detail JSON; coordinator_notes only when the account may see them."""
    payload = request_to_dict(event_request)
    if event_request.completed_at is not None and event_request.completed_by is not None:
        payload["completion"] = {
            "completed_at": event_request.completed_at.isoformat() + "Z",
            "completed_by": event_request.completed_by.username,
        }
    if event_request.cancelled_at is not None and event_request.cancelled_by is not None:
        payload["cancellation"] = {
            "cancelled_at": event_request.cancelled_at.isoformat() + "Z",
            "cancelled_by": event_request.cancelled_by.username,
            "reason": event_request.cancel_reason,
        }
    if can(account, INTERNAL_NOTES_VIEW):
        payload["coordinator_notes"] = event_request.coordinator_notes
    reviewing = account.has_role(SAFETY_OFFICER_ROLE) and event_request.status == SAFETY_CHECK
    if can(account, INTERNAL_NOTES_VIEW) or reviewing:
        payload["safety_decisions"] = [
            _safety_decision_to_dict(row) for row in event_request.safety_decisions
        ]
    if can(account, INTERNAL_NOTES_VIEW):
        payload["requested_changes"] = _requested_changes(event_request)
    if reviewing:
        payload["safety_check"] = _safety_check_to_dict(event_request)
    if _may_read_exchanges(account, event_request):
        payload["clarifications"] = [row.to_dict() for row in event_request.clarifications]
        # SCRUM-59: the Organiser's change and withdrawal requests, oldest first, each Open
        # or Closed, with what needs reviewing.
        payload["change_requests"] = [row.to_dict() for row in event_request.change_requests]
    if event_request.created_by_id == account.id:
        payload["arrangements"] = _arrangements_for_organiser(event_request)
    # SCRUM-47 AC5: the record of significant changes, for the assigned coordinator.
    if event_request.assigned_coordinator_id == account.id:
        payload["change_record"] = [row.to_dict() for row in event_request.changes]
    # SCRUM-92, SCRUM-57: the registration, for the assigned coordinator (who sets
    # it) and the Event Organiser who created the event (who only views it); for
    # nobody else, the Lead's read-only view included.
    assigned = event_request.assigned_coordinator_id == account.id
    if assigned or event_request.created_by_id == account.id:
        # Imported here: the settings module builds on this one.
        from areas.registration.settings import settings_to_dict

        payload["registration"] = settings_to_dict(event_request, account, may_edit=assigned)
    return payload


def _arrangements_for_organiser(event_request):
    """What the Event Organiser who wrote the request sees of its arrangements (SCRUM-46).

    Decided by the event's current status alone: Confirmed or Completed lists
    each Approved venue booking and Approved equipment requirement; a status
    before Confirmed says they are in progress and lists none; Draft, Rejected
    and Cancelled have none (None). Nothing else of the planning (requests,
    holds, decisions, reasons, notes) is included.
    """
    if event_request.status in ARRANGEMENTS_SHOWN:
        bookings = [
            row
            for row in sorted(event_request.booking_requests, key=lambda row: row.id)
            if row.status == "Approved"
        ]
        return {
            "in_progress": False,
            "venue_bookings": [
                {
                    "id": booking.id,
                    "venue": booking.venue.name,
                    "location": booking.venue.location,
                    "date": booking.date,
                    "start_time": booking.start_time,
                    "end_time": booking.end_time,
                }
                for booking in bookings
            ],
            "equipment": [
                {"id": row["id"], "equipment_type": row["equipment_type"], "quantity": row["quantity"]}
                for row in _approved_equipment_requirements(event_request)
            ],
        }
    if event_request.status in ARRANGEMENTS_IN_PROGRESS:
        return {"in_progress": True}
    return None


def _may_read_exchanges(account, event_request):
    """The Organiser who wrote the request, its assigned coordinator and the Lead
    (read-only) see its clarifications and replies (SCRUM-45 AC2, AC5) and its change
    and withdrawal requests (SCRUM-59 AC3, AC6); the Safety Officer, who opens only an
    event in Safety Check, does not."""
    return (
        event_request.created_by_id == account.id
        or event_request.assigned_coordinator_id == account.id
        or account.has_role(LEAD_ROLE)
    )


def _safety_decision_to_dict(decision):
    return {
        "id": decision.id,
        "decision": decision.decision,
        "reason": decision.reason,
        "notes": decision.notes or {},
        "areas": decision.areas or [],
        "decided_at": decision.decided_at.isoformat(),
        "decided_by": decision.decided_by.username,
    }


def _requested_changes(event_request):
    """The changes the Safety Officer asked for that are still outstanding, else None.

    SCRUM-90 AC5: shown while the event is in Planning, until it is sent for
    safety check again. Nothing is stored for that: the latest decision is a
    request for changes and the event has not been sent since it (SCRUM-53
    records a later safety_check_at when it sends the event), so sending it
    again clears the changes without SCRUM-53 having to know about them.
    """
    if event_request.status != "Planning" or not event_request.safety_decisions:
        return None
    latest = event_request.safety_decisions[-1]
    if latest.decision != CHANGES_REQUESTED:
        return None
    sent = event_request.safety_check_at
    if sent is not None and sent >= latest.decided_at:
        return None
    return _safety_decision_to_dict(latest)


def _approved_equipment_requirements(event_request):
    """SCRUM-48 records; SCRUM-81 reviews. Safety sees Approved only."""
    return [{**row.to_dict(), "equipment_type": row.equipment_type.name}
            for row in sorted(event_request.equipment_items, key=lambda row: row.id)
            if row.status == "Approved"]


def _safety_check_to_dict(event_request):
    """What the Safety Officer reviews on an event in Safety Check (AC3).

    Only Approved venue bookings are listed: a Rejected, Withdrawn or Cancelled
    booking is not an arrangement the event has.
    """
    bookings = [
        row
        for row in sorted(event_request.booking_requests, key=lambda row: row.id)
        if row.status == "Approved"
    ]
    sent_at = event_request.safety_check_at
    return {
        "sent_at": sent_at.isoformat() if sent_at else None,
        "note_areas": list(SAFETY_NOTE_AREAS),
        "venue_bookings": [
            {
                "id": booking.id,
                # SCRUM-61 AC3: the Safety Officer sees the too-small flag while the event is in Safety Check.
                "too_small": arrangement_flags.booking_too_small(booking),
                "date": booking.date,
                "start_time": booking.start_time,
                "end_time": booking.end_time,
                "venue": {
                    "id": booking.venue.id,
                    "name": booking.venue.name,
                    "location": booking.venue.location,
                    "max_capacity": booking.venue.max_capacity,
                    "layouts": [row.name for row in booking.venue.layouts],
                    "facilities": [row.name for row in booking.venue.facilities],
                    "accessibility_features": [
                        row.name for row in booking.venue.accessibility_features
                    ],
                },
            }
            for booking in bookings
        ],
        "equipment_requirements": _approved_equipment_requirements(event_request),
    }


def _require_organiser(account):
    if not account.has_role(ORGANISER_ROLE):
        raise ApiRefusal(403, "Only an Event Organiser may do this.")


def _apply_fields(event_request, data):
    for field in EventRequest.REQUIRED_FIELDS:
        if field in data:
            setattr(event_request, field, data[field])


def request_options():
    """SCRUM-42: the fixed lists an event request's requirements are chosen from.

    The same tables as /api/venue-options, served under requests.edit because
    an Event Organiser does not hold venues.view.
    """
    return {
        "layouts": [row.name for row in db.session.query(RoomLayout).order_by(RoomLayout.id)],
        "facilities": [row.name for row in db.session.query(Facility).order_by(Facility.id)],
        "accessibility_features": [
            row.name
            for row in db.session.query(AccessibilityFeature).order_by(AccessibilityFeature.id)
        ],
    }


def _chosen_rows(values, model, singular, plural, duplicate_message):
    """Rows for a list of names from one fixed list, else refuse 400.

    Same rules and wording as SCRUM-32's venue layouts: a list, of names on
    the list, none twice. An empty list or null clears the choice.
    """
    if values is None:
        return []
    if not isinstance(values, list):
        raise ApiRefusal(400, f"Choose {plural} as a list.")
    if not all(isinstance(value, str) for value in values):
        raise ApiRefusal(400, f"Choose each {singular} from the list.")
    if len(values) != len(set(values)):
        raise ApiRefusal(400, duplicate_message)
    rows = []
    for name in values:
        row = db.session.query(model).filter_by(name=name).first()
        if row is None:
            raise ApiRefusal(400, f"Choose each {singular} from the list.")
        rows.append(row)
    return rows


def _chosen_layout(value):
    """The one required layout, or None when none is chosen, else refuse 400."""
    if value is None or value == "":
        return None
    row = None
    if isinstance(value, str):
        row = db.session.query(RoomLayout).filter_by(name=value).first()
    if row is None:
        raise ApiRefusal(400, "Choose the layout from the list.")
    return row


def _resolve_choices(data):
    """SCRUM-42 AC1: the requirement choices sent, resolved to rows.

    Only the keys present are returned, so an edit that leaves one out leaves
    it unchanged. Every value is checked before anything is changed, so a
    refusal records nothing, on a Draft too: an unknown value cannot be
    stored as a link.
    """
    choices = {}
    if "layout" in data:
        choices["layout"] = _chosen_layout(data["layout"])
    if "facilities" in data:
        choices["facilities"] = _chosen_rows(
            data["facilities"], Facility, "facility", "facilities",
            "A facility cannot be selected more than once.",
        )
    if "accessibility_features" in data:
        choices["accessibility_features"] = _chosen_rows(
            data["accessibility_features"], AccessibilityFeature,
            "accessibility feature", "accessibility features",
            "An accessibility feature cannot be selected more than once.",
        )
    return choices


def _apply_choices(event_request, choices):
    for field, value in choices.items():
        setattr(event_request, field, value)


def _get_own_request(account, request_id):
    """An own request by id, else refuse 404 (never leaks whether it exists)."""
    event_request = db.session.get(EventRequest, request_id)
    if event_request is None or event_request.created_by_id != account.id:
        raise ApiRefusal(404, "Event request not found.")
    return event_request


def _refuse_if_name_missing(event_request):
    if event_request.name is None or event_request.name.strip() == "":
        raise ApiRefusal(400, "Missing required fields: name")


def _refuse_if_incomplete(event_request):
    missing = event_request.missing_fields()
    if missing:
        raise ApiRefusal(400, "Missing required fields: " + ", ".join(missing))


def _parse_positive_int(value):
    """The int a positive, whole attendance value represents, else None."""
    # Same rule as venues' maximum capacity: int() rejects anything that is
    # not a whole number ('20.5', '20.0', '1e5', 'nan', 'inf', True included),
    # whether it arrives as a JSON number or as a string from the form.
    try:
        number = int(str(value).strip())
    except ValueError:
        return None
    if number < 1:
        return None
    return number


def _refuse_if_invalid_date(event_request, today=None):
    """today: SCRUM-47 passes the controlled clock's date; submission keeps date.today()."""
    try:
        entered = datetime.strptime(event_request.date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise ApiRefusal(400, "Date must be a valid date.")
    if entered < (today or date.today()):
        raise ApiRefusal(400, "Date cannot be earlier than today.")


def _refuse_if_invalid_times(event_request):
    try:
        start = datetime.strptime(event_request.start_time, "%H:%M")
        end = datetime.strptime(event_request.end_time, "%H:%M")
    except (TypeError, ValueError):
        raise ApiRefusal(400, "Start and end time must be valid times.")
    if start >= end:
        raise ApiRefusal(400, "Start time must be before the end time.")


def _refuse_if_invalid_attendance(event_request):
    attendance = _parse_positive_int(event_request.attendance)
    if attendance is None:
        raise ApiRefusal(400, "Attendance must be a positive whole number.")
    event_request.attendance = attendance


def _refuse_if_business_rules_violated(event_request):
    """AC7, AC8, AC9, AC10: checked only once every required field is present."""
    _refuse_if_invalid_date(event_request)
    _refuse_if_invalid_times(event_request)
    _refuse_if_invalid_attendance(event_request)


def submit_new_request(account, data):
    """Create and submit a request directly (state-model.md: '— -> Submitted').

    AC1, AC3, AC4: every required field must be present or the submission is
    refused, listing what is missing, and nothing is recorded as submitted.
    """
    _require_organiser(account)

    choices = _resolve_choices(data)
    event_request = EventRequest(created_by_id=account.id, status="Draft")
    _apply_fields(event_request, data)
    _apply_choices(event_request, choices)
    _refuse_if_incomplete(event_request)
    _refuse_if_business_rules_violated(event_request)

    event_request.status = "Submitted"
    event_request.submitted_at = datetime.now(timezone.utc)
    db.session.add(event_request)
    _notify_received(account, event_request)
    db.session.commit()
    return event_request


def submit_draft(account, request_id):
    """Submit an existing Draft (state-model.md: 'Draft -> Submitted').

    AC2: only a request that is Draft (or new) may be submitted this way.
    """
    _require_organiser(account)
    event_request = _get_own_request(account, request_id)

    if event_request.status != "Draft":
        raise ApiRefusal(400, "Only a Draft request can be submitted.")

    _refuse_if_incomplete(event_request)
    _refuse_if_business_rules_violated(event_request)

    event_request.status = "Submitted"
    event_request.submitted_at = datetime.now(timezone.utc)
    _notify_received(account, event_request)
    db.session.commit()
    return event_request


_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _format_decision_datetime(value):
    """Match ui-guidelines.md §9: '03 Oct 2026, 14:30'. Stored values are UTC."""
    return f"{value.day:02d} {_MONTHS[value.month - 1]} {value.year}, {value.hour:02d}:{value.minute:02d}"


def _optional_reason(data):
    raw = (data or {}).get("reason")
    if raw is None:
        return None
    trimmed = str(raw).strip()
    return trimmed or None


def _already_decided_message(event_request):
    when = _format_decision_datetime(event_request.decided_at) if event_request.decided_at else None
    if when:
        return f"This request has already been decided ({event_request.decision} on {when})."
    return f"This request has already been decided ({event_request.decision})."


def _get_decidable_request(account, request_id):
    """A Submitted request the coordinator may decide, else refuse.

    AC1: only Submitted. AC7: an already decided request is refused with the
    existing decision and its date. The route's require(REQUESTS_DECIDE) has
    already refused anyone who is not an Event Coordinator; SCRUM-87 AC3 then
    requires them to be the one assigned.
    """
    event_request = get_visible_request(account, request_id)
    # SCRUM-87 AC3: only the assigned coordinator decides. A request still in the
    # unassigned queue has no one to decide it, and an account that can read it
    # for another role (the Lead's read-only view) does not become its coordinator.
    if event_request.assigned_coordinator_id != account.id:
        raise ApiRefusal(403, "You do not have permission to perform this action.")
    if event_request.status != "Submitted":
        if event_request.decision:
            raise ApiRefusal(409, _already_decided_message(event_request))
        raise ApiRefusal(409, "Only a Submitted request can be decided.")
    return event_request


def _event_coordinators():
    """Every account holding the Event Coordinator role, including one that
    also holds another role (Q-06, D-09), such as a Lead who is also a
    coordinator (SCRUM-86 AC4)."""
    return (
        db.session.query(Account)
        .join(Account.roles)
        .filter(Role.name == COORDINATOR_ROLE)
        .order_by(Account.username)
        .all()
    )


def _lead_may_read(event_request):
    """What the Lead may open, read-only: a request in the queue (SCRUM-86), one
    that has a coordinator, or any active event (SCRUM-88 AC5), never a Draft."""
    return event_request.status != "Draft" and (
        event_request.status in ACTIVE_STATUSES or event_request.assigned_coordinator_id is not None
    )


def unassigned_queue():
    """The unassigned queue, oldest submission first (SCRUM-86 AC3).

    The one with no recorded submission time sorts last, then by id so two
    submitted at the same moment keep a fixed order.
    """
    return (
        db.session.query(EventRequest)
        .filter(EventRequest.status == "Submitted", EventRequest.assigned_coordinator_id.is_(None))
        .order_by(EventRequest.submitted_at.is_(None), EventRequest.submitted_at, EventRequest.id)
        .all()
    )


def active_events(coordinator=None, status=None):
    """Every active event with who holds it, oldest request first (SCRUM-88 AC1-AC3).

    `coordinator` (a username) and `status` narrow the list; either one that is
    not a coordinator or not an active status is refused 400, nothing is shown.
    """
    if status is not None and status not in ACTIVE_STATUSES:
        raise ApiRefusal(400, "Choose one of the active statuses.")
    chosen = None
    if coordinator is not None:
        chosen = next((row for row in _event_coordinators() if row.username == coordinator), None)
        if chosen is None:
            raise ApiRefusal(400, "Choose an Event Coordinator.")

    query = db.session.query(EventRequest).filter(EventRequest.status.in_(ACTIVE_STATUSES))
    if chosen is not None:
        query = query.filter(EventRequest.assigned_coordinator_id == chosen.id)
    if status is not None:
        query = query.filter(EventRequest.status == status)
    return query.order_by(EventRequest.id).all()


def active_event_row_to_dict(event_request):
    """What the Lead's list shows of an event (SCRUM-88 AC1); no coordinator is None."""
    coordinator = event_request.assigned_coordinator
    return {
        "id": event_request.id,
        "name": event_request.name,
        "date": event_request.date,
        "status": event_request.status,
        "assigned_coordinator": coordinator.username if coordinator else None,
    }


def coordinator_workloads():
    """Each Event Coordinator and how many active events they hold, by username,
    whatever the list is filtered to (SCRUM-88 AC4); one holding none shows 0."""
    held = {
        coordinator_id: count
        for coordinator_id, count in db.session.query(
            EventRequest.assigned_coordinator_id, func.count(EventRequest.id)
        )
        .filter(
            EventRequest.status.in_(ACTIVE_STATUSES),
            EventRequest.assigned_coordinator_id.isnot(None),
        )
        .group_by(EventRequest.assigned_coordinator_id)
        .all()
    }
    return [
        {"id": row.id, "username": row.username, "active_events": held.get(row.id, 0)}
        for row in _event_coordinators()
    ]


def queue_row_to_dict(event_request):
    """What the Lead sees of a queued request, and no more (SCRUM-86 AC3)."""
    return {
        "id": event_request.id,
        "name": event_request.name,
        "purpose": event_request.purpose,
        "date": event_request.date,
        "attendance": event_request.attendance,
        "created_by": event_request.created_by.username,
        "submitted_at": event_request.submitted_at.isoformat() if event_request.submitted_at else None,
    }


def assignable_coordinators():
    """The accounts a request can be assigned to, by username (SCRUM-86 AC4)."""
    return [{"id": row.id, "username": row.username} for row in _event_coordinators()]


def _chosen_coordinator(data):
    """The Event Coordinator the Lead chose, else refuse 400 (SCRUM-86 AC4)."""
    raw = (data or {}).get("coordinator_id")
    if raw is None or str(raw).strip() == "":
        raise ApiRefusal(400, "Choose an Event Coordinator.")
    try:
        coordinator_id = int(raw)
    except (TypeError, ValueError):
        coordinator_id = None
    coordinator = db.session.get(Account, coordinator_id) if coordinator_id is not None else None
    if coordinator is None or not coordinator.has_role(COORDINATOR_ROLE):
        raise ApiRefusal(400, "The chosen account is not an Event Coordinator.")
    return coordinator


def assign_coordinator(account, request_id, data):
    """Assign a queued request to an Event Coordinator (SCRUM-86 AC4, AC5, AC6).

    Only a Submitted request with no coordinator can be assigned this way; a
    Draft answers 404 like any request the Lead may not read, and anything
    else is refused with its current state, nothing changed. The request stays
    Submitted. The coordinator, the Lead and the moment are recorded, and the
    coordinator and the Organiser are told, in one commit with the assignment.
    The route's require(ASSIGNMENTS_MANAGE) has already refused anyone who is
    not a Lead (AC9). Changing an assignment is `reassign_coordinator` (SCRUM-44).
    """
    event_request = db.session.get(EventRequest, request_id)
    if event_request is None or event_request.status == "Draft":
        raise ApiRefusal(404, "Event request not found.")
    if event_request.assigned_coordinator is not None:
        raise ApiRefusal(
            409, f"This request is already assigned to {event_request.assigned_coordinator.username}."
        )
    if event_request.status != "Submitted":
        raise ApiRefusal(409, "Only a Submitted request with no coordinator can be assigned.")

    coordinator = _chosen_coordinator(data)
    event_request.assigned_coordinator_id = coordinator.id
    event_request.assigned_by_id = account.id
    event_request.assigned_at = datetime.now(timezone.utc)

    name = event_request.name
    create_notification(coordinator, f'You have been assigned the event "{name}".', event_request)
    create_notification(
        event_request.created_by,
        f'{coordinator.username} has been assigned to your event "{name}".',
        event_request,
    )
    # SCRUM-59 AC6: a request the Organiser raised while no one held the event was waiting.
    notify_waiting_change_request(event_request, coordinator)
    db.session.commit()
    return event_request


def reassign_coordinator(account, request_id, data):
    """Move an assigned active event to another Event Coordinator (SCRUM-44 AC1-AC5).

    Only a Submitted, Approved, Planning, Safety Check or Confirmed event that
    already has a coordinator can be moved, and not to the one it has. The
    status, the fields and the arrangements are not touched. The new
    coordinator, the one it leaves and the Organiser are told, in one commit
    with the change; the Organiser's page then shows the new coordinator and
    the Lead who moved it. The route's require(ASSIGNMENTS_MANAGE) has already
    refused anyone who is not a Lead (AC6). A refusal changes nothing.
    """
    event_request = db.session.get(EventRequest, request_id)
    if event_request is None or event_request.status == "Draft":
        raise ApiRefusal(404, "Event request not found.")
    if event_request.status not in ACTIVE_STATUSES:
        raise ApiRefusal(
            409, f"A {event_request.status} event cannot be reassigned, only an active one."
        )
    previous = event_request.assigned_coordinator
    if previous is None:
        raise ApiRefusal(409, "This request has no coordinator yet; assign it from the Unassigned queue.")

    coordinator = _chosen_coordinator(data)
    if coordinator.id == previous.id:
        raise ApiRefusal(409, f"This event is already assigned to {previous.username}.")

    event_request.assigned_coordinator_id = coordinator.id
    event_request.assigned_by_id = account.id
    event_request.assigned_at = datetime.now(timezone.utc)

    name = event_request.name
    create_notification(coordinator, f'You have been assigned the event "{name}".', event_request)
    create_notification(
        previous, f'The event "{name}" has been reassigned to {coordinator.username}.', event_request
    )
    create_notification(
        event_request.created_by,
        f'{coordinator.username} has been assigned to your event "{name}".',
        event_request,
    )
    db.session.commit()
    return event_request


def start_planning_if_approved(event_request):
    """Approved -> Planning when the first hold or booking request is raised
    for the event (state-model.md); any other status is left as it is.

    Nothing is committed: the caller commits it with the hold (SCRUM-84 AC8)
    or with the booking request that started planning (SCRUM-86 AC8).
    """
    if event_request.status == "Approved":
        event_request.status = "Planning"


def _record_decision(event_request, account, decision, reason):
    # SCRUM-45 AC6: a decision ends a clarification the Organiser has not answered.
    _end_open_clarification(event_request)
    # SCRUM-59 AC7: a rejection ends the event, so its open change request closes undecided.
    if decision == "Rejected":
        close_open_change_request(event_request)
    event_request.status = decision
    event_request.decision = decision
    event_request.decision_reason = reason
    event_request.decided_at = datetime.now(timezone.utc)
    event_request.decided_by_id = account.id

    _notify_decision(event_request, decision, reason)
    db.session.commit()
    return event_request


def _end_open_clarification(event_request):
    open_one = event_request.open_clarification
    if open_one is not None:
        open_one.ended_at = datetime.now(timezone.utc)


def _clarification_text(data, message):
    """The trimmed message, else refuse 400 with `message` (a blank one is refused, SCRUM-45 AC1, AC3)."""
    raw = (data or {}).get("message")
    text = raw.strip() if isinstance(raw, str) else ""
    if not text:
        raise ApiRefusal(400, message)
    return text


def request_clarification(account, request_id, data):
    """Ask the Organiser what is missing or unclear on a Submitted request (SCRUM-45 AC1, AC2, AC4, AC7, AC8).

    Only the assigned coordinator, and only while the request is Submitted; a
    request that is not theirs answers 404, like every write (permissions.md).
    One clarification is open at a time. The request stays Submitted; the
    Organiser is told, in one commit with the clarification. A refusal changes
    nothing.
    """
    event_request = db.session.get(EventRequest, request_id)
    if (
        event_request is None
        or event_request.assigned_coordinator_id != account.id
        or event_request.status == "Draft"
    ):
        raise ApiRefusal(404, "Event request not found.")
    if event_request.status != "Submitted":
        raise ApiRefusal(409, "Only a Submitted request can have clarification requested.")
    text = _clarification_text(data, "Say what is missing or unclear.")
    if event_request.open_clarification is not None:
        raise ApiRefusal(409, "A clarification is already open on this request.")

    db.session.add(
        Clarification(
            event_request=event_request,
            requested_by_id=account.id,
            message=text,
            requested_at=datetime.now(timezone.utc),
        )
    )
    create_notification(
        event_request.created_by,
        f'Clarification was requested on your request "{event_request.name}".',
        event_request,
    )
    db.session.commit()
    return event_request


def reply_to_clarification(account, request_id, data):
    """The Organiser answers the open clarification, which ends the wait (SCRUM-45 AC3, AC4, AC7, AC8).

    Only the Organiser who created the request (another's answers 404). The
    request's details are not touched; the coordinator makes any amendment. The
    assigned coordinator is told, in one commit with the reply.
    """
    event_request = _get_own_request(account, request_id)
    open_one = event_request.open_clarification
    if open_one is None:
        raise ApiRefusal(409, "No clarification is open on this request.")
    text = _clarification_text(data, "Write a reply.")

    open_one.reply = text
    open_one.replied_by_id = account.id
    open_one.replied_at = datetime.now(timezone.utc)
    if event_request.assigned_coordinator is not None:
        create_notification(
            event_request.assigned_coordinator,
            f'{account.username} replied to your clarification request on "{event_request.name}".',
            event_request,
        )
    db.session.commit()
    return event_request


def _notify_received(organiser, event_request):
    """SCRUM-62 AC1: a submission or resubmission tells its Organiser once.

    Only the creating Organiser submits or resubmits a request, so the account
    acting is the one to tell; a new request's created_by is not loaded yet.
    The notice joins the action's commit (notifications.py), so a refused
    submission, which raises before this, tells nobody (AC6).
    """
    create_notification(organiser, f'Your request "{event_request.name}" was received.', event_request)


def _notify_decision(event_request, decision, reason):
    """SCRUM-62 AC3, AC4: an approval, with its reason if given, or a rejection with its reason."""
    message = f'Your request "{event_request.name}" was {decision.lower()}.'
    if reason:
        message += f" Reason: {reason}"
    create_notification(event_request.created_by, message, event_request)


def save_new_draft(account, data):
    """Save a new Draft (state-model.md: '— -> Draft').

    AC1, AC-story: only the event name is required to save a draft; every
    other field, even an invalid one, is accepted as given and validated
    only when the request is later submitted (SCRUM-28). AC-story: an
    Organiser may have only one open Draft at a time.
    """
    _require_organiser(account)

    existing = (
        db.session.query(EventRequest)
        .filter_by(created_by_id=account.id, status="Draft")
        .first()
    )
    if existing is not None:
        raise ApiRefusal(400, "You already have an open draft. Submit or delete it before starting another.")

    choices = _resolve_choices(data)
    event_request = EventRequest(created_by_id=account.id, status="Draft")
    _apply_fields(event_request, data)
    _apply_choices(event_request, choices)
    _refuse_if_name_missing(event_request)

    db.session.add(event_request)
    db.session.commit()
    return event_request


def approve_request(account, request_id, data):
    """Submitted -> Approved (state-model.md). Reason is optional.

    SCRUM-86 AC8: approving assigns no one and does not start planning: the
    request stays Approved, with whatever coordinator it already has, until its
    first booking request or hold is raised.
    """
    event_request = _get_decidable_request(account, request_id)
    return _record_decision(event_request, account, "Approved", _optional_reason(data))


def reject_request(account, request_id, data):
    """Submitted -> Rejected (state-model.md). Reason is required."""
    event_request = _get_decidable_request(account, request_id)
    reason = _optional_reason(data)
    if not reason:
        raise ApiRefusal(400, "A reason is required to reject.")
    return _record_decision(event_request, account, "Rejected", reason)

def resubmit_request(account, request_id, data):
    """Rejected -> Submitted (state-model.md: 'Revise and resubmit').

    AC1: the creating Organiser may change any field, the SCRUM-42 choices
    included. AC2: the same rules as submitting, and a refusal leaves the
    request exactly as it was, Rejected. AC3: status Submitted and a new
    submission date and time. AC4: the earlier decision, reason, date and
    decider are left in place until the request is decided again
    (_record_decision overwrites them; D-17 keeps no history). AC5: only a
    Rejected request, and only its creator; a request that is not the
    account's own answers 404, like every other write (permissions.md).
    """
    _require_organiser(account)
    event_request = _get_own_request(account, request_id)

    if event_request.status != "Rejected":
        raise ApiRefusal(400, "Only a Rejected request can be resubmitted.")

    try:
        choices = _resolve_choices(data)
        _apply_fields(event_request, data)
        _apply_choices(event_request, choices)
        _refuse_if_incomplete(event_request)
        _refuse_if_business_rules_violated(event_request)
    except ApiRefusal:
        db.session.rollback()
        raise

    event_request.status = "Submitted"
    event_request.submitted_at = datetime.now(timezone.utc)
    _notify_received(account, event_request)
    db.session.commit()
    return event_request


def update_draft(account, request_id, data):
    """Edit any field of an own Draft, including the name (AC3)."""
    _require_organiser(account)
    event_request = _get_own_request(account, request_id)

    if event_request.status != "Draft":
        raise ApiRefusal(400, "Only a Draft request can be edited.")

    choices = _resolve_choices(data)
    _apply_fields(event_request, data)
    _apply_choices(event_request, choices)
    _refuse_if_name_missing(event_request)

    db.session.commit()
    return event_request


def delete_draft(account, request_id):
    """Permanently delete an own Draft (AC4: not once Submitted)."""
    _require_organiser(account)
    event_request = _get_own_request(account, request_id)

    if event_request.status != "Draft":
        raise ApiRefusal(400, "Only a Draft request can be deleted.")

    db.session.delete(event_request)
    db.session.commit()


def _get_event_in_safety_check(request_id):
    """The event if it is in Safety Check, else one refusal for every other case.

    AC9: an event in any other status cannot be decided. An unknown id and an
    event outside Safety Check answer alike, so the reply never says which.
    """
    event_request = db.session.get(EventRequest, request_id)
    if event_request is None or event_request.status != SAFETY_CHECK:
        raise ApiRefusal(404, NOT_IN_SAFETY_CHECK)
    return event_request


def _safety_notes(data):
    """The note per area from the request, blank notes dropped (AC4)."""
    raw = (data or {}).get("notes")
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ApiRefusal(400, "Notes must be given as one note for each area.")
    cleaned = {}
    for area, text in raw.items():
        if area not in SAFETY_NOTE_AREAS:
            raise ApiRefusal(400, f"A note cannot be recorded against '{area}'.")
        if not isinstance(text, str):
            raise ApiRefusal(400, f"The note for '{area}' must be text.")
        if text.strip():
            cleaned[area] = text.strip()
    return {area: cleaned[area] for area in SAFETY_NOTE_AREAS if area in cleaned}


def _change_areas(data):
    """The areas a request for changes names, once each in the fixed order (AC1, AC2)."""
    raw = (data or {}).get("areas")
    if not isinstance(raw, list) or not raw:
        raise ApiRefusal(400, "At least one area is required: venue arrangements or technical arrangements.")
    for area in raw:
        if area not in CHANGE_AREAS:
            raise ApiRefusal(400, f"'{area}' is not an area changes can be requested for.")
    return [area for area in CHANGE_AREAS if area in raw]


def _record_safety_decision(event_request, account, decision, reason, notes, areas=()):
    """Keep the decision, move the event on and tell its coordinator (AC5-AC8)."""
    db.session.add(
        SafetyDecision(
            event_request=event_request,
            decision=decision,
            reason=reason,
            notes=notes,
            areas=list(areas),
            decided_at=datetime.now(timezone.utc),
            decided_by_id=account.id,
        )
    )
    name = event_request.name
    if decision == "Approved":
        event_request.status = "Confirmed"
        message = f'Your event "{name}" passed its safety check and is now Confirmed.'
    elif decision == CHANGES_REQUESTED:
        event_request.status = "Planning"
        wanted = " and ".join(CHANGE_AREA_LABELS[area] for area in areas)
        message = (
            f'Your event "{name}" needs changes before its safety check: {wanted}. '
            f"Reason: {reason}"
        )
    else:
        event_request.status = "Planning"
        message = (
            f'Your event "{name}" was rejected at its safety check and is back in '
            f"Planning. Reason: {reason}"
        )
    # No assigned coordinator: the decision still goes through and nobody is
    # told (the same rule as SCRUM-63 AC5).
    if event_request.assigned_coordinator is not None:
        create_notification(event_request.assigned_coordinator, message, event_request)
    db.session.commit()
    return event_request


def approve_safety_check(account, request_id, data):
    """Safety Check -> Confirmed (state-model.md). Notes are optional."""
    event_request = _get_event_in_safety_check(request_id)
    notes = _safety_notes(data)
    return _record_safety_decision(event_request, account, "Approved", None, notes)


def reject_safety_check(account, request_id, data):
    """Safety Check -> Planning (state-model.md). A reason is required."""
    event_request = _get_event_in_safety_check(request_id)
    reason = _optional_reason(data)
    if not reason:
        raise ApiRefusal(400, "A reason is required to reject.")
    notes = _safety_notes(data)
    return _record_safety_decision(event_request, account, "Rejected", reason, notes)


def request_safety_changes(account, request_id, data):
    """Safety Check -> Planning with the areas to change (state-model.md, SCRUM-90).

    A reason and at least one area are required; notes are optional.
    """
    event_request = _get_event_in_safety_check(request_id)
    reason = (data or {}).get("reason")
    reason = reason.strip() if isinstance(reason, str) else ""
    if not reason:
        raise ApiRefusal(400, "A reason is required to request changes.")
    areas = _change_areas(data)
    notes = _safety_notes(data)
    return _record_safety_decision(
        event_request, account, CHANGES_REQUESTED, reason, notes, areas
    )


def _unapproved_equipment_requirements(event_request):
    """Readiness uses recorded review states, never stock availability."""
    return [f"{row.equipment_type.name}, {row.quantity} ({row.status})"
            for row in sorted(event_request.equipment_items, key=lambda row: row.id)
            if row.status != "Approved"]


def _outstanding_arrangements(event_request):
    """What stops the event being sent for safety check, one text each (AC2, AC3).

    Empty means ready: at least one Approved venue booking, none of them marked
    Venue unavailable, no venue booking request awaiting a decision, and every
    recorded equipment requirement Approved (an event with none is not
    blocked). Rejected, Withdrawn and Cancelled requests are not arrangements
    (SCRUM-83 curation).
    """
    bookings = sorted(event_request.booking_requests, key=lambda row: row.id)
    approved = [row for row in bookings if row.status == "Approved"]
    outstanding = []
    if not approved:
        outstanding.append("No Approved venue booking")
    for row in bookings:
        if row.status == "Requested":
            outstanding.append(f"The venue booking request for {row.venue.name} is awaiting a decision")
    for row in approved:
        if occupancy.blocks_over(row):
            outstanding.append(f"The booking at {row.venue.name} is marked Venue unavailable")
    outstanding.extend(_unapproved_equipment_requirements(event_request))
    return outstanding


def send_for_safety_check(account, request_id):
    """Planning -> Safety Check (state-model.md, SCRUM-53).

    Only the event's assigned Event Coordinator (AC7: a write answers 404 when
    the record is not the account's, permissions.md), only from Planning (AC1)
    and only when nothing is outstanding (AC2, AC3). Every check runs before
    anything is written. The time it was sent is what SCRUM-89 orders its list
    by (AC4), and a later one is what clears any changes the Safety Officer
    asked for (SCRUM-90).
    """
    event_request = db.session.get(EventRequest, request_id)
    if event_request is None or event_request.assigned_coordinator_id != account.id:
        raise ApiRefusal(404, "Event request not found.")
    if event_request.status != "Planning":
        raise ApiRefusal(
            409,
            "Only an event in Planning can be sent for safety check; "
            f"this event is {event_request.status}.",
        )
    outstanding = _outstanding_arrangements(event_request)
    if outstanding:
        raise ApiRefusal(
            400,
            "This event cannot be sent for safety check yet. Outstanding: "
            + "; ".join(outstanding)
            + ".",
        )
    event_request.status = SAFETY_CHECK
    event_request.safety_check_at = datetime.now(timezone.utc)
    db.session.commit()
    return event_request
