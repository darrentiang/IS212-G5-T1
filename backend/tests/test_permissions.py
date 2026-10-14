"""Role-based access — SCRUM-27.

Unit tests prove the permission matrix and object rules (ADR-002).
"""

import os
import re

from permissions import (
    ALL_FEATURES,
    EQUIPMENT_VIEW,
    INTERNAL_NOTES_VIEW,
    NOTIFICATIONS_VIEW,
    REGISTRATION_VIEW,
    REQUESTS_EDIT,
    REQUESTS_VIEW,
    ROLE_FEATURES,
    VENUES_VIEW,
    can,
    features_for,
)
from models import Account

PERMISSIONS_MD = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "docs",
    "design",
    "permissions.md",
)

ROLE_COLUMNS = [
    "Event Organiser",
    "Event Coordinator",
    "Venue Staff",
    "Technical Support Staff",
    "Safety Officer",
    "Attendee",
]


def _parse_feature_keys_table(markdown_text):
    """Parse the Feature keys table into {key: {role: bool}}."""
    match = re.search(
        r"## Feature keys.*?\n\n(\| Key \|.*?)(?:\n\n|\n\| Version)",
        markdown_text,
        re.DOTALL,
    )
    assert match, "permissions.md must contain a '## Feature keys' section"
    table = match.group(1)
    rows = {}
    for line in table.splitlines():
        line = line.strip()
        if not line.startswith("|") or line.startswith("| Key") or line.startswith("|---"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) != 7:
            continue
        key = cells[0]
        rows[key] = {role: cells[i + 1] == "Yes" for i, role in enumerate(ROLE_COLUMNS)}
    return rows


# @story: SCRUM-27
# @ac: 8
def test_permissions_doc_matches_code():
    """ADR-002: matrix in permissions.py equals Feature keys in permissions.md."""
    with open(PERMISSIONS_MD, encoding="utf-8") as handle:
        doc_rows = _parse_feature_keys_table(handle.read())

    assert set(doc_rows.keys()) == set(ALL_FEATURES)

    for role in ROLE_COLUMNS:
        for key in ALL_FEATURES:
            in_code = key in ROLE_FEATURES.get(role, set())
            allowed = doc_rows[key][role]
            assert in_code == allowed, (
                f"{role} / {key}: permissions.md allowed={allowed}, "
                f"permissions.py has feature={in_code}"
            )


# @story: SCRUM-27
# @ac: 8
def test_can_rejects_missing_account_and_unknown_feature(app):
    with app.app_context():
        from models import Role
        from db import db

        org = Account(username="t_org_edge")
        org.roles = [db.session.query(Role).filter_by(name="Event Organiser").one()]
        assert can(None, REQUESTS_VIEW) is False
        assert can(org, "not.a.feature") is False
        assert can(org, EQUIPMENT_VIEW) is False


# @story: SCRUM-27
# @ac: 1
def test_event_request_repr(app):
    with app.app_context():
        from models import EventRequest

        row = EventRequest(id=9, name="X", status="Draft")
        assert repr(row) == "<EventRequest 9 Draft>"


# @story: SCRUM-27
# @ac: 1, 3
def test_can_reflects_single_role_features(app):
    with app.app_context():
        org = Account(username="t_org")
        org.roles = []
        from models import Role
        from db import db

        org.roles = [db.session.query(Role).filter_by(name="Event Organiser").one()]
        coord = Account(username="t_coord")
        coord.roles = [db.session.query(Role).filter_by(name="Event Coordinator").one()]
        venue = Account(username="t_venue")
        venue.roles = [db.session.query(Role).filter_by(name="Venue Staff").one()]

        assert can(org, REQUESTS_VIEW) is True
        assert can(org, VENUES_VIEW) is False
        assert can(coord, REQUESTS_VIEW) is True
        assert can(coord, INTERNAL_NOTES_VIEW) is True
        assert can(venue, VENUES_VIEW) is True
        assert can(venue, REQUESTS_VIEW) is False
        assert can(venue, REQUESTS_EDIT) is False


