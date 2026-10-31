"""SCRUM-59: the Event Organiser asks for a change to their event, or for its withdrawal.

The acceptance criteria as rules at the API: an Organiser raises a change (a description and
what it affects) or a withdrawal (optional text) on their own event while it is Submitted,
Approved, Planning, Safety Check or Confirmed; what needs reviewing follows what a change
affects; the request is recorded and Open, and the event is untouched; one is open at a
time; the assigned coordinator sees it and is told, or is told when assigned; an event
that is Rejected, Cancelled or Completed closes it without a decision; and nothing else is
accepted. The browser journeys are functional/tests/SCRUM-59.spec.js.
"""

from datetime import datetime

import pytest

import clock
from db import db
from models import Account, ChangeRequest, EventRequest, Notification
from tests.factories import make_event

DAY = {"date": "2036-06-10", "start_time": "10:00", "end_time": "12:00"}
ALLOWED = ["Submitted", "Approved", "Planning", "Safety Check", "Confirmed"]
REFUSED = (
    "A change can be requested only on a Submitted, Approved, Planning, Safety Check or "
    "Confirmed event."
)


def account(username):
    return db.session.query(Account).filter_by(username=username).one()


def login(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def event(name, status="Approved", coordinator="coord1", owner="org2", **fields):
    return make_event(
        name=name,
        status=status,
        owner=owner,
        assigned_coordinator=account(coordinator) if coordinator else None,
        **DAY,
        **fields,
    )


def change(client, event_id, description="Move the event a week later.", affects=("date_time",)):
    return client.post(
        f"/api/requests/{event_id}/change-requests",
        json={"kind": "Change", "description": description, "affects": list(affects)},
    )


def withdraw(client, event_id, description=None):
    body = {"kind": "Withdrawal"}
    if description is not None:
        body["description"] = description
    return client.post(f"/api/requests/{event_id}/change-requests", json=body)


def rows(event_id):
    db.session.expire_all()
    return db.session.query(ChangeRequest).filter_by(event_request_id=event_id).order_by(ChangeRequest.id).all()


def stored(event_id):
    db.session.expire_all()
    return db.session.get(EventRequest, event_id)


def notices(username, about):
    db.session.expire_all()
    found = db.session.query(Notification).filter_by(recipient_id=account(username).id)
    return [row.message for row in found if f'"{about}"' in row.message]


def detail(client, event_id):
    return client.get(f"/api/requests/{event_id}").get_json()


# --- AC1: who may raise what, and when ---


# @story: SCRUM-59
# @ac: 1, 3
def test_the_organiser_raises_a_change_request_and_it_is_recorded_open(client):
    made = event("Change Gala")
    login(client, "org2")

    resp = change(client, made.id, "  Move the event a week later.  ", ["date_time"])

    assert resp.status_code == 201
    body = resp.get_json()
    assert [(row["kind"], row["description"], row["status"], row["raised_by"]) for row in body["change_requests"]] == [
        ("Change", "Move the event a week later.", "Open", "org2")
    ]
    assert body["change_requests"][0]["raised_at"]
    assert body["change_requests"][0]["closed_at"] is None


# @story: SCRUM-59
# @ac: 1
@pytest.mark.parametrize("status", ALLOWED)
def test_a_request_can_be_raised_in_each_allowed_status(client, status):
    made = event(f"Allowed {status}", status=status)
    login(client, "org2")

    resp = change(client, made.id)

    assert resp.status_code == 201
    assert resp.get_json()["status"] == status
    assert stored(made.id).status == status


# @story: SCRUM-59
# @ac: 1
@pytest.mark.parametrize("text", [None, "", "   ", "Client cancelled the plan."])
def test_a_withdrawal_takes_optional_text_and_affects_nothing(client, text):
    made = event("Withdraw Gala")
    login(client, "org2")

    resp = withdraw(client, made.id, text)

    assert resp.status_code == 201
    row = rows(made.id)[0]
    assert (row.kind, row.status, row.affects) == ("Withdrawal", "Open", [])
    assert row.description == ((text or "").strip() or None)
    assert row.needs_review() == {"venue_bookings": False, "equipment_reservations": False}


# @story: SCRUM-59
# @ac: 1
@pytest.mark.parametrize("description", [None, "", "   ", 7])
def test_a_change_request_with_no_description_is_refused_and_nothing_changes(client, description):
    made = event("Change Blank")
    login(client, "org2")

    resp = client.post(
        f"/api/requests/{made.id}/change-requests",
        json={"kind": "Change", "description": description, "affects": ["other"]},
    )

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Describe the change."
    assert rows(made.id) == []
    assert notices("coord1", "Change Blank") == []


# @story: SCRUM-59
# @ac: 1
@pytest.mark.parametrize("kind", [None, "", "Cancel", 7])
def test_a_request_must_be_a_change_or_a_withdrawal(client, kind):
    made = event("Kind Gala")
    login(client, "org2")

    resp = client.post(f"/api/requests/{made.id}/change-requests", json={"kind": kind, "description": "x", "affects": ["other"]})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose a change or a withdrawal."
    assert rows(made.id) == []


# @story: SCRUM-59
# @ac: 1
def test_a_missing_body_is_refused_like_a_missing_kind(client):
    made = event("No Body Gala")
    login(client, "org2")

    resp = client.post(f"/api/requests/{made.id}/change-requests")

    assert resp.status_code == 400
    assert rows(made.id) == []


# --- AC2: what a change affects, and what then needs reviewing ---


# @story: SCRUM-59
# @ac: 2
@pytest.mark.parametrize(
    "affects, bookings, reservations",
    [
        (["date_time"], True, True),
        (["attendance"], True, False),
        (["venue_requirements"], True, False),
        (["equipment"], False, True),
        (["other"], False, False),
        (["attendance", "equipment"], True, True),
        (["other", "attendance"], True, False),
    ],
)
def test_what_needs_reviewing_follows_what_the_change_affects(client, affects, bookings, reservations):
    made = event("Affects Gala")
    login(client, "org2")

    resp = change(client, made.id, affects=affects)

    body = resp.get_json()["change_requests"][0]
    assert body["needs_review"] == {"venue_bookings": bookings, "equipment_reservations": reservations}


# @story: SCRUM-59
# @ac: 2
def test_what_a_change_affects_is_kept_once_each_in_the_fixed_order(client):
    made = event("Affects Order")
    login(client, "org2")

    change(client, made.id, affects=["equipment", "date_time", "equipment"])

    assert rows(made.id)[0].affects == ["date_time", "equipment"]


# @story: SCRUM-59
# @ac: 2
@pytest.mark.parametrize("affects", [None, [], "other", ["nothing"], ["other", 7], {"other": True}])
def test_a_change_that_affects_nothing_valid_is_refused_and_nothing_changes(client, affects):
    made = event("Affects Nothing")
    login(client, "org2")

    resp = client.post(
        f"/api/requests/{made.id}/change-requests",
        json={"kind": "Change", "description": "Please change something.", "affects": affects},
    )

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose what the change affects."
    assert rows(made.id) == []
    assert notices("coord1", "Affects Nothing") == []


# --- AC3 and AC6: who sees the request ---


# @story: SCRUM-59
# @ac: 3, 6
def test_the_organiser_the_coordinator_and_the_lead_see_the_requests_oldest_first(client):
    made = event("Seen Gala")
    login(client, "org2")
    change(client, made.id, "First", ["other"])
    ChangeRequest.query.filter_by(event_request_id=made.id).update({"status": "Closed"})
    db.session.commit()
    change(client, made.id, "Second", ["equipment"])

    for username in ("org2", "coord1", "lead1"):
        login(client, username)
        listed = detail(client, made.id)["change_requests"]
        assert [(row["description"], row["status"]) for row in listed] == [("First", "Closed"), ("Second", "Open")]
        assert listed[1]["needs_review"] == {"venue_bookings": False, "equipment_reservations": True}


# @story: SCRUM-59
# @ac: 3
def test_the_safety_officer_does_not_see_the_requests(client):
    made = event("Seen Safety", status="Safety Check")
    login(client, "org2")
    change(client, made.id)

    login(client, "safety1")

    assert "change_requests" not in detail(client, made.id)


# @story: SCRUM-59
# @ac: 3
def test_an_event_with_no_request_lists_none(client):
    made = event("Seen None")
    login(client, "org2")

    assert detail(client, made.id)["change_requests"] == []


# --- AC4: the event is untouched ---


# @story: SCRUM-59
# @ac: 4
def test_raising_a_request_changes_neither_the_status_nor_the_details(client):
    made = event("Untouched Gala", purpose="Keep me", attendance=40)
    keep = {"name": made.name, "purpose": "Keep me", "attendance": 40, "date": DAY["date"], "status": "Approved"}
    login(client, "org2")

    change(client, made.id, affects=["date_time", "attendance"])
    withdraw_resp = withdraw(client, made.id)

    row = stored(made.id)
    assert {key: getattr(row, key) for key in keep} == keep
    assert row.assigned_coordinator_id == account("coord1").id
    assert withdraw_resp.status_code == 409


# --- AC5: one open request at a time ---


# @story: SCRUM-59
# @ac: 5
def test_a_second_request_is_refused_while_one_is_open(client):
    made = event("Twice Gala")
    login(client, "org2")
    change(client, made.id, "First", ["other"])
    before = len(notices("coord1", "Twice Gala"))

    resp = change(client, made.id, "Second", ["other"])

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "A request is already open on this event."
    assert [row.description for row in rows(made.id)] == ["First"]
    assert len(notices("coord1", "Twice Gala")) == before


# @story: SCRUM-59
# @ac: 5
def test_a_withdrawal_is_refused_while_a_change_is_open_and_the_reverse(client):
    first = event("Open Change")
    second = event("Open Withdrawal")
    login(client, "org2")
    change(client, first.id)
    withdraw(client, second.id)

    assert withdraw(client, first.id).status_code == 409
    assert change(client, second.id).status_code == 409


# @story: SCRUM-59
# @ac: 5
def test_a_new_request_is_allowed_once_the_earlier_one_is_closed(client):
    made = event("Again Gala")
    login(client, "org2")
    change(client, made.id, "First", ["other"])
    ChangeRequest.query.filter_by(event_request_id=made.id).update({"status": "Closed"})
    db.session.commit()

    assert change(client, made.id, "Second", ["other"]).status_code == 201
    assert [row.status for row in rows(made.id)] == ["Closed", "Open"]


# --- AC6: the coordinator is told, or told when assigned ---


# @story: SCRUM-59
# @ac: 6
def test_the_assigned_coordinator_is_told_of_a_change_request(client):
    made = event("Notify Change")
    login(client, "org2")

    change(client, made.id)

    assert notices("coord1", "Notify Change") == ['org2 has asked for a change to "Notify Change".']
    assert notices("coord2", "Notify Change") == []
    assert notices("lead1", "Notify Change") == []
    assert notices("org2", "Notify Change") == []


# @story: SCRUM-59
# @ac: 6
def test_the_assigned_coordinator_is_told_of_a_withdrawal_request(client):
    made = event("Notify Withdrawal")
    login(client, "org2")

    withdraw(client, made.id, "Client cancelled.")

    assert notices("coord1", "Notify Withdrawal") == ['org2 has asked for "Notify Withdrawal" to be withdrawn.']


# @story: SCRUM-59
# @ac: 6
def test_with_no_coordinator_the_request_waits_and_nobody_is_told(client):
    made = event("Wait Gala", status="Submitted", coordinator=None)
    login(client, "org2")

    resp = change(client, made.id)

    assert resp.status_code == 201
    assert [row.status for row in rows(made.id)] == ["Open"]
    assert notices("coord1", "Wait Gala") == []


# @story: SCRUM-59
# @ac: 6
@pytest.mark.parametrize(
    "raise_one, wording",
    [
        (lambda client, event_id: change(client, event_id), "A change request is waiting on your event"),
        (lambda client, event_id: withdraw(client, event_id), "A withdrawal request is waiting on your event"),
    ],
)
def test_the_coordinator_is_told_when_assigned_a_waiting_request(client, raise_one, wording):
    made = event("Waiting Gala", status="Submitted", coordinator=None)
    login(client, "org2")
    raise_one(client, made.id)

    login(client, "lead1")
    resp = client.post(f"/api/requests/{made.id}/assign", json={"coordinator_id": account("coord1").id})

    assert resp.status_code == 200
    assert sorted(notices("coord1", "Waiting Gala")) == sorted(
        [f'{wording} "Waiting Gala".', 'You have been assigned the event "Waiting Gala".']
    )
    assert [row.status for row in rows(made.id)] == ["Open"]


# @story: SCRUM-59
# @ac: 6
def test_assigning_with_no_waiting_request_tells_only_the_assignment(client):
    made = event("Plain Assign", status="Submitted", coordinator=None)
    login(client, "lead1")

    client.post(f"/api/requests/{made.id}/assign", json={"coordinator_id": account("coord1").id})

    assert notices("coord1", "Plain Assign") == ['You have been assigned the event "Plain Assign".']


# @story: SCRUM-59
# @ac: 6
def test_a_closed_request_is_not_announced_at_assignment(client):
    made = event("Closed Assign", status="Submitted", coordinator=None)
    login(client, "org2")
    change(client, made.id)
    ChangeRequest.query.filter_by(event_request_id=made.id).update({"status": "Closed"})
    db.session.commit()

    login(client, "lead1")
    client.post(f"/api/requests/{made.id}/assign", json={"coordinator_id": account("coord1").id})

    assert notices("coord1", "Closed Assign") == ['You have been assigned the event "Closed Assign".']


# --- AC7: the event ends, the request closes without a decision ---


def open_request(event_id):
    row = ChangeRequest(
        event_request_id=event_id,
        raised_by=account("org2"),
        kind="Change",
        description="Please change it.",
        affects=["other"],
        raised_at=datetime(2036, 6, 1, 9, 0),
    )
    db.session.add(row)
    db.session.commit()
    return row


def only(event_id):
    (row,) = rows(event_id)
    return row


# @story: SCRUM-59
# @ac: 7
def test_rejecting_the_event_closes_its_open_request_without_a_decision(client):
    made = event("End Rejected", status="Submitted")
    open_request(made.id)
    login(client, "coord1")

    resp = client.post(f"/api/requests/{made.id}/reject", json={"reason": "Capacity cannot be met."})

    assert resp.status_code == 200
    row = only(made.id)
    assert (row.status, row.closed_at is not None) == ("Closed", True)
    assert [item["status"] for item in resp.get_json()["change_requests"]] == ["Closed"]


# @story: SCRUM-59
# @ac: 7
def test_cancelling_the_event_closes_its_open_request_without_a_decision(client, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: datetime(2036, 6, 1, 9, 0))
    made = event("End Cancelled")
    open_request(made.id)
    login(client, "coord1")

    resp = client.post(f"/api/requests/{made.id}/cancel", json={"reason": "Organiser has withdrawn the event."})

    assert resp.status_code == 200
    assert only(made.id).status == "Closed"


# @story: SCRUM-59
# @ac: 7
def test_completing_the_event_closes_its_open_request_without_a_decision(client, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: datetime(2036, 6, 10, 12, 0))
    made = event("End Completed", status="Confirmed")
    open_request(made.id)
    login(client, "coord1")

    resp = client.post(f"/api/requests/{made.id}/complete")

    assert resp.status_code == 200
    assert only(made.id).status == "Closed"


# @story: SCRUM-59
# @ac: 7
def test_events_that_do_not_end_leave_their_open_request_open(client, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: datetime(2036, 6, 1, 9, 0))
    approved = event("Stays Approved", status="Submitted")
    open_request(approved.id)
    login(client, "coord1")

    client.post(f"/api/requests/{approved.id}/approve", json={"reason": ""})

    assert only(approved.id).status == "Open"


# @story: SCRUM-59
# @ac: 7
def test_an_event_ending_with_no_open_request_changes_no_request(client):
    made = event("End Quietly", status="Submitted")
    open_request(made.id)
    ChangeRequest.query.filter_by(event_request_id=made.id).update({"status": "Closed"})
    db.session.commit()
    closed_at = only(made.id).closed_at
    login(client, "coord1")

    client.post(f"/api/requests/{made.id}/reject", json={"reason": "Capacity cannot be met."})

    assert only(made.id).closed_at == closed_at


# --- AC8: who may raise one, and on what ---


# @story: SCRUM-59
# @ac: 8
def test_another_organiser_cannot_raise_a_request_and_nothing_changes(client):
    made = event("Other Organiser", owner="org1")
    login(client, "org2")

    resp = change(client, made.id)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Event request not found."
    assert rows(made.id) == []
    assert notices("coord1", "Other Organiser") == []


# @story: SCRUM-59
# @ac: 8
@pytest.mark.parametrize("status", ["Draft", "Rejected", "Completed", "Cancelled"])
def test_a_request_is_refused_on_a_draft_rejected_completed_or_cancelled_event(client, status):
    made = event(f"Refused {status}", status=status)
    login(client, "org2")

    for resp in (change(client, made.id), withdraw(client, made.id)):
        assert resp.status_code == 409
        assert resp.get_json()["message"] == REFUSED
    assert rows(made.id) == []
    assert stored(made.id).status == status
    assert notices("coord1", f"Refused {status}") == []


# @story: SCRUM-59
# @ac: 8
def test_an_unknown_event_answers_404(client):
    login(client, "org2")

    assert change(client, 99999).status_code == 404


# @story: SCRUM-59
# @ac: 8
@pytest.mark.parametrize("username", ["coord1", "lead1", "venue1", "tech1", "safety1", "att1"])
def test_an_account_that_is_not_an_organiser_cannot_raise_a_request(client, username):
    made = event("Not Organiser")
    login(client, username)

    assert change(client, made.id).status_code == 403
    assert rows(made.id) == []

