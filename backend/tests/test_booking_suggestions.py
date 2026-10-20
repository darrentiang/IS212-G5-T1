"""SCRUM-78: Venue Staff suggest another venue or period when they reject a
venue booking request.

The acceptance criteria as rules at the API: a suggestion is optional and may
be a venue, a period or both; it must name an existing venue and a real
period with the start before the end, and must change the venue or the period
from what was requested; the Coordinator sees it with the reason; and it
creates no booking and holds nothing. The browser journeys are
functional/tests/SCRUM-78.spec.js.
"""

import pytest

from db import db
from models import Account, EventRequest, Venue, VenueBookingRequest

# The event every test books: Seminar Room 1, 20 Nov 2026, 09:00-17:00.
EVENT = {
    "name": "Tech Fair 2026",
    "purpose": "Career networking",
    "description": "Annual tech career fair",
    "date": "2026-11-20",
    "start_time": "09:00",
    "end_time": "17:00",
    "attendance": 40,
    "equipment_requirements": "Projector",
    "registration_needs": "Online registration",
}

REASON = "Seminar Room 1 is taken that day."


def login(client, username):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def venue_id(name):
    return db.session.query(Venue).filter_by(name=name).one().id


def make_event(name="Tech Fair 2026", **overrides):
    owner = db.session.query(Account).filter_by(username="org1").one()
    # SCRUM-87: a coordinator acts only on an event assigned to them, so every event here is coord1's.
    coordinator = db.session.query(Account).filter_by(username="coord1").one()
    event = EventRequest(
        created_by=owner,
        status="Approved",
        assigned_coordinator=coordinator,
        **{**EVENT, "name": name, **overrides},
    )
    db.session.add(event)
    db.session.commit()
    return event.id


def raise_booking(client, event=None, venue="Seminar Room 1"):
    """A fresh Requested booking at `venue`, raised by coord1; returns its id."""
    login(client, "coord1")
    event = event if event is not None else make_event()
    resp = client.post(f"/api/requests/{event}/bookings", json={"venue_id": venue_id(venue)})
    assert resp.status_code == 201
    return resp.get_json()["id"]


def reject(client, booking, venue="Seminar Room 1", reason=REASON, **suggestion):
    login(client, "venue1")
    return client.post(
        f"/api/venues/{venue_id(venue)}/bookings/{booking}/reject",
        json={"reason": reason, **suggestion},
    )


def stored(booking):
    db.session.expire_all()
    return db.session.get(VenueBookingRequest, booking)


def assert_untouched(booking):
    """Refused: still Requested, nothing of the decision or the suggestion recorded."""
    row = stored(booking)
    assert row.status == "Requested"
    assert row.decision is None
    assert row.decision_reason is None
    assert row.suggested_venue_id is None
    assert row.suggested_date is None
    assert row.suggested_start_time is None
    assert row.suggested_end_time is None


# --- AC1: a venue, a period or both; a suggestion is optional ---


# @story: SCRUM-78
# @ac: 1
def test_rejecting_with_a_suggested_venue_only(client):
    booking = raise_booking(client)

    resp = reject(client, booking, suggested_venue_id=venue_id("Auditorium"))

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Rejected"
    assert body["decision_reason"] == REASON
    assert body["suggested_venue_id"] == venue_id("Auditorium")
    assert body["suggested_venue"] == "Auditorium"
    assert body["suggested_date"] is None
    assert body["suggested_start_time"] is None
    assert body["suggested_end_time"] is None


