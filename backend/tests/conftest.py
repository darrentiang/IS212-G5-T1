import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from app import create_app
from db import db as _db
from seed import seed_database


@pytest.fixture
def app():
    """A Flask app on a fresh, seeded, in-memory database.

    Every test gets its own database; nothing a test does reaches the
    development database in backend/instance/.
    """
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})
    with app.app_context():
        _db.create_all()
        seed_database(_db)
        yield app
        _db.session.remove()
        _db.drop_all()
        _db.engine.dispose()


@pytest.fixture
def client(app):
    return app.test_client()
