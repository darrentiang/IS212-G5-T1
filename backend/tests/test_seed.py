"""Unit tests for the database and seed data.

Setup work has no Jira key; the reference is docs/compose/spec/sqlite-seed.md.
"""

import pytest
from werkzeug.security import check_password_hash

from app import create_app
from db import db
from models import SCHEMA_VERSION, Account, Role, SchemaMeta
from seed import AlreadySeededError, seed_database

ROLE_NAMES = {
    "Event Organiser",
    "Event Coordinator",
    "Venue Staff",
    "Technical Support Staff",
    "Attendee",
}

ACCOUNT_USERNAMES = {"org1", "org2", "coord1", "coord2", "venue1", "tech1", "att1", "multi1"}


# @story: setup
# @ac: sqlite-seed
def test_seeding_creates_the_five_roles(app):
    roles = db.session.query(Role).all()
    assert len(roles) == 5
    assert {role.name for role in roles} == ROLE_NAMES


# @story: setup
# @ac: sqlite-seed
def test_seeding_creates_the_eight_accounts_with_their_roles(app):
    accounts = db.session.query(Account).all()
    assert {account.username for account in accounts} == ACCOUNT_USERNAMES

    by_username = {account.username: account for account in accounts}
    assert by_username["multi1"].role_names == ["Event Coordinator", "Venue Staff"]
    for username, account in by_username.items():
        if username != "multi1":
            assert len(account.role_names) == 1, username

    assert by_username["org1"].organisation != by_username["org2"].organisation


# @story: setup
# @ac: sqlite-seed
def test_passwords_are_stored_hashed(app):
    account = db.session.query(Account).filter_by(username="org1").one()
    assert account.password_hash != "Passw0rd!"
    assert check_password_hash(account.password_hash, "Passw0rd!")
    assert account.check_password("Passw0rd!")


# @story: setup
# @ac: sqlite-seed
def test_schema_meta_holds_the_current_schema_version(app):
    rows = db.session.query(SchemaMeta).all()
    assert len(rows) == 1
    assert rows[0].version == SCHEMA_VERSION


# @story: setup
# @ac: sqlite-seed
def test_create_app_refuses_a_database_at_another_schema_version(tmp_path):
    uri = f"sqlite:///{tmp_path / 'app.db'}"

    stale = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": uri})
    with stale.app_context():
        db.create_all()
        db.session.add(SchemaMeta(version=0))
        db.session.commit()
        db.session.remove()
        db.engine.dispose()

    with pytest.raises(RuntimeError) as refusal:
        create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": uri})

    message = str(refusal.value)
    assert "v0" in message
    assert f"v{SCHEMA_VERSION}" in message
    assert "seed.py --reset" in message


# @story: setup
# @ac: sqlite-seed
def test_seeding_an_already_seeded_database_raises_and_changes_nothing(app):
    before = (db.session.query(Role).count(), db.session.query(Account).count())

    with pytest.raises(AlreadySeededError):
        seed_database(db)

    assert (db.session.query(Role).count(), db.session.query(Account).count()) == before
    assert db.session.query(SchemaMeta).count() == 1


# @story: setup
# @ac: sqlite-seed
def test_health_reports_the_database_is_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok", "database": "ok"}
