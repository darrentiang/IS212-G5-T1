"""Account and session — Jira area(s) 01 (docs/design/frontend.md §2).

SCRUM-26: login, logout, me. SCRUM-27: features from the role matrix.
Contract is frontend/src/areas/auth/api.js.
"""

from flask import Blueprint, g, jsonify, request, session

from areas.auth import services
from db import db
from errors import ApiRefusal
from models import Account
from permissions import features_for

bp = Blueprint("auth", __name__, url_prefix="/api")


def _load_account():
    account_id = session.get("account_id")
    if account_id is None:
        g.account = None
        return None
    account = db.session.get(Account, account_id)
    g.account = account
    return account


@bp.before_app_request
def load_account_from_session():
    if request.path.startswith("/api/"):
        _load_account()


def _current_account():
    return getattr(g, "account", None) or _load_account()


@bp.post("/login")
def login():
    body = request.get_json(silent=True) or {}
    account = services.authenticate(body.get("username") or "", body.get("password") or "")
    session.clear()
    session["account_id"] = account.id
    g.account = account
    return jsonify(services.account_payload(account))


@bp.post("/logout")
def logout():
    session.clear()
    g.account = None
    return "", 204


@bp.get("/me")
def me():
    account = _current_account()
    if account is None:
        raise ApiRefusal(401, "Not logged in")
    return jsonify(services.account_payload(account))
