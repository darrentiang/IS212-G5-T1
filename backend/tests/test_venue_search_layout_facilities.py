"""Layout and facilities filters on the venue search — SCRUM-35.

The acceptance criteria as rules at the API: one recognised room layout and any
number of recognised facilities can be selected, a venue is kept only when it
records that layout as supported and every selected facility, selecting nothing
restricts nothing (and the event's own required layout and facilities are never
applied), and the filters only ever narrow the SCRUM-33 search, so a venue
another rule excluded stays excluded. The browser journeys are the Playwright
spec's (functional/tests/SCRUM-35.spec.js).

Venues, by name (from backend/seed/data.json, plus two added here):
Seminar Room 1 (60, Block A Level 2): Projector, Whiteboard, Wi-Fi; no layouts;
  accessibility Step-free access, Lift access.
Auditorium (400, Block C Level 1): Projector, Stage lighting, Sound system; no
  layouts; accessibility Step-free access, Hearing loop, Accessible toilet,
  Reserved seating.
Layout Hall (80, Block D Level 1): Projector, Wi-Fi; Classroom and Boardroom.
Theatre Hall (90, Block D Level 1): Projector, Stage lighting; Theatre and
  Classroom.
Neither added venue records an accessibility feature. Results come back in the
order the venues were created: Seminar Room 1, Auditorium, Layout Hall, Theatre Hall.
"""

from datetime import datetime, timezone
from itertools import combinations

import pytest

from db import db
from models import (
    Account,
    EventRequest,
    Facility,
    RoomLayout,
    Venue,
    VenueBlock,
    VenueBookingRequest,
)

SEMINAR_ROOM_1 = "Seminar Room 1"
AUDITORIUM = "Auditorium"
LAYOUT_HALL = "Layout Hall"
THEATRE_HALL = "Theatre Hall"
EVERY_VENUE = [SEMINAR_ROOM_1, AUDITORIUM, LAYOUT_HALL, THEATRE_HALL]

LAYOUTS = ["Classroom", "Theatre", "Boardroom", "Banquet", "Exhibition"]
FACILITIES = ["Projector", "Stage lighting", "Sound system", "Whiteboard", "Catering kitchen", "Wi-Fi"]

