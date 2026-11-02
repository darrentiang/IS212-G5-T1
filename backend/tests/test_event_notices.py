"""SCRUM-64: notices when an event is confirmed, goes back to Planning or is cancelled, and when an Attendee registers or withdraws.

The rules at the API: who is told and what it says in the rule's terms; that a Registered
Attendee is the one told, at the moment of the change; that an Attendee's cancellation notice
never carries the reason; that one action tells one person once, even when that person is both
the Organiser and an Attendee; and that a refused action tells nobody. Every test builds its own
event, venues, registrations and requests with tests/factories.py. The browser journeys are
functional/tests/SCRUM-64.spec.js.
"""

from datetime import datetime

import pytest

import clock
from db import db
from factories import account, make_attendee, make_booking, make_event, make_registration, make_venue
from models import Notification, Registration, VenueBookingRequest
from tests.test_change_requests import change, login, rows, withdraw

NOW = datetime(2026, 12, 1, 9, 0)
DATE = "2026-12-15"
PERIOD = "15 Dec 2026, 10:00–12:00"
FACTS = f"{PERIOD}, Alpha Hall, Beta Room"
BLOCK = {"start_date": DATE, "start_time": "09:00", "end_date": DATE, "end_time": "18:00", "reason": "Lift repair"}


@pytest.fixture(autouse=True)
def pinned_clock(monkeypatch):
    monkeypatch.setattr(clock, "now_local", lambda: NOW)


def gala(status="Confirmed", name="Annual Gala", bookings=("Alpha Hall", "Beta Room"), capacity=5):
    """An event owned by org1 and assigned to coord1, with registration open and one Approved booking per venue."""
    row = make_event(
        name=name,
        status=status,
        date=DATE,
        start_time="10:00",
        end_time="12:00",
        assigned_coordinator=account("coord1"),
        registration_enabled=True,
        registration_capacity=capacity,
        registration_closes_at=datetime(2026, 12, 9, 23, 59),
    )
    for venue in bookings:
        make_booking(event=row, venue=make_venue(name=venue), status="Approved")
    return row


def everyone(event):
    """Every notice about the event, oldest first, as (recipient username, message)."""
    db.session.expire_all()
    rows_ = (
        db.session.query(Notification)
        .filter_by(event_request_id=event.id)
        .join(Notification.recipient)
        .order_by(Notification.id)
        .all()
    )
    return [(row.recipient.username, row.message) for row in rows_]


def told(notices, username):
    return [message for recipient, message in notices if recipient == username]


def approve(client, event):
    login(client, "safety1")
    return client.post(f"/api/requests/{event.id}/safety/approve", json={})


def raise_request(client, event, withdrawal=False):
    """The Organiser raises a request and the coordinator is left logged in; returns the new request."""
    login(client, "org1")
    reply = withdraw(client, event.id, "Client cancelled the programme") if withdrawal else change(client, event.id)
    assert reply.status_code == 201
    login(client, "coord1")
    return rows(event.id)[-1]


def decide(client, event, request, body):
    return client.post(f"/api/requests/{event.id}/change-requests/{request.id}/decision", json=body)


def cancel(client, event, reason):
    login(client, "coord1")
    return client.post(f"/api/requests/{event.id}/cancel", json={"reason": reason})


def register(client, event, username="att1"):
    login(client, username)
    return client.post(f"/api/registration/events/{event.id}/register")


# @story: SCRUM-64
# @ac: 1
def test_a_safety_approval_tells_the_organiser_the_event_its_date_time_and_venues(client):
    row = gala(status="Safety Check")
    approve(client, row)
    assert row.status == "Confirmed"
    assert told(everyone(row), "org1") == [f'Your event "Annual Gala" is confirmed: {FACTS}.']


# @story: SCRUM-64
# @ac: 4, 8
def test_each_registered_attendee_is_told_the_current_details_once_and_a_withdrawn_one_is_not(client):
    row = gala(status="Safety Check")
    make_registration(event=row, attendee="att1")
    make_registration(event=row, attendee=make_attendee("att64w").username, status="Withdrawn")
    before = everyone(row)
    approve(client, row)
    fresh = everyone(row)[len(before):]
    assert told(fresh, "att1") == [f'"Annual Gala" is confirmed again: {FACTS}.']
    assert told(fresh, "att64w") == []


# @story: SCRUM-64
# @ac: 7
def test_an_organiser_who_is_also_registered_is_told_the_confirmation_once(client):
    row = gala(status="Safety Check")
    make_registration(event=row, attendee="org1")
    approve(client, row)
    assert told(everyone(row), "org1") == [f'Your event "Annual Gala" is confirmed: {FACTS}.']


# @story: SCRUM-64
# @ac: 3, 7
def test_a_change_that_returns_a_confirmed_event_to_planning_tells_each_registered_attendee_once(client):
    row = gala()
    make_registration(event=row, attendee="att1")
    make_registration(event=row, attendee=make_attendee("att64w").username, status="Withdrawn")
    request = raise_request(client, row)
    before = everyone(row)
    reply = decide(client, row, request, {"decision": "Accept", "needs_review": {"venue_bookings": True, "equipment_reservations": False}})
    assert reply.status_code == 200 and row.status == "Planning"
    fresh = everyone(row)[len(before):]
    assert told(fresh, "att1") == ['"Annual Gala" is back in planning. Its details may change.']
    assert told(fresh, "att64w") == []
    assert told(fresh, "org1") == ['Your change request on "Annual Gala" was accepted.']


