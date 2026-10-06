"""Venue rules — SCRUM-31 (Add a Venue), SCRUM-75 (Update a Venue).

The acceptance criteria as rules at the API: who may add or update a venue,
which fields are required, and that the maximum capacity is a positive whole
number. The browser journeys are the Playwright specs.
"""

from datetime import time

import pytest
from db import db
from models import AccessibilityFeature, Account, Facility, Venue
from permissions import VENUES_EDIT, VENUES_VIEW, can

VALID = {
    "name": "Hall A",
    "location": "Block B Level 3",
    "max_capacity": 250,
    "opening_time": "08:00",
    "closing_time": "22:00",
    "facilities": ["Projector", "Stage lighting"],
    "accessibility_features": ["Step-free access", "Hearing loop"],
}


def login(client, username="venue1"):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200
    return resp.get_json()


def post_venue(client, **overrides):
    body = dict(VALID)
    body.update(overrides)
    return client.post("/api/venues", json=body)


# @story: SCRUM-31
# @ac: 1
def test_venue_staff_add_a_venue_with_every_field(client):
    login(client)

    resp = post_venue(client)

    assert resp.status_code == 201
    body = resp.get_json()
    assert body["name"] == "Hall A"
    assert body["location"] == "Block B Level 3"
    assert body["max_capacity"] == 250
    assert body["opening_time"] == "08:00"
    assert body["closing_time"] == "22:00"
    assert body["facilities"] == ["Projector", "Stage lighting"]
    assert body["accessibility_features"] == ["Step-free access", "Hearing loop"]


# @story: SCRUM-31
# @ac: 1
def test_a_saved_venue_keeps_its_hours_and_lists_in_the_database(app, client):
    login(client)

    post_venue(client)

    venue = db.session.query(Venue).filter_by(name="Hall A").one()
    assert venue.opening_time == time(8, 0)
    assert venue.closing_time == time(22, 0)
    assert [row.name for row in venue.facilities] == ["Projector", "Stage lighting"]
    assert repr(venue) == f"<Venue {venue.id} Hall A>"


# @story: SCRUM-31
# @ac: 1, 2
def test_the_operating_hours_and_both_lists_are_optional(client):
    login(client)

    resp = client.post(
        "/api/venues",
        json={"name": "Studio B", "location": "Block C Level 1", "max_capacity": 40},
    )

    assert resp.status_code == 201
    body = resp.get_json()
    assert body["opening_time"] is None
    assert body["closing_time"] is None
    assert body["facilities"] == []
    assert body["accessibility_features"] == []


# @story: SCRUM-31
# @ac: 2
def test_name_location_and_maximum_capacity_are_each_required(client):
    login(client)

    for field, message in [
        ("name", "Name is required."),
        ("location", "Location is required."),
        ("max_capacity", "Maximum capacity is required."),
    ]:
        resp = post_venue(client, **{field: ""})
        assert resp.status_code == 400, field
        assert resp.get_json()["message"] == message


# @story: SCRUM-31
# @ac: 2
def test_a_venue_is_not_saved_when_a_required_field_is_missing(app, client):
    login(client)

    resp = client.post("/api/venues", json={"location": "Block B Level 3", "max_capacity": 250})

    assert resp.status_code == 400
    assert db.session.query(Venue).filter_by(location="Block B Level 3").count() == 0


# @story: SCRUM-31
# @ac: 2
def test_a_name_of_only_spaces_is_not_a_name(client):
    login(client)

    resp = post_venue(client, name="   ")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Name is required."


# @story: SCRUM-31
# @ac: 3
def test_maximum_capacity_must_be_a_positive_whole_number(client):
    login(client)

    for value in [0, -5, "50.5", 2.5, "many"]:
        resp = post_venue(client, max_capacity=value)
        assert resp.status_code == 400, value
        assert resp.get_json()["message"] == "Maximum capacity must be a positive whole number."


# @story: SCRUM-31
# @ac: 3
def test_a_maximum_capacity_of_one_is_accepted(client):
    login(client)

    resp = post_venue(client, name="Room E", max_capacity=1)

    assert resp.status_code == 201
    assert resp.get_json()["max_capacity"] == 1


# @story: SCRUM-31
# @ac: 3
def test_a_maximum_capacity_typed_as_text_by_the_form_is_read_as_a_number(client):
    login(client)

    resp = post_venue(client, name="Room F", max_capacity="2")

    assert resp.status_code == 201
    assert resp.get_json()["max_capacity"] == 2


# @story: SCRUM-31
# @ac: 1
def test_a_facility_outside_the_fixed_list_is_refused(app, client):
    login(client)

    resp = post_venue(client, facilities=["Helipad"])

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose each facility from the list."
    assert db.session.query(Venue).filter_by(name="Hall A").count() == 0


