"""SCRUM-52: Withdraw Equipment from Service — Technical Support Staff take
units of a type out of service with a reason and return them.

Rules under test: the reason and quantity checks (AC1, AC2, AC6), a
withdrawal never touching a reservation (AC2, AC5), the events left short and
their coordinators' notifications (AC4), the history record, the total's new
minimum (AC7) and who may withdraw or return (AC8). Units out of service in
availability and reserving (AC3) are proved in test_equipment_availability.py
and here through the reserve endpoint. Every type, event and reservation is
built with tests/factories.py; the clock is pinned to 1 Dec 2026, 09:00.
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy import func

import clock
from db import db
from factories import (
    account,
    make_equipment_requirement,
    make_equipment_type,
    make_event,
    make_reservation,
)
from models import EquipmentServiceChange, EquipmentType, EventRequest, Notification, Reservation

NOW = datetime(2026, 12, 1, 9, 0)


SEEDED_NOTIFICATIONS = {"last": 0}


@pytest.fixture(autouse=True)
def _pinned_clock(app, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)
    SEEDED_NOTIFICATIONS["last"] = db.session.query(func.max(Notification.id)).scalar() or 0


def login_as(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def withdraw(client, equipment, quantity, reason="Cone damaged", username="tech1"):
    login_as(client, username)
    return client.post(f"/api/equipment/{equipment.id}/withdraw",
                       json={"quantity": quantity, "reason": reason})


def give_back(client, equipment, quantity, username="tech1"):
    login_as(client, username)
    return client.post(f"/api/equipment/{equipment.id}/return", json={"quantity": quantity})


def out_of_service(equipment):
    db.session.expire_all()
    return db.session.get(EquipmentType, equipment.id).out_of_service_units


def history(equipment):
    db.session.expire_all()
    return db.session.query(EquipmentServiceChange).filter_by(
        equipment_type_id=equipment.id).order_by(EquipmentServiceChange.id).all()


def reservations_snapshot():
    db.session.expire_all()
    return [(row.id, row.event_request_id, row.quantity, row.date, row.start_time, row.end_time, row.status)
            for row in db.session.query(Reservation).order_by(Reservation.id)]


def notifications_of(username):
    """The account's notifications created since the test began (the seed has standing ones)."""
    db.session.expire_all()
    return db.session.query(Notification).filter(
        Notification.recipient_id == account(username).id,
        Notification.id > SEEDED_NOTIFICATIONS["last"],
    ).order_by(Notification.id).all()


def booked(equipment, name, date, start, end, quantity, coordinator="coord1", status="Planning"):
    """An event of the coordinator's with a Reserved reservation of the type."""
    event = make_event(name=name, status=status, date=date, start_time=start, end_time=end,
                       assigned_coordinator=account(coordinator) if coordinator else None)
    make_reservation(event=event, equipment=equipment, quantity=quantity)
    return event


@pytest.fixture
def speakers(app):
    """The curated rows' Stage Speakers: 8 units, four events reserving them."""
    equipment = make_equipment_type(name="Stage Speakers", total_units=8)
    booked(equipment, "Stage Show", "2026-12-05", "10:00", "12:00", 5, "coord1", "Confirmed")
    booked(equipment, "Late Panel", "2026-12-05", "11:00", "13:00", 2, "coord2")
    booked(equipment, "Morning Talk", "2026-12-06", "09:00", "11:00", 7, "coord1")
    booked(equipment, "Small Meetup", "2026-12-07", "14:00", "15:00", 2, "coord2")
    return equipment


def event_id(name):
    return db.session.query(EventRequest).filter_by(name=name).one().id


# ---- AC1: a reason is required -----------------------------------------------

# @story: SCRUM-52
# @ac: 1
@pytest.mark.parametrize("reason", ["", "   ", None])
def test_a_withdrawal_without_a_reason_is_refused_and_changes_nothing(client, reason):
    equipment = make_equipment_type(name="Reasonless Speakers", total_units=8)

    resp = withdraw(client, equipment, 1, reason=reason)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A reason is required."
    assert out_of_service(equipment) == 0
    assert history(equipment) == []


