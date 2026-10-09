"""Venue booking request — Jira area(s) 12, 13, 14 (docs/design/frontend.md §2).

SCRUM-36: raise a booking request for one venue against one event, and list
a venue's booking requests. SCRUM-37: approve or reject one. SCRUM-77: the
raising Coordinator withdraws one before it is decided. Raising and
withdrawing are bookings.edit (Event Coordinator); deciding is
bookings.decide (Venue Staff); listing reuses venues.view (Event Coordinator
and Venue Staff), since a venue's booking requests are shown on its own page
— docs/design/permissions.md. SCRUM-42: the warnings for a venue chosen for
an event, before raising; bookings.edit, since only whoever may raise needs
them. SCRUM-41: the occupied periods of a venue's bookings ride along on the
list above, and the clashes the venue's recorded durations currently expose
are their own read — venues.edit (Venue Staff), who are the ones who change
those durations (docs/design/permissions.md).
Rules are in services.py; the contract is
frontend/src/areas/bookings/api.js.
"""

from flask import Blueprint, g, jsonify, request

from areas.bookings import services
from permissions import BOOKINGS_DECIDE, BOOKINGS_EDIT, VENUES_EDIT, VENUES_VIEW, require

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


@bp.get("/venues/<int:venue_id>/clashes")
@require(VENUES_EDIT)
def list_venue_clashes(venue_id):
    """SCRUM-41 AC5: the venue's Approved bookings whose occupied periods
    currently overlap another's, as the recorded durations define them now."""
    return jsonify([services.clash_to_dict(row) for row in services.current_clashes(venue_id)])


@bp.get("/requests/<int:request_id>/venues/<int:venue_id>/warnings")
@require(BOOKINGS_EDIT)
def venue_warnings(request_id, venue_id):
    return jsonify(services.check_venue(g.account, request_id, venue_id))


@bp.post("/venues/<int:venue_id>/bookings/<int:booking_id>/approve")
@require(BOOKINGS_DECIDE)
def approve_booking(venue_id, booking_id):
    """SCRUM-37: Requested -> Approved; reason optional."""
    body = request.get_json(silent=True) or {}
    updated = services.approve_booking(venue_id, booking_id, g.account, body)
    return jsonify(services.booking_to_dict(updated)), 200


@bp.post("/venues/<int:venue_id>/bookings/<int:booking_id>/reject")
@require(BOOKINGS_DECIDE)
def reject_booking(venue_id, booking_id):
    """SCRUM-37: Requested -> Rejected; reason required."""
    body = request.get_json(silent=True) or {}
    updated = services.reject_booking(venue_id, booking_id, g.account, body)
    return jsonify(services.booking_to_dict(updated)), 200


@bp.post("/venues/<int:venue_id>/bookings/<int:booking_id>/withdraw")
@require(BOOKINGS_EDIT)
def withdraw_booking(venue_id, booking_id):
    """SCRUM-77: Requested -> Withdrawn, by the Coordinator who raised it."""
    updated = services.withdraw_booking(venue_id, booking_id, g.account)
    return jsonify(services.booking_to_dict(updated)), 200