# @story: SCRUM-31
# @ac: 1
def test_an_accessibility_feature_outside_the_fixed_list_is_refused(client):
    login(client)

    resp = post_venue(client, accessibility_features=["Teleporter"])

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose each accessibility feature from the list."


# @story: SCRUM-31
# @ac: 1
def test_a_list_sent_as_one_value_instead_of_a_list_is_refused(client):
    login(client)

    resp = post_venue(client, facilities="Projector")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose each facility from the list."


# @story: SCRUM-31
# @ac: 1
def test_operating_hours_that_are_not_a_time_are_refused(client):
    login(client)

    assert post_venue(client, opening_time="morning").get_json()["message"] == (
        "Opening time must be a 24-hour time, for example 08:00."
    )
    assert post_venue(client, closing_time="25:00").get_json()["message"] == (
        "Closing time must be a 24-hour time, for example 08:00."
    )


# @story: SCRUM-31
# @ac: 5
def test_an_event_coordinator_cannot_add_a_venue(app, client):
    login(client, "coord1")

    resp = post_venue(client)

    assert resp.status_code == 403
    assert resp.get_json()["message"] == "You do not have permission to perform this action."
    assert db.session.query(Venue).filter_by(name="Hall A").count() == 0


# @story: SCRUM-31
# @ac: 5
def test_an_account_with_no_venue_role_cannot_add_or_see_venues(client):
    login(client, "org1")

    assert post_venue(client).status_code == 403
    assert client.get("/api/venues").status_code == 403


# @story: SCRUM-31
# @ac: 5
def test_adding_a_venue_needs_a_session(client):
    resp = post_venue(client)

    assert resp.status_code == 401
    assert resp.get_json()["message"] == "Not logged in"


# @story: SCRUM-31
# @ac: 5
def test_venues_edit_belongs_to_venue_staff_only(app):
    accounts = {
        account.username: account for account in db.session.query(Account).all()
    }

    assert can(accounts["venue1"], VENUES_EDIT) is True
    assert can(accounts["coord1"], VENUES_EDIT) is False
    assert can(accounts["coord1"], VENUES_VIEW) is True
    # An account may do anything any of its roles allows (Q-06, D-09).
    assert can(accounts["multi1"], VENUES_EDIT) is True


# @story: SCRUM-31
# @ac: 5
def test_a_multi_role_account_may_add_a_venue(client):
    login(client, "multi1")

    assert post_venue(client, name="Room G").status_code == 201


# @story: SCRUM-31
# @ac: 4
def test_the_venue_list_holds_the_seeded_venues_and_a_new_one(client):
    login(client)
    post_venue(client)

    resp = client.get("/api/venues")

    assert resp.status_code == 200
    names = [row["name"] for row in resp.get_json()]
    assert names == ["Seminar Room 1", "Auditorium", "Hall A"]


# @story: SCRUM-31
# @ac: 4
def test_a_venue_can_be_opened_to_show_every_recorded_field(client):
    login(client)
    created = post_venue(client).get_json()

    resp = client.get(f"/api/venues/{created['id']}")

    assert resp.status_code == 200
    assert resp.get_json() == created


# @story: SCRUM-31
# @ac: 4
def test_a_venue_that_does_not_exist_is_reported_as_missing(client):
    login(client)

    resp = client.get("/api/venues/999")

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."


# @story: SCRUM-31
# @ac: 1
def test_the_form_is_offered_the_two_seeded_lists(client):
    login(client)

    resp = client.get("/api/venue-options")

    assert resp.status_code == 200
    assert resp.get_json() == {
        "facilities": [
            "Projector",
            "Stage lighting",
            "Sound system",
            "Whiteboard",
            "Catering kitchen",
            "Wi-Fi",
        ],
        "accessibility_features": [
            "Step-free access",
            "Hearing loop",
            "Accessible toilet",
            "Lift access",
            "Reserved seating",
        ],
    }


# @story: SCRUM-31
# @ac: 1
def test_seeding_records_the_two_venues_with_their_lists(app):
    venue = db.session.query(Venue).filter_by(name="Seminar Room 1").one()

    assert venue.location == "Block A Level 2"
    assert venue.max_capacity == 60
    assert venue.opening_time == time(8, 0)
    assert venue.closing_time == time(20, 0)
    assert [row.name for row in venue.facilities] == ["Projector", "Whiteboard", "Wi-Fi"]
    assert [row.name for row in venue.accessibility_features] == [
        "Step-free access",
        "Lift access",
    ]
    assert db.session.query(Venue).count() == 2


