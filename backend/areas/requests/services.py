"""Event-request rules — SCRUM-27 (read access, object rules), SCRUM-28
(create and submit), SCRUM-29 (approve or reject) and SCRUM-30 (save, edit
and delete a Draft).
SCRUM-42: the optional required layout, facilities and accessibility features,
which replace the free-text venue requirements and accessibility needs.
SCRUM-43: approving a request assigns the Event Coordinator with the fewest open events.
SCRUM-72: revise and resubmit a Rejected request.
SCRUM-89: the Safety Officer lists, opens, approves and rejects events in Safety Check.
SCRUM-53: the assigned Event Coordinator sends a Planning event for safety check.
SCRUM-84: an Approved event moves to Planning when its first hold is placed.
SCRUM-82: a booking marked Venue unavailable stops the event being sent.

Object rules from permissions.md / ADR-002 live here next to the query.
"""

from datetime import date, datetime, timezone

from sqlalchemy import or_

import occupancy
from db import db
from errors import ApiRefusal
from models import (
    AccessibilityFeature,
    Account,
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

SAFETY_CHECK = "Safety Check"

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

    Event Coordinator (including multi-role coordinators): all except Draft.
    Event Organiser only: own requests, any status.
    Safety Officer: events in Safety Check, the one that has been there
    longest first (SCRUM-89 AC2); one with no recorded time sorts last.
    """
    query = db.session.query(EventRequest)
    if account.has_role(COORDINATOR_ROLE):
        return query.filter(EventRequest.status != "Draft").order_by(EventRequest.id).all()
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

    if account.has_role(COORDINATOR_ROLE) and event_request.status != "Draft":
        return event_request
    if account.has_role(ORGANISER_ROLE) and event_request.created_by_id == account.id:
        return event_request
    if account.has_role(SAFETY_OFFICER_ROLE) and event_request.status == SAFETY_CHECK:
        return event_request
    raise ApiRefusal(403, "You do not have permission to perform this action.")


def request_to_dict(event_request):
    """Public JSON for a list row or a create/submit response — never internal notes."""
    return event_request.to_dict()


def request_detail_dict(event_request, account):
    """Detail JSON; coordinator_notes only when the account may see them."""
    payload = request_to_dict(event_request)
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
    return payload


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


def _refuse_if_invalid_date(event_request):
    try:
        entered = datetime.strptime(event_request.date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise ApiRefusal(400, "Date must be a valid date.")
    if entered < date.today():
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
    already refused anyone who is not an Event Coordinator.
    """
    event_request = get_visible_request(account, request_id)
    if event_request.status != "Submitted":
        if event_request.decision:
            raise ApiRefusal(409, _already_decided_message(event_request))
        raise ApiRefusal(409, "Only a Submitted request can be decided.")
    return event_request


# An open event is one in Planning or Confirmed status assigned to a
# Coordinator (SCRUM-43, PO working rule 28-09-2026).
OPEN_EVENT_STATUSES = ("Planning", "Confirmed")


def _event_coordinators():
    """Every account holding the Event Coordinator role, including one that
    also holds another role (Q-06, D-09) and the one approving."""
    return (
        db.session.query(Account)
        .join(Account.roles)
        .filter(Role.name == COORDINATOR_ROLE)
        .all()
    )


def _open_event_count(coordinator):
    return (
        db.session.query(EventRequest)
        .filter(
            EventRequest.assigned_coordinator_id == coordinator.id,
            EventRequest.status.in_(OPEN_EVENT_STATUSES),
        )
        .count()
    )


def _next_coordinator():
    """The Event Coordinator with the fewest open events (SCRUM-43 AC1); a
    tie goes to the username that comes first alphabetically (AC2), so the
    same situation always gives the same result. None when no Event
    Coordinator exists (AC7)."""
    coordinators = _event_coordinators()
    if not coordinators:
        return None
    return min(
        coordinators,
        key=lambda coordinator: (_open_event_count(coordinator), coordinator.username.casefold()),
    )


def _assign_coordinator(event_request):
    """Approved -> Planning with the chosen Coordinator and the date (AC3).

    A Coordinator cannot decline (AC5): nothing here, or in the routes, can
    undo an assignment. With no Event Coordinator the request stays Approved,
    and no error is raised (AC7).
    """
    coordinator = _next_coordinator()
    if coordinator is None:
        return
    event_request.status = "Planning"
    event_request.assigned_coordinator_id = coordinator.id
    event_request.assigned_at = datetime.now(timezone.utc)


def start_planning_if_approved(event_request):
    """Approved -> Planning when the first hold or booking request is raised
    for the event (state-model.md); any other status is left as it is.

    Nothing is committed: the caller commits it with the hold (SCRUM-84 AC8)
    or, from SCRUM-86, with the booking request that started planning.
    """
    if event_request.status == "Approved":
        event_request.status = "Planning"


def _record_decision(event_request, account, decision, reason):
    event_request.status = decision
    event_request.decision = decision
    event_request.decision_reason = reason
    event_request.decided_at = datetime.now(timezone.utc)
    event_request.decided_by_id = account.id
    if decision == "Approved":
        # The decision stays recorded as Approved; the status moves on.
        _assign_coordinator(event_request)

    db.session.commit()
    return event_request


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

    SCRUM-43: approving also assigns an Event Coordinator, which moves the
    request on to Planning in the same commit.
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
