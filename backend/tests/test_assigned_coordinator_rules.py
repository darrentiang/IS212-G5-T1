"""SCRUM-87: an Event Coordinator sees and acts on only the events assigned to them.

The acceptance criteria as rules at the API: a coordinator's list holds only
their requests; opening an unassigned request, or another coordinator's, is
refused; only the assigned coordinator decides; raising and withdrawing a
booking belong to the assigned coordinator, whoever raised it; an account with
several roles keeps each role's rights and no more; a reassigned event leaves
its previous coordinator; and only an Event Organiser creates or submits a
request. Holds, cancelling a booking, venue search, the suitability warnings
and sending for safety check are covered where those stories' tests live
(test_venue_holds, test_bookings, test_venue_search, test_venue_suitability,
test_safety_check). The browser journeys are functional/tests/SCRUM-87.spec.js.
"""

from datetime import date, datetime, timedelta, timezone

import pytest

from db import db
from models import Account, EventRequest, Venue, VenueBookingRequest

FIELDS = {
    "purpose": "Client showcase",
    "description": "Evening showcase for partners",
    "date": (date.today() + timedelta(days=30)).isoformat(),
    "start_time": "18:00",
    "end_time": "21:00",
    "attendance": 40,
    "equipment_requirements": "Projector",
    "registration_needs": "Guest list supplied by the client",
}

SUBMITTED_AT = datetime(2026, 9, 20, 9, 30)


def account(username):
    return db.session.query(Account).filter_by(username=username).one()


def login(client, username):
    with client.session_transaction() as session:
        session["account_id"] = account(username).id


def make_request(name, coordinator=None, status="Submitted", **extra):
    event = EventRequest(
        created_by=account("org1"),
        status=status,
        name=name,
        submitted_at=SUBMITTED_AT,
        assigned_coordinator=account(coordinator) if coordinator else None,
        **{**FIELDS, **extra},
    )
    db.session.add(event)
    db.session.commit()
    return event.id


def stored(request_id):
    db.session.expire_all()
    return db.session.get(EventRequest, request_id)


def seminar_room():
    return db.session.query(Venue).filter_by(name="Seminar Room 1").one()


def make_booking(request_id, raised_by="coord1", status="Requested"):
    booking = VenueBookingRequest(
        venue=seminar_room(),
        event_request=db.session.get(EventRequest, request_id),
        status=status,
        date=FIELDS["date"],
        start_time=FIELDS["start_time"],
        end_time=FIELDS["end_time"],
        attendance=FIELDS["attendance"],
        raised_by=account(raised_by),
        raised_at=SUBMITTED_AT,
    )
    db.session.add(booking)
    db.session.commit()
    return booking.id


def listed_names(client):
    return {row["name"] for row in client.get("/api/requests").get_json()}


def booking_status(booking_id):
    db.session.expire_all()
    return db.session.get(VenueBookingRequest, booking_id).status


# --- AC1: the list holds only the requests assigned to them ---


# @story: SCRUM-87
# @ac: 1
def test_a_coordinators_list_holds_only_their_requests(client):
    make_request("List Mine", "coord1")
    make_request("List Theirs", "coord2")
    make_request("List Unassigned")
    login(client, "coord1")

    names = listed_names(client)

    assert "List Mine" in names
    assert "List Theirs" not in names
    assert "List Unassigned" not in names
    assert {row["assigned_coordinator"] for row in client.get("/api/requests").get_json()} == {"coord1"}


# @story: SCRUM-87
# @ac: 1
def test_a_coordinator_with_nothing_assigned_sees_an_empty_list(client):
    make_request("Someone Elses", "coord1")
    login(client, "coord2")

    names = listed_names(client)

    assert "Someone Elses" not in names


# @story: SCRUM-87
# @ac: 1
def test_a_coordinator_never_sees_a_draft_even_one_recorded_against_them(client):
    make_request("Odd Draft", "coord1", status="Draft")
    login(client, "coord1")

    assert "Odd Draft" not in listed_names(client)


