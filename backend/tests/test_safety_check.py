"""SCRUM-89: Operational Safety Check — the Safety Officer reviews an event in
Safety Check, notes it area by area, and approves or rejects it.

Requesting changes is SCRUM-90 and moving an event into Safety Check is
SCRUM-53; the seed data holds four events already in Safety Check.
"""

from datetime import datetime

import pytest

from db import db
from models import (
    Account,
    EventRequest,
    Notification,
    RoomLayout,
    Venue,
    VenueBookingRequest,
)
from permissions import features_for

NOT_IN_SAFETY_CHECK = "No event in Safety Check was found with that number."

# The events seed/data.json holds in Safety Check; SCRUM-53 is what will move
# real events there.
SEEDED_IN_SAFETY_CHECK = {
    "Harbour Gala",
    "Night Market",
    "Tech Summit",
    "Lantern Fair",
    "Book Fair",
    "Garden Concert",
    "Robotics Expo",
    "Film Night",
    "Chess Open",
    "Spring Recital",
    "Dance Night",
    "Maker Faire",
    "Jazz Brunch",
    "Quiz Night",
}


def login_as(client, app, username):
    account_id = db.session.query(Account).filter_by(username=username).one().id
    with client.session_transaction() as session:
        session["account_id"] = account_id
    return account_id


def event(name):
    db.session.expire_all()
    return db.session.query(EventRequest).filter_by(name=name).one()


def decisions(name):
    return list(event(name).safety_decisions)


def notification_count():
    db.session.expire_all()
    return db.session.query(Notification).count()


def make_event(name, status, **extra):
    owner = db.session.query(Account).filter_by(username="org1").one()
    row = EventRequest(
        name=name,
        purpose="Test purpose",
        description="Test description",
        date="2027-08-01",
        start_time="10:00",
        end_time="12:00",
        attendance=40,
        equipment_requirements="None",
        registration_needs="None",
        created_by=owner,
        status=status,
        **extra,
    )
    db.session.add(row)
    db.session.commit()
    return row


def add_booking(event_name, venue_name, status):
    """A booking request on a standing event; the pytest seed holds none."""
    row = event(event_name)
    booking = VenueBookingRequest(
        venue=db.session.query(Venue).filter_by(name=venue_name).one(),
        event_request=row,
        status=status,
        date=row.date,
        start_time=row.start_time,
        end_time=row.end_time,
        attendance=row.attendance,
        raised_by=row.assigned_coordinator,
        raised_at=datetime(2026, 9, 25, 9, 0),
    )
    db.session.add(booking)
    db.session.commit()
    return booking


def approve(client, name, body=None):
    return client.post(f"/api/requests/{event(name).id}/safety/approve", json=body or {})


def reject(client, name, body=None):
    return client.post(f"/api/requests/{event(name).id}/safety/reject", json=body or {})


# ---- AC1: the role and one seeded account ------------------------------------


# @story: SCRUM-89
# @ac: 1
def test_seed_holds_the_safety_officer_role_and_exactly_one_account(app):
    holders = db.session.query(Account).all()
    safety = [account for account in holders if account.has_role("Safety Officer")]
    assert [account.username for account in safety] == ["safety1"]
    assert safety[0].role_names == ["Safety Officer"]


# @story: SCRUM-89
# @ac: 1
def test_safety_officer_may_view_requests_decide_and_read_notifications_only(app):
    account = db.session.query(Account).filter_by(username="safety1").one()
    assert features_for(account) == ["notifications.view", "requests.view", "safety.decide"]


# @story: SCRUM-89
# @ac: 1
def test_login_of_the_safety_officer_reports_the_role_and_features(client, app):
    reply = client.post("/api/login", json={"username": "safety1", "password": "Passw0rd!"})
    body = reply.get_json()
    assert reply.status_code == 200
    assert body["roles"] == ["Safety Officer"]
    assert "safety.decide" in body["features"]


# ---- AC2: the list, longest in Safety Check first -----------------------------


# @story: SCRUM-89
# @ac: 2
def test_list_shows_events_in_safety_check_longest_first(client, app):
    login_as(client, app, "safety1")
    names = [row["name"] for row in client.get("/api/requests").get_json()]
    assert names == [
        "Harbour Gala",
        "Night Market",
        "Tech Summit",
        "Lantern Fair",
        "Book Fair",
        "Garden Concert",
        "Robotics Expo",
        "Film Night",
        "Chess Open",
        "Spring Recital",
        "Dance Night",
        "Maker Faire",
        "Jazz Brunch",
        "Quiz Night",
    ]


