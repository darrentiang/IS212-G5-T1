"""Accessibility filter on the venue search — SCRUM-34.

The acceptance criteria as rules at the API: only features the fixed list
recognises can be selected, a venue is kept only when it records every
selected feature, selecting none restricts nothing (and the event's own
required features are never applied), and the filter only ever narrows the
SCRUM-33 search, so a venue another rule excluded stays excluded. The browser
journeys are the Playwright spec's (functional/tests/SCRUM-34.spec.js).

Venues, by name (accessibility features worked out from backend/seed/data.json):
Seminar Room 1 (capacity 60, Block A Level 2): Step-free access, Lift access.
Auditorium (capacity 400, Block C Level 1): Step-free access, Hearing loop,
Accessible toilet, Reserved seating. "No Features Hall" is added here (capacity
80, Block D Level 1, no accessibility features).
"""

from datetime import datetime, timezone
from itertools import combinations

import pytest

from db import db
from models import (
    Account,
    AccessibilityFeature,
    EventRequest,
    Venue,
    VenueBlock,
    VenueBookingRequest,
)

SEMINAR_ROOM_1 = "Seminar Room 1"
AUDITORIUM = "Auditorium"
NO_FEATURES_HALL = "No Features Hall"

STEP_FREE = "Step-free access"
HEARING_LOOP = "Hearing loop"
ACCESSIBLE_TOILET = "Accessible toilet"
LIFT = "Lift access"
RESERVED_SEATING = "Reserved seating"
ALL_FEATURES = [STEP_FREE, HEARING_LOOP, ACCESSIBLE_TOILET, LIFT, RESERVED_SEATING]

# The event under search: 15 Dec 2026, 10:00-12:00, 50 people. 50 fits every venue here.
EVENT_DEFAULTS = {
    "name": "Search Test A",
    "purpose": "Client event",
    "description": "An event for SCRUM-34",
    "date": "2026-12-15",
    "start_time": "10:00",
    "end_time": "12:00",
    "attendance": 50,
    "equipment_requirements": "None",
    "registration_needs": "None",
}


def login(client, username="coord1"):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def make_event(status="Approved", required_features=(), **overrides):
    owner = db.session.query(Account).filter_by(username="org1").one()
    features = [
        db.session.query(AccessibilityFeature).filter_by(name=name).one()
        for name in required_features
    ]
    fields = dict(EVENT_DEFAULTS)
    fields.update(overrides)
    event = EventRequest(
        created_by=owner, status=status, accessibility_features=features, **fields
    )
    db.session.add(event)
    db.session.commit()
    return event.id


def venue(name):
    return db.session.query(Venue).filter_by(name=name).one()


@pytest.fixture(autouse=True)
def no_features_hall(app):
    """A venue that records no accessibility features at all."""
    db.session.add(
        Venue(name=NO_FEATURES_HALL, location="Block D Level 1", max_capacity=80)
    )
    db.session.commit()


def add_block(venue_name, starts_at, ends_at):
    db.session.add(
        VenueBlock(
            venue=venue(venue_name),
            starts_at=datetime.fromisoformat(starts_at),
            ends_at=datetime.fromisoformat(ends_at),
            reason="Maintenance",
            created_by=db.session.query(Account).filter_by(username="venue1").one(),
            created_at=datetime.now(timezone.utc),
        )
    )
    db.session.commit()


def add_booking(venue_name, status, start, end):
    other_event = make_event(name=f"Booked Event {status} {venue_name}")
    db.session.add(
        VenueBookingRequest(
            venue=venue(venue_name),
            event_request=db.session.get(EventRequest, other_event),
            status=status,
            date="2026-12-15",
            start_time=start,
            end_time=end,
            attendance=10,
            raised_by=db.session.query(Account).filter_by(username="coord1").one(),
            raised_at=datetime.now(timezone.utc),
        )
    )
    db.session.commit()


def search(client, event, features=(), **params):
    query = {"event_request_id": event, **params}
    if features:
        query["accessibility_features"] = list(features)
    return client.get("/api/venues/search", query_string=query)


def names(resp):
    assert resp.status_code == 200
    return [row["name"] for row in resp.get_json()["venues"]]


# --- AC1: only recognised accessibility features can be selected ---


# @story: SCRUM-34
# @ac: 1
@pytest.mark.parametrize("feature", ALL_FEATURES)
def test_every_recognised_feature_can_be_selected(client, feature):
    login(client)
    event = make_event()

    assert search(client, event, [feature]).status_code == 200


