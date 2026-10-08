"""API rules for SCRUM-80 — record setup and turnaround time for a venue.

Validation, atomicity, permissions and persistence of the two new fields.
"""

from datetime import datetime

from db import db
from models import Venue
from permissions import VENUES_EDIT, can


def login(client, username="venue1"):
    response = client.post(
        "/api/login",
        json={"username": username, "password": "Passw0rd!"},
    )
    assert response.status_code == 200


def patch_times(client, venue_id, payload):
    return client.patch(f"/api/venues/{venue_id}/times", json=payload)


# @story: SCRUM-80
# @ac: 4
def test_seeded_venues_default_to_zero_for_both_times(app, client):
    login(client)

    for venue_id in [1, 2]:
        resp = client.get(f"/api/venues/{venue_id}")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["setup_time"] == 0
        assert body["turnaround_time"] == 0


# @story: SCRUM-80
# @ac: 4
def test_database_defaults_are_zero_for_new_venue(app, client):
    login(client)
    resp = client.post(
        "/api/venues",
        json={"name": "Default Times Venue", "location": "Block D", "max_capacity": 50},
    )
    assert resp.status_code == 201
    venue_id = resp.get_json()["id"]

    with app.app_context():
        venue = db.session.get(Venue, venue_id)
        assert venue.setup_time == 0
        assert venue.turnaround_time == 0


# @story: SCRUM-80
# @ac: 1, 2, 5
def test_venue_staff_records_both_times_and_reads_them_back(client):
    login(client)
    resp = patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["setup_time"] == 30
    assert body["turnaround_time"] == 15

    reopened = client.get("/api/venues/1")
    assert reopened.get_json()["setup_time"] == 30
    assert reopened.get_json()["turnaround_time"] == 15


# @story: SCRUM-80
# @ac: 1, 5
def test_updating_setup_time_preserves_turnaround_time(client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": 45, "turnaround_time": 15})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 45
    assert resp.get_json()["turnaround_time"] == 15


# @story: SCRUM-80
# @ac: 1, 5
def test_updating_turnaround_time_preserves_setup_time(client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": 30, "turnaround_time": 20})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 30
    assert resp.get_json()["turnaround_time"] == 20


# @story: SCRUM-80
# @ac: 1, 2, 5
def test_blank_setup_time_saves_as_zero_while_preserving_turnaround(client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": "", "turnaround_time": 15})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 0
    assert resp.get_json()["turnaround_time"] == 15


# @story: SCRUM-80
# @ac: 1, 2, 5
def test_blank_turnaround_time_saves_as_zero_while_preserving_setup(client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": 30, "turnaround_time": ""})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 30
    assert resp.get_json()["turnaround_time"] == 0


# @story: SCRUM-80
# @ac: 1, 2, 5
def test_both_blank_times_save_as_zero(client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": "", "turnaround_time": ""})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 0
    assert resp.get_json()["turnaround_time"] == 0


# @story: SCRUM-80
# @ac: 1, 2, 5
def test_null_values_save_as_zero(client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": None, "turnaround_time": None})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 0
    assert resp.get_json()["turnaround_time"] == 0


# @story: SCRUM-80
# @ac: 2, 3
def test_negative_setup_time_is_refused_and_nothing_changes(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": -1, "turnaround_time": 20})

    assert resp.status_code == 400
    assert "Setup time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_negative_turnaround_time_is_refused_and_nothing_changes(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": 45, "turnaround_time": -1})

    assert resp.status_code == 400
    assert "Turnaround time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_fractional_setup_time_is_refused_and_nothing_changes(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": 0.5, "turnaround_time": 20})

    assert resp.status_code == 400
    assert "Setup time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_fractional_turnaround_time_is_refused_and_nothing_changes(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": 45, "turnaround_time": 0.5})

    assert resp.status_code == 400
    assert "Turnaround time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_setup_time_that_float_rounding_would_whole_is_refused(app, client):
    """A fraction whose nearest float is 1.0 is still a fraction (AC2).

    float('0.99999999999999999') rounds to 1.0, so a float-based check would
    save 1; the refusal must keep both stored times exactly as they were.
    """
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": "0.99999999999999999", "turnaround_time": 20})

    assert resp.status_code == 400
    assert "Setup time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_turnaround_time_that_float_rounding_would_whole_is_refused(app, client):
    """float('30.00000000000000001') rounds to 30.0; the fraction is refused."""
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": 45, "turnaround_time": "30.00000000000000001"})

    assert resp.status_code == 400
    assert "Turnaround time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_non_numeric_setup_time_is_refused_and_nothing_changes(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": "abc", "turnaround_time": 20})

    assert resp.status_code == 400
    assert "Setup time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_boolean_setup_time_is_refused_and_nothing_changes(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": True, "turnaround_time": 20})

    assert resp.status_code == 400
    assert "Setup time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_boolean_turnaround_time_is_refused_and_nothing_changes(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": 45, "turnaround_time": False})

    assert resp.status_code == 400
    assert "Turnaround time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_malformed_body_is_refused_and_nothing_changes(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = client.patch(
        "/api/venues/1/times",
        data="not-json",
        content_type="application/json",
    )

    assert resp.status_code == 400
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_json_body_that_is_not_an_object_is_refused(app, client):
    """A well-formed JSON body that is not an object fails the save contract."""
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = client.patch("/api/venues/1/times", json=42)

    assert resp.status_code == 400
    assert "JSON object" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_missing_setup_time_key_is_refused_and_nothing_changes(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"turnaround_time": 20})

    assert resp.status_code == 400
    assert "both setup_time and turnaround_time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_missing_turnaround_time_key_is_refused_and_nothing_changes(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": 45})

    assert resp.status_code == 400
    assert "both setup_time and turnaround_time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 2, 3
