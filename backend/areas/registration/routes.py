"""Attendee registration — Jira area(s) 18 (docs/design/frontend.md §2).

Stories in this area add their routes here and their rules in services.py.
"""

from flask import Blueprint

bp = Blueprint("registration", __name__, url_prefix="/api")
