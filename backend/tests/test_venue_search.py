"""Venue search rules — SCRUM-33 (Search Venues by Date and Capacity).

The acceptance criteria as rules at the API: which events may be searched, that
the search reads the event's own values, the capacity rule, the conflict rules
(approved bookings and blocks, with touching periods not overlapping), that a
booking awaiting a decision never excludes a venue, the exact-match location
filter, the fields of a result and that nothing matching is an empty list. The
browser journeys are the Playwright spec's (functional/tests/SCRUM-33.spec.js).

Seeded venues: Seminar Room 1 (Block A Level 2, capacity 60) and Auditorium
(Block C Level 1, capacity 400). Every expected list below is worked out from
the criteria and those two rows, never from running the code.

SCRUM-41 (setup and turnaround time) is not built, so an approved booking's
occupied period is its own period here; AC3's second sentence is that story's.
"""

from datetime import datetime, timezone

import pytest

from db import db
from models import Account, EventRequest, Venue, VenueBlock, VenueBookingRequest

SEMINAR_ROOM_1 = "Seminar Room 1"
AUDITORIUM = "Auditorium"

# The event under search: 15 Dec 2026, 10:00-12:00, 50 people. 50 fits both venues.
EVENT_DEFAULTS = {
    "name": "Search Test A",
    "purpose": "Client event",
    "description": "An event for SCRUM-33",
    "date": "2026-12-15",
    "start_time": "10:00",
    "end_time": "12:00",
    "attendance": 50,
    "venue_requirements": "Any hall",
    "accessibility_needs": "None",
    "equipment_requirements": "None",
    "registration_needs": "None",
}


def login(client, username="coord1"):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def make_event(status="Approved", **overrides):
    owner = db.session.query(Account).filter_by(username="org1").one()
    fields = dict(EVENT_DEFAULTS)
    fields.update(overrides)
    event = EventRequest(created_by=owner, status=status, **fields)
    db.session.add(event)
    db.session.commit()
    return event.id


def venue(name):
    return db.session.query(Venue).filter_by(name=name).one()


def add_booking(venue_name, status, start, end, date="2026-12-15"):
    """A booking on a venue for another event, at the given times on the given date."""
    other_event = make_event(name=f"Booked Event {status} {start}-{end} {date}")
    booking = VenueBookingRequest(
        venue=venue(venue_name),
        event_request=db.session.get(EventRequest, other_event),
        status=status,
        date=date,
        start_time=start,
        end_time=end,
        attendance=10,
        venue_requirements="Any",
        raised_by=db.session.query(Account).filter_by(username="coord1").one(),
        raised_at=datetime.now(timezone.utc),
    )
    db.session.add(booking)
    db.session.commit()


def add_block(venue_name, starts_at, ends_at):
    block = VenueBlock(
        venue=venue(venue_name),
        starts_at=datetime.fromisoformat(starts_at),
        ends_at=datetime.fromisoformat(ends_at),
        reason="Maintenance",
        created_by=db.session.query(Account).filter_by(username="venue1").one(),
        created_at=datetime.now(timezone.utc),
    )
    db.session.add(block)
    db.session.commit()


def search(client, event, **params):
    return client.get("/api/venues/search", query_string={"event_request_id": event, **params})


def names(resp):
    assert resp.status_code == 200
    return [row["name"] for row in resp.get_json()["venues"]]


# --- AC1: only an Approved or Planning event may be searched ---


# @story: SCRUM-33
# @ac: 1
@pytest.mark.parametrize("status", ["Approved", "Planning"])
def test_search_is_available_for_an_approved_or_planning_event(client, status):
    login(client)
    event = make_event(status=status)

    resp = search(client, event)

    assert resp.status_code == 200
    assert names(resp) == [SEMINAR_ROOM_1, AUDITORIUM]


