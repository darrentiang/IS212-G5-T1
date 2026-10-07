"""SCRUM-42 Warn When a Requested Venue Appears Unsuitable — rules at the API.

AC1: an event request may carry one required layout and any number of
facilities and accessibility features, chosen from the fixed lists; none is
required, and an unknown or duplicate value is refused, on a Draft too.
AC2-AC4: the check of one venue against one event, one warning per mismatch
with the values AC3 shows, and nothing checked that the event did not choose
or the venue does not record. AC5 (raise or cancel) is SCRUM-36's unchanged
raising; the browser journeys are functional/tests/SCRUM-42.spec.js.
"""

from datetime import time

import pytest

from areas.bookings.services import venue_warnings
from db import db
from models import (
    AccessibilityFeature,
    Account,
    EventRequest,
    Facility,
    RoomLayout,
    Venue,
    VenueBookingRequest,
    event_request_accessibility_features,
    event_request_facilities,
)

REQUEST_FIELDS = {
    "name": "TC42 Unit Event",
    "purpose": "Client event",
    "description": "An event for SCRUM-42",
    "date": "2026-12-10",
    "start_time": "10:00",
    "end_time": "16:00",
    "attendance": 100,
    "venue_requirements": "Any room",
    "accessibility_needs": "Step-free access",
    "equipment_requirements": "Projector",
    "registration_needs": "Guest list supplied",
}


def login(client, username="org1"):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def submit(client, **overrides):
    return client.post("/api/requests", json={**REQUEST_FIELDS, **overrides})


def delete_seeded_draft():
    """org1's seeded Draft blocks a new one (one open Draft per Organiser)."""
    draft = db.session.query(EventRequest).filter_by(name="Design Workshop").one()
    db.session.delete(draft)
    db.session.commit()


def save_draft(client, **fields):
    delete_seeded_draft()
    resp = client.post("/api/requests/draft", json={"name": "TC42 Unit Draft", **fields})
    assert resp.status_code == 201
    return resp.get_json()


def rows(model, *names):
    return [db.session.query(model).filter_by(name=name).one() for name in names]


def venue(name="Seminar Room 1"):
    return db.session.query(Venue).filter_by(name=name).one()


def make_event(status="Approved", layout=None, facilities=(), features=(), **overrides):
    owner = db.session.query(Account).filter_by(username="org1").one()
    fields = {**REQUEST_FIELDS, **overrides}
    event = EventRequest(
        created_by=owner,
        status=status,
        layout=rows(RoomLayout, layout)[0] if layout else None,
        facilities=rows(Facility, *facilities),
        accessibility_features=rows(AccessibilityFeature, *features),
        **fields,
    )
    db.session.add(event)
    db.session.commit()
    return event


# --- AC1: choosing the requirements when creating or editing a request ---


# @story: SCRUM-42
# @ac: 1
def test_a_submitted_request_carries_its_chosen_requirements_in_list_order(client):
    login(client)

    resp = submit(
        client,
        layout="Theatre",
        facilities=["Sound system", "Projector"],
        accessibility_features=["Hearing loop"],
    )

    assert resp.status_code == 201
    body = resp.get_json()
    assert body["status"] == "Submitted"
    assert body["layout"] == "Theatre"
    assert body["facilities"] == ["Projector", "Sound system"]
    assert body["accessibility_features"] == ["Hearing loop"]
    detail = client.get(f"/api/requests/{body['id']}").get_json()
    assert detail["layout"] == "Theatre"
    assert detail["facilities"] == ["Projector", "Sound system"]
    assert detail["venue_requirements"] == "Any room"


# @story: SCRUM-42
# @ac: 1
def test_a_request_with_nothing_chosen_can_be_submitted(client):
    login(client)

    resp = submit(client)

    assert resp.status_code == 201
    body = resp.get_json()
    assert body["layout"] is None
    assert body["facilities"] == []
    assert body["accessibility_features"] == []


# @story: SCRUM-42
# @ac: 1
def test_the_choices_are_never_named_as_missing(client):
    login(client)

    resp = client.post("/api/requests", json={"name": "Only a name"})

    assert resp.status_code == 400
    message = resp.get_json()["message"]
    assert "layout" not in message
    assert "facilities" not in message


