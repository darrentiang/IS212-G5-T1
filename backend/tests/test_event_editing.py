"""SCRUM-47: the assigned Event Coordinator edits an event after submission."""
# @story: SCRUM-47
# @ac: 1, 2, 3, 4, 5, 6, 7
from datetime import datetime

import pytest

import clock
from db import db
from factories import account, make_booking, make_event, make_hold, make_venue
from models import (EquipmentType, EventChange, EventRequest, Reservation, VenueBookingRequest,
                    VenueHold)

NOW = datetime(2026, 10, 26, 10, 0)  # Singapore; 02:00 UTC
CHANGED_AT = '2026-10-26T02:00:00Z'
MODELS = (EventRequest, EventChange, VenueBookingRequest, VenueHold, Reservation, EquipmentType)


def login(client, user='coord1'):
    with client.session_transaction() as session:
        session['account_id'] = account(user).id


def snapshot():
    db.session.expire_all()
    return {m.__tablename__: [{c.name: getattr(row, c.name) for c in m.__table__.columns}
                             for row in db.session.query(m).order_by(m.id)] for m in MODELS}


def make_assigned(status='Planning', coordinator='coord1', **fields):
    """An event with every submitted field filled, assigned to coordinator."""
    values = dict(name='SCRUM-47 event', status=status, date='2026-11-15', start_time='10:00',
                  end_time='12:00', attendance=40, purpose='Original purpose',
                  description='Original description', equipment_requirements='2 projectors',
                  registration_needs='Original registration needs')
    values.update(fields)
    if coordinator:
        values['assigned_coordinator'] = account(coordinator)
    return make_event(**values)


@pytest.fixture(autouse=True)
def pinned_clock(monkeypatch):
    monkeypatch.setattr(clock, 'now_local', lambda: NOW)


@pytest.fixture
def event(client):
    row = make_assigned()
    login(client)
    return row


def edit(client, event, body):
    return client.patch(f'/api/requests/{event.id}', json=body)


def entries(reply):
    return [(row['field'], row['old_value'], row['new_value']) for row in reply.json['change_record']]


def test_ordinary_changes_are_saved_without_a_change_record(client, event):
    reply = edit(client, event, {'name': 'SCRUM-47 TC01 Renamed', 'purpose': 'Updated purpose',
                                 'description': 'Updated description',
                                 'registration_needs': 'Updated registration needs'})
    assert reply.status_code == 200
    assert (reply.json['name'], reply.json['purpose'], reply.json['description'],
            reply.json['registration_needs']) == ('SCRUM-47 TC01 Renamed', 'Updated purpose',
                                                   'Updated description', 'Updated registration needs')
    assert reply.json['status'] == 'Planning'
    assert reply.json['change_record'] == []


def test_each_significant_change_is_recorded_once_with_who_and_when(client, event):
    reply = edit(client, event, {'name': 'SCRUM-47 TC02 Renamed', 'purpose': 'Updated purpose',
                                 'date': '2026-11-22', 'start_time': '13:00', 'end_time': '15:00',
                                 'attendance': '55'})
    assert reply.status_code == 200
    assert reply.json['attendance'] == 55
    assert entries(reply) == [('date', '2026-11-15', '2026-11-22'), ('start_time', '10:00', '13:00'),
                              ('end_time', '12:00', '15:00'), ('attendance', '40', '55')]
    assert {(row['changed_by'], row['changed_at']) for row in reply.json['change_record']} == {('coord1', CHANGED_AT)}
    assert reply.json['status'] == 'Planning'


def test_choices_and_equipment_requirements_are_significant(client):
    event = make_assigned(layout='Theatre', facilities=['Projector'], features=['Step-free access'])
    login(client)
    reply = edit(client, event, {'layout': 'Classroom', 'facilities': ['Projector', 'Wi-Fi'],
                                 'accessibility_features': ['Step-free access', 'Hearing loop'],
                                 'equipment_requirements': '4 projectors'})
    assert reply.status_code == 200
    assert entries(reply) == [('equipment_requirements', '2 projectors', '4 projectors'),
                              ('layout', 'Theatre', 'Classroom'),
                              ('facilities', 'Projector', 'Projector, Wi-Fi'),
                              ('accessibility_features', 'Step-free access', 'Step-free access, Hearing loop')]


def test_clearing_a_layout_and_the_same_choices_in_another_order_record_only_real_changes(client):
    event = make_assigned(layout='Theatre', facilities=['Projector', 'Wi-Fi'])
    login(client)
    reply = edit(client, event, {'layout': None, 'facilities': ['Wi-Fi', 'Projector'], 'attendance': 40})
    assert reply.status_code == 200
    assert entries(reply) == [('layout', 'Theatre', None)]


@pytest.mark.parametrize('stage', ['Submitted', 'Approved', 'Planning'])
def test_significant_changes_are_allowed_before_safety_check_and_keep_the_status(client, stage):
    event = make_assigned(status=stage)
    login(client)
    reply = edit(client, event, {'name': 'SCRUM-47 TC04 Renamed', 'attendance': 45})
    assert reply.status_code == 200
    assert reply.json['status'] == stage
    assert entries(reply) == [('attendance', '40', '45')]