# @story: SCRUM-27
# @ac: 7
def test_multi_role_is_the_union_of_features(app):
    with app.app_context():
        from models import Role
        from db import db

        multi = Account(username="t_multi")
        multi.roles = [
            db.session.query(Role).filter_by(name="Event Coordinator").one(),
            db.session.query(Role).filter_by(name="Venue Staff").one(),
        ]
        assert can(multi, REQUESTS_VIEW) is True
        assert can(multi, VENUES_VIEW) is True
        assert can(multi, INTERNAL_NOTES_VIEW) is True


# @story: SCRUM-27
# @ac: 4, 5, 6
def test_attendee_and_tech_have_narrow_features(app):
    with app.app_context():
        from models import Role
        from db import db

        att = Account(username="t_att")
        att.roles = [db.session.query(Role).filter_by(name="Attendee").one()]
        tech = Account(username="t_tech")
        tech.roles = [db.session.query(Role).filter_by(name="Technical Support Staff").one()]

        assert can(att, REGISTRATION_VIEW) is True
        assert can(att, INTERNAL_NOTES_VIEW) is False
        assert can(att, REQUESTS_VIEW) is False
        assert can(tech, EQUIPMENT_VIEW) is True
        assert can(tech, REQUESTS_EDIT) is False
        assert can(tech, REQUESTS_VIEW) is False


# @story: SCRUM-27
# @ac: 7, 8
def test_me_returns_features_for_each_seeded_account(client):
    for username, feature in [
        ("org1", REQUESTS_VIEW),
        ("coord1", REQUESTS_VIEW),
        ("venue1", VENUES_VIEW),
        ("tech1", EQUIPMENT_VIEW),
        ("att1", REGISTRATION_VIEW),
    ]:
        client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
        resp = client.get("/api/me")
        assert resp.status_code == 200
        assert feature in resp.get_json()["features"]


# @story: SCRUM-27
# @ac: 7
def test_multi1_features_include_coordinator_and_venue(client):
    client.post("/api/login", json={"username": "multi1", "password": "Passw0rd!"})
    features = client.get("/api/me").get_json()["features"]
    assert REQUESTS_VIEW in features
    assert VENUES_VIEW in features
    assert INTERNAL_NOTES_VIEW in features


# @story: SCRUM-27
# @ac: 1
def test_org1_list_shows_only_own_requests(client):
    client.post("/api/login", json={"username": "org1", "password": "Passw0rd!"})
    rows = client.get("/api/requests").get_json()
    names = {row["name"] for row in rows}
    assert "Annual Dinner" in names
    assert "Design Workshop" in names
    assert "Client B Conference" not in names
    assert "Open House" in names


# @story: SCRUM-27
# @ac: 3
def test_coord_list_excludes_drafts(client):
    client.post("/api/login", json={"username": "coord1", "password": "Passw0rd!"})
    rows = client.get("/api/requests").get_json()
    names = {row["name"] for row in rows}
    statuses = {row["status"] for row in rows}
    assert "Annual Dinner" in names
    assert "Client B Conference" in names
    assert "Design Workshop" not in names
    assert "Draft" not in statuses


# @story: SCRUM-27
# @ac: 7
def test_multi1_list_excludes_drafts(client):
    client.post("/api/login", json={"username": "multi1", "password": "Passw0rd!"})
    rows = client.get("/api/requests").get_json()
    statuses = {row["status"] for row in rows}
    assert "Draft" not in statuses
    assert len(rows) >= 2


# @story: SCRUM-27
# @ac: 2, 8
def test_org2_cannot_open_org1_request(client):
    client.post("/api/login", json={"username": "org1", "password": "Passw0rd!"})
    org1_rows = client.get("/api/requests").get_json()
    target = next(row for row in org1_rows if row["name"] == "Annual Dinner")

    client.post("/api/logout")
    client.post("/api/login", json={"username": "org2", "password": "Passw0rd!"})
    resp = client.get(f"/api/requests/{target['id']}")

    assert resp.status_code == 403
    body = resp.get_json()
    assert "message" in body
    assert "Annual Dinner" not in str(body)


