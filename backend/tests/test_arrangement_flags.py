"""SCRUM-61: too-small and timing-mismatch flags on an event's arrangements."""
# @story: SCRUM-61
# @ac: 1, 2, 3, 4, 5, 6
from datetime import datetime

import pytest

import clock
from db import db
from factories import account, make_booking, make_event, make_hold, make_venue
from models import EquipmentType, EventRequest, Reservation, VenueBookingRequest, VenueHold

NOW = datetime(2026, 10, 26, 10, 0)


def login(client, user='coord1'):
    with client.session_transaction() as session:
        session['account_id'] = account(user).id


@pytest.fixture(autouse=True)
def pinned_clock(monkeypatch):
    monkeypatch.setattr(clock, 'now_local', lambda: NOW)


@pytest.fixture
def event(client):
    row = make_event(name='SCRUM-61 event', status='Planning', date='2026-11-15', start_time='10:00',
                     end_time='12:00', attendance=40, purpose='Purpose', description='Description',
                     equipment_requirements='2 projectors', registration_needs='None',
                     assigned_coordinator=account('coord1'))
    login(client)
    return row


def bookings(client, event):
    return {row['venue_name']: row for row in client.get(f'/api/requests/{event.id}/bookings').json}


def holds(client, event):
    return {row['venue_name']: row for row in client.get(f'/api/requests/{event.id}/holds').json}


def reservations(client, event):
    return client.get(f'/api/requests/{event.id}/equipment/reservations').json


def set_attendance(client, event, attendance):
    assert client.patch(f'/api/requests/{event.id}', json={'attendance': attendance}).status_code == 200


def reserve(event, quantity=2, status='Reserved', **period):
    projector = EquipmentType(name=f'SCRUM-61 projector {status}', total_units=10)
    db.session.add(projector)
    db.session.commit()
    row = Reservation(event_request_id=event.id, equipment_type_id=projector.id, quantity=quantity,
                      date=period.get('date', event.date), start_time=period.get('start_time', event.start_time),
                      end_time=period.get('end_time', event.end_time), status=status)
    db.session.add(row)
    db.session.commit()
    return row


def statuses():
    db.session.expire_all()
    return ([b.status for b in db.session.query(VenueBookingRequest).order_by(VenueBookingRequest.id)],
            [h.status for h in db.session.query(VenueHold).order_by(VenueHold.id)],
            [r.status for r in db.session.query(Reservation).order_by(Reservation.id)])


@pytest.mark.parametrize('attendance, flagged', [(49, False), (50, False), (51, True), (60, True)])
def test_an_approved_booking_is_too_small_only_above_the_capacity(client, event, attendance, flagged):
    make_booking(event=event, venue=make_venue(name='Venue A', max_capacity=50), status='Approved')
    set_attendance(client, event, attendance)
    assert bookings(client, event)['Venue A']['too_small'] is flagged


def test_each_venue_is_compared_on_its_own(client, event):
    make_booking(event=event, venue=make_venue(name='Venue A', max_capacity=50), status='Approved')
    make_booking(event=event, venue=make_venue(name='Venue B', max_capacity=100), status='Approved')
    set_attendance(client, event, 80)
    rows = bookings(client, event)
    assert (rows['Venue A']['too_small'], rows['Venue B']['too_small']) == (True, False)


def test_a_pending_request_and_a_held_venue_are_flagged_and_nothing_changes_status(client, event):
    make_booking(event=event, venue=make_venue(name='Venue C', max_capacity=30), status='Requested')
    make_hold(event=event, venue=make_venue(name='Venue D', max_capacity=30), expires_at='2026-11-01T12:00')
    before = statuses()
    set_attendance(client, event, 41)
    assert bookings(client, event)['Venue C']['too_small'] is True
    assert holds(client, event)['Venue D']['too_small'] is True
    assert statuses() == before


def test_a_lowered_venue_capacity_flags_the_existing_booking(client, event):
    venue = make_venue(name='Venue A', max_capacity=100)
    make_booking(event=event, venue=venue, status='Approved')
    assert bookings(client, event)['Venue A']['too_small'] is False
    venue.max_capacity = 30
    db.session.commit()
    assert bookings(client, event)['Venue A']['too_small'] is True


def test_venue_staff_see_the_flag_on_the_venue_s_booking_requests(client, event):
    venue = make_venue(name='Venue A', max_capacity=50)
    make_booking(event=event, venue=venue, status='Requested')
    set_attendance(client, event, 60)
    login(client, 'venue1')
    assert [row['too_small'] for row in client.get(f'/api/venues/{venue.id}/bookings').json] == [True]


