"""Event-request rules — SCRUM-27 (read access, object rules), SCRUM-28
(create and submit), SCRUM-29 (approve or reject) and SCRUM-30 (save, edit
and delete a Draft).
SCRUM-42: the optional required layout, facilities and accessibility features,
which replace the free-text venue requirements and accessibility needs.
SCRUM-43: approving a request assigns the Event Coordinator with the fewest open events.
SCRUM-72: revise and resubmit a Rejected request.

Object rules from permissions.md / ADR-002 live here next to the query.
"""

from datetime import date, datetime, timezone

from db import db
from errors import ApiRefusal
from models import AccessibilityFeature, Account, EventRequest, Facility, Role, RoomLayout
from permissions import INTERNAL_NOTES_VIEW, can

ORGANISER_ROLE = "Event Organiser"
COORDINATOR_ROLE = "Event Coordinator"


def visible_requests(account):
    """Event requests this account may see in a list.

    Event Coordinator (including multi-role coordinators): all except Draft.
    Event Organiser only: own requests, any status.
    """
    query = db.session.query(EventRequest)
    if account.has_role(COORDINATOR_ROLE):
        return query.filter(EventRequest.status != "Draft").order_by(EventRequest.id).all()
    return query.filter(EventRequest.created_by_id == account.id).order_by(EventRequest.id).all()


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
    raise ApiRefusal(403, "You do not have permission to perform this action.")


def request_to_dict(event_request):
    """Public JSON for a list row or a create/submit response — never internal notes."""
    return event_request.to_dict()


def request_detail_dict(event_request, account):
    """Detail JSON; coordinator_notes only when the account may see them."""
    payload = request_to_dict(event_request)
    if can(account, INTERNAL_NOTES_VIEW):
        payload["coordinator_notes"] = event_request.coordinator_notes
    return payload


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
