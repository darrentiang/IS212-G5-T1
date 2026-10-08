"""Venue booking request — Jira area(s) 12, 13, 14 (docs/design/frontend.md §2).

SCRUM-36: raise a booking request for one venue against one event, and list
a venue's booking requests. Raising is bookings.edit (Event Coordinator);
listing reuses venues.view (Event Coordinator and Venue Staff), since a
venue's booking requests are shown on its own page — docs/design/permissions.md.
SCRUM-42: the warnings for a venue chosen for an event, before raising;
bookings.edit, since only whoever may raise needs them.
Rules are in services.py; the contract is frontend/src/areas/bookings/api.js.
"""

from flask import Blueprint, g, jsonify, request

from areas.bookings import services
from permissions import BOOKINGS_EDIT, VENUES_VIEW, require

bp = Blueprint("bookings", __name__, url_prefix="/api")


@bp.post("/requests/<int:request_id>/bookings")
@require(BOOKINGS_EDIT)
def raise_booking(request_id):
    body = request.get_json(silent=True) or {}
    booking = services.raise_booking(g.account, request_id, body)
    return jsonify(services.booking_to_dict(booking)), 201


@bp.get("/venues/<int:venue_id>/bookings")
@require(VENUES_VIEW)
def list_venue_bookings(venue_id):
    return jsonify(
        [services.booking_to_dict(row) for row in services.list_bookings_for_venue(venue_id)]
    )


@bp.get("/requests/<int:request_id>/venues/<int:venue_id>/warnings")
@require(BOOKINGS_EDIT)
def venue_warnings(request_id, venue_id):
    return jsonify(services.check_venue(g.account, request_id, venue_id))
