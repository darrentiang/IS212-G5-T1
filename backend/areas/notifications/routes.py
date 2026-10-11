"""Notification — Jira area(s) 20 (docs/design/frontend.md §2).

SCRUM-58: view own notifications, the unread count, and mark one or all
read. All four reuse notifications.view (every role holds it); which
notifications an account may touch is an own-record rule in services.py,
not a role split (docs/design/permissions.md).
"""

from flask import Blueprint, g, jsonify

from areas.notifications import services
from permissions import NOTIFICATIONS_VIEW, require

bp = Blueprint("notifications", __name__, url_prefix="/api")


@bp.get("/notifications")
@require(NOTIFICATIONS_VIEW)
def list_notifications():
    return jsonify(
        [services.notification_to_dict(row, g.account) for row in services.list_for(g.account)]
    )


@bp.get("/notifications/unread-count")
@require(NOTIFICATIONS_VIEW)
def unread_count():
    return jsonify({"unread_count": services.unread_count(g.account)})


@bp.post("/notifications/<int:notification_id>/read")
@require(NOTIFICATIONS_VIEW)
def mark_read(notification_id):
    notification = services.mark_read(g.account, notification_id)
    return jsonify(services.notification_to_dict(notification, g.account))


@bp.post("/notifications/mark-all-read")
@require(NOTIFICATIONS_VIEW)
def mark_all_read():
    services.mark_all_read(g.account)
    return jsonify({"unread_count": services.unread_count(g.account)})
