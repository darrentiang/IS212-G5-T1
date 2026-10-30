"""Equipment inventory — SCRUM-49 (Maintain Equipment Inventory).

Rules under test: inventory read (equipment.view), stock-count editing
(equipment.edit), whole-number validation (AC3/AC5), the reservation-minimum
guard (AC4), permission refusal (AC7), preservation of reservations and
requirements on success and refusal (AC6), the shared window-parameterized
peak calculation, the clock override, and seed.py --extra's rerun contract.
Functional rows are proven by functional/tests/SCRUM-49.spec.js; these are
the implementation-level cases the handoff asks for beyond the sheet.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

import clock
from areas.equipment import services
from areas.equipment.commitments import peak_units
from db import db
from errors import ApiRefusal
from models import Account, EquipmentType, EventRequest, Reservation
from seed import FixtureConflict, apply_extra
from areas.equipment.services import (
    INVALID_TOTAL,
    MAX_SAFE_INTEGER,
    TOO_LARGE,
)

PASSWORD = "Passw0rd!"
NOW = datetime(2026, 12, 15, 11, 0)
SINGAPORE_OFFSET = timezone(timedelta(hours=8))


@pytest.fixture(autouse=True)
def _seeded_app(app):
    """Every test runs inside the app fixture's seeded application context."""
    yield


def _login(client, username):
    resp = client.post(
        "/api/login", json={"username": username, "password": PASSWORD}
    )
    assert resp.status_code == 200


def _type(name, total):
    row = EquipmentType(name=name, total_units=total)
    db.session.add(row)
    db.session.commit()
    return row


def _event(name, date, start, end, requirements=None):
    organiser = db.session.query(Account).filter_by(username="org1").one()
    row = EventRequest(
        name=name,
        status="Approved",
        created_by=organiser,
        date=date,
        start_time=start,
        end_time=end,
        attendance=10,
        equipment_requirements=requirements,
    )
    db.session.add(row)
    db.session.commit()
    return row


def _reservation(equipment, event, quantity, status="Reserved"):
    row = Reservation(
        equipment_type=equipment,
        event_request=event,
        quantity=quantity,
        date=event.date,
        start_time=event.start_time,
        end_time=event.end_time,
        status=status,
    )
    db.session.add(row)
    db.session.commit()
    return row


def _total(equipment_id):
    resp = db.session.get(EquipmentType, equipment_id).total_units
    return resp


def _patch(client, username, equipment_id, payload=None, raw=None, content_type=None):
    _login(client, username)
    if raw is not None:
        return client.patch(f"/api/equipment/{equipment_id}", data=raw, content_type=content_type)
    return client.patch(f"/api/equipment/{equipment_id}", json=payload)


# --- read and view permission (AC1) ---------------------------------------


# @story: SCRUM-49
# @ac: 1
def test_tech_sees_inventory_with_totals(client):
    _login(client, "tech1")
    resp = client.get("/api/equipment")
    assert resp.status_code == 200
    rows = resp.get_json()
    by_name = {row["name"]: row for row in rows}
    assert by_name["Projector"]["total_units"] == 10
    assert by_name["Microphones"]["total_units"] == 20
    assert set(by_name["Projector"]) == {
        "id", "name", "description", "location", "total_units", "out_of_service_units",  # SCRUM-52
    }
    assert by_name["Projector"]["description"] == "Portable projector"
    assert by_name["Projector"]["location"] == "Equipment Store A"


# @story: SCRUM-49
# @ac: 1
def test_coord_can_view_inventory(client):
    _login(client, "coord1")
    resp = client.get("/api/equipment")
    assert resp.status_code == 200
    assert any(row["name"] == "Projector" for row in resp.get_json())


# @story: SCRUM-49
# @ac: 1, 7
def test_multi_role_can_view_but_not_edit(client):
    equipment = _type("SCRUM-49 multi view", 5)
    _login(client, "multi1")
    assert client.get("/api/equipment").status_code == 200
    resp = client.patch(f"/api/equipment/{equipment.id}", json={"total_units": 8})
    assert resp.status_code == 403
    assert "message" in resp.get_json()
    assert _total(equipment.id) == 5