# @story: SCRUM-89
# @ac: 2
def test_list_order_follows_when_each_event_was_sent(client, app):
    row = event("Lantern Fair")
    row.safety_check_at = datetime(2026, 9, 1, 8, 0)
    db.session.commit()
    login_as(client, app, "safety1")
    names = [item["name"] for item in client.get("/api/requests").get_json()]
    assert names[0] == "Lantern Fair"


# @story: SCRUM-89
# @ac: 2
def test_list_leaves_out_every_other_status(client, app):
    for status in ("Planning", "Confirmed", "Submitted", "Draft", "Cancelled"):
        make_event(f"Extra {status}", status)
    login_as(client, app, "safety1")
    names = {row["name"] for row in client.get("/api/requests").get_json()}
    assert names == SEEDED_IN_SAFETY_CHECK


# @story: SCRUM-89
# @ac: 2
def test_list_is_empty_when_nothing_is_in_safety_check(client, app):
    for name in SEEDED_IN_SAFETY_CHECK:
        row = event(name)
        row.status = "Planning"
        db.session.commit()
    login_as(client, app, "safety1")
    assert client.get("/api/requests").get_json() == []


# @story: SCRUM-89
# @ac: 2
def test_coordinator_list_still_shows_every_status_but_draft(client, app):
    login_as(client, app, "coord1")
    names = {row["name"] for row in client.get("/api/requests").get_json()}
    assert {"Harbour Gala", "Annual Dinner", "Open House"} <= names
    assert "Design Workshop" not in names


# ---- AC3: opening an event ----------------------------------------------------


# @story: SCRUM-89
# @ac: 3
def test_detail_shows_attendance_date_times_and_accessibility_needs(client, app):
    login_as(client, app, "safety1")
    body = client.get(f"/api/requests/{event('Harbour Gala').id}").get_json()
    assert body["attendance"] == 150
    assert (body["date"], body["start_time"], body["end_time"]) == ("2027-06-10", "18:00", "22:00")
    assert body["accessibility_features"] == ["Step-free access", "Hearing loop"]
    assert body["status"] == "Safety Check"


# @story: SCRUM-89
# @ac: 3
def test_detail_shows_each_approved_booking_with_the_venues_details(client, app):
    venue = add_booking("Harbour Gala", "Auditorium", "Approved").venue
    venue.layouts = [db.session.query(RoomLayout).filter_by(name="Banquet").one()]
    db.session.commit()
    login_as(client, app, "safety1")
    body = client.get(f"/api/requests/{event('Harbour Gala').id}").get_json()
    bookings = body["safety_check"]["venue_bookings"]
    assert len(bookings) == 1
    booked = bookings[0]
    assert booked["venue"]["name"] == "Auditorium"
    assert booked["venue"]["max_capacity"] == 400
    assert booked["venue"]["layouts"] == ["Banquet"]
    assert booked["venue"]["facilities"] == ["Projector", "Stage lighting", "Sound system"]
    assert booked["venue"]["accessibility_features"] == [
        "Step-free access",
        "Hearing loop",
        "Accessible toilet",
        "Reserved seating",
    ]
    assert (booked["date"], booked["start_time"], booked["end_time"]) == (
        "2027-06-10",
        "18:00",
        "22:00",
    )


# @story: SCRUM-89
# @ac: 3
def test_detail_leaves_out_a_booking_that_is_not_approved(client, app):
    add_booking("Night Market", "Seminar Room 1", "Approved")
    add_booking("Night Market", "Auditorium", "Rejected")
    login_as(client, app, "safety1")
    body = client.get(f"/api/requests/{event('Night Market').id}").get_json()
    venues = [booked["venue"]["name"] for booked in body["safety_check"]["venue_bookings"]]
    assert venues == ["Seminar Room 1"]
    statuses = {row.status for row in event("Night Market").booking_requests}
    assert statuses == {"Approved", "Rejected"}


# @story: SCRUM-89
# @ac: 3
def test_detail_shows_the_date_and_time_the_event_was_sent(client, app):
    login_as(client, app, "safety1")
    body = client.get(f"/api/requests/{event('Harbour Gala').id}").get_json()
    assert body["safety_check"]["sent_at"].startswith("2026-10-08T09:00")


