"""SCRUM-65: atomic cancellation, scoped access and historical preservation."""
# @story: SCRUM-65
# @ac: 1, 2, 3, 4, 5, 6
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier

import pytest

import clock
from areas.requests import cancellation
from db import db
from errors import ApiRefusal
from factories import account, make_event, make_venue, make_booking, make_hold, make_equipment_requirement
from models import (EquipmentType, EventRequest, Reservation, VenueBookingRequest, VenueHold,
                    EquipmentRequirement, Notification)

NOW = datetime(2036, 6, 10, 10)
REASON = 'Organiser has withdrawn the event.'
MODELS = (EventRequest, VenueBookingRequest, VenueHold, EquipmentRequirement, Reservation, EquipmentType, Notification)


def login(client, user='coord1'):
    with client.session_transaction() as session:
        session['account_id'] = account(user).id


def snapshot():
    db.session.expire_all()
    return {m.__tablename__: [{c.name: getattr(row, c.name) for c in m.__table__.columns}
                             for row in db.session.query(m).order_by(m.id)] for m in MODELS}


@pytest.fixture
def event(client, monkeypatch):
    monkeypatch.setattr(clock, 'now_local', lambda: NOW)
    row = make_event(name='SCRUM-65 owned event', status='Planning', date='2036-06-10',
                     start_time='13:00', end_time='15:00', assigned_coordinator=account('coord1'))
    login(client)
    return row


def url(event):
    return f'/api/requests/{event.id}/cancel'


def arrangements(event):
    bookings = [make_booking(event=event, venue=make_venue(name=f'SCRUM-65 venue {i}'), status=stage)
                for i, stage in enumerate(('Approved', 'Approved', 'Requested', 'Rejected', 'Withdrawn', 'Cancelled'))]
    bookings[-1].cancel_reason = 'Earlier venue arrangement withdrawn'
    bookings[0].decision = 'Approved'; bookings[0].decided_by = account('venue1')
    bookings[0].decided_at = datetime(2036, 6, 9, 1)
    holds = [make_hold(event=event, venue=make_venue(name=f'SCRUM-65 hold {i}'),
                      status=stage, expires_at='2036-06-10T12:00')
             for i, stage in enumerate(('Held', 'Released', 'Expired'))]
    holds[0].warning_sent_at = NOW - timedelta(hours=1)
    equipment = EquipmentType(name='SCRUM-65 projector', total_units=10)
    db.session.add(equipment); db.session.commit()
    requirement = make_equipment_requirement(event=event, equipment=equipment, quantity=3, status='Approved', technical_requirements='HDMI')
    reservations = [Reservation(event_request_id=event.id, equipment_type_id=equipment.id, quantity=3,
                               date=event.date, start_time=event.start_time, end_time=event.end_time, status=stage)
                    for stage in ('Reserved', 'Released')]
    db.session.add_all(reservations); db.session.commit()
    return bookings, holds, equipment, requirement, reservations


@pytest.mark.parametrize('stage', ['Submitted', 'Approved', 'Planning', 'Safety Check', 'Confirmed'])
def test_all_allowed_stages_without_arrangements(client, event, stage):
    event.status = stage; db.session.commit()
    before = snapshot()
    reply = client.post(url(event), json={'reason': '  '+REASON+'  ', 'status': 'Completed',
                                        'cancelled_by': 'org1', 'cancelled_at': '1900-01-01'})
    assert reply.status_code == 200
    assert reply.json['status'] == 'Cancelled'
    assert reply.json['cancellation'] == {'cancelled_by': 'coord1', 'cancelled_at': '2036-06-10T02:00:00Z', 'reason': REASON}
    after = snapshot()
    original = next(r for r in before['event_requests'] if r['id'] == event.id)
    changed = next(r for r in after['event_requests'] if r['id'] == event.id)
    ignore = ('status', 'cancelled_by_id', 'cancelled_at', 'cancel_reason')
    assert {k:v for k,v in original.items() if k not in ignore} == {k:v for k,v in changed.items() if k not in ignore}
    for user in ('org1', 'coord1'):
        login(client, user)
        detail = client.get(f'/api/requests/{event.id}')
        assert detail.status_code == 200
        assert detail.json['cancellation'] == reply.json['cancellation']
    # SCRUM-64 appends the cancellation notices; no existing notice is changed.
    assert after['notifications'][:len(before['notifications'])] == before['notifications']


