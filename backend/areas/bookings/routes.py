"""Venue booking request — Jira area(s) 12, 13, 14 (docs/design/frontend.md §2).

Stories in this area add their routes here and their rules in services.py.
"""

from flask import Blueprint

bp = Blueprint("bookings", __name__, url_prefix="/api")
