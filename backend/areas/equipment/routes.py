"""Equipment and reservations — Jira area(s) 15, 16, 17 (docs/design/frontend.md §2).

Stories in this area add their routes here and their rules in services.py.
"""

from flask import Blueprint

bp = Blueprint("equipment", __name__, url_prefix="/api")