def test_the_safety_officer_sees_the_flag_while_the_event_is_in_safety_check(client, event):
    make_booking(event=event, venue=make_venue(name='Venue A', max_capacity=50), status='Approved')
    event.attendance, event.status = 60, 'Safety Check'
    db.session.commit()
    login(client, 'safety1')
    card = client.get(f'/api/requests/{event.id}').json['safety_check']
    assert [row['too_small'] for row in card['venue_bookings']] == [True]


def test_the_flag_clears_when_attendance_is_back_within_capacity(client, event):
    make_booking(event=event, venue=make_venue(name='Venue A', max_capacity=50), status='Approved')
    set_attendance(client, event, 60)
    set_attendance(client, event, 50)
    assert bookings(client, event)['Venue A']['too_small'] is False


@pytest.mark.parametrize('status', ['Rejected', 'Withdrawn', 'Cancelled'])
def test_a_booking_that_holds_nothing_is_never_flagged(client, event, status):
    make_booking(event=event, venue=make_venue(name='Venue A', max_capacity=10), status=status)
    event.date = '2026-11-22'
    db.session.commit()
    row = bookings(client, event)['Venue A']
    assert (row['too_small'], row['timing_mismatch']) == (False, False)


@pytest.mark.parametrize('status', ['Released', 'Expired'])
def test_a_hold_that_holds_nothing_is_never_flagged(client, event, status):
    make_hold(event=event, venue=make_venue(name='Venue A', max_capacity=10), expires_at='2026-11-01T12:00',
              status=status)
    assert holds(client, event)['Venue A']['too_small'] is False


def test_releasing_a_hold_clears_its_flag(client, event):
    hold = make_hold(event=event, venue=make_venue(name='Venue A', max_capacity=10), expires_at='2026-11-01T12:00')
    assert holds(client, event)['Venue A']['too_small'] is True
    assert client.post(f'/api/requests/{event.id}/holds/{hold.id}/release').status_code == 200
    assert holds(client, event)['Venue A']['too_small'] is False


@pytest.mark.parametrize('change', [{'date': '2026-11-22'}, {'start_time': '09:00'}, {'end_time': '12:01'}])
def test_a_changed_date_or_time_flags_bookings_requests_and_reservations(client, event, change):
    for name, status in (('Venue A', 'Approved'), ('Venue B', 'Requested')):
        make_booking(event=event, venue=make_venue(name=name, max_capacity=100), status=status)
    reserve(event)
    before = statuses()
    assert client.patch(f'/api/requests/{event.id}', json=change).status_code == 200
    rows = bookings(client, event)
    assert (rows['Venue A']['timing_mismatch'], rows['Venue B']['timing_mismatch']) == (True, True)
    assert [row['timing_mismatch'] for row in reservations(client, event)] == [True]
    assert rows['Venue A']['date'] == '2026-11-15'
    assert statuses() == before


def test_matching_times_are_not_flagged_and_putting_them_back_clears_the_flag(client, event):
    make_booking(event=event, venue=make_venue(name='Venue A', max_capacity=100), status='Approved')
    reserve(event)
    assert bookings(client, event)['Venue A']['timing_mismatch'] is False
    assert client.patch(f'/api/requests/{event.id}', json={'date': '2026-11-22'}).status_code == 200
    assert client.patch(f'/api/requests/{event.id}', json={'date': '2026-11-15'}).status_code == 200
    assert bookings(client, event)['Venue A']['timing_mismatch'] is False
    assert [row['timing_mismatch'] for row in reservations(client, event)] == [False]


def test_a_released_reservation_is_never_flagged(client, event):
    reserve(event, status='Released', date='2026-11-22')
    assert [row['timing_mismatch'] for row in reservations(client, event)] == [False]


def test_technical_support_sees_the_reservation_s_flag(client, event):
    reserve(event, date='2026-11-22')
    login(client, 'tech1')
    assert [row['timing_mismatch'] for row in reservations(client, event)] == [True]


def test_reading_the_flags_changes_nothing(client, event):
    make_booking(event=event, venue=make_venue(name='Venue A', max_capacity=10), status='Approved')
    make_hold(event=event, venue=make_venue(name='Venue B', max_capacity=10), expires_at='2026-11-01T12:00')
    reserve(event, date='2026-11-22')
    before = statuses()
    bookings(client, event), holds(client, event), reservations(client, event)
    assert statuses() == before
    assert db.session.get(EventRequest, event.id).status == 'Planning'
