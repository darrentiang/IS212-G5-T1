"""Configuration read once by create_app.

Everything here is either a Flask session setting (ADR-001: Flask session
cookies with seeded accounts) or a SQLAlchemy setting. Values a deployment must
change come from the environment.
"""

import os


class Config:
    # Flask signs the session cookie with this. The development default is
    # deliberately not a secret; a deployment sets SECRET_KEY in its environment.
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-in-production")

    # JavaScript in the browser must never be able to read the session cookie;
    # only the API needs it.
    SESSION_COOKIE_HTTPONLY = True

    # The browser reaches the API on its own origin through the Vite proxy, so
    # Lax is enough, and it still stops another site posting as the user.
    SESSION_COOKIE_SAMESITE = "Lax"

    # Development and CI run over plain HTTP; a Secure cookie would never be
    # sent back. A deployment over HTTPS sets this to True.
    SESSION_COOKIE_SECURE = False

    # SQLAlchemy's change-tracking signals cost memory and nothing uses them.
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # How Account.set_password hashes. Werkzeug's default, scrypt, is slow on
    # purpose, which is right for real accounts. Only the pytest app fixture
    # swaps in a cheap method: it seeds every account for every test. Hashes
    # name their method, so check_password verifies either kind.
    PASSWORD_HASH_METHOD = "scrypt"