# @story: SCRUM-52
# @ac: 1
def test_a_withdrawal_with_no_body_is_refused_for_its_reason(client):
    equipment = make_equipment_type(name="Bodiless Speakers", total_units=8)
    login_as(client, "tech1")

    resp = client.post(f"/api/equipment/{equipment.id}/withdraw", data="not json")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A reason is required."
    assert out_of_service(equipment) == 0


# ---- AC1, AC2: the quantity --------------------------------------------------

# @story: SCRUM-52
# @ac: 2
@pytest.mark.parametrize("quantity", [0, 9, "9", 1.5, "1.5", "", "two", True, None, -1])
def test_a_withdrawal_outside_one_to_the_units_in_service_is_refused(client, quantity):
    equipment = make_equipment_type(name="Bounded Speakers", total_units=8)

    resp = withdraw(client, equipment, quantity)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Quantity must be a whole number from 1 to 8."
    assert out_of_service(equipment) == 0
    assert history(equipment) == []


# @story: SCRUM-52
# @ac: 2
def test_the_most_that_can_be_withdrawn_is_what_is_still_in_service(client):
    # 8 total, 3 already out of service: 5 in service, so 6 is one too many.
    equipment = make_equipment_type(name="Half Speakers", total_units=8, out_of_service_units=3)

    resp = withdraw(client, equipment, 6)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Quantity must be a whole number from 1 to 5."
    assert out_of_service(equipment) == 3


# @story: SCRUM-52
# @ac: 1, 2
@pytest.mark.parametrize("quantity, expected", [(1, 1), ("8", 8), (2.0, 2)])
def test_a_withdrawal_from_one_to_all_units_in_service_is_accepted(client, quantity, expected):
    equipment = make_equipment_type(name="Accepted Speakers", total_units=8)

    resp = withdraw(client, equipment, quantity)

    assert resp.status_code == 200
    assert resp.get_json() == {
        "equipment": {"id": equipment.id, "name": "Accepted Speakers", "description": "", "location": "",
                      "total_units": 8, "out_of_service_units": expected},
        "shortfalls": [],
    }
    assert out_of_service(equipment) == expected


# @story: SCRUM-52
# @ac: 2
def test_nothing_can_be_withdrawn_once_every_unit_is_out_of_service(client):
    equipment = make_equipment_type(name="Empty Speakers", total_units=2)
    assert withdraw(client, equipment, 2).status_code == 200

    resp = withdraw(client, equipment, 1)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "No units of Empty Speakers are in service to withdraw."
    assert out_of_service(equipment) == 2
    assert len(history(equipment)) == 1


# @story: SCRUM-52
# @ac: 2
def test_a_type_with_no_units_at_all_has_none_in_service_to_withdraw(client):
    equipment = make_equipment_type(name="Zero Speakers", total_units=0)

    resp = withdraw(client, equipment, 1)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "No units of Zero Speakers are in service to withdraw."
    assert out_of_service(equipment) == 0
    assert history(equipment) == []


# @story: SCRUM-52
# @ac: 2
def test_with_one_unit_in_service_the_quantity_refusal_names_one(client):
    # 8 total, 7 out of service: 1 in service, so 2 is one too many.
    equipment = make_equipment_type(name="Last Speaker", total_units=8, out_of_service_units=7)

    resp = withdraw(client, equipment, 2)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Quantity must be a whole number from 1 to 1."
    assert out_of_service(equipment) == 7


# ---- AC2, AC5: reservations are never touched --------------------------------

# @story: SCRUM-52
# @ac: 2, 5
def test_a_withdrawal_leaving_fewer_in_service_than_reserved_is_allowed_and_changes_no_reservation(
        client, speakers):
    before = reservations_snapshot()

    # 8 - 2 = 6 in service, while 7 are reserved at the same time on 5 Dec.
    resp = withdraw(client, speakers, 2, reason="Water damage")

    assert resp.status_code == 200
    assert out_of_service(speakers) == 2
    assert reservations_snapshot() == before


