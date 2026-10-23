"""SCRUM-45: the assigned Event Coordinator asks the Organiser to clarify a Submitted request.

The acceptance criteria as rules at the API: a coordinator asks, with a message
that is not blank, only on a Submitted request assigned to them; the request
stays Submitted and shows Clarification requested, with the message, to the
Organiser and the coordinator; the Organiser replies, which ends the wait and
touches nothing else; one clarification is open at a time; every clarification
and reply stays, oldest first; a decision ends a clarification nobody answered;
nobody else may ask or reply; and each is told. The browser journeys are
functional/tests/SCRUM-45.spec.js.
"""

import pytest

from db import db
from models import Account, Clarification, EventRequest, Notification
from tests.factories import make_clarification, make_event

DAY = {"date": "2026-12-05", "start_time": "10:00", "end_time": "12:00"}


def account(username):
    return db.session.query(Account).filter_by(username=username).one()


def login(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def event(name, status="Submitted", coordinator="coord1", owner="org2", **fields):
    return make_event(
        name=name,
        status=status,
        owner=owner,
        assigned_coordinator=account(coordinator) if coordinator else None,
        **DAY,
        **fields,
    )


def ask(client, event_id, message="Please give the guest list size."):
    return client.post(f"/api/requests/{event_id}/clarification", json={"message": message})


def reply(client, event_id, message="Forty guests."):
    return client.post(f"/api/requests/{event_id}/clarification/reply", json={"message": message})


def stored(event_id):
    db.session.expire_all()
    return db.session.get(EventRequest, event_id)


def rows(event_id):
    db.session.expire_all()
    return db.session.query(Clarification).filter_by(event_request_id=event_id).order_by(Clarification.id).all()


def notices(username, about):
    db.session.expire_all()
    found = db.session.query(Notification).filter_by(recipient_id=account(username).id)
    return [row.message for row in found if f'"{about}"' in row.message]


def detail(client, event_id):
    return client.get(f"/api/requests/{event_id}").get_json()


# --- AC1: the assigned coordinator asks; a blank request is refused ---


# @story: SCRUM-45
# @ac: 1
def test_the_assigned_coordinator_asks_with_a_message(client):
    made = event("Ask Gala")
    login(client, "coord1")

    resp = ask(client, made.id, "  Please give the guest list size.  ")

    assert resp.status_code == 201
    body = resp.get_json()
    assert body["status"] == "Submitted"
    assert body["clarification_requested"] is True
    assert [(row["message"], row["requested_by"], row["reply"]) for row in body["clarifications"]] == [
        ("Please give the guest list size.", "coord1", None)
    ]


# @story: SCRUM-45
# @ac: 1
@pytest.mark.parametrize("message", [None, "", "   ", 7])
def test_a_blank_request_is_refused_and_nothing_changes(client, message):
    made = event("Ask Blank")
    login(client, "coord1")

    resp = client.post(f"/api/requests/{made.id}/clarification", json={"message": message})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Say what is missing or unclear."
    assert rows(made.id) == []
    assert notices("org2", "Ask Blank") == []


# @story: SCRUM-45
# @ac: 1
def test_a_missing_body_is_refused_like_a_blank_message(client):
    made = event("Ask No Body")
    login(client, "coord1")

    resp = client.post(f"/api/requests/{made.id}/clarification")

    assert resp.status_code == 400
    assert rows(made.id) == []


# --- AC2: the request stays Submitted and shows the flag and message ---


# @story: SCRUM-45
# @ac: 2
def test_the_request_stays_submitted_and_its_details_are_unchanged(client):
    made = event("Ask Keeps Details", purpose="Keep me", attendance=40)
    keep = {"name": made.name, "purpose": "Keep me", "attendance": 40, "date": DAY["date"], "status": "Submitted"}
    login(client, "coord1")

    ask(client, made.id)

    row = stored(made.id)
    assert {key: getattr(row, key) for key in keep} == keep
    assert row.assigned_coordinator_id == account("coord1").id


# @story: SCRUM-45
# @ac: 2
def test_the_organiser_and_the_coordinator_see_the_flag_and_the_message(client):
    made = event("Ask Seen")
    login(client, "coord1")
    ask(client, made.id, "Which room?")

    for username in ("org2", "coord1"):
        login(client, username)
        body = detail(client, made.id)
        assert body["clarification_requested"] is True
        assert [row["message"] for row in body["clarifications"]] == ["Which room?"]
        listed = {row["name"]: row for row in client.get("/api/requests").get_json()}
        assert listed["Ask Seen"]["clarification_requested"] is True
        assert "clarifications" not in listed["Ask Seen"]


# @story: SCRUM-45
# @ac: 2
def test_the_lead_reads_the_clarifications_but_the_safety_officer_does_not(client):
    made = event("Ask Who Reads", status="Safety Check")
    make_clarification(event=made, message="Old question", reply="Old answer")
    login(client, "lead1")
    assert [row["message"] for row in detail(client, made.id)["clarifications"]] == ["Old question"]

    login(client, "safety1")

    assert "clarifications" not in detail(client, made.id)


# @story: SCRUM-45
# @ac: 2
def test_a_request_with_no_clarification_shows_no_flag_and_an_empty_history(client):
    made = event("Ask None")
    login(client, "org2")

    body = detail(client, made.id)

    assert body["clarification_requested"] is False
    assert body["clarifications"] == []


# --- AC3: the Organiser replies; a blank reply is refused ---


# @story: SCRUM-45
# @ac: 3
def test_the_organiser_replies_which_ends_the_wait_and_changes_nothing_else(client):
    made = event("Reply Gala", attendance=40)
    make_clarification(event=made, message="Which room?")
    login(client, "org2")

    resp = reply(client, made.id, "  The Seminar Room.  ")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["clarification_requested"] is False
    assert [(row["message"], row["reply"], row["replied_by"]) for row in body["clarifications"]] == [
        ("Which room?", "The Seminar Room.", "org2")
    ]
    row = stored(made.id)
    assert (row.status, row.name, row.attendance, row.date) == ("Submitted", "Reply Gala", 40, DAY["date"])


# @story: SCRUM-45
# @ac: 3
@pytest.mark.parametrize("message", [None, "", "   ", 7])
def test_a_blank_reply_is_refused_and_the_clarification_stays_open(client, message):
    made = event("Reply Blank")
    make_clarification(event=made, message="Which room?")
    login(client, "org2")

    resp = client.post(f"/api/requests/{made.id}/clarification/reply", json={"message": message})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Write a reply."
    assert stored(made.id).open_clarification is not None
    assert rows(made.id)[0].reply is None
    assert notices("coord1", "Reply Blank") == []


# --- AC4: one at a time; a reply needs an open one ---


# @story: SCRUM-45
# @ac: 4
def test_a_second_clarification_is_refused_while_one_is_open(client):
    made = event("Ask Twice")
    make_clarification(event=made, message="First question")
    login(client, "coord1")

    resp = ask(client, made.id, "Second question")

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "A clarification is already open on this request."
    assert [row.message for row in rows(made.id)] == ["First question"]
    assert notices("org2", "Ask Twice") == []


# @story: SCRUM-45
# @ac: 4
def test_a_new_clarification_is_allowed_once_the_organiser_has_replied(client):
    made = event("Ask Again")
    make_clarification(event=made, message="First question", reply="First answer")
    login(client, "coord1")

    assert ask(client, made.id, "Second question").status_code == 201
    assert [row.message for row in rows(made.id)] == ["First question", "Second question"]


# @story: SCRUM-45
# @ac: 4
def test_a_reply_is_refused_when_none_is_open(client):
    made = event("Reply None")
    make_clarification(event=made, message="Answered", reply="Done")
    login(client, "org2")

    resp = reply(client, made.id, "Again")

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "No clarification is open on this request."
    assert [row.reply for row in rows(made.id)] == ["Done"]
    assert notices("coord1", "Reply None") == []


# --- AC5: every clarification and reply stays, oldest first ---


# @story: SCRUM-45
# @ac: 5
def test_every_clarification_and_reply_stays_oldest_first_with_who_and_when(client):
    made = event("History Gala")
    login(client, "coord1")
    ask(client, made.id, "Q1")
    login(client, "org2")
    reply(client, made.id, "A1")
    login(client, "coord1")
    ask(client, made.id, "Q2")
    login(client, "org2")
    reply(client, made.id, "A2")

    for username in ("org2", "coord1"):
        login(client, username)
        history = detail(client, made.id)["clarifications"]
        assert [(row["message"], row["requested_by"], row["reply"], row["replied_by"]) for row in history] == [
            ("Q1", "coord1", "A1", "org2"),
            ("Q2", "coord1", "A2", "org2"),
        ]
        assert all(row["requested_at"] and row["replied_at"] for row in history)
        assert history[0]["requested_at"] <= history[0]["replied_at"] <= history[1]["requested_at"]


# --- AC6: a decision ends the wait ---


# @story: SCRUM-45
# @ac: 6
def test_approving_while_a_clarification_is_open_ends_the_wait(client):
    made = event("Decide Approve")
    make_clarification(event=made, message="Which room?")
    login(client, "coord1")

    resp = client.post(f"/api/requests/{made.id}/approve", json={"reason": ""})

    assert resp.status_code == 200
    body = detail(client, made.id)
    assert (body["status"], body["clarification_requested"]) == ("Approved", False)
    assert [(row["message"], row["reply"]) for row in body["clarifications"]] == [("Which room?", None)]


# @story: SCRUM-45
# @ac: 6
def test_rejecting_while_a_clarification_is_open_ends_the_wait(client):
    made = event("Decide Reject")
    make_clarification(event=made, message="Which room?")
    login(client, "coord1")

    resp = client.post(f"/api/requests/{made.id}/reject", json={"reason": "Capacity cannot be met."})

    assert resp.status_code == 200
    body = detail(client, made.id)
    assert (body["status"], body["clarification_requested"]) == ("Rejected", False)
    assert [row["reply"] for row in body["clarifications"]] == [None]


# @story: SCRUM-45
# @ac: 4, 6
def test_a_reply_after_the_wait_was_ended_by_a_decision_is_refused(client):
    made = event("Decide Then Reply")
    make_clarification(event=made, message="Which room?")
    login(client, "coord1")
    client.post(f"/api/requests/{made.id}/approve", json={"reason": ""})

    login(client, "org2")
    resp = reply(client, made.id)

    assert resp.status_code == 409
    assert [row.reply for row in rows(made.id)] == [None]
    assert notices("coord1", "Decide Then Reply") == []


# @story: SCRUM-45
# @ac: 6
def test_a_decision_with_no_clarification_open_leaves_the_history_alone(client):
    made = event("Decide Quietly")
    make_clarification(event=made, message="Answered", reply="Yes")
    login(client, "coord1")

    client.post(f"/api/requests/{made.id}/approve", json={"reason": ""})

    assert [row.ended_at for row in rows(made.id)] == [None]


# --- AC7: who may ask, who may reply, and only while Submitted ---


# @story: SCRUM-45
# @ac: 7
@pytest.mark.parametrize("username", ["coord2", "multi1", "leadcoord1"])
def test_a_coordinator_the_event_is_not_assigned_to_is_refused_with_404(client, username):
    made = event("Ask Wrong Coordinator")
    login(client, username)

    resp = ask(client, made.id)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Event request not found."
    assert rows(made.id) == []
    assert notices("org2", "Ask Wrong Coordinator") == []


# @story: SCRUM-45
# @ac: 7
@pytest.mark.parametrize("username", ["org2", "lead1", "venue1", "tech1", "safety1", "att1"])
def test_an_account_that_is_not_a_coordinator_cannot_ask(client, username):
    made = event("Ask Not Coordinator")
    login(client, username)

    assert ask(client, made.id).status_code == 403
    assert rows(made.id) == []


# @story: SCRUM-45
# @ac: 7
@pytest.mark.parametrize("status", ["Approved", "Rejected", "Planning", "Safety Check", "Confirmed", "Completed", "Cancelled"])
def test_clarification_cannot_be_requested_on_a_request_that_is_not_submitted(client, status):
    made = event(f"Ask {status}", status=status)
    login(client, "coord1")

    resp = ask(client, made.id)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "Only a Submitted request can have clarification requested."
    assert stored(made.id).status == status
    assert rows(made.id) == []


# @story: SCRUM-45
# @ac: 7
def test_an_unknown_request_and_a_draft_or_unassigned_one_answer_404(client):
    unassigned = event("Ask Unassigned", coordinator=None)
    draft = event("Ask Draft", status="Draft")
    login(client, "coord1")

    assert ask(client, 99999).status_code == 404
    assert ask(client, unassigned.id).status_code == 404
    assert ask(client, draft.id).status_code == 404


# @story: SCRUM-45
# @ac: 7
def test_another_organiser_cannot_reply_and_nothing_changes(client):
    made = event("Reply Wrong Organiser")
    make_clarification(event=made, message="Which room?")
    login(client, "org1")

    resp = reply(client, made.id)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Event request not found."
    assert rows(made.id)[0].reply is None
    assert notices("coord1", "Reply Wrong Organiser") == []


# @story: SCRUM-45
# @ac: 7
@pytest.mark.parametrize("username", ["coord1", "lead1", "venue1", "tech1", "safety1", "att1"])
def test_an_account_that_is_not_an_organiser_cannot_reply(client, username):
    made = event("Reply Not Organiser")
    make_clarification(event=made, message="Which room?")
    login(client, username)

    assert reply(client, made.id).status_code == 403
    assert rows(made.id)[0].reply is None


# @story: SCRUM-45
# @ac: 7
def test_the_organiser_cannot_reply_to_an_unknown_request(client):
    login(client, "org2")

    assert reply(client, 99999).status_code == 404


# --- AC8: who is told ---


# @story: SCRUM-45
# @ac: 8
def test_the_organiser_is_told_when_clarification_is_requested(client):
    made = event("Notify Ask")
    login(client, "coord1")

    ask(client, made.id)

    assert notices("org2", "Notify Ask") == ['Clarification was requested on your request "Notify Ask".']
    assert notices("coord1", "Notify Ask") == []
    assert notices("lead1", "Notify Ask") == []
    db.session.expire_all()
    unread = db.session.query(Notification).filter_by(recipient_id=account("org2").id, event_request_id=made.id).one()
    assert unread.read_at is None


# @story: SCRUM-45
# @ac: 8
def test_the_assigned_coordinator_is_told_when_the_organiser_replies(client):
    made = event("Notify Reply")
    make_clarification(event=made, message="Which room?")
    login(client, "org2")

    reply(client, made.id)

    assert notices("coord1", "Notify Reply") == ['org2 replied to your clarification request on "Notify Reply".']
    assert notices("org2", "Notify Reply") == []
    assert notices("coord2", "Notify Reply") == []


# @story: SCRUM-45
# @ac: 8
def test_a_reply_after_a_reassignment_tells_the_new_coordinator(client):
    made = event("Notify After Reassign")
    make_clarification(event=made, message="Which room?")
    made.assigned_coordinator = account("coord2")
    db.session.commit()
    login(client, "org2")

    reply(client, made.id)

    assert notices("coord2", "Notify After Reassign") == ['org2 replied to your clarification request on "Notify After Reassign".']
    assert notices("coord1", "Notify After Reassign") == []


# @story: SCRUM-45
# @ac: 8
def test_a_reply_with_no_coordinator_left_tells_nobody_and_still_saves(client):
    made = event("Notify No Coordinator")
    make_clarification(event=made, message="Which room?")
    made.assigned_coordinator = None
    db.session.commit()
    login(client, "org2")

    assert reply(client, made.id).status_code == 200
    assert rows(made.id)[0].reply == "Forty guests."