# @story: SCRUM-89
# @ac: 3
# STUB: equipment requirements arrive with SCRUM-48 and SCRUM-81 (Hong Yi). Until
# then nothing is recorded, so the list is empty; see _approved_equipment_requirements.
def test_detail_lists_no_equipment_until_requirements_exist(client, app):
    login_as(client, app, "safety1")
    body = client.get(f"/api/requests/{event('Harbour Gala').id}").get_json()
    assert body["safety_check"]["equipment_requirements"] == []


# @story: SCRUM-89
# @ac: 3
@pytest.mark.skip(reason="PENDING SCRUM-48 and SCRUM-81: needs equipment requirements to exist")
def test_detail_shows_each_approved_equipment_requirement_and_not_others(client, app):
    raise AssertionError("replace the stub in _approved_equipment_requirements and prove this")


# @story: SCRUM-89
# @ac: 3
def test_event_not_in_safety_check_cannot_be_opened(client, app):
    make_event("Quiet Planning", "Planning")
    login_as(client, app, "safety1")
    for name in ("Open House", "Quiet Planning", "Annual Dinner", "Design Workshop"):
        reply = client.get(f"/api/requests/{event(name).id}")
        assert reply.status_code == 403, name
        assert set(reply.get_json()) == {"message"}, name


# @story: SCRUM-89
# @ac: 3
def test_unknown_event_is_not_found(client, app):
    login_as(client, app, "safety1")
    assert client.get("/api/requests/99999").status_code == 404


# ---- AC4, AC5, AC6: approving, with optional notes ----------------------------


# @story: SCRUM-89
# @ac: 4, 5, 6
def test_approve_confirms_the_event_and_keeps_the_decision_with_its_notes(client, app):
    login_as(client, app, "safety1")
    notes = {"emergency_access": "Two exits clear", "crowd_movement": "One-way flow at the foyer"}
    reply = approve(client, "Harbour Gala", {"notes": notes})
    assert reply.status_code == 200
    assert reply.get_json()["status"] == "Confirmed"
    assert event("Harbour Gala").status == "Confirmed"
    (decision,) = decisions("Harbour Gala")
    assert decision.decision == "Approved"
    assert decision.reason is None
    assert decision.notes == notes
    assert decision.decided_by.username == "safety1"
    assert decision.decided_at is not None


# @story: SCRUM-89
# @ac: 4
def test_a_note_is_optional(client, app):
    login_as(client, app, "safety1")
    assert approve(client, "Tech Summit").status_code == 200
    assert event("Tech Summit").status == "Confirmed"
    assert decisions("Tech Summit")[0].notes == {}


# @story: SCRUM-89
# @ac: 4
def test_a_blank_note_is_not_kept(client, app):
    login_as(client, app, "safety1")
    notes = {"attendance": "   ", "accessibility": "Ramp at the east door "}
    assert approve(client, "Tech Summit", {"notes": notes}).status_code == 200
    assert decisions("Tech Summit")[0].notes == {"accessibility": "Ramp at the east door"}


# @story: SCRUM-89
# @ac: 4
def test_each_of_the_seven_areas_takes_a_note(client, app):
    areas = [
        "attendance",
        "capacity_and_layout",
        "emergency_access",
        "accessibility",
        "equipment_placement",
        "crowd_movement",
        "venue_restrictions",
    ]
    login_as(client, app, "safety1")
    notes = {area: f"note about {area}" for area in areas}
    assert approve(client, "Tech Summit", {"notes": notes}).status_code == 200
    assert decisions("Tech Summit")[0].notes == notes


# @story: SCRUM-89
# @ac: 4
def test_a_note_on_an_unknown_area_is_refused_and_nothing_changes(client, app):
    login_as(client, app, "safety1")
    before = notification_count()
    reply = approve(client, "Tech Summit", {"notes": {"parking": "Plenty"}})
    assert reply.status_code == 400
    assert "parking" in reply.get_json()["message"]
    assert event("Tech Summit").status == "Safety Check"
    assert decisions("Tech Summit") == []
    assert notification_count() == before


# @story: SCRUM-89
# @ac: 4
def test_notes_that_are_not_text_are_refused(client, app):
    login_as(client, app, "safety1")
    assert approve(client, "Tech Summit", {"notes": ["emergency_access"]}).status_code == 400
    assert approve(client, "Tech Summit", {"notes": {"attendance": 12}}).status_code == 400
    assert event("Tech Summit").status == "Safety Check"
    assert decisions("Tech Summit") == []


# ---- AC5, AC7: rejecting ------------------------------------------------------


