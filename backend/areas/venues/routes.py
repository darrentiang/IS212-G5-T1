"""Venue, layouts and availability — Jira area(s) 08, 09, 10, 11 (docs/design/frontend.md §2).

Stories in this area add their routes here and their rules in services.py.
"""

from flask import Blueprint

bp = Blueprint("venues", __name__, url_prefix="/api")