# @story: SCRUM-49
# @ac: 1, 7
def test_other_roles_and_anonymous_are_refused(client):
    equipment = _type("SCRUM-49 anon", 5)
    for username in ("org1", "venue1"):
        _login(client, username)
        assert client.get("/api/equipment").status_code == 403
        assert (
            client.patch(
                f"/api/equipment/{equipment.id}", json={"total_units": 8}
            ).status_code
            == 403
        )
        client.post("/api/logout")
    assert client.get("/api/equipment").status_code == 401
    assert (
        client.patch(f"/api/equipment/{equipment.id}", json={"total_units": 8}).status_code
        == 401
    )
    assert _total(equipment.id) == 5


# @story: SCRUM-49
# @ac: 1
def test_list_is_id_ascending(client):
    _login(client, "tech1")
    rows = client.get("/api/equipment").get_json()
    ids = [row["id"] for row in rows]
    assert ids == sorted(ids)


# --- accepted saves (AC2, AC3, AC6) ---------------------------------------


# @story: SCRUM-49
# @ac: 2, 6
def test_tech_changes_total_and_it_persists(client):
    equipment = _type("SCRUM-49 persist", 5)
    resp = _patch(client, "tech1", equipment.id, {"total_units": 8})
    assert resp.status_code == 200
    assert resp.get_json() == {
        "id": equipment.id,
        "name": "SCRUM-49 persist",
        "description": "",
        "location": "",
        "total_units": 8,
        "out_of_service_units": 0,  # SCRUM-52
    }
    client.post("/api/logout")
    _login(client, "tech1")
    rows = client.get("/api/equipment").get_json()
    assert next(row for row in rows if row["id"] == equipment.id)["total_units"] == 8


# @story: SCRUM-49
# @ac: 2, 3
def test_zero_and_one_accepted_without_reservations(client):
    equipment = _type("SCRUM-49 zero", 5)
    assert _patch(client, "tech1", equipment.id, {"total_units": 0}).status_code == 200
    assert _total(equipment.id) == 0
    client.post("/api/logout")
    assert _patch(client, "tech1", equipment.id, {"total_units": 1}).status_code == 200
    assert _total(equipment.id) == 1


# @story: SCRUM-49
# @ac: 3
def test_whole_number_representations_accepted(client):
    equipment = _type("SCRUM-49 forms", 5)
    for payload, expected in (
        ({"total_units": "8"}, 8),
        ({"total_units": 8}, 8),
        ({"total_units": 8.0}, 8),
        ({"total_units": 1e5}, 100000),
        ({"total_units": "1e5"}, 100000),
    ):
        resp = _patch(client, "tech1", equipment.id, payload)
        assert resp.status_code == 200, payload
        assert resp.get_json()["total_units"] == expected
        client.post("/api/logout")


# @story: SCRUM-49
# @ac: 5
def test_unknown_type_is_404(client):
    resp = _patch(client, "tech1", 999999, {"total_units": 8})
    assert resp.status_code == 404
    assert "message" in resp.get_json()


# --- refusals leave the stored total unchanged (AC3, AC5) -----------------


def _assert_refused(client, equipment, payload=None, **kwargs):
    before = _total(equipment.id)
    if payload is not None:
        resp = _patch(client, "tech1", equipment.id, payload, **kwargs)
    else:
        resp = _patch(client, "tech1", equipment.id, None, **kwargs)
    assert resp.status_code == 400
    body = resp.get_json()
    assert "message" in body
    client.post("/api/logout")
    assert _total(equipment.id) == before
    return body


# @story: SCRUM-49
# @ac: 3, 5
def test_negative_refused(client):
    equipment = _type("SCRUM-49 neg", 5)
    body = _assert_refused(client, equipment, {"total_units": -1})
    assert body["message"] == INVALID_TOTAL
    _assert_refused(client, equipment, {"total_units": "-1"})