# @story: SCRUM-31
# @ac: 1
def test_the_two_fixed_lists_name_themselves_in_a_log_line(app):
    facility = db.session.query(Facility).filter_by(name="Projector").one()
    feature = db.session.query(AccessibilityFeature).filter_by(name="Hearing loop").one()

    assert repr(facility) == "<Facility Projector>"
    assert repr(feature) == "<AccessibilityFeature Hearing loop>"


def put_venue(client, venue_id=1, **overrides):
    body = dict(VALID)
    body.update(overrides)
    return client.put(f"/api/venues/{venue_id}", json=body)


# @story: SCRUM-75
# @ac: 1, 3, 5
def test_venue_staff_update_every_field(client):
    login(client, "venue1")
    resp = put_venue(
        client,
        venue_id=1,
        name="Updated Name",
        location="Block Z Level 9",
        max_capacity=500,
        opening_time="07:00",
        closing_time="23:00",
        facilities=["Sound system", "Wi-Fi"],
        accessibility_features=["Lift access", "Accessible toilet"],
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["name"] == "Updated Name"
    assert body["location"] == "Block Z Level 9"
    assert body["max_capacity"] == 500
    assert body["opening_time"] == "07:00"
    assert body["closing_time"] == "23:00"
    assert sorted(body["facilities"]) == ["Sound system", "Wi-Fi"]
    assert sorted(body["accessibility_features"]) == ["Accessible toilet", "Lift access"]


# @story: SCRUM-75
# @ac: 1, 5
def test_updated_venue_persists_in_database(app, client):
    login(client, "venue1")
    put_venue(
        client,
        venue_id=1,
        name="Persisted Venue",
        location="Block X",
        max_capacity=150,
        opening_time="06:30",
        closing_time="21:30",
        facilities=["Wi-Fi"],
        accessibility_features=["Step-free access"],
    )
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.name == "Persisted Venue"
        assert venue.location == "Block X"
        assert venue.max_capacity == 150
        assert venue.opening_time == time(6, 30)
        assert venue.closing_time == time(21, 30)
        assert [f.name for f in venue.facilities] == ["Wi-Fi"]
        assert [a.name for a in venue.accessibility_features] == ["Step-free access"]


# @story: SCRUM-75
# @ac: 1, 2, 5
def test_optional_hours_and_lists_can_be_cleared(app, client):
    login(client, "venue1")
    resp = put_venue(
        client,
        venue_id=1,
        name="Cleared Venue",
        location="Block A",
        max_capacity=100,
        opening_time="",
        closing_time=None,
        facilities=[],
        accessibility_features=[],
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["opening_time"] is None
    assert body["closing_time"] is None
    assert body["facilities"] == []
    assert body["accessibility_features"] == []

    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.opening_time is None
        assert venue.closing_time is None
        assert venue.facilities == []
        assert venue.accessibility_features == []


# @story: SCRUM-75
# @ac: 1, 5
def test_updating_one_field_preserves_other_supplied_values(client):
    login(client, "venue1")
    resp = put_venue(
        client,
        venue_id=1,
        name="Renamed Only",
        location="Block B Level 3",
        max_capacity=250,
        opening_time="08:00",
        closing_time="22:00",
        facilities=["Projector", "Stage lighting"],
        accessibility_features=["Step-free access", "Hearing loop"],
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["name"] == "Renamed Only"
    assert body["location"] == "Block B Level 3"
    assert body["max_capacity"] == 250
    assert body["opening_time"] == "08:00"
    assert body["closing_time"] == "22:00"
    assert body["facilities"] == ["Projector", "Stage lighting"]
    assert body["accessibility_features"] == ["Step-free access", "Hearing loop"]


# @story: SCRUM-75
# @ac: 2, 3, 4
@pytest.mark.parametrize(
    "field,value,message",
    [
        ("name", "", "Name is required."),
        ("name", "   ", "Name is required."),
        ("name", None, "Name is required."),
        ("location", "", "Location is required."),
        ("location", "   ", "Location is required."),
        ("location", None, "Location is required."),
        ("max_capacity", "", "Maximum capacity is required."),
        ("max_capacity", "   ", "Maximum capacity is required."),
        ("max_capacity", None, "Maximum capacity is required."),
    ],
)
def test_required_fields_cannot_be_blank_or_whitespace_on_update(client, field, value, message):
    login(client, "venue1")
    resp = put_venue(client, venue_id=1, **{field: value})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == message


# @story: SCRUM-75
# @ac: 3, 4
@pytest.mark.parametrize(
    "invalid_capacity",
    [0, -1, -50, 50.5, "50.5", "0", "-5", "fifty", "abc"],
)
def test_invalid_max_capacity_is_refused_on_update(client, invalid_capacity):
    login(client, "venue1")
    resp = put_venue(client, venue_id=1, max_capacity=invalid_capacity)
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Maximum capacity must be a positive whole number."


# @story: SCRUM-75
# @ac: 3, 5
@pytest.mark.parametrize("valid_capacity", [1, 2])
def test_boundary_capacities_accepted_on_update(client, valid_capacity):
    login(client, "venue1")
    resp = put_venue(client, venue_id=1, max_capacity=valid_capacity)
    assert resp.status_code == 200
    assert resp.get_json()["max_capacity"] == valid_capacity


# @story: SCRUM-75
# @ac: 3, 4
@pytest.mark.parametrize(
    "field,invalid_time,label",
    [
        ("opening_time", "24:00", "Opening time"),
        ("opening_time", "09:60", "Opening time"),
        ("opening_time", "morning", "Opening time"),
        ("closing_time", "25:00", "Closing time"),
        ("closing_time", "18:61", "Closing time"),
        ("closing_time", "night", "Closing time"),
    ],
)
def test_malformed_time_is_refused_on_update(client, field, invalid_time, label):
    login(client, "venue1")
    resp = put_venue(client, venue_id=1, **{field: invalid_time})
    assert resp.status_code == 400
    assert resp.get_json()["message"] == f"{label} must be a 24-hour time, for example 08:00."


# @story: SCRUM-75
# @ac: 3, 4
def test_unknown_facility_or_accessibility_is_refused_on_update(client):
    login(client, "venue1")
    resp = put_venue(client, venue_id=1, facilities=["Nonexistent Facility"])
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose each facility from the list."

    resp = put_venue(client, venue_id=1, accessibility_features=["Nonexistent Feature"])
    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Choose each accessibility feature from the list."


# @story: SCRUM-75
# @ac: 4
def test_failed_update_is_atomic_and_leaves_database_unchanged(app, client):
    login(client, "venue1")
    orig_name = "Seminar Room 1"
    orig_cap = 60

    resp = put_venue(client, venue_id=1, name="New Name", max_capacity=0)
    assert resp.status_code == 400

    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.name == orig_name
        assert venue.max_capacity == orig_cap


# @story: SCRUM-75
# @ac: 6
def test_unauthorised_account_receives_403_and_cannot_update(app, client):
    login(client, "coord1")
    resp = put_venue(client, venue_id=1, name="Hacked Name")
    assert resp.status_code == 403
    assert resp.get_json()["message"] == "You do not have permission to perform this action."

    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.name == "Seminar Room 1"


# @story: SCRUM-75
# @ac: 6
def test_multi_role_account_with_venue_staff_can_update(client):
    login(client, "multi1")
    resp = put_venue(client, venue_id=1, name="Multi1 Updated")
    assert resp.status_code == 200
    assert resp.get_json()["name"] == "Multi1 Updated"


# @story: SCRUM-75
# @ac: 4
def test_update_nonexistent_venue_returns_404(client):
    login(client, "venue1")
    resp = put_venue(client, venue_id=99999)
    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."


# @story: SCRUM-75
# @ac: 1, 5
def test_existing_venue_blocks_remain_intact_after_update(app, client):
    login(client, "venue1")
    block_resp = client.post(
        "/api/venues/1/blocks",
        json={
            "start_date": "2026-11-01",
            "start_time": "09:00",
            "end_date": "2026-11-01",
            "end_time": "12:00",
            "reason": "Maintenance",
        },
    )
    assert block_resp.status_code == 201
    block_id = block_resp.get_json()["id"]

    update_resp = put_venue(client, venue_id=1, name="Venue With Block Updated")
    assert update_resp.status_code == 200

    blocks_resp = client.get("/api/venues/1/blocks")
    assert blocks_resp.status_code == 200
    blocks = blocks_resp.get_json()
    assert any(b["id"] == block_id and b["reason"] == "Maintenance" for b in blocks)


# @story: SCRUM-75
# @ac: 5
def test_subsequent_list_and_detail_reads_return_updated_information(client):
    login(client, "venue1")
    put_venue(client, venue_id=1, name="New Name In List", location="New Location In List")

    detail_resp = client.get("/api/venues/1")
    assert detail_resp.status_code == 200
    assert detail_resp.get_json()["name"] == "New Name In List"
    assert detail_resp.get_json()["location"] == "New Location In List"

    list_resp = client.get("/api/venues")
    assert list_resp.status_code == 200
    venues = list_resp.get_json()
    v1 = next(v for v in venues if v["id"] == 1)
    assert v1["name"] == "New Name In List"
    assert v1["location"] == "New Location In List"