@pytest.mark.parametrize('stage', ['Safety Check', 'Confirmed'])
def test_ordinary_changes_are_allowed_in_safety_check_and_confirmed(client, stage):
    event = make_assigned(status=stage)
    login(client)
    reply = edit(client, event, {'description': 'Updated description', 'name': 'SCRUM-47 TC05 Renamed'})
    assert reply.status_code == 200
    assert reply.json['status'] == stage
    assert reply.json['change_record'] == []


@pytest.mark.parametrize('stage', ['Safety Check', 'Confirmed'])
@pytest.mark.parametrize('body', [{'date': '2026-11-22'}, {'attendance': 55}, {'layout': 'Classroom'},
                                  {'name': 'Renamed', 'equipment_requirements': '4 projectors'}])
def test_a_significant_change_in_safety_check_or_confirmed_is_refused(client, stage, body):
    event = make_assigned(status=stage)
    login(client)
    before = snapshot()
    reply = edit(client, event, body)
    assert reply.status_code == 409
    assert reply.json['message'] == ('A significant change to an event in Safety Check or Confirmed '
                                      'needs an accepted change request.')
    assert snapshot() == before


@pytest.mark.parametrize('body, message', [
    ({'name': ''}, 'Missing required fields: name'),
    ({'purpose': '   '}, 'Missing required fields: purpose'),
    ({'description': ''}, 'Missing required fields: description'),
    ({'date': '2026-10-25'}, 'Date cannot be earlier than today.'),
    ({'date': '2026-13-01'}, 'Date must be a valid date.'),
    ({'start_time': '12:00'}, 'Start time must be before the end time.'),
    ({'start_time': '13:00'}, 'Start time must be before the end time.'),
    ({'end_time': '25:00'}, 'Start and end time must be valid times.'),
    ({'attendance': 0}, 'Attendance must be a positive whole number.'),
    ({'attendance': -5}, 'Attendance must be a positive whole number.'),
    ({'attendance': 20.5}, 'Attendance must be a positive whole number.'),
    ({'attendance': 'abc'}, 'Attendance must be a positive whole number.'),
    ({'layout': 'Ballroom'}, 'Choose the layout from the list.'),
    ({'facilities': ['Helipad']}, 'Choose each facility from the list.'),
])
def test_each_invalid_value_is_refused_and_changes_nothing(client, event, body, message):
    before = snapshot()
    reply = edit(client, event, body)
    assert reply.status_code == 400
    assert reply.json['message'] == message
    assert snapshot() == before


def test_a_refused_edit_saves_none_of_its_valid_changes(client, event):
    before = snapshot()
    reply = edit(client, event, {'name': 'SCRUM-47 TC09 Renamed', 'attendance': 60, 'date': '2026-10-25'})
    assert reply.status_code == 400
    assert reply.json['message'] == 'Date cannot be earlier than today.'
    assert snapshot() == before


def test_the_lowest_accepted_values_are_saved(client, event):
    reply = edit(client, event, {'date': '2026-10-26', 'start_time': '11:59', 'attendance': 1})
    assert reply.status_code == 200
    assert entries(reply) == [('date', '2026-11-15', '2026-10-26'), ('start_time', '10:00', '11:59'),
                              ('attendance', '40', '1')]


def test_an_unchanged_date_already_past_does_not_stop_an_ordinary_edit(client):
    event = make_assigned(status='Confirmed', date='2026-10-20')
    login(client)
    assert edit(client, event, {'name': 'Renamed', 'date': '2026-10-20'}).status_code == 200


def test_an_empty_body_changes_nothing_and_a_non_object_is_refused(client, event):
    assert edit(client, event, {}).json['change_record'] == []
    reply = client.patch(f'/api/requests/{event.id}', json=['name'])
    assert reply.status_code == 400
    assert reply.json['message'] == 'A JSON object of the fields to change is required.'


@pytest.mark.parametrize('body', [{'date': '2026-11-22'}, {'start_time': '09:00'}, {'end_time': '14:00'}])
def test_a_held_venue_stops_a_change_to_the_date_or_times(client, event, body):
    make_hold(event=event, venue=make_venue(name='SCRUM-47 Venue A'), expires_at='2026-11-01T12:00')
    before = snapshot()
    reply = edit(client, event, body)
    assert reply.status_code == 409
    assert reply.json['message'] == "Release the held venue before changing the event's date or times."
    assert snapshot() == before


def test_a_held_venue_allows_other_changes_and_releasing_it_allows_the_date(client, event):
    hold = make_hold(event=event, venue=make_venue(name='SCRUM-47 Venue A'), expires_at='2026-11-01T12:00')
    assert edit(client, event, {'name': 'SCRUM-47 TC11 Renamed', 'attendance': 50}).status_code == 200
    assert client.post(f'/api/requests/{event.id}/holds/{hold.id}/release').status_code == 200
    reply = edit(client, event, {'date': '2026-11-22'})
    assert reply.status_code == 200
    assert entries(reply) == [('attendance', '40', '50'), ('date', '2026-11-15', '2026-11-22')]