# @story: SCRUM-49
# @ac: 3, 5
def test_fractional_values_refused_never_rounded(client):
    equipment = _type("SCRUM-49 frac", 5)
    for payload in (1.5, "1.5", "30.00000000000000001"):
        body = _assert_refused(client, equipment, {"total_units": payload})
        assert body["message"] == INVALID_TOTAL
    assert _total(equipment.id) == 5  # not 1, not 2, not 30


# @story: SCRUM-49
# @ac: 5
def test_json_number_whole_but_float_written_is_accepted_as_the_whole_number(client):
    # Documented boundary: the parser delivers 30.0 for the literal
    # 30.00000000000000001, so the value as received IS the whole number 30.
    equipment = _type("SCRUM-49 float-edge", 5)
    resp = _patch(client, "tech1", equipment.id, {"total_units": 30.00000000000000001})
    assert resp.status_code == 200
    assert resp.get_json()["total_units"] == 30


# @story: SCRUM-49
# @ac: 3, 5
def test_booleans_refused(client):
    equipment = _type("SCRUM-49 bool", 5)
    for payload in (True, False):
        body = _assert_refused(client, equipment, {"total_units": payload})
        assert body["message"] == INVALID_TOTAL


# @story: SCRUM-49
# @ac: 3, 5
def test_blank_and_null_refused_not_read_as_zero(client):
    equipment = _type("SCRUM-49 blank", 5)
    for payload in ({"total_units": ""}, {"total_units": "   "}, {"total_units": None}):
        body = _assert_refused(client, equipment, payload)
        assert body["message"] == INVALID_TOTAL


# @story: SCRUM-49
# @ac: 5
def test_missing_key_and_malformed_bodies_refused(client):
    equipment = _type("SCRUM-49 shape", 5)
    body = _assert_refused(client, equipment, {})
    assert body["message"] == "Request body must contain total_units."
    body = _assert_refused(
        client, equipment, raw="[1, 2]", content_type="application/json"
    )
    assert body["message"] == (
        "Request body must be a JSON object with total_units."
    )
    body = _assert_refused(client, equipment, raw="", content_type="application/json")
    assert body["message"] == (
        "Request body must be a JSON object with total_units."
    )


# @story: SCRUM-49
# @ac: 3, 5
def test_non_numeric_string_refused(client):
    equipment = _type("SCRUM-49 text", 5)
    body = _assert_refused(client, equipment, {"total_units": "abc"})
    assert body["message"] == INVALID_TOTAL


# @story: SCRUM-49
# @ac: 5
def test_too_large_refused(client):
    equipment = _type("SCRUM-49 huge", 5)
    beyond = str(MAX_SAFE_INTEGER + 1)
    body = _assert_refused(client, equipment, {"total_units": beyond})
    assert body["message"] == TOO_LARGE
    body = _assert_refused(client, equipment, {"total_units": 1e300})
    assert body["message"] == TOO_LARGE


# @story: SCRUM-49
# @ac: 5
def test_non_finite_refused(client):
    equipment = _type("SCRUM-49 inf", 5)
    for payload in ("Infinity", "nan"):
        body = _assert_refused(client, equipment, {"total_units": payload})
        assert body["message"] == INVALID_TOTAL


# --- write permission (AC7) -----------------------------------------------


# @story: SCRUM-49
# @ac: 7
def test_coord_cannot_change_total_and_nothing_changes(client):
    equipment = _type("SCRUM-49 coord-write", 5)
    resp = _patch(client, "coord1", equipment.id, {"total_units": 8})
    assert resp.status_code == 403
    assert resp.get_json()["message"]
    assert _total(equipment.id) == 5


# --- the shared peak calculation (AC4) ------------------------------------


# @story: SCRUM-49
# @ac: 4
def test_peak_overlapping_reservations_sum_only_where_they_overlap():
    equipment = _type("SCRUM-49 peak-overlap", 10)
    a = _event("SCRUM-49 peak-overlap A", "2026-12-15", "10:00", "12:00")
    b = _event("SCRUM-49 peak-overlap B", "2026-12-15", "11:30", "12:30")
    _reservation(equipment, a, 2)
    _reservation(equipment, b, 3)
    assert peak_units(equipment.id, NOW, None) == 5