# @story: SCRUM-33
# @ac: 1
@pytest.mark.parametrize(
    "status", ["Draft", "Submitted", "Rejected", "Confirmed", "Completed", "Cancelled"]
)
def test_search_is_refused_for_any_other_event_status(client, status):
    login(client)
    event = make_event(status=status)

    resp = search(client, event)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Venue search is available only for an Approved or Planning event."


# @story: SCRUM-33
# @ac: 1
def test_search_reports_the_event_values_it_used(client):
    login(client)
    event = make_event(
        name="Design Day", date="2026-12-04", start_time="08:30", end_time="09:45", attendance=20
    )

    body = search(client, event).get_json()

    assert body["event"] == {
        "id": event,
        "name": "Design Day",
        "date": "2026-12-04",
        "start_time": "08:30",
        "end_time": "09:45",
        "attendance": 20,
    }


# @story: SCRUM-33
# @ac: 1
def test_search_uses_the_events_own_date_and_times(client):
    # A block 08:00-09:00 on the event's own date overlaps an event at 08:30, but would
    # not overlap the default 10:00-12:00 event: only the event's own times can exclude it.
    login(client)
    event = make_event(date="2026-12-04", start_time="08:30", end_time="09:45", attendance=20)
    add_block(SEMINAR_ROOM_1, "2026-12-04T08:00", "2026-12-04T09:00")

    assert names(search(client, event)) == [AUDITORIUM]


# @story: SCRUM-33
# @ac: 1
@pytest.mark.parametrize("params", [{}, {"event_request_id": "abc"}])
def test_search_without_a_usable_event_id_is_refused(client, params):
    login(client)

    resp = client.get("/api/venues/search", query_string=params)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Event request is required."


# @story: SCRUM-33
# @ac: 1
def test_search_for_an_unknown_event_is_refused(client):
    login(client)

    resp = search(client, 9999)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Event request not found."


# @story: SCRUM-33
# @ac: 1
@pytest.mark.parametrize("username", ["org1", "venue1", "tech1", "att1"])
def test_search_is_refused_to_an_account_without_venues_search(client, username):
    event = make_event()
    login(client, username)

    resp = search(client, event)

    assert resp.status_code == 403
    assert resp.get_json()["message"] == "You do not have permission to perform this action."


# @story: SCRUM-33
# @ac: 1
@pytest.mark.parametrize("username", ["coord1", "coord2", "multi1"])
def test_search_is_allowed_to_every_event_coordinator(client, username):
    event = make_event()
    login(client, username)

    assert search(client, event).status_code == 200


# @story: SCRUM-33
# @ac: 1
def test_search_requires_a_login(client):
    event = make_event()

    resp = search(client, event)

    assert resp.status_code == 401
    assert resp.get_json()["message"] == "Not logged in"


# --- AC2: capacity at least the expected attendance ---


# @story: SCRUM-33
# @ac: 2
@pytest.mark.parametrize(
    "attendance, expected",
    [
        (59, [SEMINAR_ROOM_1, AUDITORIUM]),  # just below Seminar Room 1's 60
        (60, [SEMINAR_ROOM_1, AUDITORIUM]),  # exactly 60: "at least" includes it
        (61, [AUDITORIUM]),  # just above 60
        (400, [AUDITORIUM]),  # exactly the Auditorium's 400
    ],
)
def test_only_venues_with_enough_capacity_are_included(client, attendance, expected):
    login(client)
    event = make_event(attendance=attendance)

    assert names(search(client, event)) == expected


# --- AC3: an approved booking or a block that overlaps the event excludes the venue ---


# @story: SCRUM-33
# @ac: 3
@pytest.mark.parametrize(
    "start, end",
    [
        ("09:00", "13:00"),  # covers the whole event
        ("10:30", "11:00"),  # inside the event
        ("08:00", "10:30"),  # overlaps the start
        ("11:00", "14:00"),  # overlaps the end
    ],
)
def test_an_overlapping_approved_booking_excludes_the_venue(client, start, end):
    login(client)
    event = make_event()
    add_booking(AUDITORIUM, "Approved", start, end)

    assert names(search(client, event)) == [SEMINAR_ROOM_1]


