"""Double-booking rules — SCRUM-38 (Prevent Double-Booking of a Venue).

The acceptance criteria as rules at the API: approving a booking is refused
(409) while an Approved booking or a block of the same venue overlaps its
period, the refusal names each holder, periods that only touch do not
overlap, the first of two overlapping requests approved holds the venue, a
refused approval leaves the request Requested with no decision, and choosing
a held venue warns the Event Coordinator without stopping the raise. The
overlap rule itself (occupancy.py) is tested directly for its ordering. The
browser journeys are the Playwright spec's (functional/tests/SCRUM-38.spec.js).

Seeded venues: Seminar Room 1 (capacity 60, 08:00 to 20:00) and Auditorium.
Every booking here is on 10 Dec 2026, 40 people, unless a test says otherwise.
SCRUM-41 (setup and turnaround time) is built, but the seeded venues record
none, so a booking's occupied period here is its own period. The widening
itself is tested in test_occupied_periods.py.
"""

from datetime import datetime, timezone

import pytest

import occupancy
from areas.bookings.services import venue_warnings
from db import db
from factories import account
from models import EventRequest, Venue, VenueBlock, VenueBookingRequest

DATE = "2026-12-10"
SEMINAR_ROOM_1 = "Seminar Room 1"
AUDITORIUM = "Auditorium"
HELD = "This venue is already committed for an overlapping period: "

EVENT_FIELDS = {
    "purpose": "Client event",
    "description": "An event for SCRUM-38",
    "attendance": 40,
    "equipment_requirements": "Projector",
    "registration_needs": "Guest list supplied",
}


def login(client, username):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def venue(name=SEMINAR_ROOM_1):
    return db.session.query(Venue).filter_by(name=name).one()


def make_event(name, start, end, date=DATE):
    event = EventRequest(
        created_by=account("org1"),
        status="Approved",
        name=name,
        date=date,
        start_time=start,
        end_time=end,
        **EVENT_FIELDS,
    )
    db.session.add(event)
    db.session.commit()
    return event


def add_booking(name, start, end, status="Requested", venue_name=SEMINAR_ROOM_1, date=DATE):
    """A booking for its own event, in the given status, straight into the database."""
    booking = VenueBookingRequest(
        venue=venue(venue_name),
        event_request=make_event(name, start, end, date=date),
        status=status,
        date=date,
        start_time=start,
        end_time=end,
        attendance=40,
        raised_by=account("coord1"),
        raised_at=datetime.now(timezone.utc),
    )
    db.session.add(booking)
    db.session.commit()
    return booking.id


def add_block(starts_at, ends_at, reason="Projector replacement", venue_name=SEMINAR_ROOM_1):
    block = VenueBlock(
        venue=venue(venue_name),
        starts_at=datetime.fromisoformat(starts_at),
        ends_at=datetime.fromisoformat(ends_at),
        reason=reason,
        created_by=account("venue1"),
        created_at=datetime.now(timezone.utc),
    )
    db.session.add(block)
    db.session.commit()
    return block.id


def decide(client, booking_id, action, venue_name=SEMINAR_ROOM_1, **body):
    return client.post(
        f"/api/venues/{venue(venue_name).id}/bookings/{booking_id}/{action}", json=body
    )


def approve(client, booking_id, venue_name=SEMINAR_ROOM_1, **body):
    return decide(client, booking_id, "approve", venue_name, **body)


def assert_undecided(booking_id):
    booking = db.session.get(VenueBookingRequest, booking_id)
    db.session.refresh(booking)
    assert booking.status == "Requested"
    assert booking.decision is None
    assert booking.decision_reason is None
    assert booking.decided_at is None
    assert booking.decided_by is None


# --- AC1, AC2, AC6: an overlapping approved booking refuses the approval ---


# @story: SCRUM-38
# @ac: 1, 2, 6
@pytest.mark.parametrize(
    "start, end",
    [
        ("16:00", "18:00"),  # overlaps the holder's end
        ("13:00", "15:00"),  # overlaps the holder's start
        ("13:00", "18:00"),  # encloses the holder
        ("15:00", "16:00"),  # inside the holder
        ("14:00", "17:00"),  # the same period
    ],
)
def test_approving_over_an_approved_booking_is_refused_naming_it(client, start, end):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    booking_id = add_booking("TC38 Overlap", start, end)
    login(client, "venue1")

    resp = approve(client, booking_id)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == HELD + "TC38 Holder, 10 Dec 2026, 14:00–17:00."
    assert_undecided(booking_id)


