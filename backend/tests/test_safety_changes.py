"""SCRUM-90: Return an Event for Safety Changes — the Safety Officer sends an
event in Safety Check back to Planning with the reason, the areas that need
changing and optional notes.

Built on SCRUM-89's decision record; these tests build the events they depend
on with tests/factories.py (docs/test-cases/AUTOMATION.md) and rely on the
seed only for the roles, the fixed lists and the accounts they log in as.
"""

from datetime import datetime

import pytest

from db import db
from factories import account, make_event
from models import EventRequest, Notification, Venue, VenueBookingRequest

NOT_IN_SAFETY_CHECK = "No event in Safety Check was found with that number."
SENT = datetime(2026, 10, 8, 9, 0)


def login_as(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def safety_event(name, **fields):
    """An event already in Safety Check, assigned to coord1 and sent on SENT."""
    fields.setdefault("assigned_coordinator", account("coord1"))
    fields.setdefault("safety_check_at", SENT)
    return make_event(
        name=name,
        status="Safety Check",
        date="2027-08-12",
        start_time="10:00",
        end_time="14:00",
        **fields,
    )


def stored(row):
    db.session.expire_all()
    return db.session.get(EventRequest, row.id)


def notification_count():
    db.session.expire_all()
    return db.session.query(Notification).count()


def request_changes(client, row, body=None):
    return client.post(f"/api/requests/{row.id}/safety/request-changes", json=body or {})


GOOD = {"reason": "Stage blocks the east exit", "areas": ["venue_arrangements", "technical_arrangements"]}


# ---- AC1, AC3, AC7: requesting changes ---------------------------------------


# @story: SCRUM-90
# @ac: 1, 3, 7
def test_request_changes_returns_the_event_to_planning_and_keeps_the_decision(client, app):
    row = safety_event("Chess Open")
    login_as(client, "safety1")
    notes = {"emergency_access": "Move the stage back"}

    reply = request_changes(client, row, {**GOOD, "reason": "  Stage blocks the east exit  ", "notes": notes})

    assert reply.status_code == 200
    assert reply.get_json()["status"] == "Planning"
    row = stored(row)
    assert row.status == "Planning"
    (decision,) = row.safety_decisions
    assert decision.decision == "Changes requested"
    assert decision.reason == "Stage blocks the east exit"
    assert decision.areas == ["venue_arrangements", "technical_arrangements"]
    assert decision.notes == notes
    assert decision.decided_by.username == "safety1"
    assert decision.decided_at is not None


# @story: SCRUM-90
# @ac: 1
@pytest.mark.parametrize("area", ["venue_arrangements", "technical_arrangements"])
def test_one_area_is_enough(client, app, area):
    row = safety_event("Spring Recital")
    login_as(client, "safety1")

    reply = request_changes(client, row, {"reason": "Needs work", "areas": [area]})

    assert reply.status_code == 200
    assert stored(row).safety_decisions[0].areas == [area]


# @story: SCRUM-90
# @ac: 1
def test_areas_are_kept_once_and_in_the_fixed_order(client, app):
    row = safety_event("Order Check")
    login_as(client, "safety1")

    request_changes(
        client,
        row,
        {
            "reason": "Needs work",
            "areas": ["technical_arrangements", "venue_arrangements", "technical_arrangements"],
        },
    )

    assert stored(row).safety_decisions[0].areas == ["venue_arrangements", "technical_arrangements"]


# @story: SCRUM-90
# @ac: 7
def test_notes_are_optional_and_blank_ones_are_dropped(client, app):
    row = safety_event("Notes Check")
    login_as(client, "safety1")

    request_changes(client, row, {**GOOD, "notes": {"attendance": "   ", "accessibility": " Ramp "}})

    assert stored(row).safety_decisions[0].notes == {"accessibility": "Ramp"}


# @story: SCRUM-90
# @ac: 7
def test_a_note_on_an_unknown_area_is_refused_and_nothing_changes(client, app):
    row = safety_event("Notes Refused")
    login_as(client, "safety1")
    before = notification_count()

    reply = request_changes(client, row, {**GOOD, "notes": {"parking": "Plenty"}})

    assert reply.status_code == 400
    assert stored(row).status == "Safety Check"
    assert stored(row).safety_decisions == []
    assert notification_count() == before


# ---- AC2: a reason and an area are required ----------------------------------


# @story: SCRUM-90
# @ac: 2
@pytest.mark.parametrize("reason", [None, "", "   ", 5])
def test_a_missing_or_blank_reason_is_refused_and_nothing_changes(client, app, reason):
    row = safety_event("Reason Refused")
    login_as(client, "safety1")
    before = notification_count()

    body = {"areas": ["venue_arrangements"]}
    if reason is not None:
        body["reason"] = reason
    reply = request_changes(client, row, body)

    assert reply.status_code == 400
    assert reply.get_json()["message"] == "A reason is required to request changes."
    assert stored(row).status == "Safety Check"
    assert stored(row).safety_decisions == []
    assert notification_count() == before


# @story: SCRUM-90
# @ac: 2
@pytest.mark.parametrize("areas", [None, [], "venue_arrangements", {"venue_arrangements": True}])
def test_no_area_is_refused_and_nothing_changes(client, app, areas):
    row = safety_event("Area Refused")
    login_as(client, "safety1")
    before = notification_count()

    body = {"reason": "Needs work"}
    if areas is not None:
        body["areas"] = areas
    reply = request_changes(client, row, body)

    assert reply.status_code == 400
    assert "area" in reply.get_json()["message"]
    assert stored(row).status == "Safety Check"
    assert stored(row).safety_decisions == []
    assert notification_count() == before


# @story: SCRUM-90
# @ac: 2
def test_an_unknown_area_is_refused_and_nothing_changes(client, app):
    row = safety_event("Unknown Area")
    login_as(client, "safety1")

    reply = request_changes(client, row, {"reason": "Needs work", "areas": ["attendance"]})

    assert reply.status_code == 400
    assert "attendance" in reply.get_json()["message"]
    assert stored(row).status == "Safety Check"


# ---- AC4: the assigned coordinator is notified -------------------------------


# @story: SCRUM-90
# @ac: 4
def test_the_assigned_coordinator_is_notified_once_with_reason_and_areas(client, app):
    row = safety_event("Dance Night")
    login_as(client, "safety1")
    before = notification_count()

    request_changes(client, row, {"reason": "Crowd flow crosses the fire exit", "areas": ["venue_arrangements", "technical_arrangements"]})

    assert notification_count() == before + 1
    note = db.session.query(Notification).order_by(Notification.id.desc()).first()
    assert note.recipient.username == "coord1"
    assert note.event_request.name == "Dance Night"
    assert note.read_at is None
    assert "Dance Night" in note.message
    assert "Crowd flow crosses the fire exit" in note.message
    assert "venue arrangements" in note.message
    assert "technical arrangements" in note.message


# @story: SCRUM-90
# @ac: 4
def test_only_the_coordinator_assigned_at_that_moment_is_notified(client, app):
    row = safety_event("Other Coordinator", assigned_coordinator=account("coord2"))
    login_as(client, "safety1")

    request_changes(client, row, GOOD)

    note = db.session.query(Notification).order_by(Notification.id.desc()).first()
    assert note.recipient.username == "coord2"


# @story: SCRUM-90
# @ac: 4
def test_with_no_assigned_coordinator_the_request_still_goes_through(client, app):
    row = safety_event("Nobody Assigned", assigned_coordinator=None)
    login_as(client, "safety1")
    before = notification_count()

    reply = request_changes(client, row, GOOD)

    assert reply.status_code == 200
    assert stored(row).status == "Planning"
    assert notification_count() == before


# ---- AC5: the coordinator sees what is outstanding ---------------------------


# @story: SCRUM-90
# @ac: 5
def test_the_coordinator_sees_the_requested_changes_while_the_event_is_in_planning(client, app):
    row = safety_event("Maker Faire")
    login_as(client, "safety1")
    request_changes(client, row, {"reason": "Stalls block the fire lane", "areas": ["venue_arrangements"], "notes": {"crowd_movement": "One way"}})
    login_as(client, "coord1")

    body = client.get(f"/api/requests/{row.id}").get_json()

    assert body["status"] == "Planning"
    assert body["requested_changes"]["reason"] == "Stalls block the fire lane"
    assert body["requested_changes"]["areas"] == ["venue_arrangements"]
    assert body["requested_changes"]["notes"] == {"crowd_movement": "One way"}
    assert body["requested_changes"]["decided_by"] == "safety1"


# @story: SCRUM-90
# @ac: 5
def test_the_requested_changes_clear_once_the_event_is_sent_again(client, app):
    row = safety_event("Sent Again")
    login_as(client, "safety1")
    request_changes(client, row, GOOD)

    # What SCRUM-53 will do: send it for safety check again, which records a
    # later sent time. The outstanding changes are derived from that time, so
    # nothing else has to clear them.
    row = stored(row)
    row.safety_check_at = datetime(2030, 1, 1, 9, 0)
    db.session.commit()

    login_as(client, "coord1")
    assert client.get(f"/api/requests/{row.id}").get_json()["requested_changes"] is None
    row.status = "Safety Check"
    db.session.commit()
    assert client.get(f"/api/requests/{row.id}").get_json()["requested_changes"] is None


# @story: SCRUM-90
# @ac: 5
def test_a_rejection_is_not_shown_as_requested_changes(client, app):
    row = safety_event("Rejected Not Changes")
    login_as(client, "safety1")
    client.post(f"/api/requests/{row.id}/safety/reject", json={"reason": "No"})
    login_as(client, "coord1")

    assert client.get(f"/api/requests/{row.id}").get_json()["requested_changes"] is None


# @story: SCRUM-90
# @ac: 5
def test_the_requested_changes_are_not_shown_to_an_organiser(client, app):
    row = safety_event("Organiser View")
    login_as(client, "safety1")
    request_changes(client, row, GOOD)
    login_as(client, "org1")

    body = client.get(f"/api/requests/{row.id}").get_json()

    assert "requested_changes" not in body
    assert "safety_decisions" not in body


# ---- AC6: nothing else about the event changes -------------------------------


# @story: SCRUM-90
# @ac: 6
def test_the_events_information_and_bookings_are_unchanged(client, app):
    row = safety_event("Chess Open Two", purpose="Open tournament", attendance=90)
    booking = VenueBookingRequest(
        venue=db.session.query(Venue).filter_by(name="Auditorium").one(),
        event_request=row,
        status="Approved",
        date=row.date,
        start_time=row.start_time,
        end_time=row.end_time,
        attendance=row.attendance,
        raised_by=account("coord1"),
        raised_at=datetime(2026, 9, 25, 9, 0),
    )
    db.session.add(booking)
    db.session.commit()
    login_as(client, "safety1")

    request_changes(client, row, GOOD)

    row = stored(row)
    assert (row.name, row.purpose, row.date, row.start_time, row.end_time, row.attendance) == (
        "Chess Open Two",
        "Open tournament",
        "2027-08-12",
        "10:00",
        "14:00",
        90,
    )
    assert row.assigned_coordinator.username == "coord1"
    assert [item.status for item in row.booking_requests] == ["Approved"]


# ---- AC7: the decision is visible with the earlier ones ----------------------


# @story: SCRUM-90
# @ac: 7
def test_the_decision_appears_with_the_earlier_ones_when_the_event_is_next_in_safety_check(client, app):
    row = safety_event("Second Round")
    login_as(client, "safety1")
    client.post(f"/api/requests/{row.id}/safety/reject", json={"reason": "First problem"})
    row = stored(row)
    row.status = "Safety Check"
    row.safety_check_at = datetime(2026, 10, 9, 9, 0)
    db.session.commit()
    request_changes(client, row, {"reason": "Second problem", "areas": ["technical_arrangements"]})
    row = stored(row)
    row.status = "Safety Check"
    row.safety_check_at = datetime(2026, 10, 10, 9, 0)
    db.session.commit()

    body = client.get(f"/api/requests/{row.id}").get_json()

    assert [(item["decision"], item["reason"]) for item in body["safety_decisions"]] == [
        ("Rejected", "First problem"),
        ("Changes requested", "Second problem"),
    ]
    assert body["safety_decisions"][1]["areas"] == ["technical_arrangements"]
    assert body["safety_decisions"][0]["areas"] == []


# ---- AC8: only an event in Safety Check --------------------------------------


# @story: SCRUM-90
# @ac: 8
@pytest.mark.parametrize("status", ["Planning", "Confirmed", "Submitted", "Cancelled"])
def test_an_event_not_in_safety_check_is_refused_and_nothing_changes(client, app, status):
    row = make_event(name="Out Of Scope", status=status, date="2027-08-12", start_time="10:00", end_time="12:00")
    login_as(client, "safety1")
    before = notification_count()

    reply = request_changes(client, row, GOOD)

    assert reply.status_code == 404
    assert reply.get_json()["message"] == NOT_IN_SAFETY_CHECK
    assert stored(row).status == status
    assert stored(row).safety_decisions == []
    assert notification_count() == before


# @story: SCRUM-90
# @ac: 8
def test_a_second_request_on_the_same_event_is_refused(client, app):
    row = safety_event("Quiz Night")
    login_as(client, "safety1")
    assert request_changes(client, row, GOOD).status_code == 200
    before = notification_count()

    reply = request_changes(client, row, GOOD)

    assert reply.status_code == 404
    assert reply.get_json()["message"] == NOT_IN_SAFETY_CHECK
    assert len(stored(row).safety_decisions) == 1
    assert notification_count() == before


# @story: SCRUM-90
# @ac: 8
def test_an_unknown_event_says_the_same_thing(client, app):
    login_as(client, "safety1")

    reply = client.post("/api/requests/99999/safety/request-changes", json=GOOD)

    assert reply.status_code == 404
    assert reply.get_json()["message"] == NOT_IN_SAFETY_CHECK


# ---- AC9: only a Safety Officer ----------------------------------------------


# @story: SCRUM-90
# @ac: 9
@pytest.mark.parametrize("username", ["coord1", "org1", "venue1", "tech1", "att1", "multi1"])
def test_no_other_role_can_request_changes_and_nothing_changes(client, app, username):
    row = safety_event("Not Yours")
    login_as(client, username)
    before = notification_count()

    reply = request_changes(client, row, GOOD)

    assert reply.status_code == 403
    assert stored(row).status == "Safety Check"
    assert stored(row).safety_decisions == []
    assert notification_count() == before


# @story: SCRUM-90
# @ac: 9
def test_requesting_changes_needs_login(client, app):
    row = safety_event("Logged Out")

    assert request_changes(client, row, GOOD).status_code == 401
    assert stored(row).status == "Safety Check"