# @story: SCRUM-87
# @ac: 1
def test_an_organisers_own_list_is_unchanged(client):
    make_request("Org Own Unassigned")
    make_request("Org Own Assigned", "coord1")
    login(client, "org1")

    names = listed_names(client)

    assert {"Org Own Unassigned", "Org Own Assigned"} <= names


# --- AC2: opening an unassigned or someone else's request is refused ---


# @story: SCRUM-87
# @ac: 2
def test_the_assigned_coordinator_opens_their_request(client):
    request_id = make_request("Open Mine", "coord1")
    login(client, "coord1")

    resp = client.get(f"/api/requests/{request_id}")

    assert resp.status_code == 200
    assert resp.get_json()["name"] == "Open Mine"


# @story: SCRUM-87
# @ac: 2
def test_opening_an_unassigned_request_is_refused_and_shows_nothing(client):
    request_id = make_request("Open Unassigned")
    login(client, "coord1")

    resp = client.get(f"/api/requests/{request_id}")

    assert resp.status_code == 403
    assert resp.get_json() == {"message": "You do not have permission to perform this action."}


# @story: SCRUM-87
# @ac: 2
def test_opening_another_coordinators_request_is_refused_and_shows_nothing(client):
    request_id = make_request("Open Theirs", "coord2")
    login(client, "coord1")

    resp = client.get(f"/api/requests/{request_id}")

    assert resp.status_code == 403
    assert resp.get_json() == {"message": "You do not have permission to perform this action."}
    assert stored(request_id).assigned_coordinator.username == "coord2"


# @story: SCRUM-87
# @ac: 2
def test_a_draft_cannot_be_opened_by_a_coordinator_even_when_recorded_against_them(client):
    request_id = make_request("Odd Draft Open", "coord1", status="Draft")
    login(client, "coord1")

    assert client.get(f"/api/requests/{request_id}").status_code == 403


# --- AC3: only the assigned coordinator decides ---


# @story: SCRUM-87
# @ac: 3
def test_the_assigned_coordinator_approves_and_another_cannot(client):
    request_id = make_request("Decide Mine", "coord1")
    login(client, "coord2")
    assert client.post(f"/api/requests/{request_id}/approve", json={}).status_code == 403
    assert stored(request_id).status == "Submitted"

    login(client, "coord1")
    resp = client.post(f"/api/requests/{request_id}/approve", json={})

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "Approved"


# @story: SCRUM-87
# @ac: 3
def test_only_the_assigned_coordinator_rejects(client):
    request_id = make_request("Reject Mine", "coord1")
    login(client, "coord2")

    assert client.post(f"/api/requests/{request_id}/reject", json={"reason": "No."}).status_code == 403
    assert stored(request_id).status == "Submitted"

    login(client, "coord1")
    assert client.post(f"/api/requests/{request_id}/reject", json={"reason": "No."}).status_code == 200


# @story: SCRUM-87
# @ac: 3
@pytest.mark.parametrize("username", ["coord1", "leadcoord1", "multi1"])
def test_a_request_still_in_the_queue_cannot_be_decided_by_any_coordinator(client, username):
    request_id = make_request("Queued Undecidable")
    login(client, username)

    assert client.post(f"/api/requests/{request_id}/approve", json={}).status_code == 403
    assert client.post(f"/api/requests/{request_id}/reject", json={"reason": "No."}).status_code == 403
    saved = stored(request_id)
    assert (saved.status, saved.decision) == ("Submitted", None)


# --- AC4: raising and withdrawing a booking belong to the assigned coordinator ---


# @story: SCRUM-87
# @ac: 4
def test_only_the_assigned_coordinator_raises_a_booking(client):
    request_id = make_request("Raise Mine", "coord1", status="Approved")
    body = {"venue_id": seminar_room().id}
    login(client, "coord2")

    assert client.post(f"/api/requests/{request_id}/bookings", json=body).status_code == 404
    assert db.session.query(VenueBookingRequest).filter_by(event_request_id=request_id).count() == 0

    login(client, "coord1")
    assert client.post(f"/api/requests/{request_id}/bookings", json=body).status_code == 201


