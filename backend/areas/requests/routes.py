"""Event request and its status — Jira area(s) 02, 03, 04, 05, 06, 07 (docs/design/frontend.md §2).

Stories in this area add their routes here and their rules in services.py.
"""

from flask import Blueprint

bp = Blueprint("requests", __name__, url_prefix="/api")
