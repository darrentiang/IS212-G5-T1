"""Unit tests for the test-data helpers in tests/factories.py.

Test infrastructure has no Jira key; the reference is the test-data rule in
AGENTS.md §4 and docs/test-cases/AUTOMATION.md.
"""

from db import db
from factories import account, make_event
from models import EventRequest


# @story: setup
# @ac: test-speed
def test_account_returns_the_seeded_account(app):
    found = account("multi1")

    assert found.username == "multi1"
    assert found.role_names == ["Event Coordinator", "Venue Staff"]


# @story: setup
# @ac: test-speed
def test_make_event_stores_the_given_values_with_neutral_defaults(app):
    event = make_event(
        name="Factory Default Event",
        status="Draft",
        date="2026-12-01",
        start_time="09:00",
        end_time="11:00",
    )

    db.session.expire_all()  # read back what was committed, not the cached object
    stored = db.session.get(EventRequest, event.id)
    assert stored.name == "Factory Default Event"
    assert stored.status == "Draft"
    assert (stored.date, stored.start_time, stored.end_time) == ("2026-12-01", "09:00", "11:00")
    assert stored.created_by.username == "org1"
    assert stored.attendance == 50
    assert stored.layout is None
    assert stored.facilities == []
    assert stored.accessibility_features == []


# @story: setup
# @ac: test-speed
def test_make_event_links_requirements_by_name_and_passes_other_fields(app):
    event = make_event(
        name="Factory Full Event",
        status="Approved",
        date="2026-12-02",
        start_time="13:00",
        end_time="17:00",
        owner="org2",
        attendance=120,
        layout="Theatre",
        facilities=("Projector", "Wi-Fi"),
        features=("Hearing loop",),
        purpose="Client showcase",
    )

    db.session.expire_all()  # read back what was committed, not the cached object
    stored = db.session.get(EventRequest, event.id)
    assert stored.created_by.username == "org2"
    assert stored.attendance == 120
    assert stored.layout.name == "Theatre"
    assert sorted(f.name for f in stored.facilities) == ["Projector", "Wi-Fi"]
    assert [f.name for f in stored.accessibility_features] == ["Hearing loop"]
    assert stored.purpose == "Client showcase"
