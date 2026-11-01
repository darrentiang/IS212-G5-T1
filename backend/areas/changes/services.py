"""Change-request rules — SCRUM-59 (Request a Change or Withdrawal After Submission).

Every rule the acceptance criteria state lives here, next to the query, and refuses by
raising ApiRefusal; the route never decides (ADR-002). Deciding a request is SCRUM-60.
The parts that happen inside other areas' actions (an event ending closes the request, an
assignment tells the coordinator one is waiting) are in change_requests.py.
"""

from datetime import datetime, timezone

from change_requests import open_change_request
from db import db
from errors import ApiRefusal
from models import CHANGE_AFFECTS, ChangeRequest, EventRequest
from notifications import create_notification

# AC1: the statuses an Organiser may still ask for a change or a withdrawal in.
RAISABLE_STATUSES = ("Submitted", "Approved", "Planning", "Safety Check", "Confirmed")


def _text(data, key):
    raw = (data or {}).get(key)
    return raw.strip() if isinstance(raw, str) else ""


def _chosen_affects(data):
    """What a change affects, in the fixed order, else refuse 400 (AC2: one or more)."""
    raw = (data or {}).get("affects")
    if not isinstance(raw, list) or not raw or any(item not in CHANGE_AFFECTS for item in raw):
        raise ApiRefusal(400, "Choose what the change affects.")
    return [key for key in CHANGE_AFFECTS if key in raw]


def raise_change_request(account, request_id, data):
    """The Organiser asks for a change to their event, or for it to be withdrawn (SCRUM-59 AC1-AC6, AC8).

    Only the Organiser who created the event (another's answers 404, like every write), and
    only while it is Submitted, Approved, Planning, Safety Check or Confirmed. A change needs a
    description and one or more things it affects; a withdrawal takes optional text and nothing
    else. One request is open at a time. The event itself is not touched. The assigned
    coordinator, if there is one, is told in one commit with the request; with none the
    request waits and the coordinator is told when assigned (change_requests.py). A refusal
    changes nothing.
    """
    event_request = db.session.get(EventRequest, request_id)
    if event_request is None or event_request.created_by_id != account.id:
        raise ApiRefusal(404, "Event request not found.")
    if event_request.status not in RAISABLE_STATUSES:
        raise ApiRefusal(
            409,
            "A change can be requested only on a Submitted, Approved, Planning, Safety Check "
            "or Confirmed event.",
        )

    kind = (data or {}).get("kind")
    if kind == ChangeRequest.CHANGE:
        description = _text(data, "description")
        if not description:
            raise ApiRefusal(400, "Describe the change.")
        affects = _chosen_affects(data)
    elif kind == ChangeRequest.WITHDRAWAL:
        description = _text(data, "description") or None
        affects = []
    else:
        raise ApiRefusal(400, "Choose a change or a withdrawal.")

    if open_change_request(event_request) is not None:
        raise ApiRefusal(409, "A request is already open on this event.")

    db.session.add(
        ChangeRequest(
            event_request=event_request,
            raised_by=account,
            kind=kind,
            description=description,
            affects=affects,
            raised_at=datetime.now(timezone.utc),
        )
    )
    if event_request.assigned_coordinator is not None:
        wording = (
            f'{account.username} has asked for a change to "{event_request.name}".'
            if kind == ChangeRequest.CHANGE
            else f'{account.username} has asked for "{event_request.name}" to be withdrawn.'
        )
        create_notification(event_request.assigned_coordinator, wording, event_request)
    db.session.commit()
    return event_request