# @story: SCRUM-49
# @ac: 4
def test_peak_disjoint_reservations_are_not_added_together():
    equipment = _type("SCRUM-49 peak-disjoint", 10)
    a = _event("SCRUM-49 peak-disjoint A", "2026-12-15", "12:00", "13:00")
    b = _event("SCRUM-49 peak-disjoint B", "2026-12-15", "14:00", "15:00")
    _reservation(equipment, a, 6)
    _reservation(equipment, b, 6)
    assert peak_units(equipment.id, NOW, None) == 6  # not 12


# @story: SCRUM-49
# @ac: 4
def test_peak_is_scoped_to_the_requested_window():
    # SCRUM-50's case: Monday's commitments must not reduce Tuesday's window.
    equipment = _type("SCRUM-49 peak-window", 10)
    monday = _event("SCRUM-49 peak-window Monday", "2026-12-14", "10:00", "12:00")
    _reservation(equipment, monday, 8)
    tuesday_start = datetime(2026, 12, 15, 9, 0)
    tuesday_end = datetime(2026, 12, 15, 17, 0)
    assert peak_units(equipment.id, tuesday_start, tuesday_end) == 0
    assert peak_units(equipment.id, datetime(2026, 12, 14, 9, 0), datetime(2026, 12, 14, 17, 0)) == 8


# @story: SCRUM-49
# @ac: 4
def test_peak_ignores_past_and_released_reservations():
    equipment = _type("SCRUM-49 peak-inactive", 10)
    past = _event("SCRUM-49 peak-inactive past", "2026-12-14", "10:00", "12:00")
    future = _event("SCRUM-49 peak-inactive future", "2026-12-16", "10:00", "12:00")
    _reservation(equipment, past, 8, status="Reserved")
    _reservation(equipment, future, 6, status="Released")
    assert peak_units(equipment.id, NOW, None) == 0


# @story: SCRUM-49
# @ac: 4
def test_peak_counts_only_this_type():
    mine = _type("SCRUM-49 peak-mine", 10)
    other = _type("SCRUM-49 peak-other", 10)
    event = _event("SCRUM-49 peak-other event", "2026-12-15", "10:00", "12:00")
    _reservation(other, event, 7)
    assert peak_units(mine.id, NOW, None) == 0


# @story: SCRUM-49
# @ac: 4
def test_peak_boundary_touching_periods_do_not_stack():
    equipment = _type("SCRUM-49 peak-touch", 10)
    a = _event("SCRUM-49 peak-touch A", "2026-12-15", "10:00", "12:00")
    b = _event("SCRUM-49 peak-touch B", "2026-12-15", "12:00", "14:00")
    _reservation(equipment, a, 2)
    _reservation(equipment, b, 3)
    # At 12:00 the first has ended; the peak is 3, not 5.
    assert peak_units(equipment.id, NOW, None) == 3
    # A window starting exactly when one reservation ends excludes it.
    assert peak_units(equipment.id, datetime(2026, 12, 15, 12, 0), None) == 3


# @story: SCRUM-49
# @ac: 4
def test_peak_counts_overlapping_and_contained_periods():
    equipment = _type("SCRUM-49 peak-contain", 10)
    long = _event("SCRUM-49 peak-contain long", "2026-12-15", "10:00", "16:00")
    short = _event("SCRUM-49 peak-contain short", "2026-12-15", "11:00", "12:00")
    _reservation(equipment, long, 4)
    _reservation(equipment, short, 3)
    assert peak_units(equipment.id, NOW, None) == 7  # 4 + 3 during 11:00-12:00


# @story: SCRUM-49
# @ac: 4
def test_peak_without_reservations_is_zero():
    equipment = _type("SCRUM-49 peak-none", 10)
    assert peak_units(equipment.id, NOW, None) == 0
    assert peak_units(equipment.id + 999999, NOW, None) == 0