def test_all_commitments_release_preserving_history_other_events_and_stock(client, event):
    bookings, holds, equipment, requirement, reservations = arrangements(event)
    other = make_event(name='SCRUM-65 other event', status='Planning', date=event.date,
                       start_time='13:00', end_time='15:00', assigned_coordinator=account('coord2'))
    other_booking = make_booking(event=other, venue=make_venue(name='SCRUM-65 other venue'), status='Approved')
    other_reservation = Reservation(event_request_id=other.id, equipment_type_id=equipment.id, quantity=2,
                                    date=event.date, start_time='13:00', end_time='15:00', status='Reserved')
    db.session.add(other_reservation); db.session.commit()
    before = snapshot()
    assert client.post(url(event), json={'reason': REASON}).status_code == 200
    assert [b.status for b in bookings] == ['Cancelled', 'Cancelled', 'Withdrawn', 'Rejected', 'Withdrawn', 'Cancelled']
    assert [h.status for h in holds] == ['Released', 'Released', 'Expired']
    assert [r.status for r in reservations] == ['Released', 'Released']
    for booking in bookings[:2]:
        assert (booking.cancel_reason, booking.cancelled_by_id, booking.cancelled_at) == (REASON, account('coord1').id, datetime(2036,6,10,2))
    assert holds[0].released_at == datetime(2036,6,10,2)
    after = snapshot()
    assert after['equipment_types'] == before['equipment_types']
    assert after['equipment_requirements'] == before['equipment_requirements']
    # SCRUM-64 appends the cancellation notices; no existing notice is changed.
    assert after['notifications'][:len(before['notifications'])] == before['notifications']
    for model, rows in [(VenueBookingRequest, bookings[3:]+[other_booking]), (VenueHold, holds[1:]), (Reservation, [reservations[1],other_reservation])]:
        ids = [row.id for row in rows]
        assert [x for x in before[model.__tablename__] if x['id'] in ids] == [x for x in after[model.__tablename__] if x['id'] in ids]
    login(client, 'tech1')
    response = client.get(f'/api/equipment/{equipment.id}/availability', query_string={'start':event.date+'T13:00','end':event.date+'T15:00'})
    assert response.status_code == 200
    assert response.json['available_units'] == 8
    assert db.session.get(EquipmentType, equipment.id).total_units == 10
    login(client, 'lead1')
    assert event.id not in [row['id'] for row in client.get('/api/assignments').json['events']]
    login(client)
    assert event.id in [row['id'] for row in client.get('/api/requests').json]


@pytest.mark.parametrize('body,message', [
    ({}, 'Cancellation reason is required.'), ({'reason':''}, 'Cancellation reason is required.'),
    ({'reason':'   '}, 'Cancellation reason is required.'), ({'reason':'\t\n'}, 'Cancellation reason is required.'),
    ({'reason':None}, 'Cancellation reason must be text.'), ({'reason':1}, 'Cancellation reason must be text.'),
    ([], 'A JSON object containing reason is required.'), ('reason', 'A JSON object containing reason is required.')])
def test_invalid_reason_refused_without_any_changes(client, event, body, message):
    arrangements(event); before = snapshot()
    reply = client.post(url(event), json=body)
    assert reply.status_code == 400
    assert reply.json == {'message': message}
    assert snapshot() == before


def test_absent_body_refused(client, event):
    before = snapshot()
    reply = client.post(url(event))
    assert reply.status_code == 400
    assert reply.json == {'message':'A JSON object containing reason is required.'}
    assert snapshot() == before


@pytest.mark.parametrize('stage,code', [('Draft',404),('Rejected',409),('Completed',409),('Cancelled',409)])
def test_prohibited_stages_and_repeat_keep_original_metadata(client, event, stage, code):
    event.status = stage
    event.cancelled_at = datetime(2036,6,9,2); event.cancelled_by = account('coord1'); event.cancel_reason = 'Original reason'
    db.session.commit(); before = snapshot()
    reply = client.post(url(event), json={'reason':REASON})
    assert reply.status_code == code
    assert reply.json['message'] == ('Event request not found.' if stage=='Draft' else 'Only a Submitted, Approved, Planning, Safety Check or Confirmed event can be cancelled.')
    assert snapshot() == before


@pytest.mark.parametrize('user,code', [('coord2',404),('org1',403),('lead1',403),('tech1',403),('venue1',403),('safety1',403),('leadcoord1',404)])
def test_wrong_role_or_assignment_refused(client, event, user, code):
    before = snapshot(); login(client,user)
    reply = client.post(url(event), json={'reason':REASON})
    assert reply.status_code == code
    assert reply.json == {'message':'Event request not found.' if code==404 else 'You do not have permission to perform this action.'}
    assert snapshot() == before


def test_service_feature_guard_missing_unassigned_and_anonymous(client, event):
    before = snapshot()
    with pytest.raises(ApiRefusal) as error:
        cancellation.cancel_event(account('org1'), event.id, {'reason':REASON})
    assert (error.value.status,error.value.message) == (403,'You do not have permission to perform this action.')
    assert snapshot() == before
    assert client.post('/api/requests/999999/cancel', json={'reason':REASON}).status_code == 404
    event.assigned_coordinator = None; db.session.commit(); before = snapshot()
    assert client.post(url(event), json={'reason':REASON}).status_code == 404
    assert snapshot() == before
    with client.session_transaction() as session: session.clear()
    assert client.post(url(event), json={'reason':REASON}).status_code == 401