# ---- AC4: the events left short ----------------------------------------------

# @story: SCRUM-52
# @ac: 4
def test_every_event_the_units_in_service_no_longer_cover_is_listed_once(client, speakers):
    # 6 in service. Stage Show 10-12 overlaps Late Panel 11-13: 5 + 2 = 7 > 6,
    # so both are short. Morning Talk alone holds 7 > 6. Small Meetup's 2 fits.
    resp = withdraw(client, speakers, 2, reason="Water damage")

    assert resp.get_json()["shortfalls"] == [
        {"event_request_id": event_id("Stage Show"), "name": "Stage Show", "date": "2026-12-05",
         "start_time": "10:00", "end_time": "12:00", "reserved_units": 5, "coordinator": "coord1"},
        {"event_request_id": event_id("Late Panel"), "name": "Late Panel", "date": "2026-12-05",
         "start_time": "11:00", "end_time": "13:00", "reserved_units": 2, "coordinator": "coord2"},
        {"event_request_id": event_id("Morning Talk"), "name": "Morning Talk", "date": "2026-12-06",
         "start_time": "09:00", "end_time": "11:00", "reserved_units": 7, "coordinator": "coord1"},
    ]


# @story: SCRUM-52
# @ac: 4
def test_a_withdrawal_that_still_covers_the_peak_lists_no_event(client, speakers):
    # 7 in service covers Stage Show + Late Panel's 7 and Morning Talk's 7.
    resp = withdraw(client, speakers, 1)

    assert resp.get_json()["shortfalls"] == []
    assert notifications_of("coord1") == []
    assert notifications_of("coord2") == []


# @story: SCRUM-52
# @ac: 4
def test_reservations_that_only_together_exceed_the_units_in_service_are_both_listed(client):
    equipment = make_equipment_type(name="Overlap Speakers", total_units=8)
    booked(equipment, "Overlap A", "2026-12-10", "10:00", "12:00", 4)
    booked(equipment, "Overlap B", "2026-12-10", "11:00", "13:00", 4)
    booked(equipment, "Touching C", "2026-12-10", "13:00", "14:00", 4)

    # 7 in service: A and B hold 8 at once (11:00-12:00); C only touches B, so
    # its own period holds 4 and is covered.
    names = [row["name"] for row in withdraw(client, equipment, 1).get_json()["shortfalls"]]

    assert names == ["Overlap A", "Overlap B"]


# @story: SCRUM-52
# @ac: 4
def test_an_event_that_has_started_is_not_listed(client):
    equipment = make_equipment_type(name="Started Speakers", total_units=4)
    booked(equipment, "Started at nine", "2026-12-01", "09:00", "11:00", 4)
    booked(equipment, "Starts at one past", "2026-12-01", "09:01", "11:00", 1)

    # Now is 09:00: an event starting at 09:00 has started, one at 09:01 has not.
    # 3 in service; 09:01's own period holds 4 + 1 = 5 > 3.
    names = [row["name"] for row in withdraw(client, equipment, 1).get_json()["shortfalls"]]

    assert names == ["Starts at one past"]


# @story: SCRUM-52
# @ac: 4
def test_released_reservations_and_unreserved_requirements_are_not_listed(client):
    equipment = make_equipment_type(name="Released Speakers", total_units=4)
    released = make_event(name="Released event", status="Planning", date="2026-12-05",
                          start_time="10:00", end_time="12:00", assigned_coordinator=account("coord1"))
    make_reservation(event=released, equipment=equipment, quantity=4, status="Released")
    approved = make_event(name="Approved only", status="Planning", date="2026-12-05",
                          start_time="10:00", end_time="12:00", assigned_coordinator=account("coord2"))
    make_equipment_requirement(event=approved, equipment=equipment, quantity=4, status="Approved")

    resp = withdraw(client, equipment, 4)

    assert resp.get_json()["shortfalls"] == []
    assert notifications_of("coord1") == []
    assert notifications_of("coord2") == []


