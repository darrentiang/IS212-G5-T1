"""Notification rules — SCRUM-58 (View My Notifications).

The acceptance criteria as rules at the API: an account sees only its own
notifications, newest first; the unread count; opening one marks it read and
an already-read one is unaffected; marking all read; an event is named only
when the account may open it; an account with none sees an empty list; one
account can never see, open or mark another's; several roles' notifications
arrive in one list. No story creates a notification yet (SCRUM-62, 63, 64);
every row here comes from seed/data.json (team decision, 11-10-2026).
"""

from datetime import datetime, timezone

from db import db
from models import Account, Notification


def login(client, username):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def _notification_ids_for(username):
    account = db.session.query(Account).filter_by(username=username).one()
    return [
        row.id
        for row in db.session.query(Notification).filter_by(recipient_id=account.id).all()
    ]


# --- AC2: list shows only the account's own notifications, newest first ---


# @story: SCRUM-58
# @ac: 2
def test_lists_only_this_accounts_notifications_newest_first(client):
    login(client, "org1")

    resp = client.get("/api/notifications")

    assert resp.status_code == 200
    body = resp.get_json()
    # org1's two seeded rows: Annual Dinner (10-10, unread) newer than
    # Open House (09-10, read); coord1's and multi1's rows must not appear.
    assert [row["message"] for row in body] == [
        'Your request "Annual Dinner" was submitted.',
        'Your request "Open House" was approved.',
    ]
    assert body[0]["read"] is False
    assert body[1]["read"] is True


# @story: SCRUM-58
# @ac: 2
def test_each_notification_carries_its_created_time(client):
    login(client, "org1")

    resp = client.get("/api/notifications")

    body = resp.get_json()
    unread = next(row for row in body if not row["read"])
    assert unread["created_at"].startswith("2026-10-10T08:00:00")


# --- AC3: the unread count ---


# @story: SCRUM-58
# @ac: 3
def test_unread_count_counts_only_unread_notifications(client):
    login(client, "org1")

    resp = client.get("/api/notifications/unread-count")

    assert resp.status_code == 200
    # org1 has one unread (Annual Dinner) and one read (Open House).
    assert resp.get_json()["unread_count"] == 1


# --- AC4: opening marks read; an already-read one is unaffected ---


# @story: SCRUM-58
# @ac: 4
def test_marking_an_unread_notification_read_persists_and_drops_the_count(client):
    login(client, "org1")
    [unread_id] = [
        row["id"] for row in client.get("/api/notifications").get_json() if not row["read"]
    ]
    before = datetime.now(timezone.utc)

    resp = client.post(f"/api/notifications/{unread_id}/read")

    assert resp.status_code == 200
    assert resp.get_json()["read"] is True
    stored = db.session.get(Notification, unread_id)
    assert stored.read_at is not None
    assert stored.read_at >= before.replace(tzinfo=None)
    assert client.get("/api/notifications/unread-count").get_json()["unread_count"] == 0


# @story: SCRUM-58
# @ac: 4
def test_marking_an_already_read_notification_read_changes_nothing(client):
    login(client, "org1")
    [read_id] = [row["id"] for row in client.get("/api/notifications").get_json() if row["read"]]
    original_read_at = db.session.get(Notification, read_id).read_at

    resp = client.post(f"/api/notifications/{read_id}/read")

    assert resp.status_code == 200
    assert db.session.get(Notification, read_id).read_at == original_read_at


# --- AC5: mark all as read ---


# @story: SCRUM-58
# @ac: 5
def test_mark_all_read_clears_this_accounts_unread_count_only(client):
    login(client, "coord1")
    assert client.get("/api/notifications/unread-count").get_json()["unread_count"] == 2

    resp = client.post("/api/notifications/mark-all-read")

    assert resp.status_code == 200
    assert resp.get_json()["unread_count"] == 0
    assert all(
        db.session.get(Notification, nid).read_at is not None
        for nid in _notification_ids_for("coord1")
    )
    # org1's own unread notification is untouched by coord1's mark-all.
    login(client, "org1")
    assert client.get("/api/notifications/unread-count").get_json()["unread_count"] == 1