# @story: SCRUM-38
# @ac: 6
def test_a_refused_approval_records_no_decision_even_with_a_reason(client):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    booking_id = add_booking("TC38 Overlap", "16:00", "18:00")
    login(client, "venue1")

    resp = approve(client, booking_id, reason="Fits our calendar")

    assert resp.status_code == 409
    assert_undecided(booking_id)
    listed = client.get(f"/api/venues/{venue().id}/bookings").get_json()
    row = next(row for row in listed if row["id"] == booking_id)
    assert row["status"] == "Requested"
    assert row["decision"] is None
    assert row["decided_by"] is None


# @story: SCRUM-38
# @ac: 1
def test_the_same_period_at_another_venue_is_not_a_conflict(client):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved", venue_name=AUDITORIUM)
    booking_id = add_booking("TC38 Other Venue", "14:00", "17:00")
    login(client, "venue1")

    resp = approve(client, booking_id)

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Approved"


# @story: SCRUM-38
# @ac: 1
def test_the_same_times_on_another_date_are_not_a_conflict(client):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    booking_id = add_booking("TC38 Other Day", "14:00", "17:00", date="2026-12-11")
    login(client, "venue1")

    assert approve(client, booking_id).status_code == 200


# @story: SCRUM-38
# @ac: 1
@pytest.mark.parametrize("status", ["Requested", "Rejected", "Withdrawn"])
def test_a_booking_that_is_not_approved_does_not_hold_the_venue(client, status):
    add_booking("TC38 Other", "14:00", "17:00", status=status)
    booking_id = add_booking("TC38 Clear", "15:00", "16:00")
    login(client, "venue1")

    assert approve(client, booking_id).status_code == 200


# @story: SCRUM-38
# @ac: 1
def test_a_booking_with_nothing_else_on_the_venue_never_clashes_with_itself(client):
    booking_id = add_booking("TC38 Alone", "14:00", "17:00")
    login(client, "venue1")

    assert approve(client, booking_id).status_code == 200


# --- AC3, AC2: an overlapping block refuses the approval ---


# @story: SCRUM-38
# @ac: 2, 3, 6
@pytest.mark.parametrize(
    "start, end",
    [("14:00", "16:00"), ("12:00", "14:00"), ("12:00", "16:00"), ("13:30", "14:30")],
)
def test_approving_over_a_block_is_refused_naming_it(client, start, end):
    add_block("2026-12-10T13:00", "2026-12-10T15:00")
    booking_id = add_booking("TC38 Blocked", start, end)
    login(client, "venue1")

    resp = approve(client, booking_id)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        HELD + "blocked 10 Dec 2026, 13:00 to 10 Dec 2026, 15:00 (Projector replacement)."
    )
    assert_undecided(booking_id)


# @story: SCRUM-38
# @ac: 3
def test_a_block_spanning_days_holds_the_venue_on_each_of_them(client):
    add_block("2026-12-09T18:00", "2026-12-11T09:00", reason="Refit")
    booking_id = add_booking("TC38 Mid Refit", "10:00", "12:00")
    login(client, "venue1")

    resp = approve(client, booking_id)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        HELD + "blocked 09 Dec 2026, 18:00 to 11 Dec 2026, 09:00 (Refit)."
    )


# @story: SCRUM-38
# @ac: 3
def test_a_block_on_another_venue_is_not_a_conflict(client):
    add_block("2026-12-10T13:00", "2026-12-10T15:00", venue_name=AUDITORIUM)
    booking_id = add_booking("TC38 Free", "14:00", "16:00")
    login(client, "venue1")

    assert approve(client, booking_id).status_code == 200


# --- AC2: several holders are all named ---


