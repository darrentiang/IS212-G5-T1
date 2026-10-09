"""Occupied periods — SCRUM-41 (Reserve Setup and Turnaround Time Around a
Booking).

The acceptance criteria as rules at the API and in occupancy.py: an approved
booking's occupied period is its own period widened by the venue's setup and
turnaround time, with midnight rollover preserved and no clamping; search,
approval and the pre-request warnings compare occupied periods on both sides,
so a proposed event's own buffers count too; periods that only touch never
conflict; unrecorded durations are zero; and recording or changing a venue's
durations lists the Approved bookings whose occupied periods now clash, and
clears them again when they no longer do, without changing any booking. The
browser journeys are the Playwright spec's (functional/tests/SCRUM-41.spec.js).

Each test creates its own venue row with the durations it needs, so the seeded
venues' zeros (and the SCRUM-33/SCRUM-38 suites built on them) are never
assumed. Dates are 15 Dec 2026 unless a test says otherwise.
"""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import occupancy
from db import db
from models import Account, EventRequest, Venue, VenueBlock, VenueBookingRequest

DATE = "2026-12-15"
HELD = "This venue is already committed for an overlapping period: "

EVENT_FIELDS = {
    "purpose": "Client event",
    "description": "An event for SCRUM-41",
    "attendance": 40,
    "equipment_requirements": "Projector",
    "registration_needs": "Guest list supplied",
}


def login(client, username):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def account(username):
    return db.session.query(Account).filter_by(username=username).one()


def add_venue(name, setup_time=0, turnaround_time=0):
    """Its own venue, so no test leans on a seeded venue's zero durations."""
    venue = Venue(
        name=name,
        location="Block T",
        max_capacity=100,
        setup_time=setup_time,
        turnaround_time=turnaround_time,
    )
    db.session.add(venue)
    db.session.commit()
    return venue


def venue_named(name):
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