# @story: SCRUM-34
# @ac: 1
@pytest.mark.parametrize(
    "unrecognised",
    [
        "Wheelchair ramp",  # not on the list
        "hearing loop",  # wrong case: names are exact
        "Hearing loop ",  # trailing space
        "",  # blank
    ],
)
def test_a_feature_the_list_does_not_recognise_is_refused(client, unrecognised):
    login(client)
    event = make_event()

    resp = search(client, event, [unrecognised])

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose each accessibility feature from the list."


# @story: SCRUM-34
# @ac: 1
def test_one_unrecognised_feature_among_recognised_ones_refuses_the_whole_search(client):
    login(client)
    event = make_event()

    resp = search(client, event, [HEARING_LOOP, "Wheelchair ramp"])

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose each accessibility feature from the list."


# --- AC2: only venues that record every selected feature ---


# @story: SCRUM-34
# @ac: 2
@pytest.mark.parametrize(
    "selected, expected",
    [
        # Step-free access: both seeded venues have it; the venue with none does not.
        ([STEP_FREE], [SEMINAR_ROOM_1, AUDITORIUM]),
        # Hearing loop: only the Auditorium.
        ([HEARING_LOOP], [AUDITORIUM]),
        # Lift access: only Seminar Room 1.
        ([LIFT], [SEMINAR_ROOM_1]),
        # Both: Step-free access and Lift access: only Seminar Room 1 has both. A
        # venue with either one (the Auditorium, with Step-free access) is not enough.
        ([STEP_FREE, LIFT], [SEMINAR_ROOM_1]),
        # Lift access and Hearing loop: no venue has both.
        ([LIFT, HEARING_LOOP], []),
        # Four of the Auditorium's four features at once.
        ([HEARING_LOOP, ACCESSIBLE_TOILET, RESERVED_SEATING, STEP_FREE], [AUDITORIUM]),
        # Every recognised feature: none has all five.
        (ALL_FEATURES, []),
        # The same feature twice is the same as once.
        ([HEARING_LOOP, HEARING_LOOP], [AUDITORIUM]),
    ],
)
def test_only_venues_with_every_selected_feature_are_shown(client, selected, expected):
    login(client)
    event = make_event()

    assert names(search(client, event, selected)) == expected


# @story: SCRUM-34
# @ac: 2
def test_a_venue_with_more_features_than_selected_is_kept(client):
    # The Auditorium records four features; selecting one of them keeps it.
    login(client)
    event = make_event()

    assert AUDITORIUM in names(search(client, event, [RESERVED_SEATING]))


# @story: SCRUM-34
# @ac: 2
def test_a_venue_with_no_recorded_features_is_excluded_when_any_is_selected(client):
    login(client)
    event = make_event()

    for feature in ALL_FEATURES:
        assert NO_FEATURES_HALL not in names(search(client, event, [feature]))


# --- AC3: nothing selected restricts nothing, and the event's own needs are not applied ---


# @story: SCRUM-34
# @ac: 3
def test_selecting_no_feature_does_not_restrict_the_results(client):
    login(client)
    event = make_event()

    assert names(search(client, event)) == [SEMINAR_ROOM_1, AUDITORIUM, NO_FEATURES_HALL]


# @story: SCRUM-34
# @ac: 3
def test_the_events_own_required_features_are_not_applied_automatically(client):
    # Only the Auditorium has Hearing loop and Accessible toilet, so an event that
    # required them and were applied would show the Auditorium alone.
    login(client)
    event = make_event(required_features=[HEARING_LOOP, ACCESSIBLE_TOILET])

    assert names(search(client, event)) == [SEMINAR_ROOM_1, AUDITORIUM, NO_FEATURES_HALL]


# --- AC4: combines with every other criterion; an excluded venue stays excluded ---


# @story: SCRUM-34
# @ac: 4
def test_a_venue_with_the_feature_but_the_wrong_location_stays_excluded(client):
    login(client)
    event = make_event()

    assert names(search(client, event, [STEP_FREE], location="Block C Level 1")) == [AUDITORIUM]


# @story: SCRUM-34
# @ac: 4
def test_a_venue_with_the_feature_but_too_small_stays_excluded(client):
    # 61 people do not fit Seminar Room 1 (60) although it has Step-free access.
    login(client)
    event = make_event(attendance=61)

    assert names(search(client, event, [STEP_FREE])) == [AUDITORIUM]