# @story: SCRUM-49
# @ac: 4
def test_peak_window_ending_before_a_reservation_ends():
    # A reservation running past the window's end still counts inside it,
    # and no end event is scheduled outside the window.
    equipment = _type("SCRUM-49 peak-clipped", 10)
    a = _event("SCRUM-49 peak-clipped A", "2026-12-15", "10:00", "12:00")
    b = _event("SCRUM-49 peak-clipped B", "2026-12-15", "11:30", "12:30")
    _reservation(equipment, a, 2)
    _reservation(equipment, b, 3)
    window_start = datetime(2026, 12, 15, 11, 0)
    window_end = datetime(2026, 12, 15, 11, 45)  # both reservations end after it
    assert peak_units(equipment.id, window_start, window_end) == 5


# @story: SCRUM-49
# @ac: 4
def test_peak_refuses_an_inverted_stored_period():
    equipment = _type("SCRUM-49 peak-corrupt", 10)
    event = _event("SCRUM-49 peak-corrupt event", "2026-12-15", "10:00", "12:00")
    reservation = _reservation(equipment, event, 2)
    reservation.end_time = "09:00"  # corrupt data bypasses every creation path
    db.session.commit()
    with pytest.raises(ValueError, match="inverted period"):
        peak_units(equipment.id, NOW, None)


# @story: SCRUM-49
# @ac: 6
def test_model_reprs():
    equipment = _type("SCRUM-49 repr", 5)
    assert repr(equipment) == f"<EquipmentType {equipment.id} SCRUM-49 repr>"
    event = _event("SCRUM-49 repr event", "2026-12-15", "10:00", "12:00")
    reservation = _reservation(equipment, event, 1)
    assert (
        repr(reservation)
        == f"<Reservation {reservation.id} type {equipment.id} Reserved>"
    )


# --- the guard in the save path (AC4, AC5) --------------------------------


def _guarded_type(name="SCRUM-49 guard", total=10, quantities=(2, 3)):
    """A type with two overlapping reservations peaking at sum(quantities)."""
    equipment = _type(name, total)
    a = _event(f"{name} A", "2026-12-15", "10:00", "12:00")
    b = _event(f"{name} B", "2026-12-15", "11:30", "12:30")
    _reservation(equipment, a, quantities[0])
    _reservation(equipment, b, quantities[1])
    return equipment, a, b


# @story: SCRUM-49
# @ac: 4, 5
def test_reduction_below_minimum_refused_and_names_it(client, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)
    equipment, _, _ = _guarded_type()
    before_reservations = db.session.query(Reservation).filter_by(
        equipment_type_id=equipment.id
    ).count()
    resp = _patch(client, "tech1", equipment.id, {"total_units": 4})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == (
        "Total units cannot be reduced below 5 units: 5 units are reserved."
    )
    assert _total(equipment.id) == 10
    assert (
        db.session.query(Reservation).filter_by(equipment_type_id=equipment.id).count()
        == before_reservations
    )


# @story: SCRUM-49
# @ac: 2, 4, 6
def test_reduction_exactly_at_minimum_accepted(client, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)
    equipment, a, b = _guarded_type()
    resp = _patch(client, "tech1", equipment.id, {"total_units": 5})
    assert resp.status_code == 200
    assert _total(equipment.id) == 5
    assert a.equipment_requirements is None  # untouched
    assert db.session.get(EventRequest, b.id) is not None


# @story: SCRUM-49
# @ac: 2, 4
def test_reduction_above_minimum_accepted(client, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)
    equipment, _, _ = _guarded_type()
    assert _patch(client, "tech1", equipment.id, {"total_units": 6}).status_code == 200
    assert _total(equipment.id) == 6


# @story: SCRUM-49
# @ac: 4, 5
def test_zero_refused_while_minimum_is_positive(client, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)
    equipment, _, _ = _guarded_type()
    resp = _patch(client, "tech1", equipment.id, {"total_units": 0})
    assert resp.status_code == 400
    assert "below 5" in resp.get_json()["message"]
    assert _total(equipment.id) == 10


