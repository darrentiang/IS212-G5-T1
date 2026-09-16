"""The ConnectSphere Flask application factory.

The API owns every business rule (ADR-001); this module only wires the app to
its configuration, the database, the JSON error handlers and the area
blueprints, and exposes the two infrastructure endpoints. Routes for stories
are added by those stories, in backend/areas/<area>/routes.py.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sqlalchemy as sa
from flask import Flask, jsonify

from areas import BLUEPRINTS
from config import Config
from db import db
from errors import register_error_handlers
from models import SCHEMA_VERSION, SchemaMeta

INSTANCE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instance")


def default_database_uri():
    """DATABASE_URL when it is set, otherwise the SQLite file in instance/.

    Keeping the connection string in the environment means a hosted demo can
    point at PostgreSQL without a code change (ADR-001). No PostgreSQL-specific
    feature may be used.
    """
    return os.environ.get("DATABASE_URL") or "sqlite:///" + os.path.join(INSTANCE_PATH, "app.db")


def check_schema_version(app):
    """Refuse to start on a database seeded at a different schema version.

    A database that does not exist yet, or exists but has never been seeded, is
    not a mismatch: seed.py is about to fill it.
    """
    uri = app.config["SQLALCHEMY_DATABASE_URI"]
    if uri.startswith("sqlite:///") and not uri.endswith(":memory:"):
        if not os.path.exists(uri[len("sqlite:///"):]):
            return

    with app.app_context():
        if not sa.inspect(db.engine).has_table(SchemaMeta.__tablename__):
            return
        stored = db.session.query(SchemaMeta).first()
        if stored is None or stored.version == SCHEMA_VERSION:
            return
        found = stored.version
        # The app is not going to start, so let go of the connection.
        db.session.remove()
        db.engine.dispose()
        raise RuntimeError(
            f"Database schema is v{found}, code expects v{SCHEMA_VERSION}. "
            "Run: python seed.py --reset"
        )


def create_app(config=None):
    app = Flask(__name__, instance_path=INSTANCE_PATH)

    app.config.from_object(Config)

    if config:
        app.config.update(config)

    if not app.config.get("SQLALCHEMY_DATABASE_URI"):
        os.makedirs(app.instance_path, exist_ok=True)
        app.config["SQLALCHEMY_DATABASE_URI"] = default_database_uri()

    db.init_app(app)
    check_schema_version(app)

    register_error_handlers(app)

    # /api/health and /api/ping are infrastructure, not an area, so they stay
    # here. Everything a story adds goes in backend/areas/<area>/routes.py.
    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)

    @app.route("/api/health")
    def health():
        try:
            db.session.execute(sa.text("SELECT 1"))
            database = "ok"
        except Exception:
            database = "error"
        return jsonify(status="ok", database=database)

    @app.route("/api/ping")
    def ping():
        return jsonify(message="pong")

    return app


if __name__ == "__main__":
    try:
        app = create_app()
    except RuntimeError as error:
        raise SystemExit(str(error))
    app.run(debug=True, port=5000)
