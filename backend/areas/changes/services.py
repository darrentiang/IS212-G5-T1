"""Change-request rules — SCRUM-59 (Request a Change or Withdrawal After Submission).

Every rule the acceptance criteria state lives here, next to the query, and refuses by
raising ApiRefusal; the route never decides (ADR-002). Deciding a request is SCRUM-60.
The parts that happen inside other areas' actions (an event ending closes the request, an
assignment tells the coordinator one is waiting) are in change_requests.py.
"""

from datetime import datetime, timezone

import clock
from areas.requests.cancellation import cancel_event
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


# SCRUM-60 AC1: the decision words, as the API takes them.
ACCEPT = "Accept"
DECLINE = "Decline"
# AC5: the statuses an accepted change that needs reviewing sends back to Planning.
RETURNED_TO_PLANNING = ("Safety Check", "Confirmed")


def _reviewed(data):
    """The coordinator's correction of what needs reviewing, or None when they left it (AC2)."""
    raw = (data or {}).get("needs_review")
    if raw is None:
        return None
    keys = ("venue_bookings", "equipment_reservations")
    if not isinstance(raw, dict) or any(not isinstance(raw.get(key), bool) for key in keys):
        raise ApiRefusal(400, "Say whether venue bookings and equipment reservations need reviewing.")
    return {key: raw[key] for key in keys}


def _withdrawal_reason(change_request):
    """AC4: the cancellation reason: the Organiser asked, when, and their text if any."""
    asked = change_request.raised_at.replace(tzinfo=timezone.utc).astimezone(clock.SINGAPORE)
    reason = f"Withdrawn at the Event Organiser's request on {asked.strftime('%d %b %Y, %H:%M')}."
    return f"{reason} {change_request.description}" if change_request.description else reason


def decide_change_request(account, request_id, change_request_id, data):
    """The assigned Event Coordinator accepts or declines an open request (SCRUM-60 AC1-AC7).

    Anyone but the assigned coordinator, and an event nobody could see, answers 404 (a write);
    a request that is not on this event answers 404; one that is not Open (decided, or closed
    when the event ended) answers 409 and changes nothing, so an Open request is on an event
    in one of the AC1 statuses. A decline needs a reason. An accept of a change may carry
    `needs_review` to correct what it says needs reviewing; what it says then is what counts
    and the Organiser's choice of what it affects is kept. Accepting a withdrawal cancels the
    event as SCRUM-65 does, in the same commit. Accepting a change that needs venue bookings or
    equipment reservations reviewed returns a Safety Check or Confirmed event to Planning, and
    otherwise nothing on the event changes; the event is never edited (AC6, SCRUM-47). Who and
    when are the server's. A refusal changes nothing.
    """
    event_request = db.session.get(EventRequest, request_id)
    if (
        event_request is None
        or event_request.status == "Draft"
        or event_request.assigned_coordinator_id != account.id
    ):
        raise ApiRefusal(404, "Event request not found.")
    change_request = db.session.get(ChangeRequest, change_request_id)
    if change_request is None or change_request.event_request_id != event_request.id:
        raise ApiRefusal(404, "Change request not found.")
    if change_request.status != ChangeRequest.OPEN:
        raise ApiRefusal(409, "Only an open request can be decided.")

    decision = (data or {}).get("decision")
    if decision not in (ACCEPT, DECLINE):
        raise ApiRefusal(400, "Choose accept or decline.")
    reason = _text(data, "reason")
    if decision == DECLINE and not reason:
        raise ApiRefusal(400, "Give a reason for declining.")
    reviewed = _reviewed(data) if decision == ACCEPT and change_request.kind == ChangeRequest.CHANGE else None

    change_request.decided_by = account
    change_request.decided_at = datetime.now(timezone.utc)
    if decision == DECLINE:
        change_request.status = ChangeRequest.DECLINED
        change_request.decision_reason = reason
    else:
        change_request.status = ChangeRequest.ACCEPTED
        if reviewed is not None:
            change_request.reviewed = reviewed
        if change_request.kind == ChangeRequest.WITHDRAWAL:
            db.session.flush()
            cancel_event(account, request_id, {"reason": _withdrawal_reason(change_request)}, commit=False)
        elif event_request.status in RETURNED_TO_PLANNING and any(change_request.needs_review().values()):
            event_request.status = "Planning"
    db.session.commit()
    return event_request