# @story: SCRUM-38
# @ac: 2
def test_every_holder_is_named_bookings_first_then_blocks_each_earliest_first(client):
    add_block("2026-12-10T16:00", "2026-12-10T17:00", reason="Deep clean")
    add_booking("TC38 Later", "15:00", "16:00", status="Approved")
    add_block("2026-12-10T09:00", "2026-12-10T11:00", reason="Projector replacement")
    add_booking("TC38 Earlier", "10:00", "12:00", status="Approved")
    booking_id = add_booking("TC38 All Day", "08:00", "18:00")
    login(client, "venue1")

    resp = approve(client, booking_id)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        HELD
        + "TC38 Earlier, 10 Dec 2026, 10:00–12:00; "
        + "TC38 Later, 10 Dec 2026, 15:00–16:00; "
        + "blocked 10 Dec 2026, 09:00 to 10 Dec 2026, 11:00 (Projector replacement); "
        + "blocked 10 Dec 2026, 16:00 to 10 Dec 2026, 17:00 (Deep clean)."
    )


# --- AC4: touching is not overlapping ---


# @story: SCRUM-38
# @ac: 4
@pytest.mark.parametrize("start, end", [("11:00", "14:00"), ("17:00", "19:00")])
def test_a_booking_touching_an_approved_booking_is_not_a_conflict(client, start, end):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    booking_id = add_booking("TC38 Touch", start, end)
    login(client, "venue1")

    assert approve(client, booking_id).status_code == 200


# @story: SCRUM-38
# @ac: 3, 4
@pytest.mark.parametrize("start, end", [("12:00", "14:00"), ("07:00", "09:00")])
def test_a_booking_touching_a_block_is_not_a_conflict(client, start, end):
    add_block("2026-12-10T09:00", "2026-12-10T12:00", reason="Deep clean")
    booking_id = add_booking("TC38 Touch Block", start, end)
    login(client, "venue1")

    assert approve(client, booking_id).status_code == 200


# --- AC5: of two overlapping requests, the first approved holds the venue ---


# @story: SCRUM-38
# @ac: 2, 5, 6
def test_the_first_of_two_overlapping_requests_approved_holds_the_venue(client):
    login(client, "coord1")
    first_event = make_event("TC38 First", "14:00", "17:00")
    second_event = make_event("TC38 Second", "15:00", "18:00")
    first = client.post(f"/api/requests/{first_event.id}/bookings", json={"venue_id": venue().id})
    second = client.post(f"/api/requests/{second_event.id}/bookings", json={"venue_id": venue().id})
    assert first.status_code == second.status_code == 201
    login(client, "venue1")

    assert approve(client, first.get_json()["id"]).status_code == 200
    resp = approve(client, second.get_json()["id"])

    assert resp.status_code == 409
    assert resp.get_json()["message"] == HELD + "TC38 First, 10 Dec 2026, 14:00–17:00."
    assert_undecided(second.get_json()["id"])


# --- Where the check sits in the approve flow ---


# @story: SCRUM-38
# @ac: 1
def test_an_already_decided_booking_is_refused_as_decided_before_any_conflict(client):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    booking_id = add_booking("TC38 Decided", "14:00", "17:00", status="Rejected")
    login(client, "venue1")

    resp = approve(client, booking_id)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == "This booking request has already been decided (Rejected)."


# @story: SCRUM-38
# @ac: 1
def test_an_account_without_venue_staff_is_refused_before_any_conflict(client):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    booking_id = add_booking("TC38 Overlap", "16:00", "18:00")
    login(client, "coord1")

    assert approve(client, booking_id).status_code == 403
    assert_undecided(booking_id)


# @story: SCRUM-38
# @ac: 1
def test_rejecting_an_overlapping_booking_is_never_checked(client):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    booking_id = add_booking("TC38 Overlap", "16:00", "18:00")
    login(client, "venue1")

    resp = decide(client, booking_id, "reject", reason="Already committed")

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Rejected"


# --- AC7: choosing a held venue warns the coordinator, who may still raise ---


def warnings_for(client, event, venue_name=SEMINAR_ROOM_1):
    login(client, "coord1")
    resp = client.get(f"/api/requests/{event.id}/venues/{venue(venue_name).id}/warnings")
    assert resp.status_code == 200
    return resp.get_json()


# @story: SCRUM-38
# @ac: 7
def test_choosing_a_venue_with_an_overlapping_approved_booking_warns_naming_it(client):
    holder_id = add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    event = make_event("TC38 Late Pick", "16:00", "18:00")

    assert warnings_for(client, event) == [
        {
            "type": "approved_booking",
            "id": holder_id,
            "event_request_name": "TC38 Holder",
            "date": DATE,
            "start_time": "14:00",
            "end_time": "17:00",
        }
    ]


