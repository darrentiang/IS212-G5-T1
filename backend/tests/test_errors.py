"""Unit tests for the error contract, session configuration and area wiring.

Setup work has no Jira key; the reference is docs/compose/spec/backend-areas.md.
"""

import pytest

from app import create_app
from areas import BLUEPRINTS
from db import db
from errors import ApiRefusal

AREA_NAMES = {
    "auth",
    "requests",
    "venues",
    "bookings",
    "equipment",
    "registration",
    "changes",
    "notifications",
}


# @story: setup
# @ac: backend-areas
def test_an_unknown_path_is_json_not_an_html_page(client):
    resp = client.get("/api/does-not-exist")

    assert resp.status_code == 404
    assert resp.content_type.startswith("application/json")
    assert isinstance(resp.get_json()["message"], str)


# @story: setup
# @ac: backend-areas
def test_a_wrong_method_is_json_not_an_html_page(client):
    resp = client.post("/api/health")

    assert resp.status_code == 405
    assert resp.content_type.startswith("application/json")
    assert isinstance(resp.get_json()["message"], str)


# @story: setup
# @ac: backend-areas
def test_an_api_refusal_becomes_its_own_status_and_message(app):
    @app.route("/api/test-refusal")
    def refuse():
        raise ApiRefusal(403, "Not allowed")

    resp = app.test_client().get("/api/test-refusal")

    assert resp.status_code == 403
    assert resp.get_json() == {"message": "Not allowed"}


# @story: setup
# @ac: backend-areas
def test_an_unexpected_error_reaches_pytest_while_testing(app):
    @app.route("/api/test-boom")
    def boom():
        raise RuntimeError("the real cause")

    with pytest.raises(RuntimeError, match="the real cause"):
        app.test_client().get("/api/test-boom")


# @story: setup
# @ac: backend-areas
def test_an_unexpected_error_is_a_plain_500_outside_testing():
    app = create_app({"TESTING": False, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})

    @app.route("/api/test-boom")
    def boom():
        raise RuntimeError("the real cause")

    resp = app.test_client().get("/api/test-boom")

    assert resp.status_code == 500
    assert resp.get_json() == {"message": "Something went wrong"}

    body = resp.get_data(as_text=True)
    assert "Traceback" not in body
    assert "the real cause" not in body

    with app.app_context():
        db.session.remove()
        db.engine.dispose()


# @story: setup
# @ac: backend-areas
def test_the_session_cookie_is_configured(app):
    assert app.config["SECRET_KEY"]
    assert app.config["SESSION_COOKIE_HTTPONLY"] is True
    assert app.config["SESSION_COOKIE_SAMESITE"] == "Lax"


# @story: setup
# @ac: backend-areas
def test_every_area_blueprint_is_registered(app):
    assert set(app.blueprints) == AREA_NAMES
    assert len(BLUEPRINTS) == len(AREA_NAMES)
