"""SCRUM-50: Check Equipment Availability for an Event Period — Technical
Support Staff read how many units of a type are free for a period.

The check is read-only and uses SCRUM-49's committed peak (commitments.py).
Units out of service are SCRUM-52's and show 0 until it exists (pending test).
These tests build their equipment types, events and reservations with
tests/factories.py and this file's own small helpers.
"""

from datetime import datetime

import pytest

from areas.equipment.commitments import peak_units
from db import db
from factories import account, make_event
from models import EquipmentType, Reservation

DAY = "2027-03-10"


def login_as(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def make_type(name, total_units):
    row = EquipmentType(name=name, total_units=total_units)
    db.session.add(row)
    db.session.commit()
    return row


def reserve(equipment, start, end, quantity, status="Reserved", day=DAY, event_name=None):
    """One reservation of a type for its own event, period snapshotted from it."""
    event = make_event(
        name=event_name or f"{equipment.name} {start}-{end} x{quantity} {status}",
        status="Approved",
        date=day,
        start_time=start,
        end_time=end,
    )
    row = Reservation(
        equipment_type=equipment,
        event_request=event,
        quantity=quantity,
        date=day,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.session.add(row)
    db.session.commit()
    return row


def check(client, equipment, start, end, **extra):
    query = {"start": f"{DAY}T{start}", "end": f"{DAY}T{end}", **extra}
    query = {key: value for key, value in query.items() if value is not None}
    return client.get(f"/api/equipment/{equipment.id}/availability", query_string=query)


def reservations_snapshot():
    db.session.expire_all()
    return [
        (row.id, row.equipment_type_id, row.event_request_id, row.quantity, row.status)
        for row in db.session.query(Reservation).order_by(Reservation.id)
    ]


# ---- AC1, AC3, AC4: the result -----------------------------------------------


# @story: SCRUM-50
# @ac: 1, 3, 4
def test_the_result_shows_total_reserved_out_of_service_and_available(client, app):
    projector = make_type("Check Projector", 10)
    reserve(projector, "10:00", "12:00", 2)
    reserve(projector, "11:00", "13:00", 3)
    login_as(client, "tech1")

    reply = check(client, projector, "10:00", "13:00")

    assert reply.status_code == 200
    body = reply.get_json()
    assert body["equipment_type"] == {"id": projector.id, "name": "Check Projector"}
    assert body["start"] == f"{DAY}T10:00"
    assert body["end"] == f"{DAY}T13:00"
    assert body["total_units"] == 10
    assert body["reserved_units"] == 5
    assert body["out_of_service_units"] == 0
    assert body["available_units"] == 5
    assert "requested_units" not in body


# @story: SCRUM-50
# @ac: 3
def test_reserved_is_the_most_held_at_the_same_time_not_the_sum(client, app):
    projector = make_type("Peak Projector", 10)
    reserve(projector, "09:00", "10:00", 2)
    reserve(projector, "11:00", "12:00", 3)
    login_as(client, "tech1")

    body = check(client, projector, "09:00", "12:00").get_json()

    assert body["reserved_units"] == 3
    assert body["available_units"] == 7


# @story: SCRUM-50
# @ac: 3
def test_a_released_reservation_is_not_counted(client, app):
    projector = make_type("Released Projector", 10)
    reserve(projector, "10:00", "12:00", 4, status="Released")
    reserve(projector, "10:00", "12:00", 1)
    login_as(client, "tech1")

    assert check(client, projector, "10:00", "12:00").get_json()["reserved_units"] == 1


# @story: SCRUM-50
# @ac: 3
def test_another_type_and_another_day_are_not_counted(client, app):
    projector = make_type("Own Projector", 10)
    other = make_type("Other Microphone", 10)
    reserve(other, "10:00", "12:00", 6)
    reserve(projector, "10:00", "12:00", 2, day="2027-03-11")
    login_as(client, "tech1")

    assert check(client, projector, "10:00", "12:00").get_json()["reserved_units"] == 0


# @story: SCRUM-50
# @ac: 4
def test_available_never_goes_below_zero(client, app):
    projector = make_type("Short Projector", 3)
    reserve(projector, "10:00", "12:00", 5)  # more than the total: no story stops this at write time yet
    login_as(client, "tech1")

    body = check(client, projector, "10:00", "12:00").get_json()

    assert body["reserved_units"] == 5
    assert body["available_units"] == 0


# @story: SCRUM-50
# @ac: 4
def test_a_type_with_no_reservations_is_fully_available(client, app):
    projector = make_type("Free Projector", 7)
    login_as(client, "tech1")

    body = check(client, projector, "10:00", "12:00").get_json()

    assert (body["reserved_units"], body["available_units"]) == (0, 7)


# ---- AC5: touching is not overlapping ----------------------------------------


# @story: SCRUM-50
# @ac: 5
@pytest.mark.parametrize(
    "start, end, counted",
    [
        ("08:00", "10:00", False),  # ends exactly where the period starts
        ("12:00", "14:00", False),  # starts exactly where the period ends
        ("08:00", "10:01", True),  # one minute inside at the start
        ("11:59", "14:00", True),  # one minute inside at the end
    ],
)
def test_a_reservation_that_only_touches_the_period_is_not_counted(client, app, start, end, counted):
    projector = make_type(f"Edge Projector {start}-{end}", 5)
    reserve(projector, start, end, 4)
    login_as(client, "tech1")

    body = check(client, projector, "10:00", "12:00").get_json()

    assert body["reserved_units"] == (4 if counted else 0)
    assert body["available_units"] == (1 if counted else 5)


# ---- AC1: both date-times, and the start before the end ----------------------


# @story: SCRUM-50
# @ac: 1
@pytest.mark.parametrize(
    "start, end",
    [
        ("10:00", "10:00"),
        ("12:00", "10:00"),
    ],
)
def test_a_start_that_is_not_before_the_end_is_refused(client, app, start, end):
    projector = make_type("Order Projector", 5)
    before = reservations_snapshot()
    login_as(client, "tech1")

    reply = check(client, projector, start, end)

    assert reply.status_code == 400
    assert "before" in reply.get_json()["message"]
    assert reservations_snapshot() == before


# @story: SCRUM-50
# @ac: 1
@pytest.mark.parametrize(
    "query",
    [
        {},
        {"start": f"{DAY}T10:00"},
        {"end": f"{DAY}T12:00"},
        {"start": "", "end": f"{DAY}T12:00"},
        {"start": "   ", "end": "   "},
    ],
)
def test_a_missing_start_or_end_is_refused(client, app, query):
    projector = make_type("Required Projector", 5)
    login_as(client, "tech1")

    reply = client.get(f"/api/equipment/{projector.id}/availability", query_string=query)

    assert reply.status_code == 400
    assert reply.get_json()["message"] == "A start and an end are required."


# @story: SCRUM-50
# @ac: 1
@pytest.mark.parametrize(
    "start, end",
    [
        ("tomorrow", "2027-03-10T12:00"),
        ("2027-03-10T10:00", "noon"),
        ("2027-02-30T10:00", "2027-03-10T12:00"),
        ("2027-03-10T25:00", "2027-03-10T26:00"),
        ("2027-03-10", "2027-03-11"),
    ],
)
def test_a_start_or_end_that_is_not_a_date_and_time_is_refused(client, app, start, end):
    projector = make_type("Format Projector", 5)
    login_as(client, "tech1")

    reply = client.get(
        f"/api/equipment/{projector.id}/availability", query_string={"start": start, "end": end}
    )

    assert reply.status_code == 400
    assert "date and time" in reply.get_json()["message"]


# @story: SCRUM-50
# @ac: 1
def test_an_unknown_equipment_type_is_not_found(client, app):
    login_as(client, "tech1")

    reply = client.get(
        "/api/equipment/99999/availability",
        query_string={"start": f"{DAY}T10:00", "end": f"{DAY}T12:00"},
    )

    assert reply.status_code == 404
    assert reply.get_json()["message"] == "Equipment type not found."


# ---- AC2, AC6, AC7: opened from a requirement --------------------------------


# @story: SCRUM-50
# @ac: 2, 7
def test_from_a_requirement_the_event_period_and_quantity_are_used_and_it_is_covered(client, app):
    projector = make_type("Req Projector", 10)
    event = make_event(
        name="Requirement Event",
        status="Planning",
        date=DAY,
        start_time="14:00",
        end_time="16:00",
    )
    login_as(client, "tech1")

    reply = client.get(
        f"/api/equipment/{projector.id}/availability",
        query_string={"event_request_id": event.id, "quantity": 2},
    )

    assert reply.status_code == 200
    body = reply.get_json()
    assert body["start"] == f"{DAY}T14:00"
    assert body["end"] == f"{DAY}T16:00"
    assert body["available_units"] == 10
    assert body["requested_units"] == 2
    assert body["covered"] is True
    assert body["short_by"] == 0


# @story: SCRUM-50
# @ac: 7
def test_a_requirement_that_cannot_be_covered_says_how_many_units_short(client, app):
    projector = make_type("Short Req Projector", 10)
    reserve(projector, "14:00", "16:00", 5)
    event = make_event(
        name="Short Event", status="Planning", date=DAY, start_time="14:00", end_time="16:00"
    )
    login_as(client, "tech1")

    body = client.get(
        f"/api/equipment/{projector.id}/availability",
        query_string={"event_request_id": event.id, "quantity": 8},
    ).get_json()

    assert body["available_units"] == 5
    assert body["covered"] is False
    assert body["short_by"] == 3


# @story: SCRUM-50
# @ac: 6
def test_the_events_own_reservation_is_not_counted_against_it(client, app):
    projector = make_type("Own Projector Req", 5)
    own = reserve(projector, "14:00", "16:00", 4, event_name="Own Reservation Event")
    login_as(client, "tech1")

    body = client.get(
        f"/api/equipment/{projector.id}/availability",
        query_string={"event_request_id": own.event_request_id, "quantity": 4},
    ).get_json()

    assert body["reserved_units"] == 0
    assert body["available_units"] == 5
    assert body["covered"] is True


# @story: SCRUM-50
# @ac: 6
def test_only_the_events_own_reservation_is_left_out(client, app):
    projector = make_type("Mixed Projector", 10)
    own = reserve(projector, "14:00", "16:00", 4, event_name="Mixed Own Event")
    reserve(projector, "14:00", "16:00", 3)
    login_as(client, "tech1")

    body = client.get(
        f"/api/equipment/{projector.id}/availability",
        query_string={"event_request_id": own.event_request_id, "quantity": 4},
    ).get_json()

    assert body["reserved_units"] == 3
    assert body["available_units"] == 7


# @story: SCRUM-50
# @ac: 6
def test_the_same_check_without_an_event_counts_every_reservation(client, app):
    projector = make_type("Whole Projector", 5)
    reserve(projector, "14:00", "16:00", 4)
    login_as(client, "tech1")

    body = check(client, projector, "14:00", "16:00").get_json()

    assert body["reserved_units"] == 4
    assert body["available_units"] == 1


# @story: SCRUM-50
# @ac: 2
@pytest.mark.parametrize("quantity", ["0", "-1", "1.5", "two", ""])
def test_a_quantity_that_is_not_a_positive_whole_number_is_refused(client, app, quantity):
    projector = make_type("Quantity Projector", 5)
    event = make_event(
        name="Quantity Event", status="Planning", date=DAY, start_time="14:00", end_time="16:00"
    )
    login_as(client, "tech1")

    reply = client.get(
        f"/api/equipment/{projector.id}/availability",
        query_string={"event_request_id": event.id, "quantity": quantity},
    )

    assert reply.status_code == 400
    assert reply.get_json()["message"] == "Quantity must be a positive whole number."


# @story: SCRUM-50
# @ac: 2
def test_an_event_without_a_quantity_is_refused(client, app):
    projector = make_type("No Quantity Projector", 5)
    event = make_event(
        name="No Quantity Event", status="Planning", date=DAY, start_time="14:00", end_time="16:00"
    )
    login_as(client, "tech1")

    reply = client.get(
        f"/api/equipment/{projector.id}/availability", query_string={"event_request_id": event.id}
    )

    assert reply.status_code == 400
    assert reply.get_json()["message"] == "Quantity must be a positive whole number."


# @story: SCRUM-50
# @ac: 2
def test_an_unknown_event_is_not_found(client, app):
    projector = make_type("Unknown Event Projector", 5)
    login_as(client, "tech1")

    reply = client.get(
        f"/api/equipment/{projector.id}/availability",
        query_string={"event_request_id": 99999, "quantity": 1},
    )

    assert reply.status_code == 404
    assert reply.get_json()["message"] == "Event request not found."


# @story: SCRUM-50
# @ac: 2
def test_an_event_with_no_period_is_refused(client, app):
    projector = make_type("No Period Projector", 5)
    event = make_event(
        name="Draft Without Times",
        status="Draft",
        date=None,
        start_time=None,
        end_time=None,
    )
    login_as(client, "tech1")

    reply = client.get(
        f"/api/equipment/{projector.id}/availability",
        query_string={"event_request_id": event.id, "quantity": 1},
    )

    assert reply.status_code == 400
    assert "period" in reply.get_json()["message"]


# ---- AC8: reading changes nothing --------------------------------------------


# @story: SCRUM-50
# @ac: 8
def test_a_check_changes_no_reservation_and_no_total(client, app):
    projector = make_type("Steady Projector", 6)
    reserve(projector, "10:00", "12:00", 2)
    before = reservations_snapshot()
    login_as(client, "tech1")

    first = check(client, projector, "10:00", "12:00").get_json()
    second = check(client, projector, "10:00", "12:00").get_json()

    assert first == second
    assert reservations_snapshot() == before
    db.session.expire_all()
    assert db.session.get(EquipmentType, projector.id).total_units == 6


# ---- AC9: only Technical Support Staff ---------------------------------------


# @story: SCRUM-50
# @ac: 9
@pytest.mark.parametrize("username", ["coord1", "org1", "venue1", "att1", "safety1", "multi1"])
def test_no_other_role_can_run_the_check(client, app, username):
    projector = make_type("Role Projector", 5)
    login_as(client, username)

    reply = check(client, projector, "10:00", "12:00")

    assert reply.status_code == 403
    assert set(reply.get_json()) == {"message"}


# @story: SCRUM-50
# @ac: 9
def test_the_check_needs_login(client, app):
    projector = make_type("Anonymous Projector", 5)

    assert check(client, projector, "10:00", "12:00").status_code == 401


# ---- the shared calculation --------------------------------------------------


# @story: SCRUM-50
# @ac: 6
def test_peak_units_can_leave_one_events_reservation_out(app):
    projector = make_type("Exclude Projector", 10)
    own = reserve(projector, "10:00", "12:00", 4, event_name="Exclude Own")
    reserve(projector, "11:00", "13:00", 2)
    start = datetime(2027, 3, 10, 10, 0)
    end = datetime(2027, 3, 10, 13, 0)

    assert peak_units(projector.id, start, end) == 6
    assert peak_units(projector.id, start, end, exclude_event_id=own.event_request_id) == 2
    assert peak_units(projector.id, start, end, exclude_event_id=99999) == 6


# ---- stub: units out of service ----------------------------------------------


# @story: SCRUM-50
# @ac: 3, 4
@pytest.mark.skip(reason="PENDING SCRUM-52: no units can be withdrawn from service yet")
def test_units_out_of_service_are_taken_off_what_is_available(client, app):
    raise AssertionError("withdraw units with SCRUM-52 and prove available falls by that number")