# @story: SCRUM-42
# @ac: 1
def test_an_empty_layout_value_means_none_chosen(client):
    login(client)

    resp = submit(client, layout="", facilities=None, accessibility_features=[])

    assert resp.status_code == 201
    assert resp.get_json()["layout"] is None


# @story: SCRUM-42
# @ac: 1
def test_a_draft_is_saved_with_its_choices(client):
    login(client)

    body = save_draft(client, facilities=["Projector"], layout="Classroom")

    assert body["status"] == "Draft"
    assert body["facilities"] == ["Projector"]
    assert body["layout"] == "Classroom"


# @story: SCRUM-42
# @ac: 1
def test_editing_a_draft_replaces_the_choices_sent(client):
    login(client)
    draft = save_draft(client, facilities=["Projector"])

    resp = client.put(
        f"/api/requests/{draft['id']}",
        json={"facilities": ["Whiteboard"], "accessibility_features": ["Step-free access"]},
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["facilities"] == ["Whiteboard"]
    assert body["accessibility_features"] == ["Step-free access"]
    assert body["status"] == "Draft"


# @story: SCRUM-42
# @ac: 1
def test_editing_a_draft_without_a_choice_leaves_it_unchanged(client):
    login(client)
    draft = save_draft(client, facilities=["Projector"], layout="Theatre")

    resp = client.put(f"/api/requests/{draft['id']}", json={"purpose": "Changed"})

    body = resp.get_json()
    assert body["facilities"] == ["Projector"]
    assert body["layout"] == "Theatre"


# @story: SCRUM-42
# @ac: 1
def test_editing_a_draft_can_clear_every_choice(client):
    login(client)
    draft = save_draft(
        client, facilities=["Projector"], layout="Theatre", accessibility_features=["Lift access"]
    )

    resp = client.put(
        f"/api/requests/{draft['id']}",
        json={"layout": None, "facilities": [], "accessibility_features": None},
    )

    body = resp.get_json()
    assert body["layout"] is None
    assert body["facilities"] == []
    assert body["accessibility_features"] == []


REFUSALS = [
    ({"layout": "Dance floor"}, "Choose the layout from the list."),
    ({"layout": ["Theatre"]}, "Choose the layout from the list."),
    ({"facilities": "Projector"}, "Choose facilities as a list."),
    ({"facilities": ["Hot tub"]}, "Choose each facility from the list."),
    ({"facilities": [3]}, "Choose each facility from the list."),
    ({"facilities": ["Projector", "Projector"]}, "A facility cannot be selected more than once."),
    ({"accessibility_features": "Lift access"}, "Choose accessibility features as a list."),
    ({"accessibility_features": ["Ramp"]}, "Choose each accessibility feature from the list."),
    (
        {"accessibility_features": ["Lift access", "Lift access"]},
        "An accessibility feature cannot be selected more than once.",
    ),
]


# @story: SCRUM-42
# @ac: 1
@pytest.mark.parametrize("body, message", REFUSALS)
def test_an_unrecognised_or_duplicate_choice_is_refused_on_submit(client, body, message):
    login(client)
    before = db.session.query(EventRequest).count()

    resp = submit(client, **body)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    assert db.session.query(EventRequest).count() == before


# @story: SCRUM-42
# @ac: 1
@pytest.mark.parametrize("body, message", REFUSALS)
def test_an_unrecognised_or_duplicate_choice_is_refused_on_a_new_draft(client, body, message):
    login(client)
    delete_seeded_draft()

    resp = client.post("/api/requests/draft", json={"name": "TC42 Unit Draft", **body})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    assert db.session.query(EventRequest).filter_by(name="TC42 Unit Draft").count() == 0


# @story: SCRUM-42
# @ac: 1
@pytest.mark.parametrize("body, message", REFUSALS)
def test_an_unrecognised_or_duplicate_choice_is_refused_on_a_draft_edit(client, body, message):
    login(client)
    draft = save_draft(client, facilities=["Projector"], accessibility_features=["Lift access"])

    resp = client.put(f"/api/requests/{draft['id']}", json={"name": "Renamed", **body})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    reread = client.get(f"/api/requests/{draft['id']}").get_json()
    assert reread["name"] == "TC42 Unit Draft"
    assert reread["facilities"] == ["Projector"]
    assert reread["accessibility_features"] == ["Lift access"]


# @story: SCRUM-42
# @ac: 1
def test_deleting_a_draft_removes_its_chosen_requirements(client):
    login(client)
    draft = save_draft(client, facilities=["Projector"], accessibility_features=["Lift access"])

    resp = client.delete(f"/api/requests/{draft['id']}")

    assert resp.status_code == 204
    for table in (event_request_facilities, event_request_accessibility_features):
        left = db.session.execute(
            table.select().where(table.c.event_request_id == draft["id"])
        ).all()
        assert left == []


# @story: SCRUM-42
# @ac: 1
def test_the_request_list_carries_the_choices(client):
    login(client)

    rows_ = client.get("/api/requests").get_json()

    dinner = next(row for row in rows_ if row["name"] == "Annual Dinner")
    assert dinner["layout"] == "Banquet"
    assert dinner["facilities"] == ["Stage lighting", "Sound system"]
    assert dinner["accessibility_features"] == ["Step-free access", "Reserved seating"]


# @story: SCRUM-42
# @ac: 1
def test_an_organiser_reads_the_option_lists(client):
    login(client)

    resp = client.get("/api/request-options")

    assert resp.status_code == 200
    assert resp.get_json() == {
        "layouts": ["Classroom", "Theatre", "Boardroom", "Banquet", "Exhibition"],
        "facilities": [
            "Projector", "Stage lighting", "Sound system", "Whiteboard", "Catering kitchen", "Wi-Fi",
        ],
        "accessibility_features": [
            "Step-free access", "Hearing loop", "Accessible toilet", "Lift access", "Reserved seating",
        ],
    }


# @story: SCRUM-42
# @ac: 1
def test_the_option_lists_need_requests_edit(client):
    assert client.get("/api/request-options").status_code == 401
    login(client, "venue1")
    assert client.get("/api/request-options").status_code == 403


# --- AC2, AC3, AC4: the check of one venue against one event ---


def set_hours(target, opening, closing):
    target.opening_time = opening
    target.closing_time = closing
    db.session.commit()


# @story: SCRUM-42
# @ac: 2, 3
def test_every_mismatch_gives_a_warning_in_order(app):
    target = venue()
    target.layouts = rows(RoomLayout, "Banquet")
    db.session.commit()
    event = make_event(
        start_time="07:59",
        end_time="12:00",
        layout="Theatre",
        facilities=("Projector", "Stage lighting", "Sound system"),
        features=("Step-free access", "Hearing loop", "Reserved seating"),
    )

    assert venue_warnings(event, target) == [
        {"type": "capacity", "attendance": 100, "max_capacity": 60},
        {"type": "start_time", "start_time": "07:59", "opening_time": "08:00", "closing_time": "20:00"},
        {"type": "layout", "name": "Theatre"},
        {"type": "facility", "name": "Stage lighting"},
        {"type": "facility", "name": "Sound system"},
        {"type": "accessibility_feature", "name": "Hearing loop"},
        {"type": "accessibility_feature", "name": "Reserved seating"},
    ]


# @story: SCRUM-42
# @ac: 2, 4
def test_a_venue_with_no_mismatch_gives_no_warning(app):
    target = venue("Auditorium")
    target.layouts = rows(RoomLayout, "Theatre")
    db.session.commit()
    event = make_event(
        layout="Theatre", facilities=("Projector", "Sound system"), features=("Hearing loop",)
    )

    assert venue_warnings(event, target) == []


# @story: SCRUM-42
# @ac: 2, 4
def test_attendance_equal_to_capacity_and_times_at_the_limits_fit(app):
    event = make_event(attendance=60, start_time="08:00", end_time="20:00")

    assert venue_warnings(event, venue()) == []


# @story: SCRUM-42
# @ac: 2, 3
def test_attendance_one_above_capacity_warns_with_both_numbers(app):
    event = make_event(attendance=61, start_time="10:00", end_time="12:00")

    assert venue_warnings(event, venue()) == [
        {"type": "capacity", "attendance": 61, "max_capacity": 60}
    ]


# @story: SCRUM-42
# @ac: 2, 3
def test_an_end_one_minute_after_closing_warns_with_both_times(app):
    event = make_event(attendance=20, start_time="18:00", end_time="20:01")

    assert venue_warnings(event, venue()) == [
        {"type": "end_time", "end_time": "20:01", "opening_time": "08:00", "closing_time": "20:00"}
    ]


# @story: SCRUM-42
# @ac: 2, 3
@pytest.mark.parametrize("start, end", [("21:00", "22:00"), ("06:00", "07:00")])
def test_an_event_wholly_outside_the_hours_gets_two_warnings(app, start, end):
    event = make_event(attendance=20, start_time=start, end_time=end)

    assert [warning["type"] for warning in venue_warnings(event, venue())] == [
        "start_time",
        "end_time",
    ]


# @story: SCRUM-42
# @ac: 4
@pytest.mark.parametrize(
    "opening, closing", [(time(9, 0), None), (None, time(17, 0)), (None, None)]
)
def test_hours_are_not_checked_unless_the_venue_records_both(app, opening, closing):
    target = venue()
    set_hours(target, opening, closing)
    event = make_event(attendance=50, start_time="06:00", end_time="23:30")

    assert venue_warnings(event, target) == []


# @story: SCRUM-42
# @ac: 4
def test_a_requirement_the_event_did_not_choose_is_not_checked(app):
    event = make_event(attendance=20, start_time="10:00", end_time="12:00")

    assert venue_warnings(event, venue()) == []


# @story: SCRUM-42
# @ac: 2, 3
def test_a_chosen_layout_the_venue_records_gives_no_warning(app):
    target = venue()
    target.layouts = rows(RoomLayout, "Classroom", "Theatre")
    db.session.commit()
    event = make_event(attendance=20, layout="Theatre")

    assert venue_warnings(event, target) == []


# --- The read endpoint: who may ask, and in which order refusals come ---


def warnings_url(event_id, venue_id):
    return f"/api/requests/{event_id}/venues/{venue_id}/warnings"


# @story: SCRUM-42
# @ac: 2, 3
@pytest.mark.parametrize("username", ["coord1", "multi1"])
def test_whoever_may_raise_a_booking_reads_the_warnings(client, username):
    event = make_event(attendance=100, start_time="10:00", end_time="12:00")
    login(client, username)

    resp = client.get(warnings_url(event.id, venue().id))

    assert resp.status_code == 200
    assert resp.get_json() == [{"type": "capacity", "attendance": 100, "max_capacity": 60}]


# @story: SCRUM-42
# @ac: 2
def test_checking_records_nothing(client):
    event = make_event(attendance=100)
    login(client, "coord1")

    client.get(warnings_url(event.id, venue().id))

    assert db.session.query(VenueBookingRequest).count() == 0


# @story: SCRUM-42
# @ac: 2
def test_the_check_needs_a_login(client):
    event = make_event()

    assert client.get(warnings_url(event.id, venue().id)).status_code == 401


# @story: SCRUM-42
# @ac: 2
@pytest.mark.parametrize("username", ["org1", "venue1", "tech1", "att1"])
def test_the_check_is_refused_without_bookings_edit_before_not_found(client, username):
    login(client, username)

    resp = client.get(warnings_url(9999, 9999))

    assert resp.status_code == 403


# @story: SCRUM-42
# @ac: 2
def test_an_unknown_event_or_venue_is_not_found(client):
    event = make_event()
    login(client, "coord1")

    unknown_event = client.get(warnings_url(9999, venue().id))
    unknown_venue = client.get(warnings_url(event.id, 9999))

    assert unknown_event.status_code == 404
    assert unknown_event.get_json()["message"] == "Event request not found."
    assert unknown_venue.status_code == 404
    assert unknown_venue.get_json()["message"] == "Venue not found."


# @story: SCRUM-42
# @ac: 2
def test_a_draft_is_not_checked(client):
    event = make_event(status="Draft")
    login(client, "coord1")

    resp = client.get(warnings_url(event.id, venue().id))

    assert resp.status_code == 403
