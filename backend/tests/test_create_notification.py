"""Sending a notification — notifications.create_notification() (SCRUM-58).

The inbox is SCRUM-58's; this is the one function every story calls to put a
row in it. What a notification must record is AC1 (recipient, event, message,
created time, read or not), and what the recipient then sees is AC2 to AC6. The
function must not commit: it joins the caller's transaction, so a refused action
creates nothing and one decision creates exactly one (SCRUM-62 AC6 and AC7,
SCRUM-63 AC6).

Account coord2 has no seeded notification, so a count against it starts at 0.
"""

from datetime import datetime, timedelta, timezone

import pytest

from db import db
from factories import account
from models import EventRequest, Notification
from notifications import create_notification


def event(name="Annual Dinner"):
    return db.session.query(EventRequest).filter_by(name=name).one()


def count_for(username):
    return db.session.query(Notification).filter_by(recipient_id=account(username).id).count()


def login(client, username):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


# --- AC1: a notification records its recipient, event, message, created time and read state ---


# @story: SCRUM-58
# @ac: 1
def test_creates_one_unread_notification_for_the_recipient_about_the_event(app):
    before = datetime.now(timezone.utc).replace(tzinfo=None)

    created = create_notification(account("coord2"), "Venue approved.", event("Annual Dinner"))
    db.session.commit()

    row = db.session.get(Notification, created.id)
    assert row.recipient_id == account("coord2").id
    assert row.event_request_id == event("Annual Dinner").id
    assert row.message == "Venue approved."
    assert row.read_at is None  # unread
    # The time it was created is "now": between just before the call and a minute after.
    assert before - timedelta(seconds=1) <= row.created_at <= before + timedelta(minutes=1)


# @story: SCRUM-58
# @ac: 1
def test_a_notification_need_not_be_about_an_event(app):
    created = create_notification(account("coord2"), "General notice.")
    db.session.commit()

    assert db.session.get(Notification, created.id).event_request_id is None


# @story: SCRUM-58
# @ac: 1
def test_the_message_is_kept_without_surrounding_whitespace(app):
    created = create_notification(account("coord2"), "  Hold expires at 17:00.  ")
    db.session.commit()

    assert db.session.get(Notification, created.id).message == "Hold expires at 17:00."


# --- Exactly one per call ---


# @story: SCRUM-58
# @ac: 1
def test_each_call_adds_exactly_one_notification(app):
    assert count_for("coord2") == 0

    create_notification(account("coord2"), "First.")
    db.session.commit()
    assert count_for("coord2") == 1

    create_notification(account("coord2"), "Second.")
    db.session.commit()
    assert count_for("coord2") == 2


# --- It joins the caller's transaction: no commit of its own ---


# @story: SCRUM-58
# @ac: 1
def test_a_notification_is_not_saved_when_the_action_around_it_is_rolled_back(app):
    # The action that would have caused it is refused, so the caller rolls back.
    create_notification(account("coord2"), "Should never be saved.", event("Annual Dinner"))
    db.session.rollback()

    assert count_for("coord2") == 0


# @story: SCRUM-58
# @ac: 1
def test_a_notification_is_saved_together_with_the_callers_own_change(app):
    # Mimics a decision: change the event and notify in one commit.
    target = event("Annual Dinner")
    original_notes = target.coordinator_notes
    target.coordinator_notes = "Decided."
    create_notification(account("coord2"), "Decision recorded.", target)
    db.session.commit()

    assert event("Annual Dinner").coordinator_notes == "Decided."
    assert event("Annual Dinner").coordinator_notes != original_notes
    assert count_for("coord2") == 1


# --- What the recipient then sees (AC2, AC3, AC6) ---


# @story: SCRUM-58
# @ac: 2, 3
def test_the_recipient_sees_it_unread_and_counted(client):
    create_notification(account("coord2"), "Venue approved.", event("Annual Dinner"))
    db.session.commit()
    login(client, "coord2")

    listed = client.get("/api/notifications").get_json()
    count = client.get("/api/notifications/unread-count").get_json()

    assert [row["message"] for row in listed] == ["Venue approved."]
    assert listed[0]["read"] is False
    assert count == {"unread_count": 1}


# @story: SCRUM-58
# @ac: 2
def test_a_new_notification_is_shown_first(client):
    # org1's seeded rows are dated 9 and 10 Oct 2026; one created now is newer than both.
    create_notification(account("org1"), "Newest.", event("Annual Dinner"))
    db.session.commit()
    login(client, "org1")

    listed = client.get("/api/notifications").get_json()

    assert listed[0]["message"] == "Newest."
    assert len(listed) == 3


# @story: SCRUM-58
# @ac: 6
def test_the_event_is_named_for_a_recipient_who_may_open_it(client):
    # An Event Coordinator may open any request except a Draft: Annual Dinner is Submitted.
    create_notification(account("coord2"), "About the dinner.", event("Annual Dinner"))
    db.session.commit()
    login(client, "coord2")

    listed = client.get("/api/notifications").get_json()

    assert listed[0]["event_request_name"] == "Annual Dinner"
    assert listed[0]["event_request_id"] == event("Annual Dinner").id


# @story: SCRUM-58
# @ac: 6
def test_the_event_is_not_revealed_to_a_recipient_who_may_not_open_it(client):
    # org2 did not create Annual Dinner (org1 did), so it is not theirs to open.
    create_notification(account("org2"), "About someone else's event.", event("Annual Dinner"))
    db.session.commit()
    login(client, "org2")

    listed = client.get("/api/notifications").get_json()
    mine = [row for row in listed if row["message"] == "About someone else's event."]

    assert mine[0]["event_request_name"] is None
    assert mine[0]["event_request_id"] is None


# @story: SCRUM-58
# @ac: 8
def test_nobody_else_sees_it(client):
    create_notification(account("coord2"), "Private to coord2.", event("Annual Dinner"))
    db.session.commit()
    login(client, "coord1")

    messages = [row["message"] for row in client.get("/api/notifications").get_json()]

    assert "Private to coord2." not in messages


# --- A mistake in the calling code is refused and adds nothing ---


# @story: SCRUM-58
# @ac: 1
@pytest.mark.parametrize("message", ["", "   ", None])
def test_a_blank_or_missing_message_is_refused_and_adds_nothing(app, message):
    with pytest.raises(ValueError, match="needs a message"):
        create_notification(account("coord2"), message, event("Annual Dinner"))
    db.session.commit()

    assert count_for("coord2") == 0


# @story: SCRUM-58
# @ac: 1
def test_a_missing_recipient_is_refused_and_adds_nothing(app):
    before = db.session.query(Notification).count()

    with pytest.raises(ValueError, match="needs a recipient"):
        create_notification(None, "Orphan.", event("Annual Dinner"))
    db.session.commit()

    assert db.session.query(Notification).count() == before
