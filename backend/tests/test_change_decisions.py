"""SCRUM-60: the assigned Event Coordinator accepts or declines a change request.

The acceptance criteria as rules at the API: the assigned coordinator decides an open
request while the event is Submitted, Approved, Planning, Safety Check or Confirmed, and a
decline needs a reason; before accepting a change the coordinator may correct what needs
reviewing, and that is what counts; the decision, who and when are recorded and shown to the
Organiser; accepting a withdrawal cancels the event as SCRUM-65 does with a reason that says
the Organiser asked, when, and their text; accepting a change that needs reviewing returns a
Safety Check or Confirmed event to Planning and otherwise changes no status; accepting never
edits the event; a request already decided or closed cannot be decided again, only the
assigned coordinator can decide, and a refusal changes nothing. The browser journeys are
functional/tests/SCRUM-60.spec.js.
"""

from datetime import datetime, timezone

import pytest

import clock
from db import db
from models import Account, ChangeRequest, EventRequest, Reservation
from tests.factories import make_equipment_type, make_reservation
from tests.test_change_requests import change, event, login, rows, stored, withdraw

NOT_OPEN = "Only an open request can be decided."


def decide(client, made, decision="Accept", reason=None, needs_review=None, row=None):
    body = {"decision": decision}
    if reason is not None:
        body["reason"] = reason
    if needs_review is not None:
        body["needs_review"] = needs_review
    row = row or rows(made.id)[-1]
    return client.post(f"/api/requests/{made.id}/change-requests/{row.id}/decision", json=body)


def asked(client, made, affects=("date_time",), withdrawal=None):
    """The Organiser raises a request on the event; the coordinator is left logged in."""
    login(client, "org2")
    resp = change(client, made.id, affects=affects) if withdrawal is None else withdraw(client, made.id, withdrawal or None)
    assert resp.status_code == 201
    login(client, "coord1")


def unchanged(made, status):
    after = stored(made.id)
    assert (after.status, after.date, after.start_time, after.end_time, after.attendance) == (
        status,
        made.date,
        made.start_time,
        made.end_time,
        made.attendance,
    )


# --- AC1, AC3, AC6: accept ---


# @story: SCRUM-60
# @ac: 1, 3, 6
def test_the_assigned_coordinator_accepts_and_the_decision_is_recorded_and_seen(client):
    made = event("Accept Change", "Approved")
    asked(client, made, affects=("attendance",))

    resp = decide(client, made, "Accept")

    assert resp.status_code == 200
    body = resp.get_json()["change_requests"][0]
    assert (body["status"], body["decided_by"], body["decision_reason"]) == ("Accepted", "coord1", None)
    assert body["decided_at"]
    assert body["affects"] == ["attendance"]
    unchanged(made, "Approved")
    login(client, "org2")
    seen = client.get(f"/api/requests/{made.id}").get_json()["change_requests"][0]
    assert (seen["status"], seen["decided_by"], seen["decided_at"]) == ("Accepted", "coord1", body["decided_at"])


# @story: SCRUM-60
# @ac: 1, 3
def test_declining_records_the_reason_and_leaves_the_event(client):
    made = event("Decline Change", "Confirmed")
    asked(client, made, affects=("equipment",))

    resp = decide(client, made, "Decline", reason="  The kit is already booked.  ")

    assert resp.status_code == 200
    body = resp.get_json()["change_requests"][0]
    assert (body["status"], body["decided_by"], body["decision_reason"]) == (
        "Declined",
        "coord1",
        "The kit is already booked.",
    )
    unchanged(made, "Confirmed")
    login(client, "org2")
    assert client.get(f"/api/requests/{made.id}").get_json()["change_requests"][0]["decision_reason"] == (
        "The kit is already booked."
    )


