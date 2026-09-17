"""Account and session — Jira area(s) 01 (docs/design/frontend.md §2).

SCRUM-26: log in with a seeded account, log out, and read the current account.
Contract is frontend/src/areas/auth/api.js.
"""

from flask import Blueprint, jsonify, request, session

from areas.auth import services
from db import db
from errors import ApiRefusal
from models import Account

bp = Blueprint("auth", __name__, url_prefix="/api")


def _current_account():
    account_id = session.get("account_id")
    if account_id is None:
        return None
    return db.session.get(Account, account_id)


@bp.post("/login")
def login():
    body = request.get_json(silent=True) or {}
    account = services.authenticate(body.get("username") or "", body.get("password") or "")
    session.clear()
    session["account_id"] = account.id
    return jsonify(services.account_payload(account))


@bp.post("/logout")
def logout():
    session.clear()
    return "", 204


@bp.get("/me")
def me():
    account = _current_account()
    if account is None:
        raise ApiRefusal(401, "Not logged in")
    return jsonify(services.account_payload(account))
