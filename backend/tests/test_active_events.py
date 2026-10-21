"""SCRUM-88: the Event Coordinator Lead sees every active event and who holds it.

The acceptance criteria as rules at the API: the list holds the five active
statuses, each with its name, date, status and coordinator or None; Draft,
Rejected, Completed and Cancelled are left out; it filters by coordinator and
by status; each coordinator's count of active events comes with it; the Lead
opens a listed event and its bookings and holds, but can neither edit it nor act
on its arrangements; and anyone without the Lead role is refused. The browser
journeys are functional/tests/SCRUM-88.spec.js.
"""

import pytest

from db import db
from models import Account
from tests.factories import make_booking, make_event, make_hold, make_venue

ACTIVE = ["Submitted", "Approved", "Planning", "Safety Check", "Confirmed"]
INACTIVE = ["Draft", "Rejected", "Completed", "Cancelled"]
# The feature check answers 403; a Lead who is also a Coordinator reaches the
# object rule of the coordinator actions, which answers a write 404 (permissions.md).
EXPECTED = {
    "lead1": [403] * 10,
    "leadcoord1": [403, 403, 403, 404, 404, 404, 403, 404, 404, 404],
}
DAY = {"date": "2026-12-05", "start_time": "10:00", "end_time": "12:00"}


def login(client, username):
    with client.session_transaction() as session:
        session["account_id"] = db.session.query(Account).filter_by(username=username).one().id


def event(name, status="Planning", coordinator=None, **fields):
    assigned = db.session.query(Account).filter_by(username=coordinator).one() if coordinator else None
    return make_event(name=name, status=status, assigned_coordinator=assigned, **DAY, **fields)


def listing(client, **params):
    resp = client.get("/api/assignments", query_string=params)
    assert resp.status_code == 200
    return resp.get_json()


def listed(client, **params):
    return {row["name"]: row for row in listing(client, **params)["events"]}


# --- AC1: every active event, with its name, date, status and coordinator ---


# @story: SCRUM-88
# @ac: 1
def test_the_lead_sees_every_active_event_with_name_date_status_and_coordinator(client):
    for status in ACTIVE:
        event(f"Active {status}", status, "coord1")
    login(client, "lead1")

    rows = listed(client)

    for status in ACTIVE:
        assert rows[f"Active {status}"] == {
            "id": rows[f"Active {status}"]["id"],
            "name": f"Active {status}",
            "date": "2026-12-05",
            "status": status,
            "assigned_coordinator": "coord1",
        }


# @story: SCRUM-88
# @ac: 1
def test_an_event_nobody_holds_has_no_coordinator(client):
    event("Nobody Holds This", "Submitted")
    login(client, "lead1")

    assert listed(client)["Nobody Holds This"]["assigned_coordinator"] is None


# --- AC2: Draft, Rejected, Completed and Cancelled are not listed ---


# @story: SCRUM-88
# @ac: 2
@pytest.mark.parametrize("status", INACTIVE)
def test_an_event_that_is_not_active_is_not_listed(client, status):
    event(f"Inactive {status}", status, "coord1")
    login(client, "lead1")

    assert f"Inactive {status}" not in listed(client)


# --- AC3: filter by coordinator and by status ---


# @story: SCRUM-88
# @ac: 3
def test_the_list_filters_by_coordinator(client):
    event("Filter C1", "Planning", "coord1")
    event("Filter C2", "Planning", "coord2")
    login(client, "lead1")

    rows = listed(client, coordinator="coord1")

    assert "Filter C1" in rows and "Filter C2" not in rows
    assert {row["assigned_coordinator"] for row in rows.values()} == {"coord1"}


# @story: SCRUM-88
# @ac: 3
def test_the_list_filters_by_status(client):
    event("Status Planning", "Planning", "coord1")
    event("Status Approved", "Approved", "coord1")
    login(client, "lead1")

    rows = listed(client, status="Planning")

    assert "Status Planning" in rows and "Status Approved" not in rows
    assert {row["status"] for row in rows.values()} == {"Planning"}


# @story: SCRUM-88
# @ac: 3
def test_the_two_filters_combine(client):
    event("Combo Hit", "Planning", "coord1")
    event("Combo Other Status", "Approved", "coord1")
    event("Combo Other Coordinator", "Planning", "coord2")
    login(client, "lead1")

    rows = listed(client, coordinator="coord1", status="Planning")

    assert "Combo Hit" in rows
    assert "Combo Other Status" not in rows and "Combo Other Coordinator" not in rows


# @story: SCRUM-88
# @ac: 3
def test_a_blank_filter_means_no_filter(client):
    event("Blank Filter", "Planning", "coord1")
    login(client, "lead1")

    assert "Blank Filter" in listed(client, coordinator="", status="")


# @story: SCRUM-88
# @ac: 3
def test_a_status_that_is_not_active_is_refused_and_nothing_is_shown(client):
    login(client, "lead1")

    resp = client.get("/api/assignments", query_string={"status": "Draft"})

    assert resp.status_code == 400
    assert resp.get_json() == {"message": "Choose one of the active statuses."}


# @story: SCRUM-88
# @ac: 3
@pytest.mark.parametrize("name", ["nobody", "org1", "lead1"])
def test_a_coordinator_that_is_not_an_event_coordinator_is_refused(client, name):
    login(client, "lead1")

    resp = client.get("/api/assignments", query_string={"coordinator": name})

    assert resp.status_code == 400
    assert resp.get_json() == {"message": "Choose an Event Coordinator."}


# --- AC4: how many active events each coordinator holds ---


def workloads(client, **params):
    return {row["username"]: row["active_events"] for row in listing(client, **params)["coordinators"]}