# @story: SCRUM-60
# @ac: 1
@pytest.mark.parametrize("reason", [None, "", "   ", 5])
def test_a_decline_without_a_reason_is_refused_and_changes_nothing(client, reason):
    made = event("Decline Blank", "Approved")
    asked(client, made)

    resp = client.post(
        f"/api/requests/{made.id}/change-requests/{rows(made.id)[0].id}/decision",
        json={"decision": "Decline", "reason": reason},
    )

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Give a reason for declining."
    row = rows(made.id)[0]
    assert (row.status, row.decided_by, row.decided_at, row.decision_reason) == ("Open", None, None, None)


# @story: SCRUM-60
# @ac: 7
@pytest.mark.parametrize("decision", [None, "Approve", "accept", ["Accept"]])
def test_an_unknown_decision_is_refused(client, decision):
    made = event("Decision Word", "Approved")
    asked(client, made)

    resp = client.post(
        f"/api/requests/{made.id}/change-requests/{rows(made.id)[0].id}/decision", json={"decision": decision}
    )

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose accept or decline."
    assert rows(made.id)[0].status == "Open"


# --- AC5: the event's status ---


# @story: SCRUM-60
# @ac: 1, 5
@pytest.mark.parametrize(
    "status, expected",
    [
        ("Submitted", "Submitted"),
        ("Approved", "Approved"),
        ("Planning", "Planning"),
        ("Safety Check", "Planning"),
        ("Confirmed", "Planning"),
    ],
)
def test_accepting_a_change_that_needs_reviewing_returns_only_safety_check_and_confirmed(client, status, expected):
    made = event(f"Status {status}", status)
    asked(client, made, affects=("date_time",))

    assert decide(client, made).status_code == 200

    unchanged(made, expected)
    assert rows(made.id)[0].status == "Accepted"


# @story: SCRUM-60
# @ac: 5
@pytest.mark.parametrize("status", ["Safety Check", "Confirmed"])
def test_accepting_a_change_that_needs_nothing_reviewed_keeps_the_status(client, status):
    made = event(f"Other {status}", status)
    asked(client, made, affects=("other",))

    assert decide(client, made).status_code == 200

    unchanged(made, status)


# @story: SCRUM-60
# @ac: 5
@pytest.mark.parametrize("affects, status", [("attendance", "Confirmed"), ("equipment", "Safety Check")])
def test_either_kind_of_review_returns_the_event(client, affects, status):
    made = event(f"Either {affects}", status)
    asked(client, made, affects=(affects,))

    decide(client, made)

    assert stored(made.id).status == "Planning"


# @story: SCRUM-60
# @ac: 5
def test_declining_never_changes_the_status(client):
    made = event("Decline Keeps", "Safety Check")
    asked(client, made, affects=("date_time",))

    decide(client, made, "Decline", reason="No.")

    assert stored(made.id).status == "Safety Check"


# @story: SCRUM-60
# @ac: 5, 6
def test_returning_to_planning_releases_nothing(client):
    made = event("Return Keeps", "Confirmed")
    kit = make_equipment_type(name="Return Kit", total_units=5)
    make_reservation(event=made, equipment=kit, quantity=2)
    asked(client, made, affects=("equipment",))

    decide(client, made)

    assert stored(made.id).status == "Planning"
    assert [row.status for row in db.session.query(Reservation).filter_by(event_request_id=made.id)] == ["Reserved"]


# --- AC2: correcting what needs reviewing ---


# @story: SCRUM-60
# @ac: 2, 5
def test_adding_what_needs_reviewing_before_accepting_counts(client):
    made = event("Correct Up", "Confirmed")
    asked(client, made, affects=("other",))

    resp = decide(client, made, needs_review={"venue_bookings": True, "equipment_reservations": False})

    body = resp.get_json()["change_requests"][0]
    assert body["needs_review"] == {"venue_bookings": True, "equipment_reservations": False}
    assert body["affects"] == ["other"]
    assert stored(made.id).status == "Planning"


# @story: SCRUM-60
# @ac: 2, 5
def test_removing_what_needs_reviewing_before_accepting_counts(client):
    made = event("Correct Down", "Safety Check")
    asked(client, made, affects=("date_time",))

    resp = decide(client, made, needs_review={"venue_bookings": False, "equipment_reservations": False})

    body = resp.get_json()["change_requests"][0]
    assert body["needs_review"] == {"venue_bookings": False, "equipment_reservations": False}
    assert body["affects"] == ["date_time"]
    assert stored(made.id).status == "Safety Check"


