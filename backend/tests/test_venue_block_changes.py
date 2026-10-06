"""Ending or removing a venue block — SCRUM-79 (End or Remove a Venue Block).

The acceptance criteria as rules at the API: a block that has not started can
be removed; a block in progress can be ended at a new end time that is no
earlier than now, after its start and before its original end; a block that
has ended can be neither; a refusal changes nothing; the venue's block list
shows the change; and only Venue Staff may do either. The browser journeys
are the Playwright spec's (functional/tests/SCRUM-79.spec.js).

Every rule reads the time through clock.now_local(), which the `now` fixture
replaces, so no test depends on the real time or sleeps.
"""

from datetime import datetime, timezone

import pytest

import clock
from db import db
from models import Venue, VenueBlock

# The block every test starts from: 20 Oct 09:00 to 21 Oct 18:00, Singapore time.
START = datetime(2026, 10, 20, 9, 0)
END = datetime(2026, 10, 21, 18, 0)
BLOCK = {
    "start_date": "2026-10-20",
    "start_time": "09:00",
    "end_date": "2026-10-21",
    "end_time": "18:00",
    "reason": "Lift repair",
}
# A moment inside the block: 20 Oct 12:00.
DURING = datetime(2026, 10, 20, 12, 0)

FORBIDDEN = "You do not have permission to perform this action."
REMOVE_STARTED = "A block that has started cannot be removed; end it early instead."
REMOVE_ENDED = "A block that has already ended cannot be removed."
END_UPCOMING = "A block that has not started cannot be ended early; remove it instead."
END_ENDED = "A block that has already ended cannot be ended."
END_BEFORE_NOW = "New end cannot be earlier than the current time."
END_NOT_AFTER_START = "New end must be after the block's start."
END_NOT_BEFORE_END = "New end must be before the block's current end."


class FixedClock:
    """What clock.now_local() returns while a test runs; set `.value` to move it."""

    def __init__(self, value):
        self.value = value

    def __call__(self):
        return self.value


@pytest.fixture
def now(monkeypatch):
    fixed = FixedClock(DURING)
    monkeypatch.setattr(clock, "now_local", fixed)
    return fixed


def login(client, username="venue1"):
    client.post("/api/logout")
    resp = client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
    assert resp.status_code == 200


def venue_id(name="Seminar Room 1"):
    return db.session.query(Venue).filter_by(name=name).one().id


def create_block(client, venue=None, **overrides):
    """Block a venue as venue1 through the API (SCRUM-40) and return the block's id."""
    login(client, "venue1")
    body = dict(BLOCK)
    body.update(overrides)
    resp = client.post(f"/api/venues/{venue or venue_id()}/blocks", json=body)
    assert resp.status_code == 201
    return resp.get_json()["id"]


def remove(client, block_id, venue=None):
    return client.delete(f"/api/venues/{venue or venue_id()}/blocks/{block_id}")


def end_at(client, block_id, end_date, end_time, venue=None):
    return client.patch(
        f"/api/venues/{venue or venue_id()}/blocks/{block_id}",
        json={"end_date": end_date, "end_time": end_time},
    )


def stored(block_id):
    """The block as stored now, or None once removed."""
    db.session.expire_all()
    block = db.session.get(VenueBlock, block_id)
    return None if block is None else (block.starts_at, block.ends_at, block.reason)


def listed(client, venue=None):
    return client.get(f"/api/venues/{venue or venue_id()}/blocks").get_json()


UNCHANGED = (START, END, "Lift repair")


# --- The clock: Singapore time, to the minute ---


class FrozenDateTime(datetime):
    """datetime whose now() is a fixed UTC moment, for testing clock.now_local itself."""

    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 10, 6, 16, 30, 45, 123456, tzinfo=timezone.utc).astimezone(tz)


# @story: SCRUM-79
# @ac: 3
def test_the_clock_reads_singapore_time_to_the_minute(monkeypatch):
    monkeypatch.setattr(clock, "datetime", FrozenDateTime)

    # 16:30:45 UTC on 6 Oct plus 8 hours is 00:30:45 on 7 Oct in Singapore;
    # seconds are dropped, and the result is naive like a block's times.
    assert clock.now_local() == datetime(2026, 10, 7, 0, 30)
    assert clock.now_local().tzinfo is None


# --- Phase: which action a block offers, from its timing ---