# @story: SCRUM-27
# @ac: 3, 8
def test_coord_cannot_open_draft_request(client):
    client.post("/api/login", json={"username": "org1", "password": "Passw0rd!"})
    org1_rows = client.get("/api/requests").get_json()
    draft = next(row for row in org1_rows if row["name"] == "Design Workshop")

    client.post("/api/logout")
    client.post("/api/login", json={"username": "coord1", "password": "Passw0rd!"})
    resp = client.get(f"/api/requests/{draft['id']}")

    assert resp.status_code == 403
    assert "message" in resp.get_json()


# @story: SCRUM-27
# @ac: 4, 5, 8
def test_venue_and_tech_cannot_list_or_open_event_requests(client):
    for username in ("venue1", "tech1"):
        client.post("/api/logout")
        client.post("/api/login", json={"username": username, "password": "Passw0rd!"})
        listed = client.get("/api/requests")
        assert listed.status_code == 403
        assert "message" in listed.get_json()


# @story: SCRUM-27
# @ac: 6
def test_registration_list_is_confirmed_with_registration_only(client):
    client.post("/api/login", json={"username": "att1", "password": "Passw0rd!"})
    rows = client.get("/api/registration/events").get_json()
    assert len(rows) == 1
    assert rows[0]["name"] == "Open House"
    assert "coordinator_notes" not in rows[0]
    assert "notes" not in str(rows).lower()


# @story: SCRUM-27
# @ac: 6
def test_attendee_cannot_open_request_detail(client):
    client.post("/api/login", json={"username": "att1", "password": "Passw0rd!"})
    listed = client.get("/api/requests")
    assert listed.status_code == 403
    resp = client.get("/api/requests/1")
    assert resp.status_code == 403


# @story: SCRUM-27
# @ac: 1, 6
def test_coord_detail_includes_notes_attendee_payload_does_not(client):
    client.post("/api/login", json={"username": "coord1", "password": "Passw0rd!"})
    rows = client.get("/api/requests").get_json()
    open_house = next(row for row in rows if row["name"] == "Open House")
    detail = client.get(f"/api/requests/{open_house['id']}").get_json()
    assert detail.get("coordinator_notes")

    client.post("/api/logout")
    client.post("/api/login", json={"username": "att1", "password": "Passw0rd!"})
    reg = client.get("/api/registration/events").get_json()
    assert "coordinator_notes" not in reg[0]


# @story: SCRUM-27
# @ac: 8
def test_unauthenticated_requests_are_refused(client):
    """Not logged in → 401 (frontend.md §6 routes this to /login)."""
    resp_list = client.get("/api/requests")
    assert resp_list.status_code == 401
    assert resp_list.get_json()["message"] == "Not logged in"

    resp_reg = client.get("/api/registration/events")
    assert resp_reg.status_code == 401
    assert resp_reg.get_json()["message"] == "Not logged in"


# @story: SCRUM-27
# @ac: 2, 8
def test_unknown_request_id_is_not_found(client):
    client.post("/api/login", json={"username": "org1", "password": "Passw0rd!"})
    resp = client.get("/api/requests/9999")
    assert resp.status_code == 404
    assert "message" in resp.get_json()


# @story: SCRUM-27
# @ac: 1
def test_org1_detail_hides_internal_notes_field(client):
    client.post("/api/login", json={"username": "org1", "password": "Passw0rd!"})
    rows = client.get("/api/requests").get_json()
    own = next(row for row in rows if row["name"] == "Annual Dinner")
    detail = client.get(f"/api/requests/{own['id']}").get_json()
    assert detail["name"] == "Annual Dinner"
    assert "coordinator_notes" not in detail