# @story: SCRUM-49
# @ac: 4
def test_requirements_without_reservations_do_not_block_zero(client, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)
    equipment = _type("SCRUM-49 req-only", 10)
    event = _event(
        "SCRUM-49 req-only event",
        "2026-12-15",
        "10:00",
        "12:00",
        requirements="Projector",
    )
    resp = _patch(client, "tech1", equipment.id, {"total_units": 0})
    assert resp.status_code == 200
    assert _total(equipment.id) == 0
    assert db.session.get(EventRequest, event.id).equipment_requirements == "Projector"


# @story: SCRUM-49
# @ac: 4, 6
def test_past_and_released_reservations_do_not_block_zero(client, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)
    equipment = _type("SCRUM-49 inactive", 10)
    past = _event("SCRUM-49 inactive past", "2026-12-14", "10:00", "12:00")
    released = _event("SCRUM-49 inactive released", "2026-12-16", "10:00", "12:00")
    _reservation(equipment, past, 8)
    _reservation(equipment, released, 6, status="Released")
    assert _patch(client, "tech1", equipment.id, {"total_units": 0}).status_code == 200
    assert _total(equipment.id) == 0
    assert (
        db.session.query(Reservation).filter_by(equipment_type_id=equipment.id).count()
        == 2
    )


# @story: SCRUM-49
# @ac: 6
def test_successful_save_preserves_reservations_and_requirements(client, monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)
    equipment, a, b = _guarded_type(name="SCRUM-49 preserve")
    a.equipment_requirements = "Projector"
    db.session.commit()
    before = [
        (row.id, row.quantity, row.status, row.date, row.start_time, row.end_time)
        for row in db.session.query(Reservation)
        .filter_by(equipment_type_id=equipment.id)
        .order_by(Reservation.id)
    ]
    assert _patch(client, "tech1", equipment.id, {"total_units": 6}).status_code == 200
    after = [
        (row.id, row.quantity, row.status, row.date, row.start_time, row.end_time)
        for row in db.session.query(Reservation)
        .filter_by(equipment_type_id=equipment.id)
        .order_by(Reservation.id)
    ]
    assert after == before
    assert db.session.get(EventRequest, a.id).equipment_requirements == "Projector"


# --- the clock override (functional-test control) -------------------------


# @story: SCRUM-49
# @ac: 4
def test_clock_file_pins_the_time(monkeypatch, tmp_path):
    target = tmp_path / "clock.txt"
    target.write_text("2026-12-15T11:00", encoding="utf-8")
    monkeypatch.setenv("CONNECTSPHERE_CLOCK_FILE", str(target))
    assert clock.now_local() == datetime(2026, 12, 15, 11, 0)


# @story: SCRUM-49
# @ac: 4
def test_clock_env_without_file_reads_real_time(monkeypatch, tmp_path):
    monkeypatch.setenv("CONNECTSPHERE_CLOCK_FILE", str(tmp_path / "absent.txt"))
    real = clock.now_local()
    expected = datetime.now(timezone.utc).astimezone(SINGAPORE_OFFSET).replace(
        tzinfo=None, second=0, microsecond=0
    )
    assert abs((real - expected).total_seconds()) <= 60


# @story: SCRUM-49
# @ac: 4
def test_clock_malformed_override_raises_rather_than_falling_back(monkeypatch, tmp_path):
    target = tmp_path / "clock.txt"
    target.write_text("not a timestamp", encoding="utf-8")
    monkeypatch.setenv("CONNECTSPHERE_CLOCK_FILE", str(target))
    with pytest.raises(ValueError, match="ISO timestamp"):
        clock.now_local()


# @story: SCRUM-49
# @ac: 4
def test_clock_timezone_aware_override_raises(monkeypatch, tmp_path):
    target = tmp_path / "clock.txt"
    target.write_text("2026-12-15T11:00:00+08:00", encoding="utf-8")
    monkeypatch.setenv("CONNECTSPHERE_CLOCK_FILE", str(target))
    with pytest.raises(ValueError, match="naive"):
        clock.now_local()