# @story: SCRUM-78
# @ac: 1
def test_rejecting_with_a_suggested_period_only(client):
    booking = raise_booking(client)

    resp = reject(
        client, booking,
        suggested_date="2026-11-21", suggested_start_time="09:00", suggested_end_time="12:00",
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Rejected"
    assert body["suggested_venue_id"] is None
    assert body["suggested_venue"] is None
    assert (body["suggested_date"], body["suggested_start_time"], body["suggested_end_time"]) == (
        "2026-11-21", "09:00", "12:00",
    )


# @story: SCRUM-78
# @ac: 1
def test_rejecting_with_a_suggested_venue_and_period(client):
    booking = raise_booking(client)

    resp = reject(
        client, booking,
        suggested_venue_id=venue_id("Auditorium"),
        suggested_date="2026-11-21", suggested_start_time="10:00", suggested_end_time="13:00",
    )

    assert resp.status_code == 200
    row = stored(booking)
    assert row.suggested_venue.name == "Auditorium"
    assert (row.suggested_date, row.suggested_start_time, row.suggested_end_time) == (
        "2026-11-21", "10:00", "13:00",
    )


# @story: SCRUM-78
# @ac: 1
def test_a_suggestion_is_optional(client):
    booking = raise_booking(client)

    resp = reject(client, booking)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "Rejected"
    for key in ("suggested_venue_id", "suggested_venue", "suggested_date",
                "suggested_start_time", "suggested_end_time"):
        assert body[key] is None


# @story: SCRUM-78
# @ac: 1
def test_blank_suggestion_fields_count_as_no_suggestion(client):
    booking = raise_booking(client)

    resp = reject(
        client, booking,
        suggested_venue_id="", suggested_date="  ", suggested_start_time=None, suggested_end_time="",
    )

    assert resp.status_code == 200
    assert stored(booking).suggested_venue_id is None
    assert stored(booking).suggested_date is None


# @story: SCRUM-78
# @ac: 1
def test_a_suggestion_cannot_stand_in_for_the_reason(client):
    booking = raise_booking(client)

    resp = reject(client, booking, reason="  ", suggested_venue_id=venue_id("Auditorium"))

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A reason is required to reject."
    assert_untouched(booking)


# @story: SCRUM-78
# @ac: 1
def test_approving_records_no_suggestion(client):
    booking = raise_booking(client)
    login(client, "venue1")

    resp = client.post(
        f"/api/venues/{venue_id('Seminar Room 1')}/bookings/{booking}/approve",
        json={"suggested_venue_id": venue_id("Auditorium")},
    )

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Approved"
    assert stored(booking).suggested_venue_id is None


# --- AC2: an existing venue; a whole, real period; a change from the request ---


# @story: SCRUM-78
# @ac: 2
@pytest.mark.parametrize("bad_venue", [99999, 0, -1, "abc", "2.5"])
def test_a_suggested_venue_that_does_not_exist_is_refused(client, bad_venue):
    booking = raise_booking(client)

    resp = reject(client, booking, suggested_venue_id=bad_venue)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "The suggested venue must be an existing venue."
    assert_untouched(booking)


# @story: SCRUM-78
# @ac: 2
@pytest.mark.parametrize(
    "given",
    [
        {"suggested_start_time": "09:00", "suggested_end_time": "12:00"},
        {"suggested_date": "2026-11-21", "suggested_end_time": "12:00"},
        {"suggested_date": "2026-11-21", "suggested_start_time": "09:00"},
        {"suggested_date": "2026-11-21"},
    ],
)
def test_a_period_missing_a_part_is_refused(client, given):
    booking = raise_booking(client)

    resp = reject(client, booking, **given)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A suggested period needs a date, a start time and an end time."
    assert_untouched(booking)


# @story: SCRUM-78
# @ac: 2
@pytest.mark.parametrize("bad_date", ["2026-13-40", "20 Nov 2026", "tomorrow"])
def test_a_suggested_date_that_is_not_a_real_date_is_refused(client, bad_date):
    booking = raise_booking(client)

    resp = reject(client, booking, suggested_date=bad_date, suggested_start_time="09:00", suggested_end_time="12:00")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "The suggested date must be a valid date."
    assert_untouched(booking)


# @story: SCRUM-78
# @ac: 2
@pytest.mark.parametrize("start,end", [("25:00", "26:00"), ("09:00", "noon"), ("9am", "12:00")])
def test_suggested_times_that_are_not_real_times_are_refused(client, start, end):
    booking = raise_booking(client)

    resp = reject(client, booking, suggested_date="2026-11-21", suggested_start_time=start, suggested_end_time=end)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "The suggested start and end time must be valid times."
    assert_untouched(booking)


# @story: SCRUM-78
# @ac: 2
@pytest.mark.parametrize("start,end", [("12:01", "12:00"), ("12:00", "12:00"), ("17:00", "09:00")])
def test_a_start_that_is_not_before_the_end_is_refused(client, start, end):
    booking = raise_booking(client)

    resp = reject(client, booking, suggested_date="2026-11-21", suggested_start_time=start, suggested_end_time=end)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "The suggested start time must be before the end time."
    assert_untouched(booking)


# @story: SCRUM-78
# @ac: 2
def test_a_start_one_minute_before_the_end_is_accepted(client):
    booking = raise_booking(client)

    resp = reject(client, booking, suggested_date="2026-11-21", suggested_start_time="12:00", suggested_end_time="12:01")

    assert resp.status_code == 200
    assert (stored(booking).suggested_start_time, stored(booking).suggested_end_time) == ("12:00", "12:01")


# @story: SCRUM-78
# @ac: 2
def test_the_requested_venue_alone_changes_nothing_and_is_refused(client):
    booking = raise_booking(client)

    resp = reject(client, booking, suggested_venue_id=venue_id("Seminar Room 1"))

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A suggestion must change the venue or the period from what was requested."
    assert_untouched(booking)


# @story: SCRUM-78
# @ac: 2
def test_the_requested_period_alone_changes_nothing_and_is_refused(client):
    booking = raise_booking(client)

    resp = reject(client, booking, suggested_date="2026-11-20", suggested_start_time="09:00", suggested_end_time="17:00")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A suggestion must change the venue or the period from what was requested."
    assert_untouched(booking)


# @story: SCRUM-78
# @ac: 2
def test_the_same_period_written_differently_is_still_the_same_period(client):
    booking = raise_booking(client)

    resp = reject(client, booking, suggested_date="2026-11-20", suggested_start_time="9:00", suggested_end_time="17:00")

    assert resp.status_code == 400
    assert_untouched(booking)


# @story: SCRUM-78
# @ac: 2
def test_repeating_both_the_venue_and_the_period_is_refused(client):
    booking = raise_booking(client)

    resp = reject(
        client, booking,
        suggested_venue_id=venue_id("Seminar Room 1"),
        suggested_date="2026-11-20", suggested_start_time="09:00", suggested_end_time="17:00",
    )

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "A suggestion must change the venue or the period from what was requested."
    assert_untouched(booking)


# @story: SCRUM-78
# @ac: 2
def test_changing_only_the_period_is_enough_even_with_the_requested_venue_named(client):
    booking = raise_booking(client)

    resp = reject(
        client, booking,
        suggested_venue_id=venue_id("Seminar Room 1"),
        suggested_date="2026-11-20", suggested_start_time="09:00", suggested_end_time="17:01",
    )

    assert resp.status_code == 200
    assert stored(booking).suggested_end_time == "17:01"


# @story: SCRUM-78
# @ac: 2
def test_changing_only_the_venue_is_enough_even_with_the_requested_period_named(client):
    booking = raise_booking(client)

    resp = reject(
        client, booking,
        suggested_venue_id=venue_id("Auditorium"),
        suggested_date="2026-11-20", suggested_start_time="09:00", suggested_end_time="17:00",
    )

    assert resp.status_code == 200
    assert stored(booking).suggested_venue.name == "Auditorium"


# @story: SCRUM-78
# @ac: 2
def test_a_period_on_another_day_is_a_change(client):
    booking = raise_booking(client)

    resp = reject(client, booking, suggested_date="2026-11-21", suggested_start_time="09:00", suggested_end_time="17:00")

    assert resp.status_code == 200


# @story: SCRUM-78
# @ac: 2
def test_a_refused_suggestion_leaves_the_booking_open_to_a_corrected_rejection(client):
    booking = raise_booking(client)
    assert reject(client, booking, suggested_venue_id=99999).status_code == 400

    resp = reject(client, booking, suggested_venue_id=venue_id("Auditorium"))

    assert resp.status_code == 200
    assert stored(booking).status == "Rejected"


# --- AC3: the Event Coordinator sees the suggestion with the reason ---


# @story: SCRUM-78
# @ac: 3
def test_event_coordinators_and_venue_staff_see_the_suggestion_beside_the_reason(client):
    booking = raise_booking(client)
    reject(
        client, booking,
        suggested_venue_id=venue_id("Auditorium"),
        suggested_date="2026-11-21", suggested_start_time="10:00", suggested_end_time="13:00",
    )

    for username in ("coord1", "coord2", "multi1", "venue1"):
        login(client, username)
        rows = client.get(f"/api/venues/{venue_id('Seminar Room 1')}/bookings").get_json()
        row = next(item for item in rows if item["id"] == booking)
        assert row["status"] == "Rejected"
        assert row["decision_reason"] == REASON
        assert row["suggested_venue"] == "Auditorium"
        assert (row["suggested_date"], row["suggested_start_time"], row["suggested_end_time"]) == (
            "2026-11-21", "10:00", "13:00",
        )


# @story: SCRUM-78
# @ac: 3
def test_a_booking_rejected_without_a_suggestion_lists_none(client):
    booking = raise_booking(client)
    reject(client, booking)

    login(client, "coord1")
    rows = client.get(f"/api/venues/{venue_id('Seminar Room 1')}/bookings").get_json()
    row = next(item for item in rows if item["id"] == booking)

    assert row["suggested_venue"] is None
    assert row["suggested_date"] is None


# --- AC4: a suggestion creates no booking and holds nothing ---


# @story: SCRUM-78
# @ac: 4
def test_a_suggestion_creates_no_booking_request(client):
    booking = raise_booking(client)
    before = db.session.query(VenueBookingRequest).count()

    reject(
        client, booking,
        suggested_venue_id=venue_id("Auditorium"),
        suggested_date="2026-11-21", suggested_start_time="10:00", suggested_end_time="13:00",
    )

    assert db.session.query(VenueBookingRequest).count() == before
    login(client, "coord1")
    suggested_venue_rows = client.get(f"/api/venues/{venue_id('Auditorium')}/bookings").get_json()
    assert suggested_venue_rows == []


# @story: SCRUM-78
# @ac: 4
def test_a_suggested_venue_and_period_stay_free_for_another_booking(client):
    booking = raise_booking(client)
    reject(
        client, booking,
        suggested_venue_id=venue_id("Auditorium"),
        suggested_date="2026-11-21", suggested_start_time="10:00", suggested_end_time="13:00",
    )
    other_event = make_event("Other Event", date="2026-11-21", start_time="10:00", end_time="13:00")
    other_booking = raise_booking(client, event=other_event, venue="Auditorium")
    login(client, "venue1")

    resp = client.post(f"/api/venues/{venue_id('Auditorium')}/bookings/{other_booking}/approve", json={})

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Approved"


# @story: SCRUM-78
# @ac: 4
def test_the_rejected_booking_holds_nothing_at_the_original_venue_either(client):
    booking = raise_booking(client)
    reject(client, booking, suggested_date="2026-11-21", suggested_start_time="10:00", suggested_end_time="13:00")
    other_event = make_event("Other Event")
    other_booking = raise_booking(client, event=other_event)
    login(client, "venue1")

    resp = client.post(f"/api/venues/{venue_id('Seminar Room 1')}/bookings/{other_booking}/approve", json={})

    assert resp.status_code == 200


# @story: SCRUM-78
# @ac: 1
def test_only_venue_staff_can_reject_with_a_suggestion(client):
    booking = raise_booking(client)
    login(client, "coord1")

    resp = client.post(
        f"/api/venues/{venue_id('Seminar Room 1')}/bookings/{booking}/reject",
        json={"reason": REASON, "suggested_venue_id": venue_id("Auditorium")},
    )

    assert resp.status_code == 403
    assert_untouched(booking)