# @story: SCRUM-89
# @ac: 5, 7
def test_reject_returns_the_event_to_planning_with_the_reason_kept(client, app):
    login_as(client, app, "safety1")
    reply = reject(
        client,
        "Harbour Gala",
        {"reason": "  Exit route blocked by stage  ", "notes": {"emergency_access": "Stage blocks"}},
    )
    assert reply.status_code == 200
    assert reply.get_json()["status"] == "Planning"
    assert event("Harbour Gala").status == "Planning"
    (decision,) = decisions("Harbour Gala")
    assert decision.decision == "Rejected"
    assert decision.reason == "Exit route blocked by stage"
    assert decision.notes == {"emergency_access": "Stage blocks"}
    assert decision.decided_by.username == "safety1"


# @story: SCRUM-89
# @ac: 5
@pytest.mark.parametrize("body", [{}, {"reason": ""}, {"reason": "   "}, {"reason": None}])
def test_reject_without_a_reason_is_refused_and_nothing_changes(client, app, body):
    login_as(client, app, "safety1")
    before = notification_count()
    reply = reject(client, "Harbour Gala", body)
    assert reply.status_code == 400
    assert reply.get_json()["message"] == "A reason is required to reject."
    assert event("Harbour Gala").status == "Safety Check"
    assert decisions("Harbour Gala") == []
    assert notification_count() == before


# @story: SCRUM-89
# @ac: 5
def test_earlier_decisions_stay_visible_and_new_ones_are_added(client, app):
    login_as(client, app, "safety1")
    seen = client.get(f"/api/requests/{event('Lantern Fair').id}").get_json()
    assert [(row["decision"], row["reason"]) for row in seen["safety_decisions"]] == [
        ("Rejected", "Exits not marked")
    ]
    assert seen["safety_decisions"][0]["decided_by"] == "safety1"

    assert approve(client, "Lantern Fair").status_code == 200
    after = [row.decision for row in decisions("Lantern Fair")]
    assert after == ["Rejected", "Approved"]


# @story: SCRUM-89
# @ac: 5
def test_the_assigned_coordinator_sees_the_decisions_on_the_event(client, app):
    login_as(client, app, "coord1")
    body = client.get(f"/api/requests/{event('Lantern Fair').id}").get_json()
    assert [row["reason"] for row in body["safety_decisions"]] == ["Exits not marked"]
    assert "safety_check" not in body


# @story: SCRUM-89
# @ac: 5
def test_a_decision_is_not_shown_to_an_organiser(client, app):
    login_as(client, app, "org1")
    body = client.get(f"/api/requests/{event('Harbour Gala').id}").get_json()
    assert "safety_decisions" not in body
    assert "safety_check" not in body


# ---- AC8: the assigned coordinator is told ------------------------------------


# @story: SCRUM-89
# @ac: 8
def test_approval_notifies_the_assigned_coordinator_once(client, app):
    login_as(client, app, "safety1")
    before = notification_count()
    approve(client, "Harbour Gala")
    assert notification_count() == before + 1
    row = db.session.query(Notification).order_by(Notification.id.desc()).first()
    assert row.recipient.username == "coord1"
    assert row.event_request.name == "Harbour Gala"
    assert row.read_at is None
    assert "Harbour Gala" in row.message
    assert "Confirmed" in row.message


# @story: SCRUM-89
# @ac: 8
def test_rejection_notifies_the_assigned_coordinator_with_the_reason(client, app):
    login_as(client, app, "safety1")
    before = notification_count()
    reject(client, "Night Market", {"reason": "Exit route blocked by stage"})
    assert notification_count() == before + 1
    row = db.session.query(Notification).order_by(Notification.id.desc()).first()
    assert row.recipient.username == "coord2"
    assert "Night Market" in row.message
    assert "Exit route blocked by stage" in row.message


# @story: SCRUM-89
# @ac: 8
def test_the_notification_reaches_the_coordinator_through_my_notifications(client, app):
    login_as(client, app, "safety1")
    reject(client, "Harbour Gala", {"reason": "Exit route blocked by stage"})
    login_as(client, app, "coord1")
    rows = client.get("/api/notifications").get_json()
    assert any("Exit route blocked by stage" in row["message"] for row in rows)


# @story: SCRUM-89
# @ac: 8
def test_a_decision_with_no_assigned_coordinator_still_goes_through(client, app):
    event("Tech Summit").assigned_coordinator = None
    db.session.commit()
    login_as(client, app, "safety1")
    before = notification_count()
    assert approve(client, "Tech Summit").status_code == 200
    assert event("Tech Summit").status == "Confirmed"
    assert notification_count() == before


