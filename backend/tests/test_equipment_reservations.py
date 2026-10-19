"""SCRUM-51: real API transactions, eligibility, availability and preservation."""
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from areas.equipment import reservations, services
from db import db
from errors import ApiRefusal
from factories import account, make_event, make_equipment_requirement
from models import EquipmentRequirement, EquipmentType, EventRequest, Reservation

# @story: SCRUM-51
# @ac: 1, 2, 3, 4, 5, 6, 7

def login(client, username='tech1'):
    with client.session_transaction() as session:
        session['account_id'] = account(username).id


@pytest.fixture
def staged(client):
    event = make_event(name='Reservation event', status='Planning', date=(date.today()+timedelta(days=800)).isoformat(),
                       start_time='10:00', end_time='12:00', assigned_coordinator=account('coord1'))
    equipment = EquipmentType(name='Reservation owned type', total_units=10)
    db.session.add(equipment); db.session.commit()
    row = make_equipment_requirement(event=event, equipment=equipment, quantity=4,
                                    status='Approved', technical_requirements='HDMI')
    login(client)
    return event, row, equipment


def path(event, row):
    return f'/api/requests/{event.id}/equipment/{row.id}/reserve'


def release_path(event, reservation_id):
    return f'/api/requests/{event.id}/equipment/reservations/{reservation_id}/release'


def read_path(event):
    return f'/api/requests/{event.id}/equipment/reservations'


def holder(event, equipment, quantity, start='10:00', end='12:00', status='Reserved'):
    other = make_event(name='Holding event', status='Planning', date=event.date,
                       start_time=start, end_time=end)
    result = Reservation(event_request_id=other.id, equipment_type_id=equipment.id,
                         quantity=quantity, date=event.date, start_time=start, end_time=end, status=status)
    db.session.add(result); db.session.commit()
    return result


def snapshot():
    db.session.expire_all()
    return {
        'events': [(r.id, r.status, r.date, r.start_time, r.end_time) for r in db.session.query(EventRequest).order_by(EventRequest.id)],
        'requirements': [r.to_dict() for r in db.session.query(EquipmentRequirement).order_by(EquipmentRequirement.id)],
        'stock': [(r.id, r.total_units) for r in db.session.query(EquipmentType).order_by(EquipmentType.id)],
        'reservations': [(r.id, r.event_request_id, r.equipment_type_id, r.quantity, r.date, r.start_time, r.end_time, r.status) for r in db.session.query(Reservation).order_by(Reservation.id)],
    }


def available(client, event, equipment):
    response = client.get(f'/api/equipment/{equipment.id}/availability', query_string={
        'start': f'{event.date}T10:00', 'end': f'{event.date}T12:00'})
    assert response.status_code == 200
    return response.json


@pytest.mark.parametrize('stage', ['Approved', 'Planning'])
def test_full_quantity_snapshot_persistence_review_lock_and_release(client, staged, stage):
    event, row, equipment = staged
    event.status = stage; db.session.commit()
    before = snapshot()
    response = client.post(path(event, row), json={'quantity': 99, 'date': '2000-01-01', 'status': 'Released'})
    assert response.status_code == 201
    record = response.json['reservation']
    assert record == {'id': record['id'], 'event_request_id': event.id, 'equipment_type_id': equipment.id,
        'equipment_type_name': equipment.name, 'quantity': 4, 'date': event.date,
        'start_time': '10:00', 'end_time': '12:00', 'status': 'Reserved'}
    assert response.json['requirement']['has_unreleased_reservation'] is True
    assert available(client, event, equipment)['available_units'] == 6
    assert client.get(read_path(event)).json == [record]
    # Real SCRUM-81 integration: cannot correct a committed requirement.
    assert client.patch(f'/api/requests/{event.id}/equipment/{row.id}/decision', json={'decision':'Declined','reason':'Correction'}).status_code == 409
    response = client.post(release_path(event, record['id']))
    assert response.status_code == 200 and response.json['reservation']['status'] == 'Released'
    assert response.json['requirement']['has_unreleased_reservation'] is False
    assert available(client, event, equipment)['available_units'] == 10
    assert client.get(read_path(event)).json[0] == {**record, 'status':'Released'}
    after = snapshot()
    assert after['events'] == before['events'] and after['stock'] == before['stock']
    assert after['requirements'] == before['requirements']
    assert client.patch(f'/api/requests/{event.id}/equipment/{row.id}/decision', json={'decision':'Declined','reason':'Correction'}).status_code == 200


