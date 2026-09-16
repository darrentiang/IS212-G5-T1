"""Change request — Jira area(s) 19 (docs/design/frontend.md §2).

Stories in this area add their routes here and their rules in services.py.
"""

from flask import Blueprint

bp = Blueprint("changes", __name__, url_prefix="/api")
