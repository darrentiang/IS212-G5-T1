"""Venue block rules — SCRUM-40 (Block a Venue for an Operational Reason).

The acceptance criteria as rules at the API: a block needs a start, an end and
a reason, the start must be before the end, a refusal records nothing, the
venue's blocks are listed with their period and reason, and only Venue Staff
may block. The browser journeys are the Playwright spec's
(functional/tests/SCRUM-40.spec.js).
"""

from datetime import datetime, timezone

import pytest

from db import db
from models import Venue, VenueBlock

VALID = {
    "start_date": "2026-10-20",
    "start_time": "09:00",
    "end_date": "2026-10-21",
    "end_time": "18:00",
    "reason": "Projector replacement",
}

# Form order, with the label each refusal names (AC1: all three are required;
# the start and the end are each a date and a time).
REQUIRED = [
    ("start_date", "Start date is required."),
    ("start_time", "Start time is required."),
    ("end_date", "End date is required."),
    ("end_time", "End time is required."),
    ("reason", "Reason is required."),
]

START_BEFORE_END = "End must be after the start."


def login(client, username="venue1"):
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def venue_id(name="Seminar Room 1"):
    return db.session.query(Venue).filter_by(name=name).one().id


def post_block(client, venue=None, **overrides):
    body = dict(VALID)
    body.update(overrides)
    return client.post(f"/api/venues/{venue or venue_id()}/blocks", json=body)


def block_count():
    return db.session.query(VenueBlock).count()


# --- AC1: a block with a start, an end and a reason is recorded ---


# @story: SCRUM-40
# @ac: 1
def test_venue_staff_block_a_venue_for_a_period_with_a_reason(client):
    login(client)

    resp = post_block(client)

    assert resp.status_code == 201
    body = resp.get_json()
    assert body["venue_id"] == venue_id()
    assert body["start"] == "2026-10-20T09:00"
    assert body["end"] == "2026-10-21T18:00"
    assert body["reason"] == "Projector replacement"
    assert body["created_by"] == "venue1"


# @story: SCRUM-40
# @ac: 1
def test_a_block_is_stored_with_its_local_period_who_and_when(client):
    login(client)
    before = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)

    resp = post_block(client)

    block = db.session.get(VenueBlock, resp.get_json()["id"])
    # Naive local date-times exactly as entered: no time zone shift.
    assert block.start == datetime(2026, 10, 20, 9, 0)
    assert block.end == datetime(2026, 10, 21, 18, 0)
    assert block.reason == "Projector replacement"
    assert block.created_by.username == "venue1"
    # created_at is UTC (the same convention as submitted_at), taken at the request.
    assert block.created_at.replace(tzinfo=None) >= before
    assert repr(block) == f"<VenueBlock {block.id} venue {venue_id()}>"


# @story: SCRUM-40
# @ac: 1
def test_the_reason_is_stored_without_surrounding_spaces(client):
    login(client)

    resp = post_block(client, reason="  Deep clean  ")

    assert resp.status_code == 201
    assert resp.get_json()["reason"] == "Deep clean"


# --- AC1: start, end and reason are required ---


# @story: SCRUM-40
# @ac: 1
@pytest.mark.parametrize("field, message", REQUIRED)
def test_a_missing_field_is_refused_and_nothing_is_recorded(client, field, message):
    login(client)
    body = dict(VALID)
    del body[field]

    resp = client.post(f"/api/venues/{venue_id()}/blocks", json=body)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    assert block_count() == 0


# @story: SCRUM-40
# @ac: 1
@pytest.mark.parametrize("blank", ["", "   ", "\t\n", None])
@pytest.mark.parametrize("field, message", REQUIRED)
def test_a_blank_or_whitespace_field_is_refused_and_nothing_is_recorded(client, field, message, blank):
    login(client)

    resp = post_block(client, **{field: blank})

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    assert block_count() == 0


# @story: SCRUM-40
# @ac: 1
def test_an_empty_body_is_refused_naming_the_first_field(client):
    login(client)

    resp = client.post(f"/api/venues/{venue_id()}/blocks", data="not json", content_type="text/plain")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "Start date is required."
    assert block_count() == 0


# --- AC1: the start must be before the end ---


# @story: SCRUM-40
# @ac: 1
@pytest.mark.parametrize(
    "end_time",
    [
        "09:59",  # one minute before the 10:00 start
        "10:00",  # equal to the start: not "before"
    ],
)
def test_an_end_not_after_the_start_is_refused_and_nothing_is_recorded(client, end_time):
    login(client)

    resp = post_block(
        client, start_date="2026-10-20", start_time="10:00", end_date="2026-10-20", end_time=end_time
    )

    assert resp.status_code == 400
    assert resp.get_json()["message"] == START_BEFORE_END
    assert block_count() == 0


# @story: SCRUM-40
# @ac: 1
def test_an_end_one_minute_after_the_start_is_accepted(client):
    login(client)

    resp = post_block(
        client, start_date="2026-10-20", start_time="10:00", end_date="2026-10-20", end_time="10:01"
    )

    assert resp.status_code == 201
    assert resp.get_json()["start"] == "2026-10-20T10:00"
    assert resp.get_json()["end"] == "2026-10-20T10:01"
    assert block_count() == 1


# @story: SCRUM-40
# @ac: 1
def test_an_end_on_an_earlier_date_is_refused_even_with_a_later_time(client):
    login(client)

    # 20 Oct 18:00 is before 21 Oct 09:00, although 18:00 is later than 09:00:
    # comparing the times alone would wrongly accept it.
    resp = post_block(
        client, start_date="2026-10-21", start_time="09:00", end_date="2026-10-20", end_time="18:00"
    )

    assert resp.status_code == 400
    assert resp.get_json()["message"] == START_BEFORE_END
    assert block_count() == 0