# ---- AC9: only an event in Safety Check can be decided ------------------------


# @story: SCRUM-89
# @ac: 9
@pytest.mark.parametrize("status", ["Planning", "Confirmed", "Submitted", "Cancelled"])
def test_deciding_an_event_not_in_safety_check_is_refused_and_nothing_changes(client, app, status):
    make_event("Out Of Scope", status)
    login_as(client, app, "safety1")
    before = notification_count()
    for send in (approve, lambda c, n: reject(c, n, {"reason": "Because"})):
        reply = send(client, "Out Of Scope")
        assert reply.status_code == 404
        assert reply.get_json()["message"] == NOT_IN_SAFETY_CHECK
    assert event("Out Of Scope").status == status
    assert decisions("Out Of Scope") == []
    assert notification_count() == before


# @story: SCRUM-89
# @ac: 9
def test_a_second_decision_on_the_same_event_is_refused(client, app):
    login_as(client, app, "safety1")
    assert approve(client, "Harbour Gala").status_code == 200
    before = notification_count()
    reply = reject(client, "Harbour Gala", {"reason": "Changed my mind"})
    assert reply.status_code == 404
    assert reply.get_json()["message"] == NOT_IN_SAFETY_CHECK
    assert event("Harbour Gala").status == "Confirmed"
    assert [row.decision for row in decisions("Harbour Gala")] == ["Approved"]
    assert notification_count() == before


# @story: SCRUM-89
# @ac: 9
def test_deciding_an_unknown_event_says_the_same_thing(client, app):
    login_as(client, app, "safety1")
    reply = client.post("/api/requests/99999/safety/approve", json={})
    assert reply.status_code == 404
    assert reply.get_json()["message"] == NOT_IN_SAFETY_CHECK


# ---- AC10: only a Safety Officer decides, and cannot edit ---------------------


# @story: SCRUM-89
# @ac: 10
@pytest.mark.parametrize("username", ["coord1", "org1", "venue1", "tech1", "att1", "multi1"])
def test_no_other_role_can_decide_and_nothing_changes(client, app, username):
    login_as(client, app, username)
    before = notification_count()
    assert approve(client, "Harbour Gala").status_code == 403
    assert reject(client, "Harbour Gala", {"reason": "No"}).status_code == 403
    assert event("Harbour Gala").status == "Safety Check"
    assert decisions("Harbour Gala") == []
    assert notification_count() == before


# @story: SCRUM-89
# @ac: 10
def test_a_decision_needs_login(client, app):
    reply = approve(client, "Harbour Gala")
    assert reply.status_code == 401
    assert event("Harbour Gala").status == "Safety Check"


# @story: SCRUM-89
# @ac: 10
def test_an_account_holding_two_roles_may_decide_if_one_of_them_allows_it(client, app):
    account = db.session.query(Account).filter_by(username="multi1").one()
    account.roles = account.roles + db.session.query(Account).filter_by(
        username="safety1"
    ).one().roles
    db.session.commit()
    login_as(client, app, "multi1")
    assert approve(client, "Tech Summit").status_code == 200
    assert event("Tech Summit").status == "Confirmed"


# @story: SCRUM-89
# @ac: 10
def test_safety_officer_cannot_edit_the_event_or_its_arrangements(client, app):
    booking = add_booking("Harbour Gala", "Auditorium", "Approved")
    row = event("Harbour Gala")
    venue_id = booking.venue_id
    booking_id = booking.id
    login_as(client, app, "safety1")

    assert client.put(f"/api/requests/{row.id}", json={"name": "Renamed"}).status_code == 403
    assert client.post(f"/api/requests/{row.id}/approve", json={}).status_code == 403
    assert client.post(f"/api/requests/{row.id}/reject", json={"reason": "x"}).status_code == 403
    raised = client.post(f"/api/requests/{row.id}/bookings", json={"venue_id": venue_id})
    assert raised.status_code == 403
    withdrawn = client.post(f"/api/venues/{venue_id}/bookings/{booking_id}/withdraw", json={})
    assert withdrawn.status_code == 403

    row = event("Harbour Gala")
    assert row.name == "Harbour Gala"
    assert row.status == "Safety Check"
    booking = db.session.get(VenueBookingRequest, booking_id)
    assert booking.status == "Approved"