# @story: SCRUM-52
# @ac: 4
def test_an_event_with_no_assigned_coordinator_is_listed_and_nobody_is_told(client):
    equipment = make_equipment_type(name="Unassigned Speakers", total_units=4)
    booked(equipment, "Nobody's event", "2026-12-05", "10:00", "12:00", 4, coordinator=None)
    before = db.session.query(Notification).count()

    shortfalls = withdraw(client, equipment, 1).get_json()["shortfalls"]

    assert [(row["name"], row["coordinator"]) for row in shortfalls] == [("Nobody's event", None)]
    assert db.session.query(Notification).count() == before


# @story: SCRUM-52
# @ac: 4
def test_each_coordinator_is_told_once_naming_each_of_their_short_events(client, speakers):
    withdraw(client, speakers, 2, reason="Water damage")

    coord1 = notifications_of("coord1")
    coord2 = notifications_of("coord2")
    assert [row.message for row in coord1] == [
        "Equipment withdrawn from service: Stage Speakers. Reserved units may no longer be covered for "
        "Stage Show (05 Dec 2026, 10:00–12:00), Morning Talk (06 Dec 2026, 09:00–11:00)."
    ]
    # Two events: the notification names them both and links neither.
    assert coord1[0].event_request_id is None
    assert [row.message for row in coord2] == [
        "Equipment withdrawn from service: Stage Speakers. Reserved units may no longer be covered for "
        "Late Panel (05 Dec 2026, 11:00–13:00)."
    ]
    assert coord2[0].event_request_id == event_id("Late Panel")
    assert coord2[0].read_at is None
    assert notifications_of("tech1") == []


# @story: SCRUM-52
# @ac: 4
def test_a_second_withdrawal_tells_the_coordinators_again(client, speakers):
    withdraw(client, speakers, 2, reason="Water damage")

    # 5 in service: the same three events are short again, and Small Meetup is still covered.
    resp = withdraw(client, speakers, 1, reason="Grille bent")

    assert [row["name"] for row in resp.get_json()["shortfalls"]] == ["Stage Show", "Late Panel", "Morning Talk"]
    assert len(notifications_of("coord1")) == 2
    assert len(notifications_of("coord2")) == 2


# ---- AC3: units out of service are not available when reserving --------------

# @story: SCRUM-52
# @ac: 3
def test_units_out_of_service_are_not_available_when_equipment_is_reserved(client):
    equipment = make_equipment_type(name="Reserve Speakers", total_units=8)
    booked(equipment, "Holding seven", "2026-12-05", "10:00", "12:00", 7)
    extra = make_event(name="Extra Talk", status="Planning", date="2026-12-05",
                       start_time="10:00", end_time="12:00", assigned_coordinator=account("coord2"))
    requirement = make_equipment_requirement(event=extra, equipment=equipment, quantity=1, status="Approved")
    withdraw(client, equipment, 1)

    # 8 total - 7 reserved - 1 out of service = 0 available.
    resp = client.post(f"/api/requests/{extra.id}/equipment/{requirement.id}/reserve")

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "Insufficient equipment: 0 units available for this period."


# ---- AC6: return to service --------------------------------------------------

# @story: SCRUM-52
# @ac: 6
@pytest.mark.parametrize("quantity", [0, 3, "1.5", None, True])
def test_a_return_outside_one_to_the_units_out_of_service_is_refused(client, quantity):
    equipment = make_equipment_type(name="Return Speakers", total_units=8, out_of_service_units=2)

    resp = give_back(client, equipment, quantity)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Quantity must be a whole number from 1 to 2."
    assert out_of_service(equipment) == 2
    assert history(equipment) == []


# @story: SCRUM-52
# @ac: 6
@pytest.mark.parametrize("quantity, left", [(1, 1), ("2", 0)])
def test_a_return_from_one_to_all_units_out_of_service_is_accepted(client, quantity, left):
    equipment = make_equipment_type(name="Returned Speakers", total_units=8, out_of_service_units=2)

    resp = give_back(client, equipment, quantity)

    assert resp.status_code == 200
    assert resp.get_json()["out_of_service_units"] == left
    assert out_of_service(equipment) == left