# @story: SCRUM-60
# @ac: 2
def test_without_a_correction_what_the_request_affects_counts(client):
    made = event("Correct None", "Approved")
    asked(client, made, affects=("equipment",))

    resp = decide(client, made)

    assert resp.get_json()["change_requests"][0]["needs_review"] == {
        "venue_bookings": False,
        "equipment_reservations": True,
    }


# @story: SCRUM-60
# @ac: 2, 7
@pytest.mark.parametrize(
    "needs_review",
    ["yes", {"venue_bookings": True}, {"venue_bookings": True, "equipment_reservations": "no"}],
)
def test_a_malformed_correction_is_refused_and_changes_nothing(client, needs_review):
    made = event("Correct Bad", "Confirmed")
    asked(client, made, affects=("date_time",))

    resp = decide(client, made, needs_review=needs_review)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Say whether venue bookings and equipment reservations need reviewing."
    assert rows(made.id)[0].status == "Open"
    assert stored(made.id).status == "Confirmed"


# @story: SCRUM-60
# @ac: 2
def test_a_correction_on_a_decline_or_a_withdrawal_is_ignored(client):
    made = event("Correct Ignored", "Approved")
    asked(client, made, withdrawal="")

    decide(client, made, needs_review={"venue_bookings": True, "equipment_reservations": True})

    row = rows(made.id)[0]
    assert (row.reviewed, row.status) == (None, "Accepted")


# --- AC4: accepting a withdrawal ---


# @story: SCRUM-60
# @ac: 4
def test_accepting_a_withdrawal_cancels_the_event_and_records_who_asked_and_when(client):
    made = event("Withdraw With Text", "Approved")
    asked(client, made, withdrawal="Client cancelled the plan.")
    when = rows(made.id)[0].raised_at

    resp = decide(client, made)

    assert resp.status_code == 200
    after = stored(made.id)
    assert after.status == "Cancelled"
    assert after.cancelled_by.username == "coord1"
    stamp = when.replace(tzinfo=timezone.utc).astimezone(clock.SINGAPORE)
    assert after.cancel_reason == (
        f"Withdrawn at the Event Organiser's request on {stamp.strftime('%d %b %Y, %H:%M')}. "
        "Client cancelled the plan."
    )
    body = resp.get_json()
    assert (body["status"], body["change_requests"][0]["status"]) == ("Cancelled", "Accepted")
    assert body["change_requests"][0]["closed_at"] is None


# @story: SCRUM-60
# @ac: 4
def test_a_withdrawal_without_text_gives_only_who_asked_and_when(client):
    made = event("Withdraw No Text", "Planning")
    asked(client, made, withdrawal="")

    decide(client, made)

    reason = stored(made.id).cancel_reason
    assert reason.startswith("Withdrawn at the Event Organiser's request on ")
    assert reason.endswith(".")
    assert len(reason.splitlines()) == 1 and "  " not in reason


# @story: SCRUM-60
# @ac: 4
def test_accepting_a_withdrawal_releases_the_events_commitments(client):
    made = event("Withdraw Releases", "Confirmed")
    kit = make_equipment_type(name="Withdraw Kit", total_units=5)
    make_reservation(event=made, equipment=kit, quantity=2)
    asked(client, made, withdrawal="")

    decide(client, made)

    assert [row.status for row in db.session.query(Reservation).filter_by(event_request_id=made.id)] == ["Released"]


# @story: SCRUM-60
# @ac: 4
def test_declining_a_withdrawal_keeps_the_event(client):
    made = event("Withdraw Declined", "Approved")
    asked(client, made, withdrawal="")

    decide(client, made, "Decline", reason="We need you.")

    unchanged(made, "Approved")
    assert stored(made.id).cancelled_by is None


# --- AC7: decided or closed, and who ---