# @story: SCRUM-33
# @ac: 3
def test_an_overlapping_block_excludes_the_venue_even_across_days(client):
    login(client)
    event = make_event()
    add_block(SEMINAR_ROOM_1, "2026-12-15T11:00", "2026-12-16T11:00")

    assert names(search(client, event)) == [AUDITORIUM]


# @story: SCRUM-33
# @ac: 3
def test_a_block_that_started_days_before_and_still_runs_excludes_the_venue(client):
    login(client)
    event = make_event()
    add_block(SEMINAR_ROOM_1, "2026-12-10T09:00", "2026-12-20T18:00")

    assert names(search(client, event)) == [AUDITORIUM]


# @story: SCRUM-33
# @ac: 3
def test_a_booking_or_block_on_another_day_does_not_exclude_the_venue(client):
    login(client)
    event = make_event()
    add_booking(AUDITORIUM, "Approved", "10:00", "12:00", date="2026-12-16")
    add_block(SEMINAR_ROOM_1, "2026-12-16T10:00", "2026-12-16T12:00")

    assert names(search(client, event)) == [SEMINAR_ROOM_1, AUDITORIUM]


# @story: SCRUM-33
# @ac: 3
def test_a_conflict_excludes_only_the_venue_it_belongs_to(client):
    login(client)
    event = make_event()
    add_booking(AUDITORIUM, "Approved", "09:00", "13:00")
    add_block(AUDITORIUM, "2026-12-15T09:00", "2026-12-15T13:00")

    assert names(search(client, event)) == [SEMINAR_ROOM_1]


# --- AC4: a booking that is not approved never excludes the venue ---


# @story: SCRUM-33
# @ac: 3, 4
@pytest.mark.parametrize("status", ["Requested", "Rejected", "Withdrawn"])
def test_a_booking_that_is_not_approved_does_not_exclude_the_venue(client, status):
    login(client)
    event = make_event()
    add_booking(AUDITORIUM, status, "09:00", "13:00")

    assert names(search(client, event)) == [SEMINAR_ROOM_1, AUDITORIUM]


# --- AC5: periods that only touch at a boundary do not overlap ---
# The event is 10:00-12:00.


# @story: SCRUM-33
# @ac: 5
@pytest.mark.parametrize(
    "start, end, excluded",
    [
        ("09:00", "10:01", True),  # one minute into the event
        ("09:00", "10:00", False),  # ends exactly as the event starts
        ("09:00", "09:59", False),  # ends a minute before
        ("11:59", "13:00", True),  # starts one minute before the event ends
        ("12:00", "13:00", False),  # starts exactly as the event ends
        ("12:01", "13:00", False),  # starts a minute after
    ],
)
def test_booking_touching_the_event_is_not_a_conflict(client, start, end, excluded):
    login(client)
    event = make_event()
    add_booking(AUDITORIUM, "Approved", start, end)

    expected = [SEMINAR_ROOM_1] if excluded else [SEMINAR_ROOM_1, AUDITORIUM]
    assert names(search(client, event)) == expected


# @story: SCRUM-33
# @ac: 5
@pytest.mark.parametrize(
    "starts_at, ends_at, excluded",
    [
        ("2026-12-15T09:00", "2026-12-15T10:01", True),
        ("2026-12-15T09:00", "2026-12-15T10:00", False),
        ("2026-12-15T09:00", "2026-12-15T09:59", False),
        ("2026-12-15T11:59", "2026-12-15T13:00", True),
        ("2026-12-15T12:00", "2026-12-15T13:00", False),
        ("2026-12-15T12:01", "2026-12-15T13:00", False),
        # a block may span days: touching at midnight-to-event-start across a date change
        ("2026-12-14T08:00", "2026-12-15T10:00", False),
        ("2026-12-14T08:00", "2026-12-15T10:01", True),
    ],
)
def test_block_touching_the_event_is_not_a_conflict(client, starts_at, ends_at, excluded):
    login(client)
    event = make_event()
    add_block(AUDITORIUM, starts_at, ends_at)

    expected = [SEMINAR_ROOM_1] if excluded else [SEMINAR_ROOM_1, AUDITORIUM]
    assert names(search(client, event)) == expected


