"""Account and session rules — SCRUM-26, SCRUM-27.

The API owns every business rule (ADR-001). Routes stay thin; refusals are
raised here next to the rule they enforce (backend/errors.py).
"""

from db import db
from errors import ApiRefusal
from models import Account
from permissions import features_for

# One string for wrong password and unknown user (AC3, AC4). No username
# enumeration: the reply never says which value was wrong.
REFUSAL_MESSAGE = "Invalid username or password"


def authenticate(username, password):
    """Return the account when the credentials match, else refuse with 401."""
    account = db.session.query(Account).filter_by(username=username).first()
    if account is None or not account.check_password(password):
        raise ApiRefusal(401, REFUSAL_MESSAGE)
    return account


def account_payload(account):
    """Body for POST /api/login and GET /api/me (areas/auth/api.js)."""
    return {
        "username": account.username,
        "roles": account.role_names,
        "features": features_for(account),
    }