@pytest.mark.parametrize('committed,code,free', [(5,201,1), (6,201,0), (7,409,3)])
def test_below_at_above_available_boundary(client, staged, committed, code, free):
    event, row, equipment = staged
    existing = holder(event, equipment, committed)
    before = snapshot()
    response = client.post(path(event,row))
    assert response.status_code == code
    assert available(client,event,equipment)['available_units'] == free
    if code == 409:
        assert response.json['message'] == 'Insufficient equipment: 3 units available for this period.'
        assert snapshot() == before
    else:
        assert response.json['reservation']['quantity'] == 4
    assert db.session.get(Reservation,existing.id).quantity == committed


@pytest.mark.parametrize('start,end,code', [('08:00','09:59',201),('08:00','10:00',201),('08:00','10:01',409),
    ('11:59','13:00',409),('12:00','13:00',201),('12:01','13:00',201)])
def test_one_minute_overlap_touch_and_gap_both_directions(client, staged, start, end, code):
    event,row,equipment = staged
    equipment.total_units=4; db.session.commit()
    holder(event,equipment,4,start,end)
    assert client.post(path(event,row)).status_code == code


def test_non_simultaneous_commitments_use_peak_not_sum(client,staged):
    event,row,equipment=staged
    event.end_time='13:00'; db.session.commit()
    holder(event,equipment,6,'10:00','11:00'); holder(event,equipment,6,'12:00','13:00')
    assert client.post(path(event,row)).status_code == 201


def test_rechecks_after_an_earlier_read_and_preserves_records(client,staged):
    event,row,equipment=staged
    row.quantity=6; db.session.commit()
    assert available(client,event,equipment)['available_units'] == 10
    holder(event,equipment,5)
    before=snapshot()
    result=client.post(path(event,row))
    assert result.status_code == 409 and '5 units available' in result.json['message']
    assert snapshot() == before


def test_duplicate_refused_release_then_new_record_not_counting_history(client,staged):
    event,row,equipment=staged
    first=client.post(path(event,row)).json['reservation']
    before=snapshot()
    response=client.post(path(event,row))
    assert response.status_code == 409 and 'unreleased reservation' in response.json['message']
    assert snapshot()==before
    assert client.post(release_path(event,first['id'])).status_code==200
    equipment.total_units=4; db.session.commit()
    second=client.post(path(event,row))
    assert second.status_code==201 and second.json['reservation']['id']!=first['id']
    assert [r['status'] for r in client.get(read_path(event)).json]==['Released','Reserved']
    assert available(client,event,equipment)['reserved_units']==4


@pytest.mark.parametrize('status',['Requested','Declined'])
def test_non_approved_refused(client,staged,status):
    event,row,_=staged
    row.status=status; db.session.commit()
    before=snapshot(); result=client.post(path(event,row))
    assert result.status_code==409 and 'Approved' in result.json['message']
    assert snapshot()==before


@pytest.mark.parametrize('stage',['Draft','Submitted','Rejected','Safety Check','Confirmed','Completed','Cancelled'])
def test_prohibited_event_stages_refuse_both_actions(client,staged,stage):
    event,row,_=staged
    record=client.post(path(event,row)).json['reservation']
    event.status=stage; db.session.commit(); before=snapshot()
    expected=404 if stage=='Draft' else 409
    assert client.post(path(event,row)).status_code==expected
    assert client.post(release_path(event,record['id'])).status_code==expected
    assert snapshot()==before


