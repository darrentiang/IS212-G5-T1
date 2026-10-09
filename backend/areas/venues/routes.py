"""Venue, layouts and availability — Jira area(s) 08, 09, 10, 11 (docs/design/frontend.md §2).

SCRUM-31: list, detail, the two fixed lists the form offers, and add a venue.
SCRUM-40: list a venue's blocks and block a venue.
SCRUM-75: update a venue.
SCRUM-79: remove a block that has not started, or end one in progress early.
SCRUM-80: record setup and turnaround time for a venue.
Seeing venues and their blocks is venues.view (Event Coordinator and Venue
Staff); adding a venue, updating one, blocking one, and ending or removing a
block is venues.edit (Venue Staff only) — docs/design/permissions.md.
SCRUM-33: search the venues free for an Approved or Planning event, which is
venues.search (Event Coordinator only); SCRUM-34 narrows that search by
accessibility features and SCRUM-35 by room layout and facilities. Rules are
in services.py; the contract is
frontend/src/areas/venues/api.js.
"""

from flask import Blueprint, g, jsonify, request

from areas.venues import services
from permissions import VENUES_EDIT, VENUES_SEARCH, VENUES_VIEW, require

bp = Blueprint("venues", __name__, url_prefix="/api")


@bp.get("/venues")
@require(VENUES_VIEW)
def list_venues():
    return jsonify([services.venue_to_dict(row) for row in services.list_venues()])


@bp.get("/venue-options")
@require(VENUES_VIEW)
def venue_options():
    return jsonify(services.venue_options())


@bp.get("/venues/search")
@require(VENUES_SEARCH)
def search_venues():
    event, venues = services.search_venues(
        request.args.get("event_request_id", type=int),
        request.args.get("location", ""),
        request.args.getlist("accessibility_features"),
        request.args.get("layout", ""),
        request.args.getlist("facilities"),
    )
    return jsonify(services.search_to_dict(event, venues))


@bp.get("/venues/<int:venue_id>")
@require(VENUES_VIEW)
def get_venue(venue_id):
    return jsonify(services.venue_to_dict(services.get_venue(venue_id)))


@bp.post("/venues")
@require(VENUES_EDIT)
def create_venue():
    body = request.get_json(silent=True) or {}
    venue = services.create_venue(body)
    return jsonify(services.venue_to_dict(venue)), 201


@bp.put("/venues/<int:venue_id>")
@require(VENUES_EDIT)
def update_venue(venue_id):
    body = request.get_json(silent=True) or {}
    venue = services.update_venue(venue_id, body)
    return jsonify(services.venue_to_dict(venue)), 200


@bp.patch("/venues/<int:venue_id>/layouts")
@require(VENUES_EDIT)
def update_layouts(venue_id):
    body = request.get_json(silent=True) or {}
    venue = services.update_layouts(venue_id, body)
    return jsonify(services.venue_to_dict(venue)), 200


@bp.patch("/venues/<int:venue_id>/times")
@require(VENUES_EDIT)
def update_times(venue_id):
    body = request.get_json(silent=True) or {}
    venue = services.update_times(venue_id, body)
    return jsonify(services.venue_to_dict(venue)), 200


@bp.get("/venues/<int:venue_id>/blocks")
@require(VENUES_VIEW)
def list_blocks(venue_id):
    return jsonify([services.block_to_dict(row) for row in services.list_blocks(venue_id)])


@bp.post("/venues/<int:venue_id>/blocks")
@require(VENUES_EDIT)
def create_block(venue_id):
    body = request.get_json(silent=True) or {}
    block = services.create_block(venue_id, body, g.account)
    return jsonify(services.block_to_dict(block)), 201


@bp.delete("/venues/<int:venue_id>/blocks/<int:block_id>")
@require(VENUES_EDIT)
def remove_block(venue_id, block_id):
    services.remove_block(venue_id, block_id)
    return "", 204


@bp.patch("/venues/<int:venue_id>/blocks/<int:block_id>")
@require(VENUES_EDIT)
def end_block(venue_id, block_id):
    body = request.get_json(silent=True) or {}
    block = services.end_block(venue_id, block_id, body)
    return jsonify(services.block_to_dict(block))
