"""Event-request access rules — SCRUM-27.

Object rules from permissions.md / ADR-002 live here next to the query.
"""

from db import db
from errors import ApiRefusal
from models import EventRequest
from permissions import INTERNAL_NOTES_VIEW, can


def visible_requests(account):
    """Event requests this account may see in a list.

    Event Coordinator (including multi-role coordinators): all except Draft.
    Event Organiser only: own requests, any status.
    """
    query = db.session.query(EventRequest)
    if account.has_role("Event Coordinator"):
        return query.filter(EventRequest.status != "Draft").all()
    return query.filter(EventRequest.created_by_id == account.id).all()


def get_visible_request(account, request_id):
    """One request if the account may see it, else refuse 403 / 404."""
    event_request = db.session.get(EventRequest, request_id)
    if event_request is None:
        raise ApiRefusal(404, "Event request not found.")

    if account.has_role("Event Coordinator") and event_request.status != "Draft":
        return event_request
    if account.has_role("Event Organiser") and event_request.created_by_id == account.id:
        return event_request
    raise ApiRefusal(403, "You do not have permission to perform this action.")


def request_to_dict(event_request):
    """Public JSON for a list row — never internal notes."""
    return {
        "id": event_request.id,
        "name": event_request.name,
        "purpose": event_request.purpose,
        "status": event_request.status,
        "created_by": event_request.created_by.username if event_request.created_by else None,
        "registration_enabled": bool(event_request.registration_enabled),
    }


def request_detail_dict(event_request, account):
    """Detail JSON; coordinator_notes only when the account may see them."""
    payload = request_to_dict(event_request)
    if can(account, INTERNAL_NOTES_VIEW):
        payload["coordinator_notes"] = event_request.coordinator_notes
    return payload