# @story: SCRUM-88
# @ac: 4
def test_each_coordinators_count_holds_only_their_active_events(client):
    login(client, "lead1")
    before = workloads(client)
    event("Count A", "Submitted", "coord1")
    event("Count B", "Planning", "coord1")
    event("Count C", "Completed", "coord1")
    event("Count D", "Draft", "coord1")

    after = workloads(client)

    assert after["coord1"] == before["coord1"] + 2
    assert after["coord2"] == before["coord2"]


# @story: SCRUM-88
# @ac: 4
def test_a_coordinator_with_no_active_events_shows_zero_and_a_lead_coordinator_is_counted(client):
    login(client, "lead1")

    counts = workloads(client)

    assert set(counts) >= {"coord1", "coord2", "multi1", "leadcoord1"}
    assert counts["leadcoord1"] == 0


# @story: SCRUM-88
# @ac: 4
def test_the_counts_do_not_change_with_the_filters(client):
    event("Stable Count", "Planning", "coord1")
    login(client, "lead1")

    assert workloads(client, coordinator="coord2", status="Approved") == workloads(client)


# --- AC5: open a listed event and its arrangements, read-only ---


# @story: SCRUM-88
# @ac: 5
def test_the_lead_opens_a_listed_event_with_its_bookings_and_holds(client):
    planning = event("Read Only Planning", "Planning", "coord1")
    venue = make_venue(name="Read Only Room")
    booking = make_booking(event=planning, venue=venue, status="Requested")
    login(client, "lead1")

    detail = client.get(f"/api/requests/{planning.id}")
    bookings = client.get(f"/api/requests/{planning.id}/bookings")
    holds = client.get(f"/api/requests/{planning.id}/holds")

    assert detail.status_code == 200
    assert detail.get_json()["assigned_coordinator"] == "coord1"
    assert [row["id"] for row in bookings.get_json()] == [booking.id]
    assert holds.status_code == 200 and holds.get_json() == []


# @story: SCRUM-88
# @ac: 5
def test_the_lead_opens_an_active_event_that_has_no_coordinator(client):
    approved = event("Approved Nobody Holds", "Approved")
    login(client, "lead1")

    assert client.get(f"/api/requests/{approved.id}").status_code == 200


# @story: SCRUM-88
# @ac: 5
@pytest.mark.parametrize("username", ["lead1", "leadcoord1"])
def test_the_lead_reads_the_planning_information_of_a_listed_event(client, username):
    planning = event("Planning Notes", "Planning", "coord2", coordinator_notes="Bring spare cables")
    login(client, username)

    assert client.get(f"/api/requests/{planning.id}").get_json()["coordinator_notes"] == "Bring spare cables"


# @story: SCRUM-88
# @ac: 5
def test_the_lead_still_cannot_open_a_draft_or_an_unassigned_event_that_is_not_active(client):
    draft = event("Lead Draft", "Draft", "coord1")
    rejected = event("Lead Rejected", "Rejected")
    login(client, "lead1")

    assert client.get(f"/api/requests/{draft.id}").status_code == 403
    assert client.get(f"/api/requests/{rejected.id}").status_code == 403


# @story: SCRUM-88
# @ac: 5
@pytest.mark.parametrize("username", ["lead1", "leadcoord1"])
def test_the_lead_cannot_edit_the_event_or_act_on_its_arrangements(client, username):
    planning = event("Lead Cannot Act", "Planning", "coord2")
    venue = make_venue(name="Lead Cannot Act Room")
    booking = make_booking(event=planning, venue=venue, status="Requested", raised_by="coord2")
    hold = make_hold(event=planning, venue=venue, expires_at="2026-12-04T17:00")
    login(client, username)
    base = f"/api/requests/{planning.id}"

    attempts = [
        client.put(base, json={"name": "Renamed"}),
        client.post(f"{base}/approve", json={}),
        client.post(f"{base}/reject", json={"reason": "No."}),
        client.post(f"{base}/bookings", json={"venue_id": venue.id}),
        client.post(f"{base}/holds", json={"venue_id": venue.id}),
        client.post(f"{base}/send-for-safety-check"),
        client.post(f"/api/venues/{venue.id}/bookings/{booking.id}/approve", json={}),
        client.post(f"/api/venues/{venue.id}/bookings/{booking.id}/withdraw"),
        client.post(f"/api/venues/{venue.id}/bookings/{booking.id}/cancel", json={"reason": "x"}),
        client.post(f"{base}/holds/{hold.id}/release"),
    ]

    # 403 from the feature check, or 404 from the object rule for a Lead who is also a Coordinator.
    assert [resp.status_code for resp in attempts] == EXPECTED[username]
    db.session.expire_all()
    assert db.session.get(type(planning), planning.id).name == "Lead Cannot Act"
    assert db.session.get(type(booking), booking.id).status == "Requested"


# --- AC6: anyone without the Lead role is refused ---


# @story: SCRUM-88
# @ac: 6
@pytest.mark.parametrize("username", ["coord1", "org1", "venue1", "tech1", "safety1", "att1", "multi1"])
def test_an_account_without_the_lead_role_is_refused_and_nothing_is_shown(client, username):
    event("Refused Event", "Planning", "coord1")
    login(client, username)

    resp = client.get("/api/assignments")

    assert resp.status_code == 403
    assert "events" not in resp.get_json()


# @story: SCRUM-88
# @ac: 6
def test_a_logged_out_visitor_is_refused(client):
    assert client.get("/api/assignments").status_code == 401


# @story: SCRUM-88
# @ac: 6
def test_a_lead_who_is_also_a_coordinator_is_allowed(client):
    login(client, "leadcoord1")

    assert client.get("/api/assignments").status_code == 200