# @story: SCRUM-49
# @ac: 4
def test_clock_without_env_unchanged(monkeypatch):
    monkeypatch.delenv("CONNECTSPHERE_CLOCK_FILE", raising=False)
    real = clock.now_local()
    assert isinstance(real, datetime)
    assert real.tzinfo is None
    assert real.second == 0 and real.microsecond == 0


# --- seed baseline and the --extra rerun contract --------------------------


# @story: SCRUM-49
# @ac: 6
def test_baseline_catalogue_is_seeded():
    rows = {
        row.name: row.total_units
        for row in db.session.query(EquipmentType).all()
    }
    assert rows == {
        "Projector": 10,
        "Microphones": 20,
        "Speakers": 8,
        "Laptops": 6,
    }


def _fixture_file(tmp_path, data, name="fixture.json"):
    path = tmp_path / name
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _small_fixture():
    return {
        "equipment_types": [{
            "name": "SCRUM-49 extra type",
            "description": "Fixture projector",
            "location": "Fixture Store",
            "total_units": 5,
        }],
        "event_requests": [
            {
                "name": "SCRUM-49 extra event",
                "created_by": "org1",
                "status": "Approved",
                "date": "2026-12-15",
                "start_time": "10:00",
                "end_time": "12:00",
                "attendance": 10,
                "equipment_requirements": "Projector",
            }
        ],
        "reservations": [
            {
                "equipment_type": "SCRUM-49 extra type",
                "event": "SCRUM-49 extra event",
                "quantity": 2,
                "status": "Reserved",
            }
        ],
    }


def _counts():
    return (
        db.session.query(EquipmentType).filter_by(name="SCRUM-49 extra type").count(),
        db.session.query(EventRequest).filter_by(name="SCRUM-49 extra event").count(),
        db.session.query(Reservation).count(),
    )


# @story: SCRUM-49
# @ac: 6
def test_apply_extra_inserts_once_and_reruns_without_duplicates(tmp_path):
    path = _fixture_file(tmp_path, _small_fixture())
    assert apply_extra(db, path) == 3
    assert _counts() == (1, 1, 1)
    assert apply_extra(db, path) == 0  # every row matched, nothing added
    assert _counts() == (1, 1, 1)


# @story: SCRUM-49
# @ac: 6
def test_apply_extra_never_overwrites_edited_stock(tmp_path):
    path = _fixture_file(tmp_path, _small_fixture())
    apply_extra(db, path)
    equipment = db.session.query(EquipmentType).filter_by(
        name="SCRUM-49 extra type"
    ).one()
    equipment.total_units = 3  # edited during a local run
    db.session.commit()
    assert apply_extra(db, path) == 0
    assert equipment.total_units == 3  # untouched


# @story: SCRUM-49
# @ac: 5
def test_apply_extra_fails_loudly_on_a_diverged_reservation(tmp_path):
    path = _fixture_file(tmp_path, _small_fixture())
    apply_extra(db, path)
    reservation = db.session.query(Reservation).one()
    reservation.quantity = 4
    db.session.commit()
    with pytest.raises(FixtureConflict, match="SCRUM-49 extra type"):
        apply_extra(db, path)
    assert db.session.query(Reservation).one().quantity == 4  # never repaired


# @story: SCRUM-49
# @ac: 5
def test_apply_extra_fails_loudly_on_a_diverged_event(tmp_path):
    path = _fixture_file(tmp_path, _small_fixture())
    apply_extra(db, path)
    event = db.session.query(EventRequest).filter_by(name="SCRUM-49 extra event").one()
    event.date = "2026-12-20"
    db.session.commit()
    with pytest.raises(FixtureConflict, match="SCRUM-49 extra event"):
        apply_extra(db, path)


# @story: SCRUM-49
# @ac: 5
def test_apply_extra_rejects_a_duplicate_identity_inside_the_file(tmp_path):
    data = _small_fixture()
    data["reservations"].append(dict(data["reservations"][0]))
    path = _fixture_file(tmp_path, data)
    with pytest.raises(FixtureConflict, match="duplicate identity"):
        apply_extra(db, path)
    assert _counts() == (0, 0, 0)


