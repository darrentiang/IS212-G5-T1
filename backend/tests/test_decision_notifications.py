"""SCRUM-63: Notify on Venue and Equipment Decisions — approving or rejecting a
venue booking request, approving or declining an equipment requirement, and
reserving or releasing equipment each tell the event's assigned Event
Coordinator once, in the same commit as the decision; a refused decision, a
withdrawal or an event with no coordinator tells nobody.

Every test builds its own event, venues and equipment type with
tests/factories.py. The event runs 15 Dec 2026, 10:00–12:00, the period the
messages name (ui-guidelines.md §9: '15 Dec 2026, 10:00–12:00').
"""

import pytest

from db import db
from factories import account, make_booking, make_equipment_requirement, make_event, make_venue
from models import EquipmentRequirement, EquipmentType, Notification, Reservation, VenueBookingRequest

DATE = "2026-12-15"
PERIOD = "15 Dec 2026, 10:00–12:00"


def login_as(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def event(name="Annual Gala", status="Planning", coordinator="coord1"):
    return make_event(
        name=name,
        status=status,
        date=DATE,
        start_time="10:00",
        end_time="12:00",
        attendance=40,
        assigned_coordinator=account(coordinator) if coordinator else None,
    )


def equipment(name="TC63 Projector", total_units=10):
    row = EquipmentType(name=name, total_units=total_units)
    db.session.add(row)
    db.session.commit()
    return row


def notifications_about(gala):
    """Every notification of the event, oldest first, as (recipient, message)."""
    db.session.expire_all()
    rows = (
        db.session.query(Notification)
        .filter_by(event_request_id=gala.id)
        .order_by(Notification.id)
        .all()
    )
    return [(row.recipient.username, row.message) for row in rows]


def approve(client, booking, body=None):
    return client.post(f"/api/venues/{booking.venue_id}/bookings/{booking.id}/approve", json=body or {})


def reject(client, booking, body):
    return client.post(f"/api/venues/{booking.venue_id}/bookings/{booking.id}/reject", json=body)


def decide(client, gala, requirement, body):
    return client.patch(f"/api/requests/{gala.id}/equipment/{requirement.id}/decision", json=body)


def reserve(client, gala, requirement):
    return client.post(f"/api/requests/{gala.id}/equipment/{requirement.id}/reserve")


def release(client, gala, reservation_id):
    return client.post(f"/api/requests/{gala.id}/equipment/reservations/{reservation_id}/release")


# --- AC1, AC2: venue booking decisions ---------------------------------------


# @story: SCRUM-63
# @ac: 1, 8
def test_approving_a_booking_tells_the_coordinator_the_event_venue_and_period(client):
    gala = event()
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    login_as(client, "venue1")

    resp = approve(client, booking)

    assert resp.status_code == 200
    assert notifications_about(gala) == [
        ("coord1", f"Venue booking approved for Annual Gala: Venue A, {PERIOD}.")
    ]
    row = db.session.query(Notification).filter_by(event_request_id=gala.id).one()
    assert row.read_at is None


# @story: SCRUM-63
# @ac: 1
def test_a_booking_message_names_the_booking_period_not_the_occupied_one(client):
    # 30 minutes of setup and turnaround widen the occupied period to
    # 09:30–12:30; the coordinator is told the period they asked for.
    gala = event()
    venue = make_venue(name="Venue A", setup_time=30, turnaround_time=30)
    booking = make_booking(event=gala, venue=venue, status="Requested")
    login_as(client, "venue1")

    approve(client, booking)

    assert notifications_about(gala) == [
        ("coord1", f"Venue booking approved for Annual Gala: Venue A, {PERIOD}.")
    ]


# @story: SCRUM-63
# @ac: 2
def test_rejecting_with_a_suggested_venue_and_period_tells_the_coordinator_all_of_them(client):
    gala = event()
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    venue_b = make_venue(name="Venue B")
    login_as(client, "venue1")

    resp = reject(client, booking, {
        "reason": "Venue A is reserved for maintenance",
        "suggested_venue_id": venue_b.id,
        "suggested_date": DATE,
        "suggested_start_time": "13:00",
        "suggested_end_time": "15:00",
    })

    assert resp.status_code == 200
    assert notifications_about(gala) == [(
        "coord1",
        f"Venue booking rejected for Annual Gala: Venue A, {PERIOD}. "
        "Suggested venue: Venue B. Suggested period: 15 Dec 2026, 13:00–15:00. "
        "Reason: Venue A is reserved for maintenance",
    )]


# @story: SCRUM-63
# @ac: 2
def test_rejecting_with_only_a_suggested_venue_names_no_period(client):
    gala = event()
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    venue_b = make_venue(name="Venue B")
    login_as(client, "venue1")

    reject(client, booking, {"reason": "Too small", "suggested_venue_id": venue_b.id})

    assert notifications_about(gala) == [(
        "coord1",
        f"Venue booking rejected for Annual Gala: Venue A, {PERIOD}. "
        "Suggested venue: Venue B. Reason: Too small",
    )]


# @story: SCRUM-63
# @ac: 2
def test_rejecting_with_only_a_suggested_period_names_no_venue(client):
    gala = event()
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    login_as(client, "venue1")

    reject(client, booking, {
        "reason": "Fully booked",
        "suggested_date": "2026-12-16",
        "suggested_start_time": "10:00",
        "suggested_end_time": "12:00",
    })

    assert notifications_about(gala) == [(
        "coord1",
        f"Venue booking rejected for Annual Gala: Venue A, {PERIOD}. "
        "Suggested period: 16 Dec 2026, 10:00–12:00. Reason: Fully booked",
    )]


# @story: SCRUM-63
# @ac: 2
def test_rejecting_without_a_suggestion_tells_the_reason_only(client):
    gala = event()
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    login_as(client, "venue1")

    reject(client, booking, {"reason": "Venue A is too small for the expected attendance"})

    assert notifications_about(gala) == [(
        "coord1",
        f"Venue booking rejected for Annual Gala: Venue A, {PERIOD}. "
        "Reason: Venue A is too small for the expected attendance",
    )]


# --- AC3: equipment decisions ------------------------------------------------


# @story: SCRUM-63
# @ac: 3
def test_approving_equipment_tells_the_coordinator_the_equipment_quantity_and_decision(client):
    gala = event()
    requirement = make_equipment_requirement(
        event=gala, equipment=equipment("TC63 Projector"), quantity=2,
        technical_requirements="HDMI connection required",
    )
    login_as(client, "tech1")

    resp = decide(client, gala, requirement, {"decision": "Approved"})

    assert resp.status_code == 200
    assert notifications_about(gala) == [
        ("coord1", "Equipment decision for Annual Gala: TC63 Projector × 2 Approved.")
    ]


# @story: SCRUM-63
# @ac: 3
def test_declining_equipment_tells_the_coordinator_the_reason(client):
    gala = event()
    requirement = make_equipment_requirement(event=gala, equipment=equipment("TC63 Microphones"), quantity=4)
    login_as(client, "tech1")

    resp = decide(client, gala, requirement, {
        "decision": "Declined", "reason": "  Wireless microphones cannot be provided.  ",
    })

    assert resp.status_code == 200
    assert notifications_about(gala) == [(
        "coord1",
        "Equipment decision for Annual Gala: TC63 Microphones × 4 Declined. "
        "Reason: Wireless microphones cannot be provided.",
    )]


# @story: SCRUM-63
# @ac: 3, 6
def test_correcting_an_equipment_decision_is_a_second_decision_and_a_second_notification(client):
    gala = event()
    requirement = make_equipment_requirement(event=gala, equipment=equipment("TC63 Projector"), quantity=2)
    login_as(client, "tech1")

    decide(client, gala, requirement, {"decision": "Approved"})
    decide(client, gala, requirement, {"decision": "Declined", "reason": "Model withdrawn"})

    assert notifications_about(gala) == [
        ("coord1", "Equipment decision for Annual Gala: TC63 Projector × 2 Approved."),
        ("coord1", "Equipment decision for Annual Gala: TC63 Projector × 2 Declined. Reason: Model withdrawn"),
    ]


# @story: SCRUM-63
# @ac: 3
def test_changing_an_arrangement_note_tells_nobody(client):
    gala = event()
    requirement = make_equipment_requirement(event=gala, equipment=equipment(), quantity=2)
    login_as(client, "tech1")

    resp = client.patch(
        f"/api/requests/{gala.id}/equipment/{requirement.id}/note", json={"arrangement_note": "Bay 3"}
    )

    assert resp.status_code == 200
    assert notifications_about(gala) == []


# --- AC4: reserving and releasing equipment ----------------------------------


# @story: SCRUM-63
# @ac: 4
def test_reserving_equipment_tells_the_coordinator_the_type_quantity_and_period(client):
    gala = event(status="Approved")
    requirement = make_equipment_requirement(
        event=gala, equipment=equipment("TC63 Projector"), quantity=2, status="Approved"
    )
    login_as(client, "tech1")

    resp = reserve(client, gala, requirement)

    assert resp.status_code == 201
    assert notifications_about(gala) == [
        ("coord1", f"Equipment reserved for Annual Gala: TC63 Projector × 2, {PERIOD}.")
    ]


# @story: SCRUM-63
# @ac: 4
def test_releasing_equipment_tells_the_coordinator_the_type_quantity_and_period(client):
    gala = event(status="Approved")
    projector = equipment("TC63 Projector")
    make_equipment_requirement(event=gala, equipment=projector, quantity=2, status="Approved")
    reservation = Reservation(
        event_request_id=gala.id, equipment_type_id=projector.id, quantity=2,
        date=DATE, start_time="10:00", end_time="12:00", status="Reserved",
    )
    db.session.add(reservation)
    db.session.commit()
    login_as(client, "tech1")

    resp = release(client, gala, reservation.id)

    assert resp.status_code == 200
    assert resp.get_json()["reservation"]["status"] == "Released"
    assert notifications_about(gala) == [
        ("coord1", f"Equipment released for Annual Gala: TC63 Projector × 2, {PERIOD}.")
    ]


# --- AC5: only the coordinator assigned at that moment -----------------------


# @story: SCRUM-63
# @ac: 5
def test_only_the_coordinator_assigned_now_is_told(client):
    # Reassigned from coord1 to coord2 before the decision (SCRUM-44's effect).
    gala = event(coordinator="coord1")
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    gala.assigned_coordinator = account("coord2")
    db.session.commit()
    login_as(client, "venue1")

    approve(client, booking)

    assert notifications_about(gala) == [
        ("coord2", f"Venue booking approved for Annual Gala: Venue A, {PERIOD}.")
    ]


def _booking_decision(client, gala):
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    login_as(client, "venue1")
    return approve(client, booking)


def _booking_rejection(client, gala):
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    login_as(client, "venue1")
    return reject(client, booking, {"reason": "Too small"})


def _equipment_decision(client, gala):
    requirement = make_equipment_requirement(event=gala, equipment=equipment(), quantity=2)
    login_as(client, "tech1")
    return decide(client, gala, requirement, {"decision": "Approved"})


def _equipment_reservation(client, gala):
    requirement = make_equipment_requirement(event=gala, equipment=equipment(), quantity=2, status="Approved")
    login_as(client, "tech1")
    return reserve(client, gala, requirement)


def _equipment_release(client, gala):
    projector = equipment()
    make_equipment_requirement(event=gala, equipment=projector, quantity=2, status="Approved")
    reservation = Reservation(
        event_request_id=gala.id, equipment_type_id=projector.id, quantity=2,
        date=DATE, start_time="10:00", end_time="12:00", status="Reserved",
    )
    db.session.add(reservation)
    db.session.commit()
    login_as(client, "tech1")
    return release(client, gala, reservation.id)


# Each decision with the status its success answers.
DECISIONS = [
    (_booking_decision, 200),
    (_booking_rejection, 200),
    (_equipment_decision, 200),
    (_equipment_reservation, 201),
    (_equipment_release, 200),
]


# @story: SCRUM-63
# @ac: 5
@pytest.mark.parametrize("act, succeeded", DECISIONS)
def test_with_no_coordinator_the_decision_goes_through_and_nobody_is_told(client, act, succeeded):
    gala = event(coordinator=None)
    before = db.session.query(Notification).count()

    resp = act(client, gala)

    assert resp.status_code == succeeded
    assert db.session.query(Notification).count() == before


# @story: SCRUM-63
# @ac: 5
def test_with_no_coordinator_the_equipment_decision_is_still_stored(client):
    gala = event(coordinator=None)
    requirement = make_equipment_requirement(event=gala, equipment=equipment(), quantity=2)
    login_as(client, "tech1")

    decide(client, gala, requirement, {"decision": "Approved"})

    db.session.expire_all()
    stored = db.session.get(EquipmentRequirement, requirement.id)
    assert stored.status == "Approved"
    assert stored.decided_by_id == account("tech1").id
    assert stored.decided_at is not None


# --- AC6: refused decisions tell nobody; each decision tells once ------------


# @story: SCRUM-63
# @ac: 6
@pytest.mark.parametrize("reason", ["", "   "])
def test_a_refused_equipment_decline_tells_nobody(client, reason):
    gala = event()
    requirement = make_equipment_requirement(event=gala, equipment=equipment(), quantity=2)
    login_as(client, "tech1")

    resp = decide(client, gala, requirement, {"decision": "Declined", "reason": reason})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A decline reason is required."
    assert db.session.get(EquipmentRequirement, requirement.id).status == "Requested"
    assert notifications_about(gala) == []


# @story: SCRUM-63
# @ac: 6
def test_an_equipment_decision_by_a_coordinator_is_refused_and_tells_nobody(client):
    gala = event()
    requirement = make_equipment_requirement(event=gala, equipment=equipment(), quantity=2)
    login_as(client, "coord1")

    resp = decide(client, gala, requirement, {"decision": "Approved"})

    assert resp.status_code == 403
    assert db.session.get(EquipmentRequirement, requirement.id).status == "Requested"
    assert notifications_about(gala) == []


# @story: SCRUM-63
# @ac: 6
def test_a_refused_booking_rejection_tells_nobody(client):
    gala = event()
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    login_as(client, "venue1")

    resp = reject(client, booking, {"reason": "   "})

    assert resp.status_code == 400
    assert db.session.get(VenueBookingRequest, booking.id).status == "Requested"
    assert notifications_about(gala) == []


# @story: SCRUM-63
# @ac: 6
def test_a_booking_approval_refused_by_a_conflict_tells_nobody(client):
    venue = make_venue(name="Venue A")
    holder = event(name="Holder", coordinator="coord2")
    make_booking(event=holder, venue=venue, status="Approved")
    gala = event()
    booking = make_booking(event=gala, venue=venue, status="Requested")
    login_as(client, "venue1")

    resp = approve(client, booking)

    assert resp.status_code == 409
    assert notifications_about(gala) == []
    assert notifications_about(holder) == []


# @story: SCRUM-63
# @ac: 6
def test_a_reservation_refused_for_insufficient_stock_tells_nobody(client):
    gala = event(status="Approved")
    requirement = make_equipment_requirement(
        event=gala, equipment=equipment(total_units=1), quantity=2, status="Approved"
    )
    login_as(client, "tech1")

    resp = reserve(client, gala, requirement)

    assert resp.status_code == 409
    assert db.session.query(Reservation).filter_by(event_request_id=gala.id).count() == 0
    assert notifications_about(gala) == []


# @story: SCRUM-63
# @ac: 6
def test_a_second_decision_on_a_decided_booking_is_refused_and_adds_nothing(client):
    gala = event()
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    login_as(client, "venue1")

    approve(client, booking)
    again = approve(client, booking)

    assert again.status_code == 409
    assert len(notifications_about(gala)) == 1


# @story: SCRUM-63
# @ac: 6
def test_a_second_release_is_refused_and_adds_nothing(client):
    gala = event(status="Approved")
    requirement = make_equipment_requirement(event=gala, equipment=equipment(), quantity=2, status="Approved")
    login_as(client, "tech1")
    reservation_id = reserve(client, gala, requirement).get_json()["reservation"]["id"]

    release(client, gala, reservation_id)
    again = release(client, gala, reservation_id)

    assert again.status_code == 409
    assert [message.split(" for ")[0] for _, message in notifications_about(gala)] == [
        "Equipment reserved", "Equipment released",
    ]


# --- AC7: withdrawing tells nobody -------------------------------------------


# @story: SCRUM-63
# @ac: 7
def test_withdrawing_a_booking_request_tells_nobody(client):
    gala = event()
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    before = db.session.query(Notification).count()
    login_as(client, "coord1")

    resp = client.post(f"/api/venues/{booking.venue_id}/bookings/{booking.id}/withdraw")

    assert resp.status_code == 200
    assert db.session.query(Notification).count() == before


# --- AC8: shown on the coordinator's notifications page ----------------------


# @story: SCRUM-63
# @ac: 8
def test_the_notification_reaches_only_the_coordinators_list_with_the_event_named(client):
    gala = event()
    booking = make_booking(event=gala, venue=make_venue(name="Venue A"), status="Requested")
    login_as(client, "venue1")
    approve(client, booking)

    login_as(client, "coord1")
    mine = [row for row in client.get("/api/notifications").get_json() if row["event_request_id"] == gala.id]
    login_as(client, "coord2")
    theirs = [row for row in client.get("/api/notifications").get_json() if row["event_request_id"] == gala.id]

    assert len(mine) == 1
    assert mine[0]["event_request_name"] == "Annual Gala"
    assert mine[0]["read"] is False
    assert theirs == []