# @story: SCRUM-79
# @ac: 1, 2, 3
@pytest.mark.parametrize(
    "moment, phase",
    [
        (datetime(2026, 10, 20, 8, 59), "upcoming"),  # one minute before the start
        (START, "in_progress"),  # at the start: the start is inside the block
        (datetime(2026, 10, 21, 17, 59), "in_progress"),  # one minute before the end
        (END, "ended"),  # at the end: the end is not inside the block
    ],
)
def test_a_blocks_phase_follows_the_current_time(client, now, moment, phase):
    block_id = create_block(client)
    now.value = moment

    rows = listed(client)

    assert [(row["id"], row["phase"]) for row in rows] == [(block_id, phase)]


# --- AC1: a block that has not started can be removed ---


# @story: SCRUM-79
# @ac: 1, 4
def test_venue_staff_remove_a_block_that_has_not_started(client, now):
    block_id = create_block(client)
    now.value = datetime(2026, 10, 20, 8, 59)  # one minute before the start

    resp = remove(client, block_id)

    assert resp.status_code == 204
    assert resp.data == b""
    assert stored(block_id) is None
    assert listed(client) == []


# @story: SCRUM-79
# @ac: 1, 4
def test_removing_a_block_leaves_the_venues_other_blocks_listed(client, now):
    removed = create_block(client)
    kept = create_block(client, start_date="2026-10-25", end_date="2026-10-25", reason="Deep clean")
    now.value = datetime(2026, 10, 19, 12, 0)  # both upcoming

    assert remove(client, removed).status_code == 204

    assert [row["id"] for row in listed(client)] == [kept]


# @story: SCRUM-79
# @ac: 1, 3
@pytest.mark.parametrize(
    "moment, message",
    [
        (START, REMOVE_STARTED),  # in progress from its very start
        (DURING, REMOVE_STARTED),
        (END, REMOVE_ENDED),  # ended at its very end
        (datetime(2026, 10, 22, 9, 0), REMOVE_ENDED),
    ],
)
def test_a_block_that_has_started_or_ended_cannot_be_removed_and_is_unchanged(client, now, moment, message):
    block_id = create_block(client)
    now.value = moment

    resp = remove(client, block_id)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 1
def test_a_removed_block_cannot_be_removed_again(client, now):
    block_id = create_block(client)
    now.value = datetime(2026, 10, 19, 12, 0)
    assert remove(client, block_id).status_code == 204

    resp = remove(client, block_id)

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Block not found."


# --- AC2, AC3: a block in progress can be ended at a new end time ---


# @story: SCRUM-79
# @ac: 2, 4
def test_venue_staff_end_a_block_in_progress_early(client, now):
    block_id = create_block(client)

    resp = end_at(client, block_id, "2026-10-20", "15:00")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["id"] == block_id
    assert body["start"] == "2026-10-20T09:00"
    assert body["end"] == "2026-10-20T15:00"
    assert body["reason"] == "Lift repair"
    # 12:00 now is still before the 15:00 new end.
    assert body["phase"] == "in_progress"
    assert stored(block_id) == (START, datetime(2026, 10, 20, 15, 0), "Lift repair")


# @story: SCRUM-79
# @ac: 2, 4
def test_an_ended_block_is_listed_with_its_original_start_and_new_end(client, now):
    block_id = create_block(client)
    assert end_at(client, block_id, "2026-10-20", "15:00").status_code == 200

    rows = listed(client)

    assert [(row["id"], row["start"], row["end"], row["reason"]) for row in rows] == [
        (block_id, "2026-10-20T09:00", "2026-10-20T15:00", "Lift repair")
    ]


# @story: SCRUM-79
# @ac: 2, 3
def test_a_new_end_equal_to_the_current_time_is_accepted_and_the_block_has_ended(client, now):
    block_id = create_block(client)

    # "No earlier than the current time": now itself is allowed.
    resp = end_at(client, block_id, "2026-10-20", "12:00")

    assert resp.status_code == 200
    assert resp.get_json()["end"] == "2026-10-20T12:00"
    # now = end, and the end is not inside the block.
    assert resp.get_json()["phase"] == "ended"
    assert stored(block_id) == (START, DURING, "Lift repair")


# @story: SCRUM-79
# @ac: 3
def test_a_new_end_one_minute_before_the_current_time_is_refused(client, now):
    block_id = create_block(client)

    resp = end_at(client, block_id, "2026-10-20", "11:59")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == END_BEFORE_NOW
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 3
def test_a_new_end_on_an_earlier_date_than_now_is_refused_even_with_a_later_time(client, now):
    block_id = create_block(client)
    now.value = datetime(2026, 10, 21, 10, 0)

    # 20 Oct 18:00 is before 21 Oct 10:00 although 18:00 is later than 10:00.
    resp = end_at(client, block_id, "2026-10-20", "18:00")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == END_BEFORE_NOW
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 2, 3
@pytest.mark.parametrize(
    "end_date, end_time",
    [
        ("2026-10-21", "17:59"),  # one minute before the original 18:00 end
        ("2026-10-20", "12:01"),  # one minute after now
    ],
)
def test_a_new_end_just_inside_the_limits_is_accepted(client, now, end_date, end_time):
    block_id = create_block(client)

    resp = end_at(client, block_id, end_date, end_time)

    assert resp.status_code == 200
    assert resp.get_json()["end"] == f"{end_date}T{end_time}"
    assert stored(block_id)[1] == datetime.strptime(f"{end_date} {end_time}", "%Y-%m-%d %H:%M")