# --- AC6: optional location filter, exact match ---


# @story: SCRUM-33
# @ac: 6
@pytest.mark.parametrize(
    "location, expected",
    [
        ("Block C Level 1", [AUDITORIUM]),
        ("Block A Level 2", [SEMINAR_ROOM_1]),
        ("Block C", []),  # only part of a recorded location
        ("Block C Level 1 ", []),  # a trailing space is not the same text
        ("block c level 1", []),  # a different case is not the same text
        ("Block Z Level 9", []),  # a location no venue has
        ("", [SEMINAR_ROOM_1, AUDITORIUM]),  # an empty filter is no filter
    ],
)
def test_location_filter_matches_the_recorded_location_exactly(client, location, expected):
    login(client)
    event = make_event()

    assert names(search(client, event, location=location)) == expected


# @story: SCRUM-33
# @ac: 6
def test_no_location_means_no_location_restriction(client):
    login(client)
    event = make_event()

    assert names(search(client, event)) == [SEMINAR_ROOM_1, AUDITORIUM]


# @story: SCRUM-33
# @ac: 2, 6
def test_location_filter_and_capacity_both_apply(client):
    # 61 people do not fit Seminar Room 1 (60), whatever the location asked for.
    login(client)
    event = make_event(attendance=61)

    assert names(search(client, event, location="Block A Level 2")) == []


# @story: SCRUM-33
# @ac: 3, 6
def test_location_filter_and_conflicts_both_apply(client):
    login(client)
    event = make_event()
    add_block(AUDITORIUM, "2026-12-15T09:00", "2026-12-15T13:00")

    assert names(search(client, event, location="Block C Level 1")) == []


# --- AC7: a result identifies the venue and shows its location and capacity ---


# @story: SCRUM-33
# @ac: 7
def test_each_result_identifies_the_venue_with_location_and_capacity(client):
    login(client)
    event = make_event()

    rows = search(client, event).get_json()["venues"]

    assert [(row["name"], row["location"], row["max_capacity"]) for row in rows] == [
        (SEMINAR_ROOM_1, "Block A Level 2", 60),
        (AUDITORIUM, "Block C Level 1", 400),
    ]
    assert [row["id"] for row in rows] == [venue(SEMINAR_ROOM_1).id, venue(AUDITORIUM).id]


# --- AC8: nothing matching is an empty result, not an error ---


# @story: SCRUM-33
# @ac: 2, 8
def test_attendance_above_every_capacity_gives_an_empty_result(client):
    login(client)
    event = make_event(attendance=401)

    resp = search(client, event)

    assert resp.status_code == 200
    assert resp.get_json()["venues"] == []


# @story: SCRUM-33
# @ac: 3, 8
def test_every_venue_in_conflict_gives_an_empty_result(client):
    login(client)
    event = make_event()
    add_booking(SEMINAR_ROOM_1, "Approved", "10:00", "12:00")
    add_block(AUDITORIUM, "2026-12-15T10:00", "2026-12-15T12:00")

    resp = search(client, event)

    assert resp.status_code == 200
    assert resp.get_json()["venues"] == []


# --- Beyond the criteria: a retired venue is not offered (it cannot be booked, SCRUM-36 AC10) ---


# @story: SCRUM-33
# @ac: 2
def test_a_retired_venue_is_not_offered(client):
    login(client)
    event = make_event()
    auditorium = venue(AUDITORIUM)
    auditorium.is_active = False
    db.session.commit()

    assert names(search(client, event)) == [SEMINAR_ROOM_1]