# @story: SCRUM-52
# @ac: 6
def test_nothing_can_be_returned_when_no_units_are_out_of_service(client):
    equipment = make_equipment_type(name="Whole Speakers", total_units=8)

    resp = give_back(client, equipment, 1)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "No units of Whole Speakers are out of service to return."
    assert out_of_service(equipment) == 0
    assert history(equipment) == []


# @story: SCRUM-52
# @ac: 6
def test_everything_returned_leaves_nothing_more_to_return(client):
    equipment = make_equipment_type(name="Returned Twice", total_units=8, out_of_service_units=2)
    assert give_back(client, equipment, 2).status_code == 200

    resp = give_back(client, equipment, 1)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "No units of Returned Twice are out of service to return."
    assert out_of_service(equipment) == 0


# @story: SCRUM-52
# @ac: 6
def test_a_return_with_no_body_is_refused(client):
    equipment = make_equipment_type(name="Bodiless Return", total_units=8, out_of_service_units=2)
    login_as(client, "tech1")

    resp = client.post(f"/api/equipment/{equipment.id}/return", data="not json")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Quantity must be a whole number from 1 to 2."


# @story: SCRUM-52
# @ac: 3, 6
def test_returned_units_count_as_available_again(client):
    equipment = make_equipment_type(name="Available Again", total_units=8, out_of_service_units=2)
    booked(equipment, "Holding five", "2026-12-05", "10:00", "12:00", 5)
    give_back(client, equipment, 2)

    body = client.get(f"/api/equipment/{equipment.id}/availability",
                      query_string={"start": "2026-12-05T10:00", "end": "2026-12-05T12:00"}).get_json()

    # 8 total - 5 reserved - 0 out of service = 3.
    assert (body["out_of_service_units"], body["available_units"]) == (0, 3)


# ---- The history record ------------------------------------------------------

# @story: SCRUM-52
# @ac: 1, 6
def test_every_withdrawal_and_return_is_recorded(client):
    equipment = make_equipment_type(name="Recorded Speakers", total_units=8)
    before = datetime.now(timezone.utc).replace(tzinfo=None)

    withdraw(client, equipment, 3, reason="Cone damaged")
    give_back(client, equipment, 1)

    after = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = history(equipment)
    assert [(row.action, row.quantity, row.reason, row.changed_by.username) for row in rows] == [
        ("Withdrawn", 3, "Cone damaged", "tech1"),
        ("Returned", 1, None, "tech1"),
    ]
    # UTC, like the other decision timestamps, not the pinned local clock.
    assert all(before <= row.changed_at <= after for row in rows)


# ---- AC7: the total's minimum ------------------------------------------------

# @story: SCRUM-52
# @ac: 7
@pytest.mark.parametrize("out, total, message", [
    # 7 reserved at once on 5 Dec (Stage Show 5 + Late Panel 2).
    (0, 6, "Total units cannot be reduced below 7 units: 7 units are reserved."),
    (1, 7, "Total units cannot be reduced below 8 units: 7 are reserved at the same time "
           "and 1 is out of service."),
    (2, 8, "Total units cannot be reduced below 9 units: 7 are reserved at the same time "
           "and 2 are out of service."),
])
def test_a_total_below_out_of_service_plus_the_reserved_peak_is_refused(client, out, total, message):
    equipment = make_equipment_type(name="Minimum Speakers", total_units=10, out_of_service_units=out)
    booked(equipment, "Peak Show", "2026-12-05", "10:00", "12:00", 5)
    booked(equipment, "Peak Panel", "2026-12-05", "11:00", "13:00", 2)
    login_as(client, "tech1")

    resp = client.patch(f"/api/equipment/{equipment.id}", json={"total_units": str(total)})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    db.session.expire_all()
    assert db.session.get(EquipmentType, equipment.id).total_units == 10