# --- AC6: an event is named only when the account may open it ---


# @story: SCRUM-58
# @ac: 6
def test_event_is_named_and_linkable_when_the_account_may_view_it(client):
    login(client, "coord1")

    body = client.get("/api/notifications").get_json()

    # coord1 may view "Annual Dinner" (Submitted, not Draft).
    row = next(r for r in body if r["message"] == "This request now needs your attention.")
    assert row["event_request_name"] == "Annual Dinner"
    assert row["event_request_id"] is not None


# @story: SCRUM-58
# @ac: 6
def test_event_is_hidden_when_the_account_may_not_view_it(client):
    login(client, "org2")

    body = client.get("/api/notifications").get_json()

    # org2 cannot view "Annual Dinner": Event Organisers see only their own
    # requests, whatever the event's status — robust against any other
    # test or story that later changes Annual Dinner's status.
    row = next(r for r in body if r["message"] == "A note was recorded for this event.")
    assert row["event_request_id"] is None
    assert row["event_request_name"] is None


# @story: SCRUM-58
# @ac: 6
def test_a_notification_with_no_event_at_all_names_none(client):
    login(client, "multi1")

    body = client.get("/api/notifications").get_json()

    row = next(r for r in body if r["message"] == "A venue booking you manage was approved.")
    assert row["event_request_id"] is None
    assert row["event_request_name"] is None


# --- AC7: no notifications ---


# @story: SCRUM-58
# @ac: 7
def test_an_account_with_no_notifications_sees_an_empty_list(client):
    login(client, "tech1")

    resp = client.get("/api/notifications")

    assert resp.status_code == 200
    assert resp.get_json() == []
    assert client.get("/api/notifications/unread-count").get_json()["unread_count"] == 0


# --- AC8: never another account's notification ---


# @story: SCRUM-58
# @ac: 8
def test_cannot_mark_another_accounts_notification_read(client):
    [org1_unread_id] = [
        row.id
        for row in db.session.query(Notification)
        .join(Account, Notification.recipient_id == Account.id)
        .filter(Account.username == "org1", Notification.read_at.is_(None))
        .all()
    ]
    login(client, "coord2")

    resp = client.post(f"/api/notifications/{org1_unread_id}/read")

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Notification not found."
    assert db.session.get(Notification, org1_unread_id).read_at is None


# @story: SCRUM-58
# @ac: 8
def test_marking_all_read_never_touches_another_accounts_notifications(client):
    login(client, "coord2")

    client.post("/api/notifications/mark-all-read")

    login(client, "org1")
    assert client.get("/api/notifications/unread-count").get_json()["unread_count"] == 1


# @story: SCRUM-58
# @ac: 8
def test_an_unknown_notification_id_is_refused_the_same_way(client):
    login(client, "org1")

    resp = client.post("/api/notifications/999999/read")

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Notification not found."


# --- AC9: several roles' notifications arrive in one list ---


# @story: SCRUM-58
# @ac: 9
def test_a_multi_role_account_sees_notifications_from_every_role_in_one_list(client):
    # multi1 is Event Coordinator and Venue Staff; it holds a
    # coordinator-flavoured row (Past Gala) and a venue-flavoured one (no
    # event), both simply addressed to the account, not to either role.
    login(client, "multi1")

    body = client.get("/api/notifications").get_json()

    assert {row["message"] for row in body} == {
        "This event was marked completed.",
        "A venue booking you manage was approved.",
    }


# @story: SCRUM-58
def test_not_logged_in_cannot_list_notifications(client):
    resp = client.get("/api/notifications")

    assert resp.status_code == 401


# @story: SCRUM-58
def test_notification_repr_shows_recipient_and_read_state(app):
    with app.app_context():
        notification = Notification(
            recipient_id=1, message="x", created_at=datetime.now(timezone.utc),
        )
        assert repr(notification) == f"<Notification {notification.id} to 1 read=False>"
