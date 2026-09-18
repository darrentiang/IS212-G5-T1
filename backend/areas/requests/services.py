"""Event-request rules — SCRUM-27 (read access, object rules) and SCRUM-28
(create and submit).

Object rules from permissions.md / ADR-002 live here next to the query.
"""

from datetime import datetime, timezone

from db import db
from errors import ApiRefusal
from models import EventRequest
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
    """One request if the account may see it, else refuse 403 / 404."""
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


def _refuse_if_incomplete(event_request):
    missing = event_request.missing_fields()
    if missing:
        raise ApiRefusal(400, "Missing required fields: " + ", ".join(missing))


def submit_new_request(account, data):
    """Create and submit a request directly (state-model.md: '— -> Submitted').

    AC1, AC3, AC4: every required field must be present or the submission is
    refused, listing what is missing, and nothing is recorded as submitted.
    """
    _require_organiser(account)

    event_request = EventRequest(created_by_id=account.id, status="Draft")
    _apply_fields(event_request, data)
    _refuse_if_incomplete(event_request)

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

    event_request = db.session.get(EventRequest, request_id)
    if event_request is None or event_request.created_by_id != account.id:
        raise ApiRefusal(404, "Event request not found.")

    if event_request.status != "Draft":
        raise ApiRefusal(400, "Only a Draft request can be submitted.")

    _refuse_if_incomplete(event_request)

    event_request.status = "Submitted"
    event_request.submitted_at = datetime.now(timezone.utc)
    db.session.commit()
    return event_request