# @story: SCRUM-79
# @ac: 3
@pytest.mark.parametrize(
    "end_date, end_time",
    [
        ("2026-10-21", "18:00"),  # equal to the original end: not "before" it
        ("2026-10-21", "18:01"),  # one minute after: that would extend the block
        ("2026-10-22", "09:00"),
    ],
)
def test_a_new_end_not_before_the_original_end_is_refused(client, now, end_date, end_time):
    block_id = create_block(client)

    resp = end_at(client, block_id, end_date, end_time)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == END_NOT_BEFORE_END
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 3
def test_a_new_end_equal_to_the_start_is_refused_when_the_block_has_just_started(client, now):
    block_id = create_block(client)
    now.value = START

    # 09:00 is no earlier than now (09:00), but it is not after the 09:00 start.
    resp = end_at(client, block_id, "2026-10-20", "09:00")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == END_NOT_AFTER_START
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 2, 3
def test_a_new_end_one_minute_after_the_start_is_accepted_when_the_block_has_just_started(client, now):
    block_id = create_block(client)
    now.value = START

    resp = end_at(client, block_id, "2026-10-20", "09:01")

    assert resp.status_code == 200
    assert stored(block_id) == (START, datetime(2026, 10, 20, 9, 1), "Lift repair")


# @story: SCRUM-79
# @ac: 2, 3
@pytest.mark.parametrize(
    "moment, message",
    [
        (datetime(2026, 10, 20, 8, 59), END_UPCOMING),  # one minute before the start
        (END, END_ENDED),  # at the end
        (datetime(2026, 10, 22, 9, 0), END_ENDED),
    ],
)
def test_a_block_that_is_not_in_progress_cannot_be_ended_and_is_unchanged(client, now, moment, message):
    block_id = create_block(client)
    now.value = moment

    # A new end that would otherwise be valid for an upcoming block: after now,
    # after the start and before the end.
    resp = end_at(client, block_id, "2026-10-21", "12:00")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 3
def test_a_block_ended_early_cannot_then_be_extended(client, now):
    block_id = create_block(client)
    assert end_at(client, block_id, "2026-10-20", "15:00").status_code == 200

    # Back to the original end: no longer before the block's current end.
    resp = end_at(client, block_id, "2026-10-21", "18:00")

    assert resp.status_code == 400
    assert resp.get_json()["message"] == END_NOT_BEFORE_END
    assert stored(block_id)[1] == datetime(2026, 10, 20, 15, 0)


# @story: SCRUM-79
# @ac: 3
@pytest.mark.parametrize(
    "body, message",
    [
        ({"end_time": "15:00"}, "New end date is required."),
        ({"end_date": "2026-10-20"}, "New end time is required."),
        ({"end_date": "", "end_time": "15:00"}, "New end date is required."),
        ({"end_date": "   ", "end_time": "15:00"}, "New end date is required."),
        ({"end_date": "2026-10-20", "end_time": ""}, "New end time is required."),
        ({"end_date": "2026-10-20", "end_time": "\t"}, "New end time is required."),
        ({"end_date": None, "end_time": None}, "New end date is required."),
        ({}, "New end date is required."),
        ({"end_date": "2026-02-30", "end_time": "15:00"}, "New end date must be a valid date."),
        ({"end_date": "20/10/2026", "end_time": "15:00"}, "New end date must be a valid date."),
        ({"end_date": "2026-10-20", "end_time": "24:00"}, "New end time must be a 24-hour time, for example 09:00."),
        ({"end_date": "2026-10-20", "end_time": "3pm"}, "New end time must be a 24-hour time, for example 09:00."),
    ],
)
def test_a_missing_blank_or_unparseable_new_end_is_refused_naming_the_field(client, now, body, message):
    block_id = create_block(client)

    resp = client.patch(f"/api/venues/{venue_id()}/blocks/{block_id}", json=body)

    assert resp.status_code == 400
    assert resp.get_json()["message"] == message
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 3
def test_a_body_that_is_not_json_is_refused_naming_the_first_field(client, now):
    block_id = create_block(client)

    resp = client.patch(
        f"/api/venues/{venue_id()}/blocks/{block_id}", data="not json", content_type="text/plain"
    )

    assert resp.status_code == 400
    assert resp.get_json()["message"] == "New end date is required."
    assert stored(block_id) == UNCHANGED