# @story: SCRUM-60
# @ac: 7
@pytest.mark.parametrize("first", [("Accept", None), ("Decline", "No.")])
def test_a_decided_request_cannot_be_decided_again(client, first):
    made = event("Decide Twice", "Approved")
    asked(client, made)
    decide(client, made, first[0], reason=first[1])
    before = rows(made.id)[0]
    snapshot = (before.status, before.decided_at, before.decision_reason)

    resp = decide(client, made, "Decline", reason="Changed my mind.")

    assert resp.status_code == 409
    assert resp.get_json()["message"] == NOT_OPEN
    after = rows(made.id)[0]
    assert (after.status, after.decided_at, after.decision_reason) == snapshot


# @story: SCRUM-60
# @ac: 7
def test_a_closed_request_cannot_be_decided(client):
    made = event("Decide Closed", "Approved")
    asked(client, made)
    row = rows(made.id)[0]
    row.status = ChangeRequest.CLOSED
    made.status = "Cancelled"
    db.session.commit()

    resp = decide(client, made, row=row)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == NOT_OPEN
    assert (rows(made.id)[0].status, stored(made.id).status) == ("Closed", "Cancelled")


# @story: SCRUM-60
# @ac: 7
def test_only_the_assigned_coordinator_can_decide(client):
    made = event("Decide Wrong Account", "Approved")
    asked(client, made)
    row = rows(made.id)[0]

    login(client, "coord2")
    resp = decide(client, made, row=row)
    assert (resp.status_code, resp.get_json()["message"]) == (404, "Event request not found.")
    for username in ("org2", "lead1"):
        login(client, username)
        assert decide(client, made, row=row).status_code == 403

    assert (rows(made.id)[0].status, rows(made.id)[0].decided_by) == ("Open", None)
    assert stored(made.id).status == "Approved"


# @story: SCRUM-60
# @ac: 7
def test_a_request_on_another_event_or_none_is_not_found(client):
    made = event("Decide Here", "Approved")
    other = event("Decide There", "Approved")
    asked(client, other)
    asked(client, made)
    elsewhere = rows(other.id)[0]

    wrong = decide(client, made, row=elsewhere)
    missing = client.post(f"/api/requests/{made.id}/change-requests/999999/decision", json={"decision": "Accept"})
    no_event = client.post("/api/requests/999999/change-requests/1/decision", json={"decision": "Accept"})

    assert [(r.status_code, r.get_json()["message"]) for r in (wrong, missing)] == [
        (404, "Change request not found.")
    ] * 2
    assert (no_event.status_code, no_event.get_json()["message"]) == (404, "Event request not found.")
    assert [rows(made.id)[0].status, rows(other.id)[0].status] == ["Open", "Open"]


# @story: SCRUM-60
# @ac: 7
def test_an_unassigned_event_is_not_found(client):
    made = event("Decide Unassigned", "Submitted", coordinator=None)
    login(client, "org2")
    assert change(client, made.id).status_code == 201

    login(client, "coord1")
    resp = decide(client, made)

    assert (resp.status_code, resp.get_json()["message"]) == (404, "Event request not found.")
    assert rows(made.id)[0].status == "Open"


# @story: SCRUM-60
# @ac: 7
def test_a_draft_is_not_found_and_a_missing_body_is_refused(client):
    draft = event("Decide Draft", "Draft")
    row = ChangeRequest(
        event_request=draft,
        raised_by=db.session.query(Account).filter_by(username="org2").one(),
        kind="Change",
        description="x",
        affects=["other"],
        raised_at=datetime(2036, 1, 1),
    )
    db.session.add(row)
    db.session.commit()
    login(client, "coord1")
    assert decide(client, draft, row=row).status_code == 404

    made = event("Decide No Body", "Approved")
    asked(client, made)
    resp = client.post(f"/api/requests/{made.id}/change-requests/{rows(made.id)[0].id}/decision")
    assert (resp.status_code, resp.get_json()["message"]) == (400, "Choose accept or decline.")