@pytest.mark.parametrize('user',['org1','coord1','coord2','venue1','att1','safety1','multi1'])
def test_other_roles_cannot_mutate(client,staged,user):
    event,row,_=staged
    record=client.post(path(event,row)).json['reservation']; before=snapshot()
    login(client,user)
    for url in (path(event,row),release_path(event,record['id'])):
        result=client.post(url)
        assert result.status_code==403 and result.json['message']
    assert snapshot()==before


def test_missing_auth_and_scoped_reads(client,staged):
    event,row,_=staged
    record=client.post(path(event,row)).json['reservation']
    for user in ['coord1','tech1']:
        login(client,user)
        assert client.get(read_path(event)).json==[record]
        assert client.get(f'/api/requests/{event.id}/equipment').json['reservations']==[record]
    login(client,'coord2')
    assert client.get(read_path(event)).status_code==403
    assert client.get(f'/api/requests/{event.id}/equipment').status_code==403
    with client.session_transaction() as session: session.clear()
    assert client.get(read_path(event)).status_code==401
    assert client.post(path(event,row)).status_code==401
    assert client.post(release_path(event,record['id'])).status_code==401


@pytest.mark.parametrize('identifier',[999999,2**53])
def test_absent_and_oversized_ids_refused(client,staged,identifier):
    event,row,_=staged
    assert client.post(f'/api/requests/{event.id}/equipment/{identifier}/reserve').status_code==404
    assert client.post(release_path(event,identifier)).status_code==404
    assert client.get(f'/api/requests/{identifier}/equipment/reservations').status_code==404


def test_other_event_objects_refused_and_repeated_release_noop(client,staged):
    event,row,_=staged
    other=make_event(name='Different event',status='Planning',date=event.date,start_time='10:00',end_time='12:00')
    record=client.post(path(event,row)).json['reservation']; before=snapshot()
    assert client.post(path(other,row)).status_code==404
    assert client.post(release_path(other,record['id'])).status_code==404
    assert snapshot()==before
    assert client.post(release_path(event,record['id'])).status_code==200
    before=snapshot(); result=client.post(release_path(event,record['id']))
    assert result.status_code==409 and 'already been released' in result.json['message']
    assert snapshot()==before


@pytest.mark.parametrize('start,end,expected', [('12:00','10:00',409), ('10:00','10:00',409), (None,'12:00',400)])
def test_invalid_stored_event_period_refused(client,staged,start,end,expected):
    event,row,_=staged
    event.start_time=start; event.end_time=end; db.session.commit()
    before=snapshot()
    assert client.post(path(event,row)).status_code == expected
    assert snapshot()==before


def test_release_legacy_reservation_without_requirement_preserves_history(client,staged):
    event,row,_=staged
    record=client.post(path(event,row)).json['reservation']
    db.session.delete(row); db.session.commit()
    result=client.post(release_path(event,record['id']))
    assert result.status_code==200 and result.json['requirement'] is None
    assert result.json['reservation']['status']=='Released'


def test_service_permission_and_failure_roll_back_no_op_locks(client,staged,monkeypatch):
    event,row,_=staged
    before=snapshot()
    with pytest.raises(ApiRefusal) as error:
        reservations.reserve(account('coord1'),event.id,row.id)
    assert error.value.status==403
    def unavailable(*args,**kwargs): raise RuntimeError('Unavailable dependency')
    monkeypatch.setattr(services,'check_availability',unavailable)
    with pytest.raises(RuntimeError,match='Unavailable dependency'):
        client.post(path(event,row))
    assert snapshot()==before


