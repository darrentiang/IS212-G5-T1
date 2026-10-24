"""SCRUM-66: completion boundary, permissions, atomicity and preservation."""
# @story: SCRUM-66
# @ac: 1, 2, 3, 4, 5
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import clock
from areas.requests import completion
from db import db
from errors import ApiRefusal
from factories import account, make_event, make_venue, make_booking, make_equipment_requirement
from models import EventRequest, EquipmentType, Reservation, Notification

NOW = datetime(2035, 6, 10, 12)


def login(client, username='coord1'):
    with client.session_transaction() as session:
        session['account_id'] = account(username).id


@pytest.fixture
def event(client, monkeypatch):
    monkeypatch.setattr(clock, 'now_local', lambda: NOW)
    row = make_event(name='SCRUM-66 owned event', status='Confirmed', date='2035-06-10',
                     start_time='10:00', end_time='12:00', assigned_coordinator=account('coord1'))
    login(client)
    return row


def url(event):
    return f'/api/requests/{event.id}/complete'


def state(event):
    db.session.refresh(event)
    return {c.name: getattr(event, c.name) for c in EventRequest.__table__.columns}


@pytest.mark.parametrize('now,allowed', [(NOW.replace(hour=11,minute=59),False),(NOW,True),
                                        (NOW.replace(minute=1),True),(NOW.replace(day=9,hour=13),False)])
def test_end_boundary_and_date(client, event, monkeypatch, now, allowed):
    monkeypatch.setattr(clock, 'now_local', lambda: now)
    before=state(event)
    reply=client.post(url(event),json={'status':'Planning','completed_by':'org1','completed_at':'1900-01-01'})
    assert reply.status_code == (200 if allowed else 409)
    if not allowed:
        assert reply.json['message'] == 'The event cannot be completed before its scheduled end.'
        assert state(event)==before
        return
    assert reply.json['status']=='Completed'
    assert reply.json['completion']=={'completed_by':'coord1','completed_at':now.replace(tzinfo=clock.SINGAPORE).astimezone(timezone.utc).replace(tzinfo=None).isoformat()+'Z'}
    after=state(event)
    assert {k:v for k,v in after.items() if k not in ('status','completed_at','completed_by_id')} == {k:v for k,v in before.items() if k not in ('status','completed_at','completed_by_id')}
    assert client.get(f'/api/requests/{event.id}').json['completion']==reply.json['completion']


@pytest.mark.parametrize('status', ['Planning','Completed','Draft'])
def test_wrong_stage_and_repeat_preserve(client, event, status):
    event.status=status
    if status=='Completed':
        event.completed_at=datetime(2035,6,10,3)
        event.completed_by=account('coord1')
    db.session.commit()
    before=state(event)
    reply=client.post(url(event))
    assert reply.status_code==(404 if status=='Draft' else 409)
    assert state(event)==before


@pytest.mark.parametrize('user,code',[('coord2',404),('org1',403),('tech1',403),('lead1',403),('leadcoord1',404)])
def test_wrong_role_or_assignment(client,event,user,code):
    login(client,user)
    before=state(event)
    assert client.post(url(event)).status_code==code
    assert state(event)==before


def test_missing_unassigned_and_anonymous(client,event):
    assert client.post('/api/requests/999999/complete').status_code==404
    event.assigned_coordinator=None
    db.session.commit()
    before=state(event)
    assert client.post(url(event)).status_code==404
    assert state(event)==before
    with client.session_transaction() as session: session.clear()
    assert client.post(url(event)).status_code==401


@pytest.mark.parametrize('changes',[{'date':None},{'end_time':'bad'},{'end_time':'09:00'},
                                    {'end_time':'12:00+08:00'},{'start_time':'10:00+08:00'}])
def test_invalid_stored_period(client,event,changes):
    for key,value in changes.items(): setattr(event,key,value)
    db.session.commit()
    before=state(event)
    reply=client.post(url(event))
    assert reply.status_code==400
    assert reply.json['message']=='The event has an invalid scheduled period.'
    assert state(event)==before


def test_service_does_not_trust_caller_role(client,event):
    before=state(event)
    with pytest.raises(ApiRefusal) as error: completion.complete_event(account('org1'),event.id)
    assert error.value.status==403
    assert error.value.message=="You do not have permission to perform this action."
    assert state(event)==before