# @story: SCRUM-40
# @ac: 1
def test_an_end_on_a_later_date_with_an_earlier_time_is_accepted(client):
    login(client)

    # 21 Oct 08:00 is after 20 Oct 18:00: comparing the times alone would refuse it.
    resp = post_block(
        client, start_date="2026-10-20", start_time="18:00", end_date="2026-10-21", end_time="08:00"
    )

    assert resp.status_code == 201


# @story: SCRUM-40
# @ac: 1
@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"start_date": "2026-02-30"}, "Start date must be a valid date."),
        ({"start_date": "20/10/2026"}, "Start date must be a valid date."),
        ({"start_time": "24:00"}, "Start time must be a 24-hour time, for example 09:00."),
        ({"start_time": "9am"}, "Start time must be a 24-hour time, for example 09:00."),
        ({"end_date": "2026-13-01"}, "End date must be a valid date."),
        ({"end_time": "18:60"}, "End time must be a 24-hour time, for example 09:00."),
    ],
)
def test_a_start_or_end_that_is_not_a_date_and_time_is_refused(client, overrides, message):
    login(client)

    resp = post_block(client, **overrides)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    assert block_count() == 0


# @story: SCRUM-40
# @ac: 1
def test_an_unknown_venue_cannot_be_blocked(client):
    login(client)

    resp = post_block(client, venue=9999)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."
    assert block_count() == 0


# --- AC2: the venue's page lists its blocks, each with its period and reason ---


# @story: SCRUM-40
# @ac: 2
def test_a_venues_blocks_are_listed_with_period_and_reason(client):
    login(client)
    first = post_block(client).get_json()
    second = post_block(
        client, start_date="2026-11-02", start_time="08:00", end_date="2026-11-02", end_time="12:00",
        reason="Safety inspection",
    ).get_json()

    resp = client.get(f"/api/venues/{venue_id()}/blocks")

    assert resp.status_code == 200
    rows = resp.get_json()
    assert [row["id"] for row in rows] == [first["id"], second["id"]]
    assert [(row["start"], row["end"], row["reason"]) for row in rows] == [
        ("2026-10-20T09:00", "2026-10-21T18:00", "Projector replacement"),
        ("2026-11-02T08:00", "2026-11-02T12:00", "Safety inspection"),
    ]
    assert all(row["created_by"] == "venue1" for row in rows)
    assert all(row["created_at"] for row in rows)


# @story: SCRUM-40
# @ac: 2
def test_a_venue_lists_only_its_own_blocks(client):
    login(client)
    seminar = post_block(client).get_json()
    auditorium = post_block(client, venue=venue_id("Auditorium"), reason="Renovation").get_json()

    seminar_rows = client.get(f"/api/venues/{venue_id()}/blocks").get_json()
    auditorium_rows = client.get(f"/api/venues/{venue_id('Auditorium')}/blocks").get_json()

    assert [row["id"] for row in seminar_rows] == [seminar["id"]]
    assert [row["id"] for row in auditorium_rows] == [auditorium["id"]]


# @story: SCRUM-40
# @ac: 2
def test_a_venue_with_no_blocks_lists_none(client):
    login(client)

    resp = client.get(f"/api/venues/{venue_id()}/blocks")

    assert resp.status_code == 200
    assert resp.get_json() == []


# @story: SCRUM-40
# @ac: 2
def test_an_event_coordinator_sees_a_venues_blocks(client):
    login(client, "venue1")
    block = post_block(client).get_json()
    client.post("/api/logout")
    login(client, "coord1")

    resp = client.get(f"/api/venues/{venue_id()}/blocks")

    assert resp.status_code == 200
    assert [row["id"] for row in resp.get_json()] == [block["id"]]


# @story: SCRUM-40
# @ac: 2
def test_an_unknown_venue_has_no_block_list(client):
    login(client)

    resp = client.get("/api/venues/9999/blocks")

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."


# @story: SCRUM-40
# @ac: 2
@pytest.mark.parametrize("username", ["org1", "tech1", "att1"])
def test_an_account_without_venues_view_cannot_list_blocks(client, username):
    login(client, username)

    resp = client.get(f"/api/venues/{venue_id()}/blocks")

    assert resp.status_code == 403
    assert resp.get_json()["message"] == "You do not have permission to perform this action."


# --- AC3: only Venue Staff can block a venue ---


# @story: SCRUM-40
# @ac: 3
@pytest.mark.parametrize("username", ["org1", "coord1", "tech1", "att1"])
def test_an_account_without_venue_staff_cannot_block_and_nothing_is_recorded(client, username):
    login(client, username)

    resp = post_block(client)

    assert resp.status_code == 403
    assert resp.get_json()["message"] == "You do not have permission to perform this action."
    assert block_count() == 0


# @story: SCRUM-40
# @ac: 3
def test_the_role_check_comes_before_the_venue_lookup(client):
    login(client, "coord1")

    # Refused for the role, so the reply says nothing about whether venue 9999 exists.
    resp = post_block(client, venue=9999)

    assert resp.status_code == 403


# @story: SCRUM-40
# @ac: 3
def test_not_logged_in_cannot_block(client):
    resp = post_block(client)

    assert resp.status_code == 401
    assert block_count() == 0


# @story: SCRUM-40
# @ac: 3
def test_an_account_holding_venue_staff_among_its_roles_can_block(client):
    # multi1 is Event Coordinator and Venue Staff: any role allowing it is enough (D-09).
    login(client, "multi1")

    resp = post_block(client)

    assert resp.status_code == 201
    assert resp.get_json()["created_by"] == "multi1"
    assert block_count() == 1