def test_multirole_assigned_coordinator_can_cancel(client, event):
    event.assigned_coordinator = account('leadcoord1'); db.session.commit(); login(client,'leadcoord1')
    assert client.post(url(event), json={'reason':REASON}).status_code == 200


def test_partial_writes_and_metadata_roll_back_on_commit_failure(client, event, monkeypatch):
    arrangements(event); before = snapshot()
    def fail():
        db.session.flush()
        raise RuntimeError('simulated storage failure after flush')
    monkeypatch.setattr(db.session, 'commit', fail)
    with pytest.raises(RuntimeError, match='simulated storage failure after flush'):
        cancellation.cancel_event(account('coord1'), event.id, {'reason':REASON})
    assert snapshot() == before


@pytest.mark.parametrize('metadata', ['none','timestamp_only','actor_only'])
def test_legacy_partial_cancellation_metadata_readable(client, event, metadata):
    event.status = 'Cancelled'
    if metadata == 'timestamp_only': event.cancelled_at = datetime(2036,6,10,2)
    if metadata == 'actor_only': event.cancelled_by = account('coord1')
    db.session.commit(); before = snapshot()
    reply = client.get(f'/api/requests/{event.id}')
    assert reply.status_code == 200
    assert reply.json['status'] == 'Cancelled'
    assert 'cancellation' not in reply.json
    assert snapshot() == before


def test_cancelled_event_cannot_be_resubmitted_completed_or_replanned(client, event):
    arrangements(event)
    assert client.post(url(event), json={'reason':REASON}).status_code == 200
    before = snapshot()
    assert client.post(f'/api/requests/{event.id}/complete').status_code == 409
    for action in ('approve','reject','send-for-safety-check'):
        assert client.post(f'/api/requests/{event.id}/{action}', json={'reason':'Try again'}).status_code == 409
        assert snapshot() == before
    login(client,'org1')
    assert client.post(f'/api/requests/{event.id}/resubmit', json={}).status_code == 400
    assert client.put(f'/api/requests/{event.id}', json={'name':'Reopen'}).status_code == 400
    assert client.delete(f'/api/requests/{event.id}').status_code == 400
    assert snapshot() == before


def test_stale_identity_map_is_reloaded_under_event_lock(client, event):
    from sqlalchemy import update
    event_id = event.id
    coordinator_id = account('coord2').id
    before = snapshot()
    session = db.session()
    session.expire_on_commit = False
    try:
        session.execute(update(EventRequest).where(EventRequest.id==event_id)
                        .values(assigned_coordinator_id=coordinator_id), execution_options={'synchronize_session':False})
        session.commit()
    finally:
        session.expire_on_commit = True
    assert event.assigned_coordinator_id == account('coord1').id  # Deliberately stale.
    next(row for row in before['event_requests'] if row['id']==event_id)['assigned_coordinator_id'] = coordinator_id
    with pytest.raises(ApiRefusal) as error:
        cancellation.cancel_event(account('coord1'), event_id, {'reason':REASON})
    assert error.value.status == 404
    assert snapshot() == before


@pytest.mark.parametrize('competition', ['reserve','cancel'])
def test_concurrent_reservation_or_repeat_cannot_survive_event_cancellation(tmp_path, competition):
    from app import create_app
    from seed import seed_database
    app = create_app({'TESTING':True,'SQLALCHEMY_DATABASE_URI':f'sqlite:///{tmp_path / "cancel-race.db"}',
                      'PASSWORD_HASH_METHOD':'pbkdf2:sha256:1'})
    with app.app_context():
        db.create_all(); seed_database(db,standing_bookings=False)
        e = make_event(name='Cancellation race',status='Planning',date='2036-06-10',start_time='13:00',end_time='15:00',assigned_coordinator=account('coord1'))
        eq = EquipmentType(name='Cancellation race type',total_units=4); db.session.add(eq); db.session.commit()
        req = make_equipment_requirement(event=e,equipment=eq,quantity=4,status='Approved')
        cancel_url=url(e); reserve_url=f'/api/requests/{e.id}/equipment/{req.id}/reserve'
        event_id=e.id; coordinator=account('coord1').id; staff=account('tech1').id
        db.session.remove()
    barrier=Barrier(2)
    def attempt(action):
        with app.test_client() as c:
            with c.session_transaction() as session:session['account_id']=coordinator if action=='cancel' else staff
            barrier.wait(timeout=10)
            reply=c.post(cancel_url,json={'reason':REASON}) if action=='cancel' else c.post(reserve_url)
            return reply.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:codes=list(pool.map(attempt,['cancel',competition]))
    if competition == 'cancel':
        assert sorted(codes) == [200,409]
    else:
        assert codes[0] == 200
    with app.app_context():
        assert db.session.get(EventRequest,event_id).status == 'Cancelled'
        rows = db.session.query(Reservation).filter_by(event_request_id=event_id).all()
        if competition == 'reserve':
            assert codes[1] == (201 if rows else 409)
        assert all(row.status == 'Released' for row in rows)
        db.session.remove(); db.engine.dispose()