# @story: SCRUM-64
# @ac: 3
def test_a_safety_check_sent_back_to_planning_tells_no_attendee(client):
    row = gala(status="Safety Check")
    make_registration(event=row, attendee="att1")
    login(client, "safety1")
    assert client.post(f"/api/requests/{row.id}/safety/reject", json={"reason": "Exit route blocked"}).status_code == 200
    assert row.status == "Planning"
    assert told(everyone(row), "att1") == []


# @story: SCRUM-64
# @ac: 3
def test_a_venue_block_that_returns_a_confirmed_event_tells_each_registered_attendee_once(client):
    row = gala()
    make_registration(event=row, attendee="att1")
    login(client, "venue1")
    venue = db.session.query(VenueBookingRequest).filter_by(event_request_id=row.id).first().venue
    assert client.post(f"/api/venues/{venue.id}/blocks", json=BLOCK).status_code == 201
    assert row.status == "Planning"
    assert told(everyone(row), "att1") == ['"Annual Gala" is back in planning. Its details may change.']


# @story: SCRUM-64
# @ac: 2
def test_declining_a_change_gives_the_organiser_the_coordinators_reason(client):
    row = gala()
    request = raise_request(client, row)
    before = everyone(row)
    assert decide(client, row, request, {"decision": "Decline", "reason": "Venue is not free on that day."}).status_code == 200
    assert told(everyone(row)[len(before):], "org1") == [
        'Your change request on "Annual Gala" was declined. Reason: Venue is not free on that day.'
    ]


# @story: SCRUM-64
# @ac: 2
def test_declining_a_withdrawal_names_the_withdrawal_request_and_its_reason(client):
    row = gala()
    request = raise_request(client, row, withdrawal=True)
    before = everyone(row)
    assert decide(client, row, request, {"decision": "Decline", "reason": "Venue already paid for"}).status_code == 200
    assert told(everyone(row)[len(before):], "org1") == [
        'Your withdrawal request on "Annual Gala" was declined. Reason: Venue already paid for'
    ]


# @story: SCRUM-64
# @ac: 2
def test_accepting_a_change_that_keeps_the_event_tells_the_organiser_without_a_reason(client):
    row = gala(status="Approved")
    request = raise_request(client, row)
    before = everyone(row)
    assert decide(client, row, request, {"decision": "Accept"}).status_code == 200
    assert row.status == "Approved"
    assert told(everyone(row)[len(before):], "org1") == ['Your change request on "Annual Gala" was accepted.']


# @story: SCRUM-64
# @ac: 2, 5
def test_accepting_a_withdrawal_sends_the_organiser_one_cancellation_and_no_decision_notice(client):
    row = gala()
    request = raise_request(client, row, withdrawal=True)
    before = everyone(row)
    assert decide(client, row, request, {"decision": "Accept"}).status_code == 200
    assert row.status == "Cancelled"
    organiser = told(everyone(row)[len(before):], "org1")
    assert len(organiser) == 1
    assert organiser[0].startswith('Your event "Annual Gala" was cancelled. Reason: Withdrawn at the Event Organiser')
    assert organiser[0].endswith("Client cancelled the programme")


# @story: SCRUM-64
# @ac: 5, 7
def test_cancelling_tells_the_organiser_the_reason_and_each_registered_attendee_without_it(client):
    row = gala()
    make_registration(event=row, attendee="att1")
    make_registration(event=row, attendee=make_attendee("att64w").username, status="Withdrawn")
    before = everyone(row)
    assert cancel(client, row, "Speaker unavailable").status_code == 200
    fresh = everyone(row)[len(before):]
    assert told(fresh, "org1") == ['Your event "Annual Gala" was cancelled. Reason: Speaker unavailable']
    assert told(fresh, "att1") == ['"Annual Gala" was cancelled.']
    assert told(fresh, "att64w") == []


# @story: SCRUM-64
# @ac: 7
def test_an_organiser_who_is_also_registered_is_told_the_cancellation_once_with_the_reason(client):
    row = gala()
    make_registration(event=row, attendee="org1")
    cancel(client, row, "Speaker unavailable")
    assert told(everyone(row), "org1") == ['Your event "Annual Gala" was cancelled. Reason: Speaker unavailable']


# @story: SCRUM-64
# @ac: 5, 7
def test_a_cancellation_refused_for_a_blank_reason_tells_nobody(client):
    row = gala()
    make_registration(event=row, attendee="att1")
    before = everyone(row)
    assert cancel(client, row, "   ").status_code == 400
    assert everyone(row) == before
    assert row.status == "Confirmed"


# @story: SCRUM-64
# @ac: 6, 8
def test_registering_tells_the_attendee_the_event_name_date_time_and_venues(client):
    row = gala()
    assert register(client, row).status_code == 201
    assert told(everyone(row), "att1") == [f'You are Registered for "Annual Gala": {FACTS}.']


# @story: SCRUM-64
# @ac: 6, 7
def test_withdrawing_tells_the_attendee_once_after_the_registration_notice(client):
    row = gala()
    register(client, row)
    registration = db.session.query(Registration).filter_by(event_request_id=row.id, attendee_id=account("att1").id).one()
    login(client, "att1")
    assert client.post(f"/api/registrations/{registration.id}/withdraw").status_code == 200
    assert told(everyone(row), "att1") == [
        f'You are Registered for "Annual Gala": {FACTS}.',
        'You are Withdrawn from "Annual Gala".',
    ]


# @story: SCRUM-64
# @ac: 6, 7
def test_a_registration_refused_because_the_event_is_full_tells_nobody(client):
    row = gala(capacity=1)
    make_registration(event=row, attendee=make_attendee("att64w").username)
    before = everyone(row)
    assert register(client, row).status_code == 409
    assert everyone(row) == before