# --- Unknown venue or block ---


# @story: SCRUM-79
# @ac: 1, 2
@pytest.mark.parametrize("method", ["delete", "patch"])
def test_an_unknown_venue_is_not_found(client, now, method):
    block_id = create_block(client)

    resp = getattr(client, method)(f"/api/venues/9999/blocks/{block_id}", json={})

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Venue not found."
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 1, 2
@pytest.mark.parametrize("method", ["delete", "patch"])
def test_an_unknown_block_is_not_found(client, now, method):
    login(client)

    resp = getattr(client, method)(f"/api/venues/{venue_id()}/blocks/9999", json={})

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Block not found."


# @story: SCRUM-79
# @ac: 1, 2
@pytest.mark.parametrize("method", ["delete", "patch"])
def test_a_block_of_another_venue_is_not_found_and_is_unchanged(client, now, method):
    block_id = create_block(client, venue=venue_id("Auditorium"))
    # Upcoming for DELETE would succeed if the venue were ignored; in progress for PATCH likewise.
    now.value = datetime(2026, 10, 19, 12, 0) if method == "delete" else DURING

    resp = getattr(client, method)(
        f"/api/venues/{venue_id()}/blocks/{block_id}", json={"end_date": "2026-10-20", "end_time": "15:00"}
    )

    assert resp.status_code == 404
    assert resp.get_json()["message"] == "Block not found."
    assert stored(block_id) == UNCHANGED


# --- AC5: only Venue Staff can end or remove a block ---


# @story: SCRUM-79
# @ac: 5
@pytest.mark.parametrize("username", ["org1", "coord1", "tech1", "att1"])
def test_an_account_without_venue_staff_cannot_remove_a_block_and_nothing_changes(client, now, username):
    block_id = create_block(client)
    now.value = datetime(2026, 10, 19, 12, 0)  # upcoming: Venue Staff could remove it
    login(client, username)

    resp = remove(client, block_id)

    assert resp.status_code == 403
    assert resp.get_json()["message"] == FORBIDDEN
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 5
@pytest.mark.parametrize("username", ["org1", "coord1", "tech1", "att1"])
def test_an_account_without_venue_staff_cannot_end_a_block_and_nothing_changes(client, now, username):
    block_id = create_block(client)  # in progress: Venue Staff could end it at 15:00
    login(client, username)

    resp = end_at(client, block_id, "2026-10-20", "15:00")

    assert resp.status_code == 403
    assert resp.get_json()["message"] == FORBIDDEN
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 5
@pytest.mark.parametrize("method", ["delete", "patch"])
def test_the_role_check_comes_before_the_block_lookup(client, now, method):
    login(client, "coord1")

    # Refused for the role, so the reply says nothing about whether block 9999 exists.
    resp = getattr(client, method)("/api/venues/9999/blocks/9999", json={})

    assert resp.status_code == 403
    assert resp.get_json()["message"] == FORBIDDEN


# @story: SCRUM-79
# @ac: 5
@pytest.mark.parametrize("method", ["delete", "patch"])
def test_not_logged_in_cannot_end_or_remove_a_block(client, now, method):
    block_id = create_block(client)
    now.value = datetime(2026, 10, 19, 12, 0) if method == "delete" else DURING
    client.post("/api/logout")

    resp = getattr(client, method)(
        f"/api/venues/{venue_id()}/blocks/{block_id}", json={"end_date": "2026-10-20", "end_time": "15:00"}
    )

    assert resp.status_code == 401
    assert stored(block_id) == UNCHANGED


# @story: SCRUM-79
# @ac: 5
def test_an_account_holding_venue_staff_among_its_roles_can_remove_a_block(client, now):
    block_id = create_block(client)
    now.value = datetime(2026, 10, 19, 12, 0)
    # multi1 is Event Coordinator and Venue Staff: any role allowing it is enough (D-09).
    login(client, "multi1")

    resp = remove(client, block_id)

    assert resp.status_code == 204
    assert stored(block_id) is None


# @story: SCRUM-79
# @ac: 5
def test_an_account_holding_venue_staff_among_its_roles_can_end_a_block(client, now):
    block_id = create_block(client)
    login(client, "multi1")

    resp = end_at(client, block_id, "2026-10-20", "15:00")

    assert resp.status_code == 200
    assert stored(block_id) == (START, datetime(2026, 10, 20, 15, 0), "Lift repair")