def test_stale_conditional_write_refused(client,event,monkeypatch):
    before=state(event)
    monkeypatch.setattr(db.session,'execute',lambda *a,**kw:SimpleNamespace(rowcount=0))
    with pytest.raises(ApiRefusal) as error: completion.complete_event(account('coord1'),event.id)
    assert error.value.status==409
    assert state(event)==before


def test_failed_commit_rolls_back(client,event,monkeypatch):
    before=state(event)
    def fail(): raise RuntimeError('database unavailable')
    monkeypatch.setattr(db.session,'commit',fail)
    with pytest.raises(RuntimeError,match='database unavailable'):
        completion.complete_event(account('coord1'),event.id)
    assert state(event)==before


def test_arrangements_active_views_and_authorised_history(client,event):
    venue=make_venue(name='SCRUM-66 venue')
    booking=make_booking(event=event,venue=venue,status='Approved')
    equipment=EquipmentType(name='SCRUM-66 projector',total_units=10)
    db.session.add(equipment);db.session.commit()
    requirement=make_equipment_requirement(event=event,equipment=equipment,quantity=2,status='Approved')
    reservation=Reservation(event_request_id=event.id,equipment_type_id=equipment.id,quantity=2,
                            date=event.date,start_time='10:00',end_time='12:00',status='Reserved')
    db.session.add(reservation);db.session.commit()
    def arrangements():
        db.session.expire_all()
        return {obj.__tablename__:[{c.name:getattr(r,c.name) for c in obj.__table__.columns}
               for r in db.session.query(obj).order_by(obj.id)]
               for obj in (type(booking),type(requirement),Reservation,EquipmentType,Notification)}
    before=arrangements()
    login(client,'lead1')
    count=next(c for c in client.get('/api/assignments').json['coordinators'] if c['username']=='coord1')['active_events']
    login(client)
    assert client.post(url(event)).status_code==200
    assert arrangements()==before
    login(client,'lead1')
    overview=client.get('/api/assignments').json
    assert event.id not in [e['id'] for e in overview['events']]
    assert next(c for c in overview['coordinators'] if c['username']=='coord1')['active_events']==count-1
    assert client.get(f'/api/requests/{event.id}').status_code==200
    for user in ('org1','coord1'):
        login(client,user)
        assert client.get(f'/api/requests/{event.id}').json['status']=='Completed'


def test_existing_lifecycle_actions_cannot_reopen(client,event):
    assert client.post(url(event)).status_code==200
    before=state(event)
    for action in ('approve','reject','send-for-safety-check'):
        response=client.post(f'/api/requests/{event.id}/{action}',json={'reason':'Attempt'})
        assert response.status_code==409
        assert state(event)==before
    login(client,'org1')
    assert client.post(f'/api/requests/{event.id}/resubmit',json={}).status_code==400
    assert client.put(f'/api/requests/{event.id}',json={'name':'Changed'}).status_code==400
    assert client.delete(f'/api/requests/{event.id}').status_code==400
    assert state(event)==before
    login(client,'safety1')
    for action in ('approve','reject','request-changes'):
        assert client.post(f'/api/requests/{event.id}/safety/{action}',json={'reason':'Attempt','areas':['technical_arrangements']}).status_code==404
        assert state(event)==before


@pytest.mark.parametrize('metadata', ['none', 'timestamp_only', 'actor_only'])
def test_legacy_or_partial_completion_metadata_readable(client, event, metadata):
    event.status = 'Completed'
    if metadata == 'timestamp_only':
        event.completed_at = datetime(2035, 6, 10, 4)
    if metadata == 'actor_only':
        event.completed_by = account('coord1')
    db.session.commit()
    before = state(event)
    reply = client.get(f'/api/requests/{event.id}')
    assert reply.status_code == 200
    assert reply.json['status'] == 'Completed'
    assert 'completion' not in reply.json
    assert state(event) == before


def test_early_morning_completion_records_previous_utc_date(client, event, monkeypatch):
    event.start_time = '00:00'
    event.end_time = '00:01'
    db.session.commit()
    monkeypatch.setattr(clock, 'now_local', lambda: datetime(2035, 6, 10, 0, 1))
    reply = client.post(url(event))
    assert reply.status_code == 200
    assert reply.json['completion'] == {
        'completed_by': 'coord1', 'completed_at': '2035-06-09T16:01:00Z',
    }