# The event under search: 15 Dec 2026, 10:00-12:00, 50 people. 50 fits every venue here.
EVENT_DEFAULTS = {
    "name": "Search Test A",
    "purpose": "Client event",
    "description": "An event for SCRUM-35",
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


def rows(model, names):
    return [db.session.query(model).filter_by(name=name).one() for name in names]


def make_event(status="Approved", layout=None, facilities=(), **overrides):
    owner = db.session.query(Account).filter_by(username="org1").one()
    fields = dict(EVENT_DEFAULTS)
    fields.update(overrides)
    event = EventRequest(
        created_by=owner,
        status=status,
        layout=rows(RoomLayout, [layout])[0] if layout else None,
        facilities=rows(Facility, facilities),
        **fields,
    )
    db.session.add(event)
    db.session.commit()
    return event.id


def venue(name):
    return db.session.query(Venue).filter_by(name=name).one()


@pytest.fixture(autouse=True)
def two_more_venues(app):
    """Layout Hall and Theatre Hall: the venues that record layouts."""
    db.session.add(
        Venue(
            name=LAYOUT_HALL,
            location="Block D Level 1",
            max_capacity=80,
            facilities=rows(Facility, ["Projector", "Wi-Fi"]),
            layouts=rows(RoomLayout, ["Classroom", "Boardroom"]),
        )
    )
    db.session.add(
        Venue(
            name=THEATRE_HALL,
            location="Block D Level 1",
            max_capacity=90,
            facilities=rows(Facility, ["Projector", "Stage lighting"]),
            layouts=rows(RoomLayout, ["Theatre", "Classroom"]),
        )
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


def search(client, event, layout="", facilities=(), features=(), **params):
    query = {"event_request_id": event, **params}
    if layout != "":
        query["layout"] = layout
    if facilities:
        query["facilities"] = list(facilities)
    if features:
        query["accessibility_features"] = list(features)
    return client.get("/api/venues/search", query_string=query)


def names(resp):
    assert resp.status_code == 200
    return [row["name"] for row in resp.get_json()["venues"]]


# --- AC1: one recognised room layout; only venues that record it as supported ---


# @story: SCRUM-35
# @ac: 1
@pytest.mark.parametrize("layout", LAYOUTS)
def test_every_recognised_layout_can_be_selected(client, layout):
    login(client)
    event = make_event()

    assert search(client, event, layout).status_code == 200


# @story: SCRUM-35
# @ac: 1
@pytest.mark.parametrize(
    "unrecognised",
    [
        "Lecture",  # not on the list
        "classroom",  # wrong case: names are exact
        "Classroom ",  # trailing space
        " ",  # blank spaces are not "none selected"
    ],
)
def test_a_layout_the_list_does_not_recognise_is_refused(client, unrecognised):
    login(client)
    event = make_event()

    resp = search(client, event, unrecognised)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose the layout from the list."


# @story: SCRUM-35
# @ac: 1
@pytest.mark.parametrize(
    "layout, expected",
    [
        ("Classroom", [LAYOUT_HALL, THEATRE_HALL]),  # both record it; the two without layouts are out
        ("Boardroom", [LAYOUT_HALL]),
        ("Theatre", [THEATRE_HALL]),
        ("Banquet", []),  # recognised, but no venue supports it
        ("Exhibition", []),
    ],
)
def test_only_venues_that_record_the_layout_as_supported_are_shown(client, layout, expected):
    login(client)
    event = make_event()

    assert names(search(client, event, layout)) == expected


# @story: SCRUM-35
# @ac: 1
def test_a_venue_with_no_layouts_recorded_is_not_treated_as_supporting_every_layout(client):
    login(client)
    event = make_event()

    for layout in LAYOUTS:
        shown = names(search(client, event, layout))
        assert SEMINAR_ROOM_1 not in shown
        assert AUDITORIUM not in shown


# --- AC2: recognised facilities; only venues that record every one ---


# @story: SCRUM-35
# @ac: 2
@pytest.mark.parametrize("facility", FACILITIES)
def test_every_recognised_facility_can_be_selected(client, facility):
    login(client)
    event = make_event()

    assert search(client, event, facilities=[facility]).status_code == 200


# @story: SCRUM-35
# @ac: 2
@pytest.mark.parametrize("unrecognised", ["Microphone", "wi-fi", "Wi-Fi ", ""])
def test_a_facility_the_list_does_not_recognise_is_refused(client, unrecognised):
    login(client)
    event = make_event()

    resp = search(client, event, facilities=[unrecognised])

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose each facility from the list."


# @story: SCRUM-35
# @ac: 2
def test_one_unrecognised_facility_among_recognised_ones_refuses_the_whole_search(client):
    login(client)
    event = make_event()

    resp = search(client, event, facilities=["Wi-Fi", "Microphone"])

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose each facility from the list."


# @story: SCRUM-35
# @ac: 2
@pytest.mark.parametrize(
    "selected, expected",
    [
        (["Wi-Fi"], [SEMINAR_ROOM_1, LAYOUT_HALL]),
        (["Projector"], EVERY_VENUE),  # all four have a Projector
        (["Stage lighting"], [AUDITORIUM, THEATRE_HALL]),
        (["Whiteboard"], [SEMINAR_ROOM_1]),
        (["Catering kitchen"], []),  # recognised, but no venue records it
        # Both: Auditorium and Theatre Hall record Projector and Stage lighting; the others
        # record only Projector. Any-of would show all four.
        (["Projector", "Stage lighting"], [AUDITORIUM, THEATRE_HALL]),
        (["Projector", "Stage lighting", "Sound system"], [AUDITORIUM]),
        # Wi-Fi is Seminar Room 1's and Layout Hall's; Stage lighting is the Auditorium's and
        # Theatre Hall's: no venue has both. Any-of would show all four.
        (["Wi-Fi", "Stage lighting"], []),
        (["Wi-Fi", "Wi-Fi"], [SEMINAR_ROOM_1, LAYOUT_HALL]),  # the same one twice is once
        (FACILITIES, []),  # no venue records all six
    ],
)
def test_only_venues_that_record_every_selected_facility_are_shown(client, selected, expected):
    login(client)
    event = make_event()

    assert names(search(client, event, facilities=selected)) == expected


# @story: SCRUM-35
# @ac: 2
def test_a_venue_with_more_facilities_than_selected_is_kept(client):
    # The Auditorium records three; selecting one of them keeps it.
    login(client)
    event = make_event()

    assert AUDITORIUM in names(search(client, event, facilities=["Sound system"]))


# --- AC1 and AC2 together ---


# @story: SCRUM-35
# @ac: 1, 2
@pytest.mark.parametrize(
    "layout, facilities, expected",
    [
        # Classroom: Layout Hall, Theatre Hall. Wi-Fi: Seminar Room 1, Layout Hall. Both: Layout Hall.
        ("Classroom", ["Wi-Fi"], [LAYOUT_HALL]),
        ("Classroom", ["Projector"], [LAYOUT_HALL, THEATRE_HALL]),
        ("Theatre", ["Wi-Fi"], []),  # Theatre Hall has the layout but not Wi-Fi
        ("Boardroom", ["Stage lighting"], []),  # Layout Hall has the layout but not Stage lighting
        ("Classroom", ["Projector", "Stage lighting"], [THEATRE_HALL]),
    ],
)
def test_the_layout_and_the_facilities_must_both_match(client, layout, facilities, expected):
    login(client)
    event = make_event()

    assert names(search(client, event, layout, facilities)) == expected


# --- AC3: nothing selected restricts nothing; the event's own needs are not applied ---


# @story: SCRUM-35
# @ac: 3
def test_selecting_nothing_does_not_restrict_the_results(client):
    login(client)
    event = make_event()

    assert names(search(client, event)) == EVERY_VENUE


# @story: SCRUM-35
# @ac: 3
def test_the_events_own_required_layout_and_facilities_are_not_applied_automatically(client):
    # Required Theatre with Stage lighting and Sound system: applied, only the Auditorium would
    # have the facilities and only Theatre Hall the layout, so the result would be empty.
    login(client)
    event = make_event(layout="Theatre", facilities=["Stage lighting", "Sound system"])

    assert names(search(client, event)) == EVERY_VENUE


# --- AC4: combines with every other criterion; an excluded venue stays excluded ---


# @story: SCRUM-35
# @ac: 4
def test_a_venue_with_the_facility_but_the_wrong_location_stays_excluded(client):
    login(client)
    event = make_event()

    assert names(search(client, event, facilities=["Projector"], location="Block A Level 2")) == [
        SEMINAR_ROOM_1
    ]


# @story: SCRUM-35
# @ac: 4
def test_a_venue_with_the_layout_but_the_wrong_location_stays_excluded(client):
    login(client)
    event = make_event()

    assert names(search(client, event, "Classroom", location="Block A Level 2")) == []


# @story: SCRUM-35
# @ac: 4
def test_a_venue_with_the_layout_but_too_small_stays_excluded(client):
    # 85 people do not fit Layout Hall (80) although it supports Classroom.
    login(client)
    event = make_event(attendance=85)

    assert names(search(client, event, "Classroom")) == [THEATRE_HALL]


# @story: SCRUM-35
# @ac: 4
def test_a_blocked_venue_with_the_layout_stays_excluded(client):
    login(client)
    event = make_event()
    add_block(LAYOUT_HALL, "2026-12-15T09:00", "2026-12-15T13:00")

    assert names(search(client, event, "Classroom")) == [THEATRE_HALL]


# @story: SCRUM-35
# @ac: 4
def test_a_venue_with_the_facility_and_an_approved_booking_stays_excluded(client):
    login(client)
    event = make_event()
    add_booking(SEMINAR_ROOM_1, "Approved", "09:00", "13:00")

    assert names(search(client, event, facilities=["Wi-Fi"])) == [LAYOUT_HALL]


# @story: SCRUM-35
# @ac: 4
def test_a_venue_with_the_facility_and_only_a_requested_booking_is_kept(client):
    # SCRUM-33 AC4: a booking still awaiting a decision does not exclude the venue.
    login(client)
    event = make_event()
    add_booking(SEMINAR_ROOM_1, "Requested", "09:00", "13:00")

    assert names(search(client, event, facilities=["Wi-Fi"])) == [SEMINAR_ROOM_1, LAYOUT_HALL]


# @story: SCRUM-35
# @ac: 4
def test_a_retired_venue_with_the_layout_stays_excluded(client):
    login(client)
    event = make_event()
    hall = venue(THEATRE_HALL)
    hall.is_active = False
    db.session.commit()

    assert names(search(client, event, "Classroom")) == [LAYOUT_HALL]


# @story: SCRUM-35
# @ac: 4
def test_the_facility_filter_combines_with_the_accessibility_filter(client):
    # Wi-Fi: Seminar Room 1, Layout Hall. Step-free access: Seminar Room 1, Auditorium. Both: Seminar Room 1.
    login(client)
    event = make_event()

    assert names(search(client, event, facilities=["Wi-Fi"], features=["Step-free access"])) == [
        SEMINAR_ROOM_1
    ]


# @story: SCRUM-35
# @ac: 4
def test_every_filter_together_keeps_only_a_venue_that_passes_them_all(client):
    # Location Block D, capacity for 85, free at the time, supports Classroom, has Stage
    # lighting: only Theatre Hall (Layout Hall is too small and has no Stage lighting).
    login(client)
    event = make_event(attendance=85)
    add_block(AUDITORIUM, "2026-12-15T09:00", "2026-12-15T13:00")

    assert names(
        search(client, event, "Classroom", ["Stage lighting"], location="Block D Level 1")
    ) == [THEATRE_HALL]


# @story: SCRUM-35
# @ac: 4
def test_the_filters_only_ever_narrow_the_search_they_never_add_a_venue_back(client):
    # With a block and an approved booking in play, no layout and facility selection may
    # show a venue the search without them left out.
    login(client)
    event = make_event()
    add_block(SEMINAR_ROOM_1, "2026-12-15T11:00", "2026-12-15T14:00")
    add_booking(AUDITORIUM, "Approved", "10:00", "12:00")
    without_filters = set(names(search(client, event)))
    assert without_filters == {LAYOUT_HALL, THEATRE_HALL}  # the other two are out

    for layout in ("", "Classroom", "Theatre"):
        for size in range(3):
            for selected in combinations(FACILITIES, size):
                with_filters = set(names(search(client, event, layout, selected)))
                assert with_filters <= without_filters, (layout, selected)


# --- AC5: clearing the layout or the facilities removes only that restriction ---


# @story: SCRUM-35
# @ac: 5
def test_clearing_the_layout_keeps_the_facilities(client):
    login(client)
    event = make_event()

    with_both = search(client, event, "Classroom", ["Wi-Fi"])
    layout_cleared = search(client, event, "", ["Wi-Fi"])

    assert names(with_both) == [LAYOUT_HALL]
    assert names(layout_cleared) == [SEMINAR_ROOM_1, LAYOUT_HALL]  # Wi-Fi still applies


# @story: SCRUM-35
# @ac: 5
def test_clearing_the_facilities_keeps_the_layout(client):
    login(client)
    event = make_event()

    with_both = search(client, event, "Classroom", ["Wi-Fi"])
    facilities_cleared = search(client, event, "Classroom")

    assert names(with_both) == [LAYOUT_HALL]
    assert names(facilities_cleared) == [LAYOUT_HALL, THEATRE_HALL]  # Classroom still applies


# @story: SCRUM-35
# @ac: 5
def test_clearing_the_layout_keeps_the_location_restriction(client):
    login(client)
    event = make_event()

    with_layout = search(client, event, "Classroom", location="Block A Level 2")
    layout_cleared = search(client, event, location="Block A Level 2")

    assert names(with_layout) == []  # Seminar Room 1 records no layouts
    assert names(layout_cleared) == [SEMINAR_ROOM_1]  # Block A only


# @story: SCRUM-35
# @ac: 5
def test_clearing_the_layout_keeps_availability_and_capacity_restrictions(client):
    login(client)
    event = make_event(attendance=85)
    add_block(AUDITORIUM, "2026-12-15T09:00", "2026-12-15T13:00")

    assert names(search(client, event, "Classroom")) == [THEATRE_HALL]
    # Layout Hall (80) is too small and the Auditorium is blocked; Theatre Hall is all that is left.
    assert names(search(client, event)) == [THEATRE_HALL]


# --- The response is unchanged by the filters: still the event values and the venues ---


# @story: SCRUM-35
# @ac: 1
def test_a_filtered_search_reports_the_event_values_and_full_venue_fields(client):
    login(client)
    event = make_event()

    body = search(client, event, "Boardroom", ["Wi-Fi"]).get_json()

    assert body["event"]["id"] == event
    assert [(row["name"], row["location"], row["max_capacity"]) for row in body["venues"]] == [
        (LAYOUT_HALL, "Block D Level 1", 80)
    ]