def test_atomic_refusal_when_companion_is_valid_blank(app, client):
    """If setup is invalid and turnaround is blank (would become 0), neither changes."""
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": -1, "turnaround_time": ""})

    assert resp.status_code == 400
    assert "Setup time" in resp.get_json()["message"]
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 30
        assert venue.turnaround_time == 15


# @story: SCRUM-80
# @ac: 1, 2, 5
def test_boundary_zero_is_accepted_for_both_fields(client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = patch_times(client, 1, {"setup_time": 0, "turnaround_time": 0})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 0
    assert resp.get_json()["turnaround_time"] == 0


# @story: SCRUM-80
# @ac: 1, 2, 5
def test_boundary_one_is_accepted_for_both_fields(client):
    login(client)

    resp = patch_times(client, 1, {"setup_time": 1, "turnaround_time": 1})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 1
    assert resp.get_json()["turnaround_time"] == 1


# @story: SCRUM-80
# @ac: 1, 2, 5
def test_exact_whole_number_float_is_accepted(client):
    """30.0 represents an exact whole number and is accepted."""
    login(client)

    resp = patch_times(client, 1, {"setup_time": 30.0, "turnaround_time": 15.0})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 30
    assert resp.get_json()["turnaround_time"] == 15


# @story: SCRUM-80
# @ac: 1, 2, 5
def test_string_whole_number_is_accepted(client):
    login(client)

    resp = patch_times(client, 1, {"setup_time": "45", "turnaround_time": "20"})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 45
    assert resp.get_json()["turnaround_time"] == 20


# @story: SCRUM-80
# @ac: 6
def test_event_coordinator_cannot_change_times(app, client):
    login(client, "coord1")

    resp = patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    assert resp.status_code == 403
    assert resp.get_json()["message"] == "You do not have permission to perform this action."
    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.setup_time == 0
        assert venue.turnaround_time == 0


# @story: SCRUM-80
# @ac: 6
def test_not_logged_in_is_refused(client):
    resp = patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    assert resp.status_code == 401
    assert resp.get_json()["message"] == "Not logged in"


# @story: SCRUM-80
# @ac: 6
def test_multi_role_account_can_change_times(client):
    login(client, "multi1")

    resp = patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    assert resp.status_code == 200
    assert resp.get_json()["setup_time"] == 30
    assert resp.get_json()["turnaround_time"] == 15


# @story: SCRUM-80
# @ac: 3
def test_unknown_venue_returns_404(client):
    login(client)

    resp = patch_times(client, 99999, {"setup_time": 30, "turnaround_time": 15})

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."


# @story: SCRUM-80
# @ac: 5
def test_times_persist_after_repeated_edits(client):
    login(client)
    patch_times(client, 1, {"setup_time": 10, "turnaround_time": 5})
    patch_times(client, 1, {"setup_time": 20, "turnaround_time": 10})
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = client.get("/api/venues/1")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["setup_time"] == 30
    assert body["turnaround_time"] == 15


# @story: SCRUM-80
# @ac: 5
def test_times_in_list_response_match_detail_response(client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    list_resp = client.get("/api/venues")
    detail_resp = client.get("/api/venues/1")

    list_venue = next(v for v in list_resp.get_json() if v["id"] == 1)
    detail_venue = detail_resp.get_json()
    assert list_venue["setup_time"] == 30
    assert list_venue["turnaround_time"] == 15
    assert detail_venue["setup_time"] == 30
    assert detail_venue["turnaround_time"] == 15


# @story: SCRUM-80
# @ac: 5
def test_update_times_does_not_alter_other_venue_fields(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    with app.app_context():
        venue = db.session.get(Venue, 1)
        assert venue.name == "Seminar Room 1"
        assert venue.location == "Block A Level 2"
        assert venue.max_capacity == 60


# @story: SCRUM-80
# @ac: 5
def test_update_times_does_not_alter_layouts(app, client):
    login(client)
    client.patch("/api/venues/1/layouts", json={"layouts": ["Classroom", "Theatre"]})
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = client.get("/api/venues/1")
    assert resp.get_json()["layouts"] == ["Classroom", "Theatre"]


# @story: SCRUM-80
# @ac: 5
def test_update_times_does_not_alter_blocks(app, client):
    login(client)
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

    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    blocks_resp = client.get("/api/venues/1/blocks")
    assert blocks_resp.status_code == 200
    blocks = blocks_resp.get_json()
    assert any(b["id"] == block_id and b["reason"] == "Maintenance" for b in blocks)


# @story: SCRUM-80
# @ac: 5
def test_update_venue_does_not_alter_times(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = client.put(
        "/api/venues/1",
        json={
            "name": "Updated Name",
            "location": "Block A",
            "max_capacity": 100,
            "opening_time": "08:00",
            "closing_time": "20:00",
            "facilities": [],
            "accessibility_features": [],
        },
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["setup_time"] == 30
    assert body["turnaround_time"] == 15


# @story: SCRUM-80
# @ac: 5
def test_update_layouts_does_not_alter_times(app, client):
    login(client)
    patch_times(client, 1, {"setup_time": 30, "turnaround_time": 15})

    resp = client.patch("/api/venues/1/layouts", json={"layouts": ["Banquet"]})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["setup_time"] == 30
    assert body["turnaround_time"] == 15


# @story: SCRUM-80
# @ac: 6
def test_venues_edit_belongs_to_venue_staff_only(app):
    from models import Account

    accounts = {
        account.username: account for account in db.session.query(Account).all()
    }
    assert can(accounts["venue1"], VENUES_EDIT) is True
    assert can(accounts["coord1"], VENUES_EDIT) is False
    assert can(accounts["multi1"], VENUES_EDIT) is True


# Coverage for the whole touched models.py file — existing model methods that
# are not otherwise exercised by the venue test subset.


def test_role_repr_names_itself(app):
    from models import Role

    with app.app_context():
        role = db.session.query(Role).filter_by(name="Venue Staff").one()
        assert repr(role) == "<Role Venue Staff>"


def test_account_repr_role_names_and_has_role(app):
    from models import Account

    with app.app_context():
        account = db.session.query(Account).filter_by(username="venue1").one()
        assert repr(account) == "<Account venue1>"
        assert account.role_names == ["Venue Staff"]
        assert account.has_role("Venue Staff") is True
        assert account.has_role("Event Coordinator") is False


def test_event_request_repr_and_methods(app):
    from models import Account, EventRequest

    with app.app_context():
        organiser = db.session.query(Account).filter_by(username="org1").one()
        req = EventRequest(created_by_id=organiser.id, name="Coverage Request", status="Draft")
        db.session.add(req)
        db.session.commit()
        assert repr(req) == f"<EventRequest {req.id} Draft>"
        missing = req.missing_fields()
        # Every required field except name is unset, in REQUIRED_FIELDS order.
        # SCRUM-42 dropped the free-text venue_requirements and
        # accessibility_needs; every remaining required field except name is
        # unset, in REQUIRED_FIELDS order.
        assert missing == [
            "purpose",
            "description",
            "date",
            "start_time",
            "end_time",
            "attendance",
            "equipment_requirements",
            "registration_needs",
        ]
        as_dict = req.to_dict()
        assert as_dict["name"] == "Coverage Request"
        assert as_dict["status"] == "Draft"


def test_venue_block_repr(app):
    from models import VenueBlock

    with app.app_context():
        assert db.session.query(VenueBlock).count() == 0
        # Create a block to exercise repr
        block = VenueBlock(
            venue_id=1,
            starts_at=datetime(2026, 11, 1, 9, 0),
            ends_at=datetime(2026, 11, 1, 12, 0),
            reason="Test",
            created_by_id=1,
            created_at=datetime(2026, 10, 8, 0, 0),
        )
        db.session.add(block)
        db.session.commit()
        assert repr(block) == f"<VenueBlock {block.id} venue 1>"


def test_venue_booking_request_repr(app):
    from models import VenueBookingRequest

    with app.app_context():
        assert db.session.query(VenueBookingRequest).count() == 0
        # Create a booking request to exercise repr
        booking = VenueBookingRequest(
            venue_id=1,
            event_request_id=1,
            status="Requested",
            date="2026-11-01",
            start_time="09:00",
            end_time="17:00",
            attendance=50,
            raised_by_id=1,
            raised_at=datetime(2026, 10, 8, 0, 0),
        )
        db.session.add(booking)
        db.session.commit()
        assert repr(booking) == (
            f"<VenueBookingRequest {booking.id} venue 1 event 1 Requested>"
        )


def test_schema_meta_repr(app):
    from models import SchemaMeta

    with app.app_context():
        meta = db.session.query(SchemaMeta).one()
        assert repr(meta) == f"<SchemaMeta v{meta.version}>"