# @story: SCRUM-87
# @ac: 4
def test_the_assigned_coordinator_withdraws_a_booking_someone_else_raised(client):
    request_id = make_request("Withdraw Event", "coord2", status="Approved")
    booking_id = make_booking(request_id, raised_by="coord1")
    login(client, "coord2")

    resp = client.post(f"/api/venues/{seminar_room().id}/bookings/{booking_id}/withdraw")

    assert resp.status_code == 200
    assert booking_status(booking_id) == "Withdrawn"


# @story: SCRUM-87
# @ac: 4
def test_the_coordinator_who_raised_a_booking_cannot_withdraw_it_unless_assigned(client):
    request_id = make_request("Raiser Event", "coord2", status="Approved")
    booking_id = make_booking(request_id, raised_by="coord1")
    login(client, "coord1")

    resp = client.post(f"/api/venues/{seminar_room().id}/bookings/{booking_id}/withdraw")

    assert resp.status_code == 404
    assert booking_status(booking_id) == "Requested"


# @story: SCRUM-87
# @ac: 4
def test_each_booking_names_the_coordinator_its_event_is_assigned_to(client):
    assigned = make_request("Names Assigned", "coord1", status="Approved")
    unassigned = make_request("Names Nobody", status="Approved")
    assigned_booking = make_booking(assigned)
    unassigned_booking = make_booking(unassigned)
    login(client, "venue1")

    rows = {row["id"]: row for row in client.get(f"/api/venues/{seminar_room().id}/bookings").get_json()}

    assert rows[assigned_booking]["assigned_coordinator"] == "coord1"
    assert rows[unassigned_booking]["assigned_coordinator"] is None


# --- AC5: an account with several roles keeps each role's rights and no more ---


# @story: SCRUM-87
# @ac: 5
def test_a_lead_who_is_also_a_coordinator_still_views_the_queue_and_assigns(client):
    request_id = make_request("Lead Assign")
    login(client, "leadcoord1")

    queue = [row["name"] for row in client.get("/api/assignments/queue").get_json()]
    resp = client.post(f"/api/requests/{request_id}/assign", json={"coordinator_id": account("coord2").id})

    assert "Lead Assign" in queue
    assert resp.status_code == 200
    assert stored(request_id).assigned_coordinator.username == "coord2"


# @story: SCRUM-87
# @ac: 5
def test_a_lead_who_is_also_a_coordinator_lists_only_their_own_events(client):
    make_request("Lead Mine", "leadcoord1")
    make_request("Lead Theirs", "coord2")
    login(client, "leadcoord1")

    names = listed_names(client)

    assert "Lead Mine" in names
    assert "Lead Theirs" not in names


# @story: SCRUM-87
# @ac: 5
def test_a_lead_who_is_also_a_coordinator_reads_another_event_but_does_not_act_on_it(client):
    request_id = make_request("Lead Reads Theirs", "coord2", status="Approved")
    submitted = make_request("Lead Cannot Decide", "coord2")
    login(client, "leadcoord1")

    assert client.get(f"/api/requests/{request_id}").status_code == 200  # the Lead's read-only view
    assert client.post(f"/api/requests/{submitted}/approve", json={}).status_code == 403
    assert client.post(f"/api/requests/{submitted}/reject", json={"reason": "No."}).status_code == 403
    assert client.post(
        f"/api/requests/{request_id}/bookings", json={"venue_id": seminar_room().id}
    ).status_code == 404
    assert stored(submitted).status == "Submitted"


# @story: SCRUM-87
# @ac: 5
def test_a_coordinator_who_is_also_venue_staff_keeps_both_roles_rights(client):
    mine = make_request("Multi Mine", "multi1")
    theirs = make_request("Multi Theirs", "coord1")
    booking_id = make_booking(make_request("Multi Other", "coord2", status="Approved"), raised_by="coord2")
    login(client, "multi1")

    names = listed_names(client)
    approved = client.post(f"/api/venues/{seminar_room().id}/bookings/{booking_id}/approve", json={})

    assert "Multi Mine" in names and "Multi Theirs" not in names
    assert client.get(f"/api/requests/{theirs}").status_code == 403
    assert client.get(f"/api/requests/{mine}").status_code == 200
    assert approved.status_code == 200
    assert booking_status(booking_id) == "Approved"