# @story: SCRUM-38
# @ac: 7
def test_choosing_a_venue_blocked_over_the_event_warns_naming_the_block(client):
    block_id = add_block("2026-12-10T13:00", "2026-12-10T15:00")
    event = make_event("TC38 Block Pick", "14:00", "16:00")

    assert warnings_for(client, event) == [
        {
            "type": "block",
            "id": block_id,
            "start": "2026-12-10T13:00",
            "end": "2026-12-10T15:00",
            "reason": "Projector replacement",
        }
    ]


# @story: SCRUM-38
# @ac: 7
@pytest.mark.parametrize("status", ["Requested", "Rejected", "Withdrawn"])
def test_a_booking_that_is_not_approved_gives_no_warning(client, status):
    add_booking("TC38 Other", "14:00", "17:00", status=status)
    event = make_event("TC38 Pick", "14:00", "17:00")

    assert warnings_for(client, event) == []


# @story: SCRUM-38
# @ac: 4, 7
def test_holders_that_only_touch_the_event_or_sit_on_another_venue_give_no_warning(client):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    add_block("2026-12-10T19:00", "2026-12-10T20:00")
    add_booking("TC38 Elsewhere", "17:00", "19:00", status="Approved", venue_name=AUDITORIUM)
    event = make_event("TC38 Touch Pick", "17:00", "19:00")

    assert warnings_for(client, event) == []


# @story: SCRUM-38
# @ac: 7
def test_holder_warnings_follow_the_mismatches_bookings_then_blocks(app):
    block_id = add_block("2026-12-10T07:00", "2026-12-10T09:00")
    later_id = add_booking("TC38 Later", "11:00", "12:00", status="Approved")
    earlier_id = add_booking("TC38 Earlier", "08:00", "09:00", status="Approved")
    event = make_event("TC38 Early", "07:30", "12:00")
    event.attendance = 61
    db.session.commit()

    warnings = venue_warnings(event, venue())

    assert [(w["type"], w.get("id")) for w in warnings] == [
        ("capacity", None),
        ("start_time", None),
        ("approved_booking", earlier_id),
        ("approved_booking", later_id),
        ("block", block_id),
    ]


# @story: SCRUM-38
# @ac: 7
def test_the_coordinator_can_still_raise_for_a_held_venue(client):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    add_block("2026-12-10T15:00", "2026-12-10T17:00")
    event = make_event("TC38 Late Pick", "16:00", "18:00")
    assert len(warnings_for(client, event)) == 2

    resp = client.post(f"/api/requests/{event.id}/bookings", json={"venue_id": venue().id})

    assert resp.status_code == 201
    assert resp.get_json()["status"] == "Requested"


# --- The one overlap rule (occupancy.py) ---


# @story: SCRUM-38
# @ac: 1, 3
def test_venue_holders_lists_each_kind_earliest_start_first_then_by_id(app):
    second_block = add_block("2026-12-10T12:00", "2026-12-10T13:00")
    first_block = add_block("2026-12-10T09:00", "2026-12-10T10:00")
    same_start_a = add_booking("TC38 A", "10:00", "11:00", status="Approved")
    same_start_b = add_booking("TC38 B", "10:00", "10:30", status="Approved")
    earliest = add_booking("TC38 C", "08:00", "09:00", status="Approved")
    add_booking("TC38 Pending", "08:00", "18:00")

    holders = occupancy.venue_holders(
        venue(), occupancy.moment(DATE, "08:00"), occupancy.moment(DATE, "18:00")
    )

    assert [row.id for row in holders.bookings] == [earliest, same_start_a, same_start_b]
    assert [row.id for row in holders.blocks] == [first_block, second_block]


# @story: SCRUM-38
# @ac: 4
def test_venue_holders_is_empty_for_a_free_venue(app):
    add_booking("TC38 Holder", "14:00", "17:00", status="Approved")
    add_block("2026-12-10T09:00", "2026-12-10T12:00")

    holders = occupancy.venue_holders(
        venue(), occupancy.moment(DATE, "12:00"), occupancy.moment(DATE, "14:00")
    )

    assert holders == occupancy.Holders(bookings=[], blocks=[], holds=[])