# @story: SCRUM-34
# @ac: 4
def test_a_blocked_venue_with_the_feature_stays_excluded(client):
    login(client)
    event = make_event()
    add_block(AUDITORIUM, "2026-12-15T09:00", "2026-12-15T13:00")

    assert names(search(client, event, [HEARING_LOOP])) == []


# @story: SCRUM-34
# @ac: 4
def test_a_venue_with_the_feature_and_an_approved_booking_stays_excluded(client):
    login(client)
    event = make_event()
    add_booking(AUDITORIUM, "Approved", "09:00", "13:00")

    assert names(search(client, event, [HEARING_LOOP])) == []


# @story: SCRUM-34
# @ac: 4
def test_a_venue_with_the_feature_and_only_a_requested_booking_is_kept(client):
    # SCRUM-33 AC4: a booking still awaiting a decision does not exclude the venue.
    login(client)
    event = make_event()
    add_booking(AUDITORIUM, "Requested", "09:00", "13:00")

    assert names(search(client, event, [HEARING_LOOP])) == [AUDITORIUM]


# @story: SCRUM-34
# @ac: 4
def test_a_retired_venue_with_the_feature_stays_excluded(client):
    login(client)
    event = make_event()
    auditorium = venue(AUDITORIUM)
    auditorium.is_active = False
    db.session.commit()

    assert names(search(client, event, [HEARING_LOOP])) == []


# @story: SCRUM-34
# @ac: 4
def test_every_filter_together_keeps_only_a_venue_that_passes_them_all(client):
    # Location, capacity, an overlapping block and a feature: only the Auditorium is
    # in Block C, big enough, free at the time and has Hearing loop, with the block
    # moved to another day.
    login(client)
    event = make_event(attendance=300)
    add_block(AUDITORIUM, "2026-12-16T09:00", "2026-12-16T13:00")

    assert names(search(client, event, [HEARING_LOOP], location="Block C Level 1")) == [AUDITORIUM]


# @story: SCRUM-34
# @ac: 4
def test_the_filter_only_ever_narrows_the_search_it_never_adds_a_venue_back(client):
    # With a block, an approved booking and a location in play, no feature selection
    # may show a venue the search without it left out.
    login(client)
    event = make_event()
    add_block(SEMINAR_ROOM_1, "2026-12-15T11:00", "2026-12-15T14:00")
    add_booking(NO_FEATURES_HALL, "Approved", "10:00", "12:00")
    without_filter = set(names(search(client, event)))
    assert without_filter == {AUDITORIUM}  # the other two are out, by block and booking

    for size in range(len(ALL_FEATURES) + 1):
        for selected in combinations(ALL_FEATURES, size):
            with_filter = set(names(search(client, event, selected)))
            assert with_filter <= without_filter, selected


# --- AC5: clearing the accessibility filter removes only that restriction ---


# @story: SCRUM-34
# @ac: 5
def test_clearing_the_filter_keeps_the_location_restriction(client):
    login(client)
    event = make_event()

    filtered = search(client, event, [HEARING_LOOP], location="Block A Level 2")
    cleared = search(client, event, location="Block A Level 2")

    assert names(filtered) == []  # Seminar Room 1 is in Block A but has no Hearing loop
    assert names(cleared) == [SEMINAR_ROOM_1]  # clearing brings it back; Block C stays out


# @story: SCRUM-34
# @ac: 5
def test_clearing_the_filter_keeps_availability_and_capacity_restrictions(client):
    login(client)
    event = make_event(attendance=61)
    add_block(AUDITORIUM, "2026-12-15T09:00", "2026-12-15T13:00")

    assert names(search(client, event, [HEARING_LOOP])) == []
    # Seminar Room 1 (60) is too small and the Auditorium is blocked; No Features
    # Hall (80) is the only one left once accessibility no longer restricts.
    assert names(search(client, event)) == [NO_FEATURES_HALL]


# --- The response is unchanged by the filter: still the event values and the venues ---


# @story: SCRUM-34
# @ac: 2
def test_a_filtered_search_reports_the_event_values_and_full_venue_fields(client):
    login(client)
    event = make_event()

    body = search(client, event, [HEARING_LOOP]).get_json()

    assert body["event"]["id"] == event
    assert [(row["name"], row["location"], row["max_capacity"]) for row in body["venues"]] == [
        (AUDITORIUM, "Block C Level 1", 400)
    ]