# --- AC6: a reassigned event leaves its previous coordinator ---
# SCRUM-44 builds the reassignment; here the event's coordinator is changed the way it will.


# @story: SCRUM-87
# @ac: 6
def test_after_reassignment_the_previous_coordinator_no_longer_sees_or_acts_and_the_new_one_does(client):
    request_id = make_request("Reassigned Away", "coord1", status="Approved")
    booking_id = make_booking(request_id, raised_by="coord1")
    event = db.session.get(EventRequest, request_id)
    event.assigned_coordinator = account("coord2")
    db.session.commit()

    login(client, "coord1")
    assert "Reassigned Away" not in listed_names(client)
    assert client.get(f"/api/requests/{request_id}").status_code == 403
    assert client.post(f"/api/requests/{request_id}/bookings", json={"venue_id": seminar_room().id}).status_code == 404
    assert client.post(f"/api/venues/{seminar_room().id}/bookings/{booking_id}/withdraw").status_code == 404
    assert booking_status(booking_id) == "Requested"

    login(client, "coord2")
    assert "Reassigned Away" in listed_names(client)
    assert client.get(f"/api/requests/{request_id}").status_code == 200
    assert client.post(f"/api/venues/{seminar_room().id}/bookings/{booking_id}/withdraw").status_code == 200


# --- AC7: only an Event Organiser creates or submits a request ---


NEW_REQUEST = {"name": "Not Allowed Event", **FIELDS}


# @story: SCRUM-87
# @ac: 7
@pytest.mark.parametrize(
    "username", ["coord1", "multi1", "lead1", "leadcoord1", "venue1", "tech1", "safety1", "att1"]
)
def test_any_role_but_an_organiser_is_refused_creating_or_saving_a_request(client, username):
    before = db.session.query(EventRequest).count()
    login(client, username)

    submitted = client.post("/api/requests", json=NEW_REQUEST)
    drafted = client.post("/api/requests/draft", json={"name": "Not Allowed Draft"})

    assert submitted.status_code == 403
    assert drafted.status_code == 403
    assert db.session.query(EventRequest).count() == before


# @story: SCRUM-87
# @ac: 7
@pytest.mark.parametrize("username", ["coord1", "multi1", "leadcoord1"])
def test_a_coordinator_is_refused_submitting_an_organisers_draft(client, username):
    draft_id = make_request("Someone Elses Draft", status="Draft")
    login(client, username)

    resp = client.post(f"/api/requests/{draft_id}/submit")

    assert resp.status_code == 403
    assert stored(draft_id).status == "Draft"


# @story: SCRUM-87
# @ac: 7
def test_the_coordinator_no_longer_holds_the_edit_feature_and_the_organiser_does(client):
    login(client, "coord1")
    assert "requests.edit" not in client.get("/api/me").get_json()["features"]
    assert client.get("/api/request-options").status_code == 403

    login(client, "org1")
    assert "requests.edit" in client.get("/api/me").get_json()["features"]
    assert client.get("/api/request-options").status_code == 200


# @story: SCRUM-87
# @ac: 7
def test_an_organiser_can_still_create_and_submit(client):
    login(client, "org2")

    resp = client.post("/api/requests", json=NEW_REQUEST)

    assert resp.status_code == 201
    assert resp.get_json()["status"] == "Submitted"


# @story: SCRUM-87
# @ac: 7
def test_the_service_refuses_a_non_organiser_even_if_a_route_let_them_through(client):
    # The route's permission check refuses first; the service keeps its own rule (ADR-002).
    from areas.requests import services
    from errors import ApiRefusal

    before = db.session.query(EventRequest).count()
    for call in (
        lambda who: services.submit_new_request(who, NEW_REQUEST),
        lambda who: services.save_new_draft(who, {"name": "Not Allowed Draft"}),
    ):
        with pytest.raises(ApiRefusal) as refused:
            call(account("coord1"))
        assert refused.value.status == 403
        assert refused.value.message == "Only an Event Organiser may do this."
    assert db.session.query(EventRequest).count() == before