def test_competing_reservations_on_file_database_never_overcommit(tmp_path):
    """Two independent real sessions race for the final units; no fake DB lock."""
    from app import create_app
    from seed import seed_database
    app=create_app({'TESTING':True,'SQLALCHEMY_DATABASE_URI':f'sqlite:///{tmp_path / "race.db"}',
                    'PASSWORD_HASH_METHOD':'pbkdf2:sha256:1'})
    with app.app_context():
        db.create_all(); seed_database(db,standing_bookings=False)
        equipment=EquipmentType(name='Concurrent type',total_units=4); db.session.add(equipment); db.session.commit()
        staff_id=account('tech1').id
        type_id=equipment.id
        targets=[]
        for n in range(2):
            event=make_event(name=f'Concurrent {n}',status='Planning',date=(date.today()+timedelta(days=800)).isoformat(),start_time='10:00',end_time='12:00')
            row=make_equipment_requirement(event=event,equipment=equipment,quantity=4,status='Approved')
            targets.append((event.id,row.id))
    barrier=Barrier(2)
    def attempt(target):
        with app.test_client() as client:
            with client.session_transaction() as session: session['account_id']=staff_id
            barrier.wait(timeout=10)
            return client.post(f'/api/requests/{target[0]}/equipment/{target[1]}/reserve').status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(attempt,targets))
    assert sorted(codes)==[201,409]
    with app.app_context():
        assert db.session.query(Reservation).filter_by(equipment_type_id=type_id,status='Reserved').count()==1
        db.session.remove(); db.engine.dispose()


@pytest.mark.parametrize('competition',['reserve','stock'])
def test_stock_reduction_and_reserve_share_the_authoritative_type_lock(tmp_path,competition):
    from app import create_app
    from seed import seed_database
    app=create_app({'TESTING':True,'SQLALCHEMY_DATABASE_URI':f'sqlite:///{tmp_path / "stock-race.db"}',
                    'PASSWORD_HASH_METHOD':'pbkdf2:sha256:1'})
    with app.app_context():
        db.create_all(); seed_database(db,standing_bookings=False)
        equipment=EquipmentType(name='Stock race type',total_units=4); db.session.add(equipment); db.session.commit()
        type_id=equipment.id; staff_id=account('tech1').id
        event=make_event(name='Stock race',status='Planning',date=(date.today()+timedelta(days=800)).isoformat(),start_time='10:00',end_time='12:00')
        row=make_equipment_requirement(event=event,equipment=equipment,quantity=4,status='Approved')
        reserve_url=path(event,row)
    barrier=Barrier(2)
    def attempt(mode):
        with app.test_client() as client:
            with client.session_transaction() as session: session['account_id']=staff_id
            barrier.wait(timeout=10)
            result=client.post(reserve_url) if mode=='reserve' else client.patch(f'/api/equipment/{type_id}',json={'total_units':0})
            return result.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(attempt,['reserve',competition]))
    if competition=='reserve': assert sorted(codes)==[201,409]
    else: assert tuple(codes) in [(201,400),(409,200)]
    with app.app_context():
        committed=sum(r.quantity for r in db.session.query(Reservation).filter_by(equipment_type_id=type_id,status='Reserved'))
        assert committed<=db.session.get(EquipmentType,type_id).total_units
        db.session.remove(); db.engine.dispose()


def test_reserve_consumes_shared_out_of_service_provider(client, staged, monkeypatch):
    """Contract test only: SCRUM-52's real storage/UI remains a dependency."""
    event, row, equipment = staged
    holder(event, equipment, 5)
    monkeypatch.setattr(services, '_units_out_of_service', lambda equipment: 2)
    check = available(client, event, equipment)
    assert (check['total_units'], check['reserved_units'], check['out_of_service_units'], check['available_units']) == (10, 5, 2, 3)
    before = snapshot()
    result = client.post(path(event, row))
    assert result.status_code == 409
    assert result.json == {'message': 'Insufficient equipment: 3 units available for this period.'}
    assert snapshot() == before


@pytest.mark.parametrize('event_id', [999999, 2**53])
def test_absent_event_reservation_writes_are_404(client, staged, event_id):
    _, row, _ = staged
    before = snapshot()
    assert client.post(f'/api/requests/{event_id}/equipment/{row.id}/reserve').status_code == 404
    assert client.post(f'/api/requests/{event_id}/equipment/reservations/1/release').status_code == 404
    assert snapshot() == before