@pytest.mark.parametrize('arrangement', ['Released hold', 'Expired hold', 'Approved booking'])
def test_arrangements_that_hold_no_venue_do_not_stop_a_date_change(client, event, arrangement):
    venue = make_venue(name='SCRUM-47 Venue A')
    if arrangement == 'Approved booking':
        make_booking(event=event, venue=venue, status='Approved')
    else:
        make_hold(event=event, venue=venue, expires_at='2026-11-01T12:00', status=arrangement.split()[0])
    assert edit(client, event, {'date': '2026-11-22'}).status_code == 200


def test_an_edit_never_moves_cancels_or_releases_an_arrangement(client, event):
    other = make_assigned(name='SCRUM-47 other event', coordinator='coord2')
    make_booking(event=event, venue=make_venue(name='SCRUM-47 Venue A'), status='Approved')
    make_booking(event=event, venue=make_venue(name='SCRUM-47 Venue B'), status='Requested')
    make_booking(event=other, venue=make_venue(name='SCRUM-47 Venue D'), status='Approved')
    make_hold(event=event, venue=make_venue(name='SCRUM-47 Venue C'), expires_at='2026-11-01T12:00',
              status='Released')
    projector = EquipmentType(name='SCRUM-47 projector', total_units=10)
    db.session.add(projector)
    db.session.commit()
    for row, quantity in ((event, 2), (other, 3)):
        db.session.add(Reservation(event_request_id=row.id, equipment_type_id=projector.id, quantity=quantity,
                                   date=row.date, start_time=row.start_time, end_time=row.end_time,
                                   status='Reserved'))
    db.session.commit()
    before = snapshot()
    reply = edit(client, event, {'date': '2026-11-22', 'start_time': '13:00', 'end_time': '15:00',
                                 'attendance': 70})
    assert reply.status_code == 200
    after = snapshot()
    for table in ('venue_booking_requests', 'venue_holds', 'reservations', 'equipment_types'):
        assert after[table] == before[table]
    assert reply.json['status'] == 'Planning'


@pytest.mark.parametrize('user, code', [('coord2', 404), ('leadcoord1', 404), ('lead1', 403), ('org1', 403)])
def test_only_the_assigned_coordinator_may_edit(client, user, code):
    event = make_assigned()
    login(client, user)
    before = snapshot()
    reply = edit(client, event, {'name': 'SCRUM-47 TC14 Hijacked', 'attendance': 55})
    assert reply.status_code == code
    assert snapshot() == before


def test_a_draft_or_unknown_event_answers_not_found_and_no_login_is_refused(client):
    draft = make_event(name='SCRUM-47 TC16 Draft Event', status='Draft', date='2026-11-15',
                       start_time='10:00', end_time='12:00')
    login(client)
    assert edit(client, draft, {'name': 'Edit attempt'}).status_code == 404
    assert client.patch('/api/requests/999999', json={'name': 'x'}).status_code == 404
    with client.session_transaction() as session:
        session.clear()
    assert edit(client, draft, {'name': 'Edit attempt'}).status_code == 401


@pytest.mark.parametrize('stage', ['Rejected', 'Completed', 'Cancelled'])
def test_a_rejected_completed_or_cancelled_event_cannot_be_edited(client, stage):
    event = make_assigned(status=stage)
    login(client)
    before = snapshot()
    reply = edit(client, event, {'name': 'SCRUM-47 TC16 Edit attempt'})
    assert reply.status_code == 409
    assert reply.json['message'] == ('Only a Submitted, Approved, Planning, Safety Check or Confirmed '
                                      'event can be edited.')
    assert snapshot() == before


def test_only_the_assigned_coordinator_sees_the_change_record(client, event):
    edit(client, event, {'attendance': 55})
    assert len(client.get(f'/api/requests/{event.id}').json['change_record']) == 1
    for user in ('org1', 'lead1'):
        login(client, user)
        assert 'change_record' not in client.get(f'/api/requests/{event.id}').json


@pytest.mark.parametrize('stage', ['Safety Check', 'Confirmed'])
def test_a_significant_change_is_allowed_once_an_accepted_change_request_returned_the_event_to_planning(client, stage):
    event = make_assigned(status=stage)
    login(client, 'org1')
    raised = client.post(f'/api/requests/{event.id}/change-requests',
                         json={'kind': 'Change', 'description': 'Please move it.', 'affects': ['date_time']})
    login(client)
    assert edit(client, event, {'date': '2026-11-22'}).status_code == 409
    change_id = raised.json['change_requests'][0]['id']
    decided = client.post(f'/api/requests/{event.id}/change-requests/{change_id}/decision', json={'decision': 'Accept'})
    assert decided.json['status'] == 'Planning'
    reply = edit(client, event, {'date': '2026-11-22'})
    assert reply.status_code == 200
    assert reply.json['status'] == 'Planning'
    assert entries(reply) == [('date', '2026-11-15', '2026-11-22')]