# @story: SCRUM-65
# @ac: 3, 5, 6
@pytest.mark.parametrize('operation', ['raise', 'hold', 'approve'])
def test_booking_write_rechecks_state_after_concurrent_cancellation(tmp_path, monkeypatch, operation):
    """Pause a real ORM load, cancel in another session, then resume the stale writer."""
    from threading import Event, current_thread
    from sqlalchemy import event as sa_event
    from sqlalchemy.orm import Session
    from app import create_app
    from seed import seed_database

    app = create_app({'TESTING': True,
                      'SQLALCHEMY_DATABASE_URI': f'sqlite:///{tmp_path / "venue-cancel-race.db"}',
                      'PASSWORD_HASH_METHOD': 'pbkdf2:sha256:1'})
    monkeypatch.setattr(clock, 'now_local', lambda: NOW)
    with app.app_context():
        db.create_all(); seed_database(db, standing_bookings=False)
        e = make_event(name='SCRUM-65 venue cancellation race', status='Approved',
                       date='2036-06-10', start_time='13:00', end_time='15:00',
                       assigned_coordinator=account('coord1'))
        venue = make_venue(name='SCRUM-65 race venue')
        booking = make_booking(event=e, venue=venue, status='Requested') if operation == 'approve' else None
        event_id, venue_id = e.id, venue.id
        coordinator, staff = account('coord1').id, account('venue1').id
        endpoint = (f'/api/venues/{venue_id}/bookings/{booking.id}/approve' if booking else
                    f'/api/requests/{event_id}/'+('holds' if operation == 'hold' else 'bookings'))
        target = VenueBookingRequest if booking else EventRequest
        target_id = booking.id if booking else event_id
        notifications_before = [{c.name: getattr(row, c.name) for c in Notification.__table__.columns}
                                for row in db.session.query(Notification).order_by(Notification.id)]
        db.session.remove()
    cached, resume = Event(), Event()

    def pause_cached_read(session, row):
        if current_thread().name.startswith('venue-race') and isinstance(row, target) and row.id == target_id and not cached.is_set():
            cached.set()
            assert resume.wait(10), 'Cancellation did not finish while the cached read was paused.'

    def venue_write():
        with app.test_client() as c:
            with c.session_transaction() as session:
                session['account_id'] = staff if operation == 'approve' else coordinator
            data = {'venue_id': venue_id, 'expiry_date': '2036-06-10', 'expiry_time': '12:00'}
            response = c.post(endpoint, json=data)
            return response.status_code, response.json

    sa_event.listen(Session, 'loaded_as_persistent', pause_cached_read)
    try:
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix='venue-race') as pool:
            worker = pool.submit(venue_write)
            try:
                assert cached.wait(10), 'Venue operation never reached its real cached read.'
                with app.test_client() as c:
                    with c.session_transaction() as session: session['account_id'] = coordinator
                    response = c.post(f'/api/requests/{event_id}/cancel', json={'reason': REASON})
                    assert response.status_code == 200
            finally:
                resume.set()
            code, payload = worker.result(timeout=10)
        expected = {
            'raise': (400, 'A venue booking can be requested only for an Approved or Planning event.'),
            'hold': (400, 'A venue can be held only for an Approved or Planning event.'),
            'approve': (409, 'This booking request has already been decided (Withdrawn).'),
        }
        assert (code, payload.get('message')) == expected[operation]
        with app.app_context():
            e = db.session.get(EventRequest, event_id)
            assert e.status == 'Cancelled'
            assert e.cancel_reason == REASON
            assert [b.status for b in e.booking_requests] == (['Withdrawn'] if operation == 'approve' else [])
            assert e.venue_holds == []
            # SCRUM-64 appends the cancellation notices; no existing notice is changed.
            after_notices = [{c.name: getattr(row, c.name) for c in Notification.__table__.columns}
                             for row in db.session.query(Notification).order_by(Notification.id)]
            assert after_notices[:len(notifications_before)] == notifications_before
    finally:
        sa_event.remove(Session, 'loaded_as_persistent', pause_cached_read)
        with app.app_context():
            db.session.remove(); db.engine.dispose()