def add_booking(name, start, end, venue_name, status="Requested", date=DATE):
    """A booking for its own event, in the given status, straight into the database."""
    booking = VenueBookingRequest(
        venue=venue_named(venue_name),
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


def add_block(starts_at, ends_at, venue_name, reason="Projector replacement"):
    block = VenueBlock(
        venue=venue_named(venue_name),
        starts_at=datetime.fromisoformat(starts_at),
        ends_at=datetime.fromisoformat(ends_at),
        reason=reason,
        created_by=account("venue1"),
        created_at=datetime.now(timezone.utc),
    )
    db.session.add(block)
    db.session.commit()
    return block.id


def set_times(client, venue_name, setup_time, turnaround_time):
    login(client, "venue1")
    resp = client.patch(
        f"/api/venues/{venue_named(venue_name).id}/times",
        json={"setup_time": setup_time, "turnaround_time": turnaround_time},
    )
    assert resp.status_code == 200
    return resp.get_json()


def approve(client, booking_id, venue_name):
    login(client, "venue1")
    return client.post(
        f"/api/venues/{venue_named(venue_name).id}/bookings/{booking_id}/approve", json={}
    )


def clashes(client, venue_name):
    login(client, "venue1")
    resp = client.get(f"/api/venues/{venue_named(venue_name).id}/clashes")
    assert resp.status_code == 200
    return resp.get_json()


def search(client, event):
    login(client, "coord1")
    resp = client.get("/api/venues/search", query_string={"event_request_id": event.id})
    assert resp.status_code == 200
    return [row["id"] for row in resp.get_json()["venues"]]


def warnings_for(client, event, venue_name):
    login(client, "coord1")
    resp = client.get(f"/api/requests/{event.id}/venues/{venue_named(venue_name).id}/warnings")
    assert resp.status_code == 200
    return resp.get_json()


def occupied_of(booking_id):
    booking = db.session.get(VenueBookingRequest, booking_id)
    return occupancy.occupied_period(booking)


# --- AC1, AC4: the arithmetic of one booking's occupied period ---


# @story: SCRUM-41
# @ac: 1
def test_a_booking_occupies_setup_event_and_turnaround(client):
    add_venue("SCRUM-41 Arithmetic", setup_time=30, turnaround_time=15)
    booking_id = add_booking("TC41 Wide", "10:00", "12:00", "SCRUM-41 Arithmetic", status="Approved")

    start, end = occupied_of(booking_id)

    assert start == datetime(2026, 12, 15, 9, 30)
    assert end == datetime(2026, 12, 15, 12, 15)


# @story: SCRUM-41
# @ac: 1
def test_setup_time_rolls_the_occupied_start_into_the_previous_date(client):
    add_venue("SCRUM-41 Previous Day", setup_time=30, turnaround_time=15)
    booking_id = add_booking(
        "TC41 Previous Day", "00:15", "01:15", "SCRUM-41 Previous Day", status="Approved"
    )

    start, end = occupied_of(booking_id)

    assert start == datetime(2026, 12, 14, 23, 45)
    assert end == datetime(2026, 12, 15, 1, 30)


# @story: SCRUM-41
# @ac: 1
def test_turnaround_time_rolls_the_occupied_end_into_the_next_date(client):
    add_venue("SCRUM-41 Next Day", setup_time=30, turnaround_time=30)
    booking_id = add_booking(
        "TC41 Next Day", "23:00", "23:45", "SCRUM-41 Next Day", status="Approved"
    )

    start, end = occupied_of(booking_id)

    assert start == datetime(2026, 12, 15, 22, 30)
    assert end == datetime(2026, 12, 16, 0, 15)


# @story: SCRUM-41
# @ac: 4
@pytest.mark.parametrize(
    "setup_time, turnaround_time, expected",
    [
        (30, 0, (datetime(2026, 12, 15, 9, 30), datetime(2026, 12, 15, 12, 0))),
        (0, 15, (datetime(2026, 12, 15, 10, 0), datetime(2026, 12, 15, 12, 15))),
    ],
)
def test_one_recorded_duration_still_widens_its_own_side(
    client, setup_time, turnaround_time, expected
):
    add_venue("SCRUM-41 One Side", setup_time=setup_time, turnaround_time=turnaround_time)
    booking_id = add_booking("TC41 One Side", "10:00", "12:00", "SCRUM-41 One Side", status="Approved")

    assert occupied_of(booking_id) == expected


# @story: SCRUM-41
# @ac: 4
def test_unrecorded_durations_leave_the_period_the_bookings_own(client):
    add_venue("SCRUM-41 Unrecorded")
    booking_id = add_booking("TC41 Zero", "10:00", "12:00", "SCRUM-41 Unrecorded", status="Approved")

    start, end = occupied_of(booking_id)

    assert start == datetime(2026, 12, 15, 10, 0)
    assert end == datetime(2026, 12, 15, 12, 0)


# --- AC3: occupied periods conflict only when they really overlap ---


# @story: SCRUM-41
# @ac: 3
@pytest.mark.parametrize(
    "second_start, second_end, overlapping",
    [
        ("2026-12-15T12:15", "2026-12-15T14:00", False),  # touches the first's end
        ("2026-12-15T12:14", "2026-12-15T14:00", True),  # one minute over its end
        ("2026-12-15T09:30", "2026-12-15T12:15", True),  # identical
        ("2026-12-15T10:00", "2026-12-15T11:00", True),  # contained
        ("2026-12-15T08:00", "2026-12-15T13:00", True),  # contains
        ("2026-12-15T08:00", "2026-12-15T09:30", False),  # touches the first's start
        ("2026-12-15T08:00", "2026-12-15T09:29", False),  # one-minute gap before
    ],
)
def test_occupied_periods_conflict_only_when_they_really_overlap(
    client, second_start, second_end, overlapping
):
    first = (datetime(2026, 12, 15, 9, 30), datetime(2026, 12, 15, 12, 15))
    second = (datetime.fromisoformat(second_start), datetime.fromisoformat(second_end))

    assert occupancy.overlaps(*first, *second) is overlapping
    # The reverse direction agrees; overlap never depends on which is "first".
    assert occupancy.overlaps(*second, *first) is overlapping


# --- AC1, AC3: the approval boundaries, with both sides buffered ---


# @story: SCRUM-41
# @ac: 1, 3
def test_a_one_minute_overlap_between_occupied_periods_refuses_the_approval(client):
    name = "SCRUM-41 Overlap"
    add_venue(name, setup_time=30, turnaround_time=15)
    add_booking("TC41 Holder A", "10:00", "12:00", name, status="Approved")
    booking_id = add_booking("TC41 Overlap B", "12:44", "13:44", name)

    resp = approve(client, booking_id, name)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == HELD + "TC41 Holder A, 15 Dec 2026, 10:00–12:00."
    booking = db.session.get(VenueBookingRequest, booking_id)
    assert booking.status == "Requested"
    assert booking.decision is None


# @story: SCRUM-41
# @ac: 1, 3
def test_occupied_periods_that_exactly_touch_allow_the_approval(client):
    name = "SCRUM-41 Touch"
    add_venue(name, setup_time=30, turnaround_time=15)
    add_booking("TC41 Holder A", "10:00", "12:00", name, status="Approved")
    booking_id = add_booking("TC41 Touch B", "12:45", "13:45", name)

    resp = approve(client, booking_id, name)

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Approved"


# @story: SCRUM-41
# @ac: 1, 3
def test_a_one_minute_gap_between_occupied_periods_allows_the_approval(client):
    name = "SCRUM-41 Gap"
    add_venue(name, setup_time=30, turnaround_time=15)
    add_booking("TC41 Holder A", "10:00", "12:00", name, status="Approved")
    booking_id = add_booking("TC41 Gap B", "12:46", "13:46", name)

    resp = approve(client, booking_id, name)

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Approved"


# @story: SCRUM-41
# @ac: 1, 3
def test_a_refused_approval_leaves_both_bookings_exactly_as_they_were(client):
    name = "SCRUM-41 Unchanged"
    add_venue(name, setup_time=30, turnaround_time=15)
    holder_id = add_booking("TC41 Holder A", "10:00", "12:00", name, status="Approved")
    booking_id = add_booking("TC41 Overlap B", "12:44", "13:44", name)

    assert approve(client, booking_id, name).status_code == 409

    holder = db.session.get(VenueBookingRequest, holder_id)
    assert holder.status == "Approved"
    assert (holder.date, holder.start_time, holder.end_time) == (DATE, "10:00", "12:00")


# --- AC1, AC2, AC3: the candidate's own buffers in search and warnings ---


# @story: SCRUM-41
# @ac: 2
@pytest.mark.parametrize("start, end", [("09:40", "09:50"), ("12:05", "12:10")])
def test_search_excludes_a_venue_during_an_existing_bookings_setup_or_turnaround(
    client, start, end
):
    name = "SCRUM-41 Search Held"
    add_venue(name, setup_time=30, turnaround_time=15)
    add_booking("TC41 Holder A", "10:00", "12:00", name, status="Approved")
    event = make_event(f"TC41 Search {start}", start, end)

    assert venue_named(name).id not in search(client, event)


# @story: SCRUM-41
# @ac: 1, 2, 3
def test_search_excludes_a_venue_whose_proposed_setup_reaches_into_a_turnaround(client):
    name = "SCRUM-41 Search Buffer"
    add_venue(name, setup_time=30, turnaround_time=15)
    add_booking("TC41 Holder A", "10:00", "12:00", name, status="Approved")
    # Published 12:30–13:30 clears the holder's published period, but its own
    # 30 minutes of setup make it occupy from 12:00, inside the turnaround.
    event = make_event("TC41 Late Pick", "12:30", "13:30")

    assert venue_named(name).id not in search(client, event)


# @story: SCRUM-41
# @ac: 3
def test_search_still_offers_a_venue_whose_occupied_period_only_touches(client):
    name = "SCRUM-41 Search Touch"
    add_venue(name, setup_time=30, turnaround_time=15)
    add_booking("TC41 Holder A", "10:00", "12:00", name, status="Approved")
    # Occupied from 12:15, exactly where the holder's turnaround ends.
    event = make_event("TC41 Touch Pick", "12:45", "13:45")

    assert venue_named(name).id in search(client, event)


# @story: SCRUM-41
# @ac: 1, 2, 3
def test_warnings_count_the_proposed_events_own_buffers_but_name_the_published_period(client):
    name = "SCRUM-41 Warned"
    add_venue(name, setup_time=30, turnaround_time=15)
    holder_id = add_booking("TC41 Holder A", "10:00", "12:00", name, status="Approved")
    event = make_event("TC41 Buffer Pick", "12:30", "13:30")

    # The line names the holder's own published period, as the warnings always
    # have; it is the comparison that uses the occupied periods.
    assert warnings_for(client, event, name) == [
        {
            "type": "approved_booking",
            "id": holder_id,
            "event_request_name": "TC41 Holder A",
            "date": DATE,
            "start_time": "10:00",
            "end_time": "12:00",
        }
    ]


# @story: SCRUM-41
# @ac: 3
def test_a_candidate_whose_occupied_period_only_touches_gives_no_warning(client):
    name = "SCRUM-41 Quiet"
    add_venue(name, setup_time=30, turnaround_time=15)
    add_booking("TC41 Holder A", "10:00", "12:00", name, status="Approved")
    event = make_event("TC41 Touch Pick", "12:45", "13:45")

    assert warnings_for(client, event, name) == []


# --- AC1, AC3: blocks stay unbuffered and are compared against the candidate ---


# @story: SCRUM-41
# @ac: 1
def test_approving_is_refused_when_the_candidates_setup_reaches_into_a_block(client):
    name = "SCRUM-41 Blocked Buffer"
    add_venue(name, setup_time=30, turnaround_time=15)
    add_block("2026-12-15T11:00", "2026-12-15T12:15", name)
    booking_id = add_booking("TC41 After Block", "12:30", "13:30", name)

    resp = approve(client, booking_id, name)

    assert resp.status_code == 409
    assert resp.get_json()["message"] == (
        HELD + "blocked 15 Dec 2026, 11:00 to 15 Dec 2026, 12:15 (Projector replacement)."
    )


# @story: SCRUM-41
# @ac: 1, 3
def test_a_block_is_never_widened_so_a_touching_candidate_is_allowed(client):
    name = "SCRUM-41 Block Touch"
    add_venue(name, setup_time=30, turnaround_time=15)
    add_block("2026-12-15T11:00", "2026-12-15T12:15", name)
    # Occupied from 12:15, exactly where the block ends; the block itself has
    # no turnaround to widen it.
    booking_id = add_booking("TC41 Touch Block", "12:45", "13:45", name)

    assert approve(client, booking_id, name).status_code == 200


# --- AC1: the read contract carries occupied periods beside published ones ---


# @story: SCRUM-41
# @ac: 1
def test_the_booking_list_carries_the_occupied_period_beside_the_published_one(client):
    name = "SCRUM-41 Listed"
    add_venue(name, setup_time=30, turnaround_time=15)
    booking_id = add_booking("TC41 Wide", "10:00", "12:00", name, status="Approved")
    login(client, "coord1")

    rows = client.get(f"/api/venues/{venue_named(name).id}/bookings").get_json()
    row = next(row for row in rows if row["id"] == booking_id)

    assert row["occupied_start"] == "2026-12-15T09:30"
    assert row["occupied_end"] == "2026-12-15T12:15"
    # The published period is never overwritten by the buffers.
    assert (row["date"], row["start_time"], row["end_time"]) == (DATE, "10:00", "12:00")


# @story: SCRUM-41
# @ac: 5
def test_a_requested_booking_also_carries_its_derived_occupied_period(client):
    name = "SCRUM-41 Pending"
    add_venue(name, setup_time=30, turnaround_time=15)
    booking_id = add_booking("TC41 Pending", "10:00", "12:00", name)
    login(client, "coord1")

    rows = client.get(f"/api/venues/{venue_named(name).id}/bookings").get_json()
    row = next(row for row in rows if row["id"] == booking_id)

    assert (row["occupied_start"], row["occupied_end"]) == ("2026-12-15T09:30", "2026-12-15T12:15")


# --- AC5: what the venue's recorded durations currently clash over ---


# @story: SCRUM-41
# @ac: 1, 5
def test_recording_durations_lists_the_whole_chain_of_affected_bookings(client):
    name = "SCRUM-41 Chain"
    other = add_venue("SCRUM-41 Chain Other", setup_time=30, turnaround_time=15)
    add_venue(name)
    a_id = add_booking("TC41 Chain A", "10:00", "12:00", name, status="Approved")
    b_id = add_booking("TC41 Chain B", "12:30", "13:30", name, status="Approved")
    c_id = add_booking("TC41 Chain C", "14:00", "15:00", name, status="Approved")
    add_booking("TC41 Chain D", "15:15", "16:00", name)  # Requested
    add_booking("TC41 Chain E", "10:30", "11:30", other.name, status="Approved")

    set_times(client, name, 30, 15)

    # A overlaps B and B overlaps C, so all three are listed once each; the
    # Requested booking and the other venue's are not.
    rows = clashes(client, name)
    assert [row["id"] for row in rows] == [a_id, b_id, c_id]
    assert [(row["occupied_start"], row["occupied_end"]) for row in rows] == [
        ("2026-12-15T09:30", "2026-12-15T12:15"),
        ("2026-12-15T12:00", "2026-12-15T13:45"),
        ("2026-12-15T13:30", "2026-12-15T15:15"),
    ]
    # Published periods come along unchanged.
    assert [(row["date"], row["start_time"], row["end_time"]) for row in rows] == [
        (DATE, "10:00", "12:00"),
        (DATE, "12:30", "13:30"),
        (DATE, "14:00", "15:00"),
    ]
    # Each row names the event, with its request id so the page can link the
    # name for an account with requests.view (ui-guidelines.md §7).
    assert [row["event_request_name"] for row in rows] == [
        "TC41 Chain A",
        "TC41 Chain B",
        "TC41 Chain C",
    ]
    assert [row["event_request_id"] for row in rows] == [
        booking.event_request_id
        for booking in (
            db.session.get(VenueBookingRequest, a_id),
            db.session.get(VenueBookingRequest, b_id),
            db.session.get(VenueBookingRequest, c_id),
        )
    ]


# @story: SCRUM-41
# @ac: 5
def test_reducing_a_duration_clears_the_resolved_clashes(client):
    name = "SCRUM-41 Resolved"
    add_venue(name, setup_time=30, turnaround_time=15)
    a_id = add_booking("TC41 Clear A", "10:00", "12:00", name, status="Approved")
    b_id = add_booking("TC41 Clear B", "12:30", "13:30", name, status="Approved")
    assert [row["id"] for row in clashes(client, name)] == [a_id, b_id]

    set_times(client, name, 0, 15)

    assert clashes(client, name) == []
    a = db.session.get(VenueBookingRequest, a_id)
    b = db.session.get(VenueBookingRequest, b_id)
    assert (a.status, a.date, a.start_time, a.end_time) == ("Approved", DATE, "10:00", "12:00")
    assert (b.status, b.date, b.start_time, b.end_time) == ("Approved", DATE, "12:30", "13:30")


# @story: SCRUM-41
# @ac: 5
def test_a_save_that_exposes_clashes_still_succeeds(client):
    name = "SCRUM-41 Exposed"
    add_venue(name)
    add_booking("TC41 Exposed A", "10:00", "12:00", name, status="Approved")
    add_booking("TC41 Exposed B", "12:30", "13:30", name, status="Approved")

    body = set_times(client, name, 30, 15)

    assert (body["setup_time"], body["turnaround_time"]) == (30, 15)
    assert len(clashes(client, name)) == 2


# @story: SCRUM-41
# @ac: 5
def test_a_valid_save_with_nothing_clashing_lists_none(client):
    name = "SCRUM-41 Quiet Save"
    add_venue(name)
    add_booking("TC41 Quiet A", "10:00", "12:00", name, status="Approved")
    add_booking("TC41 Quiet B", "13:00", "14:00", name, status="Approved")

    set_times(client, name, 15, 15)

    assert clashes(client, name) == []


# @story: SCRUM-41
# @ac: 5
def test_a_lone_approved_booking_never_clashes_with_itself(client):
    name = "SCRUM-41 Alone"
    add_venue(name, setup_time=30, turnaround_time=15)
    add_booking("TC41 Alone", "10:00", "12:00", name, status="Approved")

    assert clashes(client, name) == []


# @story: SCRUM-41
# @ac: 5
@pytest.mark.parametrize("status", ["Requested", "Rejected", "Withdrawn"])
def test_a_booking_that_is_not_approved_never_appears_in_the_clash_list(client, status):
    name = f"SCRUM-41 {status}"
    add_venue(name, setup_time=30, turnaround_time=15)
    # A would clash with B on their occupied periods if B were Approved, but
    # only Approved bookings are ever compared, so nothing clashes.
    add_booking(f"TC41 {status} A", "10:00", "12:00", name, status="Approved")
    add_booking(f"TC41 {status} B", "12:30", "13:30", name, status=status)

    assert clashes(client, name) == []


# --- An extreme accepted duration must never break a read ---


# @story: SCRUM-41
# @ac: 1
def test_a_duration_out_of_python_range_clamps_at_the_edges_instead_of_raising():
    """Even a minute count timedelta itself cannot hold clamps, on both sides.

    The clamp is the whole rule for extreme durations (occupancy._shift): no
    maximum duration is invented, and no read can raise instead of answering.
    """
    venue = SimpleNamespace(setup_time=10**20, turnaround_time=10**20)

    start, end = occupancy.buffered_period(venue, DATE, "10:00", "12:00")

    assert start == datetime.min
    assert end == datetime.max


# @story: SCRUM-41
# @ac: 1, 5
def test_extreme_saved_durations_never_break_a_read(client):
    """The reviewer's reproduction: setup_time 2000000000 saves with 200, and
    every list that derives its periods from it still answers — the booking
    list with a clamped occupied period, the clash list, search, warnings and
    an approval refusal, none of them a server error.
    """
    name = "SCRUM-41 Extreme"
    add_venue(name)
    a_id = add_booking("TC41 Extreme A", "10:00", "12:00", name, status="Approved")
    b_id = add_booking("TC41 Extreme B", "12:30", "13:30", name, status="Approved")
    c_id = add_booking("TC41 Extreme C", "14:00", "15:00", name)

    # The save is accepted exactly as before — no maximum has been invented.
    set_times(client, name, 2_000_000_000, 15)

    # The booking list reads: the occupied start clamps at the first date
    # Python represents, while the published period stays as recorded.
    login(client, "coord1")
    rows = client.get(f"/api/venues/{venue_named(name).id}/bookings").get_json()
    row = next(row for row in rows if row["id"] == a_id)
    assert (row["occupied_start"], row["occupied_end"]) == ("0001-01-01T00:00", "2026-12-15T12:15")
    assert (row["date"], row["start_time"], row["end_time"]) == (DATE, "10:00", "12:00")

    # Both Approved bookings now hold the venue from that edge, so both clash
    # — and the clash list serializes the clamped endpoints the same
    # four-digit way the booking list does, on every platform.
    clash_rows = clashes(client, name)
    assert [row["id"] for row in clash_rows] == [a_id, b_id]
    assert {row["occupied_start"] for row in clash_rows} == {"0001-01-01T00:00"}

    # Search and warnings answer on the same arithmetic: the venue is held.
    event = make_event("TC41 Extreme Search", "09:00", "11:00")
    assert venue_named(name).id not in search(client, event)
    warnings = warnings_for(client, event, name)
    assert [w["type"] for w in warnings].count("approved_booking") == 2

    # An approval reads the same way: refused with its message, never a crash.
    resp = approve(client, c_id, name)
    assert resp.status_code == 409
    assert "TC41 Extreme A" in resp.get_json()["message"]


# --- Permissions and missing objects ---


# @story: SCRUM-41
# @ac: 5
@pytest.mark.parametrize("username", ["coord1", "org1", "tech1", "att1"])
def test_the_clash_list_needs_venues_edit(client, username):
    name = "SCRUM-41 Permission"
    add_venue(name, setup_time=30, turnaround_time=15)
    login(client, username)

    resp = client.get(f"/api/venues/{venue_named(name).id}/clashes")

    assert resp.status_code == 403


# @story: SCRUM-41
# @ac: 5
def test_the_clash_list_for_an_unknown_venue_is_not_found(client):
    login(client, "venue1")

    assert client.get("/api/venues/9999/clashes").status_code == 404
