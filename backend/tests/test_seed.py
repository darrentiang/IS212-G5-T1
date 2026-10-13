"""Unit tests for the database and seed data.

Setup work has no Jira key; the reference is docs/compose/spec/sqlite-seed.md.
"""

import os

import pytest
from werkzeug.security import check_password_hash

import app as app_module
from app import create_app, default_database_uri
from db import db
from models import SCHEMA_VERSION, Account, EventRequest, Role, SchemaMeta
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
# @ac: test-speed
def test_default_password_hash_is_scrypt():
    # No PASSWORD_HASH_METHOD override: what seed.py and the running app use.
    default = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})
    with default.app_context():
        account = Account(username="hash-default")
        account.set_password("Passw0rd!")

        assert account.password_hash.startswith("scrypt:")
        assert account.check_password("Passw0rd!")
        assert not account.check_password("wrong")
        db.engine.dispose()


# @story: setup
# @ac: test-speed
def test_test_config_password_hash_is_honoured(app):
    # conftest.py sets PASSWORD_HASH_METHOD to "pbkdf2:sha256:1" (one round).
    account = Account(username="hash-test")
    account.set_password("Passw0rd!")
    seeded = db.session.query(Account).filter_by(username="org1").one()

    assert account.password_hash.startswith("pbkdf2:sha256:1$")
    assert seeded.password_hash.startswith("pbkdf2:sha256:1$")
    assert account.check_password("Passw0rd!")
    assert seeded.check_password("Passw0rd!")
    assert not account.check_password("wrong")


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
# @story: setup
# @ac: sqlite-seed
def test_has_role_answers_for_every_role_the_account_holds(app):
    multi1 = db.session.query(Account).filter_by(username="multi1").one()

    assert multi1.has_role("Event Coordinator") is True
    assert multi1.has_role("Venue Staff") is True
    assert multi1.has_role("Attendee") is False


# @story: setup
# @ac: sqlite-seed
def test_records_name_themselves_in_a_log_line(app):
    account = db.session.query(Account).filter_by(username="org1").one()
    role = db.session.query(Role).filter_by(name="Attendee").one()
    meta = db.session.query(SchemaMeta).one()

    assert repr(account) == "<Account org1>"
    assert repr(role) == "<Role Attendee>"
    assert repr(meta) == f"<SchemaMeta v{SCHEMA_VERSION}>"


# @story: setup
# @ac: sqlite-seed
def test_the_connection_string_comes_from_the_environment_when_it_is_set(monkeypatch, tmp_path):
    uri = f"sqlite:///{tmp_path / 'from-env.db'}"
    monkeypatch.setenv("DATABASE_URL", uri)

    assert default_database_uri() == uri

    # create_app with no override picks the same string up.
    configured = create_app({"TESTING": True})
    assert configured.config["SQLALCHEMY_DATABASE_URI"] == uri
    with configured.app_context():
        db.session.remove()
        db.engine.dispose()


# @story: setup
# @ac: sqlite-seed
def test_the_connection_string_falls_back_to_the_instance_file(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)

    expected = "sqlite:///" + os.path.join(app_module.INSTANCE_PATH, "app.db")
    assert default_database_uri() == expected


# @story: setup
# @ac: sqlite-seed
def test_create_app_uses_the_default_database_when_config_uri_is_empty(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")

    configured = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": ""})

    assert configured.config["SQLALCHEMY_DATABASE_URI"] == "sqlite:///:memory:"
    with configured.app_context():
        db.session.remove()
        db.engine.dispose()


# @story: setup
# @ac: sqlite-seed
def test_create_app_accepts_no_configuration_override(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")

    configured = create_app()

    assert configured.config["SQLALCHEMY_DATABASE_URI"] == "sqlite:///:memory:"
    with configured.app_context():
        db.session.remove()
        db.engine.dispose()


# @story: setup
# @ac: sqlite-seed
def test_create_app_starts_on_a_database_at_the_current_version(tmp_path):
    uri = f"sqlite:///{tmp_path / 'app.db'}"

    first = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": uri})
    with first.app_context():
        seed_database(db)
        db.session.remove()
        db.engine.dispose()

    # The file now exists and holds the version this code expects, so the
    # factory returns an app instead of refusing.
    second = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": uri})
    with second.app_context():
        assert db.session.query(SchemaMeta).one().version == SCHEMA_VERSION
        db.session.remove()
        db.engine.dispose()


# @story: setup
# @ac: sqlite-seed
def test_health_reports_an_error_when_the_database_cannot_be_reached():
    unreachable = create_app(
        {"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:////nonexistent/dir/app.db"}
    )

    resp = unreachable.test_client().get("/api/health")

    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok", "database": "error"}


# @story: SCRUM-28
# @ac: 1
def test_every_seeded_request_past_draft_is_complete(app):
    """A request may only leave Draft with every required field filled
    (SCRUM-28). The seed writes rows straight to the database, bypassing the
    service that enforces it, so the seed is the one place that invariant can
    rot without a test noticing.
    """
    with app.app_context():
        rows = db.session.query(EventRequest).filter(EventRequest.status != "Draft").all()

        assert rows, "seed should hold at least one request past Draft"
        incomplete = {row.name: row.missing_fields() for row in rows if row.missing_fields()}
        assert incomplete == {}