# @story: SCRUM-52
# @ac: 7
@pytest.mark.parametrize("out, total, message", [
    (1, 1, "Total units cannot be reduced below 2 units: 1 is reserved at the same time "
           "and 1 is out of service."),
    (3, 3, "Total units cannot be reduced below 4 units: 1 is reserved at the same time "
           "and 3 are out of service."),
])
def test_one_unit_reserved_is_named_in_the_singular(client, out, total, message):
    equipment = make_equipment_type(name="Single Reserved", total_units=10, out_of_service_units=out)
    booked(equipment, "Single Show", "2026-12-05", "10:00", "12:00", 1)
    login_as(client, "tech1")

    resp = client.patch(f"/api/equipment/{equipment.id}", json={"total_units": str(total)})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    db.session.expire_all()
    assert db.session.get(EquipmentType, equipment.id).total_units == 10


# @story: SCRUM-52
# @ac: 7
def test_no_units_reserved_is_named_in_the_plural(client):
    # Nothing reserved from now on, 2 out of service: the minimum is 2.
    equipment = make_equipment_type(name="Unreserved Speakers", total_units=10, out_of_service_units=2)
    login_as(client, "tech1")

    resp = client.patch(f"/api/equipment/{equipment.id}", json={"total_units": "1"})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == (
        "Total units cannot be reduced below 2 units: 0 are reserved at the same time "
        "and 2 are out of service.")


# @story: SCRUM-52
# @ac: 7
def test_a_total_equal_to_out_of_service_plus_the_reserved_peak_is_accepted(client):
    equipment = make_equipment_type(name="Exact Speakers", total_units=10, out_of_service_units=1)
    booked(equipment, "Exact Show", "2026-12-05", "10:00", "12:00", 7)
    login_as(client, "tech1")

    resp = client.patch(f"/api/equipment/{equipment.id}", json={"total_units": "8"})

    assert resp.status_code == 200
    assert resp.get_json()["total_units"] == 8
    assert resp.get_json()["out_of_service_units"] == 1


# ---- AC8: only Technical Support Staff ---------------------------------------

# @story: SCRUM-52
# @ac: 8
@pytest.mark.parametrize("username", ["org1", "coord1", "lead1", "venue1", "safety1", "att1", "multi1"])
@pytest.mark.parametrize("action", ["withdraw", "return"])
def test_only_technical_support_staff_may_withdraw_or_return(client, username, action):
    equipment = make_equipment_type(name="Guarded Speakers", total_units=8, out_of_service_units=2)
    login_as(client, username)

    resp = client.post(f"/api/equipment/{equipment.id}/{action}", json={"quantity": 1, "reason": "Cone damaged"})

    assert resp.status_code == 403
    assert out_of_service(equipment) == 2
    assert history(equipment) == []


# @story: SCRUM-52
# @ac: 8
@pytest.mark.parametrize("action", ["withdraw", "return"])
def test_withdrawing_or_returning_needs_a_login(client, action):
    equipment = make_equipment_type(name="Anonymous Speakers", total_units=8, out_of_service_units=2)

    resp = client.post(f"/api/equipment/{equipment.id}/{action}", json={"quantity": 1, "reason": "Cone damaged"})

    assert resp.status_code == 401
    assert out_of_service(equipment) == 2


# @story: SCRUM-52
# @ac: 1, 6
@pytest.mark.parametrize("action", ["withdraw", "return"])
def test_an_unknown_equipment_type_is_not_found(client, action):
    login_as(client, "tech1")

    resp = client.post(f"/api/equipment/99999/{action}", json={"quantity": 1, "reason": "Cone damaged"})

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Equipment type not found."


# @story: SCRUM-52
# @ac: 8
def test_an_event_coordinator_sees_units_out_of_service_in_the_inventory(client):
    equipment = make_equipment_type(name="Visible Speakers", total_units=8, out_of_service_units=1)
    login_as(client, "coord1")

    rows = client.get("/api/equipment").get_json()

    assert next(row for row in rows if row["id"] == equipment.id)["out_of_service_units"] == 1
