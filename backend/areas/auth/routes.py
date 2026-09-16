"""Account and session — Jira area(s) 01 (docs/design/frontend.md §2).

Stories in this area add their routes here and their rules in services.py.
"""

from flask import Blueprint

bp = Blueprint("auth", __name__, url_prefix="/api")