# @story: SCRUM-49
# @ac: 5
@pytest.mark.parametrize(
    "mutilate, match",
    [
        (lambda d: d["reservations"][0].update(quantity=0), "quantity"),
        (lambda d: d["reservations"][0].update(status="Retired"), "Reserved or Released"),
        (lambda d: d["reservations"][0].update(event="No such event"), "unknown event"),
        (lambda d: d["event_requests"][0].update(end_time="09:00"), "before end time"),
        (lambda d: d["event_requests"][0].pop("date"), "missing date"),
        (lambda d: d["event_requests"][0].update(created_by="nobody"), "unknown account"),
        (lambda d: d["equipment_types"][0].update(total_units=-1), "non-negative"),
    ],
)
def test_apply_extra_rejects_invalid_fixture_rows(tmp_path, mutilate, match):
    data = _small_fixture()
    mutilate(data)
    path = _fixture_file(tmp_path, data)
    with pytest.raises(FixtureConflict, match=match):
        apply_extra(db, path)
    assert _counts() == (0, 0, 0)  # nothing half applied


# @story: SCRUM-49
# @ac: 5
def test_apply_extra_failure_after_a_type_insert_rolls_everything_back(tmp_path):
    data = _small_fixture()
    data["reservations"][0]["quantity"] = 0  # fails after the type and event load
    path = _fixture_file(tmp_path, data)
    with pytest.raises(FixtureConflict):
        apply_extra(db, path)
    assert _counts() == (0, 0, 0)


# --- JSON-boundary documentation on the wire ------------------------------


# @story: SCRUM-49
# @ac: 3
def test_parse_helper_matches_the_documented_boundary():
    # String path: exact. Float path: as delivered by the parser.
    with pytest.raises(ApiRefusal):
        services._parse_total_units("30.00000000000000001")
    assert services._parse_total_units("8.0") == 8
    assert services._parse_total_units(8.0) == 8


# @story: SCRUM-49
# @ac: 1
@pytest.mark.parametrize("username", ["tech1", "coord1"])
def test_catalogue_metadata_is_visible_to_both_inventory_roles(client, username):
    _login(client, username)
    rows = client.get("/api/equipment").get_json()
    projector = next(row for row in rows if row["name"] == "Projector")
    assert projector["description"] == "Portable projector"
    assert projector["location"] == "Equipment Store A"


# @story: SCRUM-49
# @ac: 1, 2, 6
def test_stock_edit_cannot_change_read_only_catalogue_metadata(client):
    projector = db.session.query(EquipmentType).filter_by(name="Projector").one()
    resp = _patch(client, "tech1", projector.id, {
        "total_units": 8,
        "name": "Changed name",
        "description": "Changed description",
        "location": "Changed location",
    })
    assert resp.status_code == 200
    expected = {
        "id": projector.id, "name": "Projector",
        "description": "Portable projector", "location": "Equipment Store A",
        "total_units": 8, "out_of_service_units": 0,  # SCRUM-52
    }
    assert resp.get_json() == expected
    db.session.expire_all()
    reopened = next(row for row in client.get("/api/equipment").get_json()
                    if row["id"] == projector.id)
    assert reopened == expected


# @story: SCRUM-49
# @ac: 1, 6
def test_extra_seed_preserves_catalogue_metadata_on_rerun(tmp_path):
    data = _small_fixture()
    path = _fixture_file(tmp_path, data)
    assert apply_extra(db, path) == 3
    equipment = db.session.query(EquipmentType).filter_by(name="SCRUM-49 extra type").one()
    assert equipment.description == "Fixture projector"
    assert equipment.location == "Fixture Store"
    data["equipment_types"][0]["description"] = "Replacement description"
    data["equipment_types"][0]["location"] = "Replacement location"
    path = _fixture_file(tmp_path, data)
    assert apply_extra(db, path) == 0
    db.session.expire_all()
    assert equipment.description == "Fixture projector"
    assert equipment.location == "Fixture Store"
